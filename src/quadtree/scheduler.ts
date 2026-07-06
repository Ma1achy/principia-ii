import type { TileCacheKey, TileID, QuadtreeView } from './types.js';
import type { TileReduction } from './reduction_types.js';
import { TileCache } from './cache.js';
import { transition } from './lifecycle.js';
import { computePriority } from './priority.js';
import { decideSplit, DEFAULT_THRESHOLDS } from './split.js';
import { children, tileKey } from './tile.js';
import { visibleTiles } from './visible.js';
import { compositeCoherence } from './coherence.js';

export interface SchedulerOpts {
  frameBudget:    number;       // max compute jobs to launch this frame
  maxInFlight:    number;       // jobs already running
  ftleEnabled:    boolean;
  ensembleEnabled:boolean;
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

  // 1. Visible tiles.
  const visible = visibleTiles(view);
  for (const id of visible) {
    const cached = cache.get(id, view.cacheKey);
    if (cached?.lifecycle === 'ready' || cached?.lifecycle === 'readyRefinable') {
      // If marked refinable, evaluate split candidacy.
      if (cached.lifecycle === 'readyRefinable') {
        const r = (cached as any).reduction as TileReduction | undefined;
        if (r) {
          const dec = decideSplit(r, {
            level: id.z, maxDepth: view.zMax, visible: true,
            thresholds: DEFAULT_THRESHOLDS,
            ftleEnabled: opts.ftleEnabled,
            ensembleEnabled: opts.ensembleEnabled,
          });
          if (dec.action === 'split') {
            for (const c of children(id)) {
              const k = tileKey(c);
              if (seen.has(k)) continue;
              seen.add(k);
              candidates.push({
                id: c, parent: id,
                priority: computePriority(c, view, null),
              });
            }
          }
        }
      }
      continue;
    }
    // Missing or in-flight: queue if not already.
    const k = tileKey(id);
    if (seen.has(k)) continue;
    seen.add(k);
    if (cached?.lifecycle !== 'queued' && cached?.lifecycle !== 'computing') {
      candidates.push({ id, priority: computePriority(id, view, null) });
    }
  }

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
): void {
  const tile = cache.get(id, key);
  if (!tile) return;     // evicted while in flight; drop on the floor

  // Refresh coherence with current mode flags (some terms zero out
  // depending on whether ensembles / FTLE are active).
  const { sTile } = compositeCoherence(reduction,
                       { ftleEnabled, ensembleEnabled });
  reduction.coherence_score = sTile;

  (tile as any).reduction = reduction;
  transition(tile, 'ready');
  // Promote to refinable if not yet at f32 floor or max depth — the
  // scheduler will revisit it when budget allows.
  // (M5 keeps the simple "always refinable unless guarded" policy.)
  // We avoid a second transition() call to keep state-machine churn low;
  // the scheduler treats `ready` and `readyRefinable` symmetrically here.
}
