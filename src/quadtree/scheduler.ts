import type { TileCacheKey, TileID, QuadtreeView } from './types.js';
import type { TileReduction } from './reduction_types.js';
import { TILE_STATUS } from './reduction_types.js';
import { TileCache } from './cache.js';
import { transition } from './lifecycle.js';
import { computePriority } from './priority.js';
import { decideSplit, DEFAULT_THRESHOLDS } from './split.js';
import { children, tileKey } from './tile.js';
import { visibleTiles } from './visible.js';
import { compositeCoherence } from './coherence.js';
import { reachedF32Floor } from './pyramid.js';

/** How far below the visible frontier live refinement may descend. Bounds
 *  both the scheduler's proposals and the frame loop's overlay draws:
 *  each level quadruples the worst-case tile count, and two levels already
 *  give 4× the effective sample density at fixed zoom. */
export const REFINE_LEVELS_MAX = 2;

export interface SchedulerOpts {
  frameBudget:    number;       // max compute jobs to launch this frame
  maxInFlight:    number;       // jobs already running
  ftleEnabled:    boolean;
  ensembleEnabled:boolean;
}

/** Depth-refinement context for ingestReduction: how the floor and ceiling
 *  are derived for the tile being ingested. Optional everywhere so the M5
 *  harness / existing callers keep their exact behaviour ('ready' only). */
export interface RefineOpts {
  samplesPerAxis: number;       // per-tile N — sets the f32 floor depth
  maxDepth:       number;       // ViewState.maxDepth (the zMax ceiling)
}

export interface FrameJob {
  id:        TileID;
  priority:  number;
  parent?:   TileID;
}

/**
 * Pure-CPU pass that the renderer wraps a GPU dispatch loop around. It:
 *   1. Lists visible tiles at the desired depth.
 *   2. For each missing tile, walks ancestors to draw a fallback.
 *   3. Computes priority for every visible tile and every candidate
 *      child of a refinable tile.
 *   4. Top-K of the candidates becomes this frame's compute jobs.
 *
 * Returns the jobs ordered highest-priority first.
 */
export function planFrame(
  cache: TileCache, view: QuadtreeView, opts: SchedulerOpts,
): FrameJob[] {
  const candidates: FrameJob[] = [];
  const seen = new Set<string>();

  // Evaluate one tile of the (possibly refined) frontier. A refinable
  // tile that decideSplit approves proposes its four children; children
  // that are already computed recurse — that is what carries refinement
  // PAST one level (a ready child is itself refinable until the floor,
  // maxDepth, or the REFINE_LEVELS_MAX descent cap stops it).
  const evaluate = (id: TileID, depthBelowBase: number, parent?: TileID): void => {
    const cached = cache.get(id, view.cacheKey);
    if (cached?.lifecycle === 'ready' || cached?.lifecycle === 'readyRefinable') {
      if (cached.lifecycle !== 'readyRefinable') return;
      if (depthBelowBase >= REFINE_LEVELS_MAX) return;
      const r = (cached as any).reduction as TileReduction | undefined;
      if (!r) return;
      const dec = decideSplit(r, {
        level: id.z, maxDepth: view.zMax, visible: true,
        thresholds: DEFAULT_THRESHOLDS,
        ftleEnabled: opts.ftleEnabled,
        ensembleEnabled: opts.ensembleEnabled,
      });
      if (dec.action !== 'split') return;
      for (const c of children(id)) evaluate(c, depthBelowBase + 1, id);
      return;
    }
    // Missing or in-flight: queue if not already.
    const k = tileKey(id);
    if (seen.has(k)) return;
    seen.add(k);
    if (cached?.lifecycle !== 'queued' && cached?.lifecycle !== 'computing') {
      candidates.push({
        id, priority: computePriority(id, view, null),
        ...(parent ? { parent } : {}),
      });
    }
  };

  // 1. Visible tiles (the zBase frontier) and their refinement chains.
  const visible = visibleTiles(view);
  for (const id of visible) evaluate(id, 0);

  // 2. Sort by priority desc, take top-K up to remaining budget.
  candidates.sort((a, b) => b.priority - a.priority);
  const budget = Math.max(0, opts.frameBudget - opts.maxInFlight);
  return candidates.slice(0, budget);
}

/**
 * Called when the GPU finishes a tile. Updates the lifecycle and stores
 * the reduction; the caller is responsible for the cache itself
 * (this function only mutates lifecycle and bookkeeping).
 */
export function ingestReduction(
  cache: TileCache, key: TileCacheKey,
  id: TileID, reduction: TileReduction,
  ftleEnabled: boolean, ensembleEnabled: boolean,
  refine?: RefineOpts,
): void {
  const tile = cache.get(id, key);
  if (!tile) return;     // evicted while in flight; drop on the floor

  // Refresh coherence with current mode flags (some terms zero out
  // depending on whether ensembles / FTLE are active).
  const { sTile } = compositeCoherence(reduction,
                       { ftleEnabled, ensembleEnabled });
  reduction.coherence_score = sTile;

  // DS.1: the f32-floor bit is CPU-derived (the GPU kernel has no depth
  // context) — stamp it here so decideSplit's hard guard binds in the
  // live loop exactly as it does in the depth-stress harness.
  if (refine && reachedF32Floor(id.z, refine.samplesPerAxis)) {
    reduction.status_flags |= TILE_STATUS.AT_F32_FLOOR;
  }

  (tile as any).reduction = reduction;
  transition(tile, 'ready');
  // Promote to refinable unless the floor or the depth ceiling forbids
  // ever splitting this tile — the scheduler revisits it when budget
  // allows. Callers without a RefineOpts (the M5 harness, older tests)
  // keep the plain 'ready' terminal state.
  if (refine
      && (reduction.status_flags & TILE_STATUS.AT_F32_FLOOR) === 0
      && id.z < refine.maxDepth) {
    transition(tile, 'readyRefinable');
  }
}
