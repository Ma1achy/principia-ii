# M5 — Layer 2: GPU reduction + adaptive refinement

## Goal

Tile-level decisions become data-driven. The GPU reduces `SimResult[N²]`
into a 272-byte `TileReduction` per tile, the CPU reads it back, scores
coherence, and decides what to split. Compute budget concentrates at
fractal boundaries; uniform basin interiors stay coarse.

**Exit criterion.**

```bash
npm test -- --run test/integration/layer2
```

A uniform-basin tile has `coherence_score ≤ 0.05` and is never split below
depth 4 with budget unbounded. A fractal-boundary tile splits all the way
to `MAX_DEPTH`. Off-screen tiles are cancelled before dispatch.

## File tree

```
principia/
  src/
    quadtree/
      lifecycle.ts            # state-machine helpers
      priority.ts             # priority scoring
      coherence.ts            # composite coherence score
      split.ts                # split / keep / merge logic
      eviction.ts             # weighted-LRU
      scheduler.ts            # per-frame loop
      reduction_types.ts      # MODIFIED: TileReduction interface pinned to the field table
    gpu/
      structs.ts              # MODIFIED (from M3): + TILE_REDUCTION_FIELDS table,
                              #   generated decodeTileReduction, TILE_REDUCTION_SCHEMA_VERSION
      shaders/
        reduce.wgsl           # writes TILE_REDUCTION_SCHEMA_VERSION into the version slot
      reduce_pipeline.ts
      reduce_dispatch.ts
      reduce_readback.ts      # MODIFIED: imports the generated decoder + schema check
  test/
    unit/quadtree/
      lifecycle.test.ts
      priority.test.ts
      coherence.test.ts
      split.test.ts
      eviction.test.ts
    golden/
      tile_reduction_layout.test.ts   # ADR-0006 golden byte-fixture round-trip
                                       #   + schema-version-mismatch guard
    integration/
      layer2_basin_stays_coarse.test.ts
      layer2_boundary_refines.test.ts
      layer2_offscreen_cancellation.test.ts
```

## `src/quadtree/lifecycle.ts`

```ts
import type { CachedTile, Lifecycle } from './types.js';

/**
 * Allowed transitions. Anything not listed is a bug.
 *
 *   unseen        → queued
 *   queued        → computing | unseen (cancel)
 *   computing     → ready | unseen (failure with no recovery)
 *   ready         → readyRefinable | unseen (eviction)
 *   readyRefinable → computing (split / re-dispatch) | unseen
 */
const TRANSITIONS: Record<Lifecycle, readonly Lifecycle[]> = {
  unseen:         ['queued'],
  queued:         ['computing', 'unseen'],
  computing:      ['ready',     'unseen'],
  ready:          ['readyRefinable', 'unseen'],
  readyRefinable: ['computing', 'unseen'],
};

export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(tile: CachedTile, to: Lifecycle): void {
  if (!canTransition(tile.lifecycle, to)) {
    throw new Error(`illegal lifecycle ${tile.lifecycle} → ${to}`);
  }
  tile.lifecycle = to;
}
```

## `src/quadtree/coherence.ts`

```ts
import type { TileReduction } from './reduction_types.js';

/**
 * Composite coherence weights from Appendix A of the spec.
 * Active terms are zero-weighted when their respective metric is disabled
 * (FTLE, ensemble) so the formula is one expression in all tiers.
 */
export const COHERENCE_WEIGHTS = {
  wn:    1.0,    // shape-trajectory spread (dominant)
  wL:    0.20,   // arc-length spread
  wt:    0.25,   // event-time spread
  wd:    0.15,   // d_min spread
  wf:    0.20,   // FTLE spread (Research only)
  wD:    0.25,   // diffusion spread
  wo:    0.35,   // outcome impurity
  wE:    0.30,   // suspect_fraction (numerical unreliability)
  wLz:   0.15,   // suspect_lz_fraction
  wens:  0.25,   // ensemble disagreement
} as const;

/**
 * S_tile = w_n S_n + ... + w_ens S_ens
 * C_tile = 1 / (1 + S_tile)
 *
 * Returns both. The caller may want either (S_tile is monotone for
 * thresholding, C_tile is bounded in [0,1] for blending).
 */
export function compositeCoherence(
  r: TileReduction,
  modes: { ftleEnabled: boolean; ensembleEnabled: boolean },
): { sTile: number; cTile: number } {
  const w = COHERENCE_WEIGHTS;
  const Sn   = r.spread_n;
  const SL   = r.spread_arc_length_n;
  const St   = r.spread_t_end;
  const Sd   = r.spread_d_min;
  const Sf   = modes.ftleEnabled     ? r.spread_ftle      : 0;
  const SD   = r.spread_diffusion >= 0 ? r.spread_diffusion : 0;
  const So   = r.outcome_impurity;
  const SE   = r.suspect_fraction;
  const SLz  = r.suspect_lz_fraction;
  const Sens = modes.ensembleEnabled
    ? Math.max(0, 1 - r.ensemble_outcome_agreement)
    : 0;

  const sTile = w.wn*Sn + w.wL*SL + w.wt*St + w.wd*Sd
              + w.wf*Sf + w.wD*SD + w.wo*So
              + w.wE*SE + w.wLz*SLz + w.wens*Sens;
  return { sTile, cTile: 1 / (1 + sTile) };
}
```

## `src/gpu/structs.ts` — MODIFIED from M3 (ADR 0006 TileReduction offset map)

`TileReduction` is the *only* struct that crosses GPU->CPU, so it is the only
one that needs a CPU **decoder**. Per ADR 0006 that decoder must not be a
fourth hand copy of the layout. M5 extends the M3 `structs.ts` (which already
owns `sizeOfTileReduction`) with **one declarative field table** that is the
single source of truth: the WGSL struct snippet, the TS decoder, and the schema
version are all derived from it. M6 changes the layout by editing this table and
bumping the version — never by hand-editing decoder offsets.

```ts
// ── appended to src/gpu/structs.ts (from M3) ──────────────────────────────

import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { TileID } from '@/quadtree/types.js';

/**
 * Bump whenever TILE_REDUCTION_FIELDS changes (order, type, insertion,
 * removal). reduce.wgsl writes this into the version slot; the decoder
 * asserts it. Hand-bumped integer, per ADR 0006 (a content hash can replace
 * it later without changing the contract).
 */
export const TILE_REDUCTION_SCHEMA_VERSION = 1;

/**
 * The single declarative layout of the per-tile `TileReduction` body fields
 * (everything *after* id+level+mean_n_checkpoints[M]). One entry per f32/u32/i32
 * lane, in WGSL field order. The WGSL struct emitter, the TS decoder, and the
 * `reduction_types.ts` interface are all derived from / pinned to this table —
 * there is no second hand-maintained copy of these offsets (ADR 0006).
 *
 * The version slot reuses the `status_flags` reserved bits 6-7 (TILE_STATUS
 * occupies bits 0-5); reduce.wgsl ORs TILE_REDUCTION_SCHEMA_VERSION into those
 * two bits, and decodeTileReduction strips + checks them. Two bits hold
 * versions 0-3; widen to a dedicated `schema_version` slot (kept at constant
 * 272-byte size, enforced by the alignment pin) before version 4.
 */
export const TILE_REDUCTION_FIELDS = [
  { name: 'mean_arc_length_n',          type: 'f32' },
  { name: 'mean_t_end',                 type: 'f32' },
  { name: 'mean_d_min',                 type: 'f32' },
  { name: 'mean_ftle',                  type: 'f32' },
  { name: 'mean_energy_drift',          type: 'f32' },
  { name: 'mean_diffusion',             type: 'f32' },
  { name: 'spread_n',                   type: 'f32' },
  { name: 'spread_arc_length_n',        type: 'f32' },
  { name: 'spread_t_end',               type: 'f32' },
  { name: 'spread_d_min',               type: 'f32' },
  { name: 'spread_ftle',                type: 'f32' },
  { name: 'spread_energy_drift',        type: 'f32' },
  { name: 'spread_diffusion',           type: 'f32' },
  { name: 'outcome_impurity',           type: 'f32' },
  { name: 'dominant_outcome',           type: 'u32' },
  { name: 'suspect_fraction',           type: 'f32' },
  { name: 'suspect_lz_fraction',        type: 'f32' },
  { name: 'energy_drift_worst',         type: 'f32' },
  { name: 'lz_drift_worst',             type: 'f32' },
  { name: 'mean_word_length',           type: 'f32' },
  { name: 'spread_word_length',         type: 'f32' },
  { name: 'word_agreement',             type: 'f32' },
  { name: 'dominant_word_hash',         type: 'u32' },
  { name: 'ensemble_outcome_agreement', type: 'f32' },
  { name: 'ensemble_count',             type: 'i32' },
  { name: 'mean_orbit_count',           type: 'f32' },
  { name: 'retrograde_fraction',        type: 'f32' },
  { name: 'coherence_score',            type: 'f32' },
  { name: 'priority_score',             type: 'f32' },
  { name: 'sample_count',               type: 'i32' },
  { name: 'status_flags',               type: 'u32' },
] as const;

export type TileReductionFieldName = (typeof TILE_REDUCTION_FIELDS)[number]['name'];

/** status_flags bits 6-7 carry the schema version (TILE_STATUS owns bits 0-5). */
const SCHEMA_VERSION_SHIFT = 6;
const SCHEMA_VERSION_MASK = 0x3 << SCHEMA_VERSION_SHIFT;   // bits 6-7

/**
 * Emit the WGSL `TileReduction` struct body from the table (the head — id,
 * level, mean_n_checkpoints[M] — is fixed). reduce.wgsl is diffed against this
 * in CI so a WGSL edit cannot bypass the table.
 */
export function wgslTileReductionStruct(M: number = M_DEFAULT): string {
  const head =
    `struct TileReduction {\n` +
    `  id:    TileID,\n` +
    `  level: i32,\n` +
    `  mean_n_checkpoints: array<vec4<f32>, ${M}>,\n`;
  const body = TILE_REDUCTION_FIELDS
    .map((f) => `  ${f.name}: ${f.type === 'i32' ? 'i32' : f.type === 'u32' ? 'u32' : 'f32'},`)
    .join('\n');
  return head + body + `\n};`;
}

/**
 * Decode a mapped `TileReduction` buffer. Derived from TILE_REDUCTION_FIELDS:
 * lanes are assigned in table order starting at `base = 8 + M*4` (skipping the
 * 16-byte id+level head plus M vec4 checkpoints). Throws on schema mismatch.
 */
export function decodeTileReduction(ab: ArrayBuffer, M: number = M_DEFAULT): TileReduction {
  const f32 = new Float32Array(ab);
  const i32 = new Int32Array(ab);
  const u32 = new Uint32Array(ab);

  const id: TileID = { z: i32[0], tx: i32[1], ty: i32[2] };
  const level = i32[4];

  const ck: { x: number; y: number; z: number; w: number }[] = [];
  for (let m = 0; m < M; m++) {
    const o = 8 + m * 4;     // 16B id+level head (4 i32) + WGSL pad to vec4
    ck.push({ x: f32[o], y: f32[o + 1], z: f32[o + 2], w: f32[o + 3] });
  }

  const base = 8 + M * 4;
  const out = { id, level, mean_n_checkpoints: ck } as Record<string, unknown>;
  TILE_REDUCTION_FIELDS.forEach((field, i) => {
    const lane = base + i;
    out[field.name] =
      field.type === 'u32' ? u32[lane]
      : field.type === 'i32' ? i32[lane]
      : f32[lane];
  });

  const version = ((out.status_flags as number) & SCHEMA_VERSION_MASK) >>> SCHEMA_VERSION_SHIFT;
  if (version !== TILE_REDUCTION_SCHEMA_VERSION) {
    throw new Error(
      `TileReduction schema mismatch: buffer v${version}, ` +
      `decoder v${TILE_REDUCTION_SCHEMA_VERSION}`,
    );
  }
  // Strip the version bits so consumers see the real status flags.
  out.status_flags = (out.status_flags as number) & ~SCHEMA_VERSION_MASK;

  return out as unknown as TileReduction;
}
```

## `src/quadtree/reduction_types.ts`

The `TileReduction` interface is **derived from** `TILE_REDUCTION_FIELDS`, not a
hand copy. The `id`/`level`/`mean_n_checkpoints` head is declared explicitly
(it is the fixed part of the layout); every scalar field is generated as
`Record<TileReductionFieldName, number>`, so a table edit re-types the interface
automatically and the round-trip golden (below) pins the byte offsets.

```ts
import type { TileID } from './types.js';
import type { TileReductionFieldName } from '@/gpu/structs.js';

/**
 * In-memory mirror of the GPU `TileReduction` struct (272 bytes at M=8).
 * The scalar fields are the single source of truth in `TILE_REDUCTION_FIELDS`
 * (src/gpu/structs.ts); this interface derives their names from the table so
 * the two cannot drift. The round-trip golden pins the byte offsets.
 */
export type TileReduction =
  & {
      id:                 TileID;
      level:              number;
      mean_n_checkpoints: readonly { x: number; y: number; z: number; w: number }[];
    }
  & Record<TileReductionFieldName, number>;

/** Status-flag bit positions. */
export const TILE_STATUS = {
  HAS_ENSEMBLE:      1 << 0,
  DECODE_LINEAR:     1 << 1,
  AT_F32_FLOOR:      1 << 2,
  SUSPECT_MAJORITY:  1 << 3,
  FTLE_VALID:        1 << 4,
  PLAYBACK_VALID:    1 << 5,
} as const;
```

## `src/quadtree/split.ts`

```ts
import type { TileReduction } from './reduction_types.js';
import { TILE_STATUS } from './reduction_types.js';

export interface SplitThresholds {
  tauImpurity:        number;     // outcome impurity force-split
  tauSuspect:         number;     // suspect-sample force-split
  tau0:               number;     // base τ(ℓ)
  tauPerLevel:        number;     // slope
  ensembleAgreementMin: number;
}

export const DEFAULT_THRESHOLDS: SplitThresholds = {
  tauImpurity:        0.10,
  tauSuspect:         0.05,
  tau0:               0.20,
  tauPerLevel:        0.02,
  ensembleAgreementMin: 0.85,
};

export interface SplitDecision {
  action: 'split' | 'keep' | 'merge';
  reason: string;
}

/**
 * Decide whether to split, keep, or merge a tile. The order of the
 * checks matters: hard guards (depth, f32 floor, off-screen) override
 * everything; force-splits override coherence; coherence is the default.
 */
export function decideSplit(
  r: TileReduction,
  ctx: {
    level:        number;
    maxDepth:     number;
    visible:      boolean;
    thresholds:   SplitThresholds;
    ftleEnabled:  boolean;
    ensembleEnabled: boolean;
  },
): SplitDecision {
  // Hard guards.
  if (!ctx.visible)
    return { action: 'merge', reason: 'off_screen' };
  if (r.status_flags & TILE_STATUS.AT_F32_FLOOR)
    return { action: 'keep', reason: 'f32_floor' };
  if (ctx.level >= ctx.maxDepth)
    return { action: 'keep', reason: 'max_depth' };

  // Force splits.
  if (r.outcome_impurity > ctx.thresholds.tauImpurity)
    return { action: 'split', reason: 'outcome_impurity' };
  if (r.suspect_fraction > ctx.thresholds.tauSuspect)
    return { action: 'split', reason: 'suspect_fraction' };
  if (ctx.ensembleEnabled
      && r.ensemble_outcome_agreement < ctx.thresholds.ensembleAgreementMin)
    return { action: 'split', reason: 'ensemble_disagreement' };

  // Coherence-driven split.
  const tau = ctx.thresholds.tau0 + ctx.thresholds.tauPerLevel * ctx.level;
  if (r.coherence_score > tau)
    return { action: 'split', reason: 'coherence' };

  return { action: 'keep', reason: 'coherent' };
}
```

## `src/quadtree/priority.ts`

```ts
import type { TileID, QuadtreeView } from './types.js';
import type { TileReduction } from './reduction_types.js';
import { tileBounds } from './tile.js';
import { clamp } from '@/math/scalar.js';

export interface PriorityWeights {
  wv: number;     // visibility (dominant)
  wz: number;     // zoom-match
  wc: number;     // complexity
  wf: number;     // focus
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  wv: 10, wz: 2, wc: 3, wf: 1,
};

export function computePriority(
  id: TileID, view: QuadtreeView,
  r: TileReduction | null,
  weights = DEFAULT_PRIORITY_WEIGHTS,
): number {
  const b = tileBounds(id);
  const visible =
    !(b.uMax < view.uvCentre[0] - view.uvHalfWidth[0] ||
      b.uMin > view.uvCentre[0] + view.uvHalfWidth[0] ||
      b.vMax < view.uvCentre[1] - view.uvHalfWidth[1] ||
      b.vMin > view.uvCentre[1] + view.uvHalfWidth[1]);
  const Pv = visible ? 1 : 0;

  const Pz = view.zBase === 0 ? 1
    : clamp(1 - Math.abs(id.z - view.zBase) / view.zBase, 0, 1);

  const Pc = r ? clamp(r.coherence_score / (1 + r.coherence_score), 0, 1) : 0.5;

  const cx = (b.uMin + b.uMax) / 2;
  const cy = (b.vMin + b.vMax) / 2;
  const dist = Math.hypot(cx - view.uvCentre[0], cy - view.uvCentre[1]);
  const Pf = 1 / (1 + dist * 50);

  return weights.wv*Pv + weights.wz*Pz + weights.wc*Pc + weights.wf*Pf;
}
```

## `src/quadtree/eviction.ts`

```ts
import type { CachedTile } from './types.js';

/**
 * Weighted-LRU score. A tile that took 100 ms to compute is worth ~25× a
 * tile that took 4 ms; we don't want to throw away the expensive one
 * just because it was used a moment longer ago.
 *
 * Score = lastUsed - α · log(1 + computeCostMs)
 *
 * Lower score → more evictable. α = 4 by default — empirically chosen so
 * that a tile that took 200 ms gets ~21 frames of "head start" against a
 * 1 ms tile.
 */
export function evictionScore(t: CachedTile, alpha = 4): number {
  return t.lastUsed - alpha * Math.log(1 + t.computeCostMs);
}

/** Pick the tile with the smallest eviction score, skipping computing
 *  tiles. Returns null if no eligible tile exists. */
export function pickEvictee(
  tiles: Iterable<[string, CachedTile]>,
  alpha = 4,
): [string, CachedTile] | null {
  let chosen: [string, CachedTile] | null = null;
  let chosenScore = Infinity;
  for (const entry of tiles) {
    const t = entry[1];
    if (t.lifecycle === 'computing') continue;
    const s = evictionScore(t, alpha);
    if (s < chosenScore) { chosen = entry; chosenScore = s; }
  }
  return chosen;
}
```

## `src/quadtree/scheduler.ts`

```ts
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
```

## `src/gpu/shaders/reduce.wgsl`

```wgsl
// One workgroup reduces one tile. Each lane in a 64-thread workgroup
// stride-loads through the N² SimResults and accumulates partials in
// shared memory; lane 0 writes the final TileReduction at the end.

struct SimResult {
  n_checkpoints: array<vec4<f32>, 8>,
  free_group_word: vec4<u32>,
  arc_length_n:    f32,
  t_end:           f32,
  d_min:           f32,
  ftle:            f32,
  energy_drift:    f32,
  diffusion:       f32,
  delta_E_max_abs: f32,
  Lz_drift:        f32,
  delta_Lz_max_abs:f32,
  E_0:             f32,
  Lz_0:            f32,
  sample_descriptor: u32,
  trajectory_stats:  u32,
};

struct TileID  { z: i32, tx: i32, ty: i32, _pad: i32 };
struct TileReduction {
  id:    TileID,
  level: i32,
  mean_n_checkpoints: array<vec4<f32>, 8>,
  mean_arc_length_n:        f32,
  mean_t_end:               f32,
  mean_d_min:               f32,
  mean_ftle:                f32,
  mean_energy_drift:        f32,
  mean_diffusion:           f32,
  spread_n:                 f32,
  spread_arc_length_n:      f32,
  spread_t_end:             f32,
  spread_d_min:             f32,
  spread_ftle:              f32,
  spread_energy_drift:      f32,
  spread_diffusion:         f32,
  outcome_impurity:         f32,
  dominant_outcome:         u32,
  suspect_fraction:         f32,
  suspect_lz_fraction:      f32,
  energy_drift_worst:       f32,
  lz_drift_worst:           f32,
  mean_word_length:         f32,
  spread_word_length:       f32,
  word_agreement:           f32,
  dominant_word_hash:       u32,
  ensemble_outcome_agreement: f32,
  ensemble_count:           i32,
  mean_orbit_count:         f32,
  retrograde_fraction:      f32,
  coherence_score:          f32,
  priority_score:           f32,
  sample_count:             i32,
  status_flags:             u32,
};

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req : TileRequest;
@group(1) @binding(0) var<storage, read>       results : array<SimResult>;
@group(2) @binding(0) var<storage, read_write> out     : TileReduction;

const LANES: u32 = 64u;
var<workgroup> shared_arc:       array<f32, 64>;
var<workgroup> shared_t_end:     array<f32, 64>;
var<workgroup> shared_d_min:     array<f32, 64>;
var<workgroup> shared_drift:     array<f32, 64>;
var<workgroup> shared_diff:      array<f32, 64>;
var<workgroup> shared_class_hist: array<atomic<u32>, 5>;
var<workgroup> shared_suspect_e: array<atomic<u32>, 1>;
var<workgroup> shared_suspect_l: array<atomic<u32>, 1>;
var<workgroup> shared_drift_max: array<atomic<u32>, 1>;
var<workgroup> shared_lz_max:    array<atomic<u32>, 1>;

fn parallel_sum(arr: ptr<workgroup, array<f32, 64>>, lane: u32) -> f32 {
  for (var s: u32 = 32u; s > 0u; s = s >> 1u) {
    if (lane < s) {
      (*arr)[lane] = (*arr)[lane] + (*arr)[lane + s];
    }
    workgroupBarrier();
  }
  return (*arr)[0];
}

fn parallel_max(arr: ptr<workgroup, array<f32, 64>>, lane: u32) -> f32 {
  for (var s: u32 = 32u; s > 0u; s = s >> 1u) {
    if (lane < s) {
      (*arr)[lane] = max((*arr)[lane], (*arr)[lane + s]);
    }
    workgroupBarrier();
  }
  return (*arr)[0];
}

@compute @workgroup_size(64, 1, 1)
fn reduce(@builtin(local_invocation_id) lid : vec3<u32>) {
  let lane = lid.x;
  let total = u32(uniforms.samples_per_axis * uniforms.samples_per_axis);

  if (lane == 0u) {
    for (var i = 0u; i < 5u; i = i + 1u) { atomicStore(&shared_class_hist[i], 0u); }
    atomicStore(&shared_suspect_e[0], 0u);
    atomicStore(&shared_suspect_l[0], 0u);
    atomicStore(&shared_drift_max[0], 0u);
    atomicStore(&shared_lz_max[0],    0u);
  }
  workgroupBarrier();

  // Stride loop: per-lane accumulators.
  var arc: f32 = 0.0;
  var t_end_sum: f32 = 0.0;
  var d_min_sum: f32 = 0.0;
  var drift_sum: f32 = 0.0;
  var diff_sum:  f32 = 0.0; var diff_count: u32 = 0u;

  var i = lane;
  loop {
    if (i >= total) { break; }
    let r = results[i];
    arc       = arc       + r.arc_length_n;
    t_end_sum = t_end_sum + r.t_end;
    d_min_sum = d_min_sum + r.d_min;
    drift_sum = drift_sum + r.energy_drift;
    if (r.diffusion >= 0.0) {       // sentinel guard
      diff_sum  = diff_sum  + r.diffusion;
      diff_count = diff_count + 1u;
    }

    let cls = r.sample_descriptor & 0x7u;
    if (cls < 5u) {
      atomicAdd(&shared_class_hist[cls], 1u);
    }
    let suspectE = (r.sample_descriptor >> 5u) & 1u;
    let suspectL = (r.sample_descriptor >> 6u) & 1u;
    if (suspectE == 1u) { atomicAdd(&shared_suspect_e[0], 1u); }
    if (suspectL == 1u) { atomicAdd(&shared_suspect_l[0], 1u); }

    // Drift maxima via atomicMax with f32 bit pattern (positive only).
    atomicMax(&shared_drift_max[0], bitcast<u32>(r.delta_E_max_abs));
    atomicMax(&shared_lz_max[0],    bitcast<u32>(r.delta_Lz_max_abs));

    i = i + LANES;
  }
  shared_arc[lane]   = arc;
  shared_t_end[lane] = t_end_sum;
  shared_d_min[lane] = d_min_sum;
  shared_drift[lane] = drift_sum;
  shared_diff[lane]  = diff_sum;
  workgroupBarrier();

  let sumArc   = parallel_sum(&shared_arc,   lane);
  let sumTend  = parallel_sum(&shared_t_end, lane);
  let sumDmin  = parallel_sum(&shared_d_min, lane);
  let sumDrift = parallel_sum(&shared_drift, lane);
  let sumDiff  = parallel_sum(&shared_diff,  lane);

  if (lane == 0u) {
    let n = f32(total);
    out.id = TileID(tile_req.z, tile_req.tx, tile_req.ty, 0);
    out.level = tile_req.level;

    out.mean_arc_length_n = sumArc   / n;
    out.mean_t_end        = sumTend  / n;
    out.mean_d_min        = sumDmin  / n;
    out.mean_energy_drift = sumDrift / n;
    out.mean_diffusion    = -1.0;       // updated below if any valid samples

    // Class histogram → outcome impurity and dominant.
    var hist: array<u32, 5>;
    var dom: u32 = 0u; var domN: u32 = 0u; var sumN: u32 = 0u;
    for (var c = 0u; c < 5u; c = c + 1u) {
      hist[c] = atomicLoad(&shared_class_hist[c]);
      sumN = sumN + hist[c];
      if (hist[c] > domN) { domN = hist[c]; dom = c; }
    }
    out.dominant_outcome  = dom;
    out.outcome_impurity  = 1.0 - f32(domN) / max(1.0, f32(sumN));
    out.suspect_fraction  = f32(atomicLoad(&shared_suspect_e[0])) / n;
    out.suspect_lz_fraction = f32(atomicLoad(&shared_suspect_l[0])) / n;
    out.energy_drift_worst = bitcast<f32>(atomicLoad(&shared_drift_max[0]));
    out.lz_drift_worst     = bitcast<f32>(atomicLoad(&shared_lz_max[0]));
    out.sample_count       = i32(total);

    // Coherence score is computed CPU-side after readback so the same
    // formula governs the scheduler decisions; the GPU writes the
    // dominant spread terms below and zero-pads the rest.
    out.spread_n              = 0.0;       // M6 fills this
    out.spread_arc_length_n   = 0.0;
    out.spread_t_end          = 0.0;
    out.spread_d_min          = 0.0;
    out.spread_ftle           = 0.0;
    out.spread_energy_drift   = 0.0;
    out.spread_diffusion      = 0.0;

    out.coherence_score = 0.0;     // CPU patches after readback
    out.priority_score  = 0.0;
    out.status_flags    = 0u;
  }
}
```

> The pass above produces means, the class histogram, suspect counts, and
> drift maxima — the information the scheduler actually needs. M6 wires
> in the per-checkpoint `spread_n` calculation (a second pass over each
> checkpoint after means are known). For M5 the scheduler runs against
> the partial reduction, which is enough to gate basin / boundary
> behaviour.

## `src/gpu/reduce_pipeline.ts`

```ts
import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import { sizeOfTileReduction } from './structs.js';

export interface ReducePipeline {
  pipeline:    GPUComputePipeline;
  bgCommon:    GPUBindGroup;
  bgInput:     GPUBindGroup;
  bgOutput:    GPUBindGroup;
  outputBuf:   GPUBuffer;
  readbackBuf: GPUBuffer;
}

export async function buildReducePipeline(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<ReducePipeline> {
  const { device } = ctx;

  const groupCommon = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
    ],
  });
  const groupInput = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' } },
    ],
  });
  const groupOutput = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' } },
    ],
  });

  const layout = device.createPipelineLayout({
    bindGroupLayouts: [groupCommon, groupInput, groupOutput],
  });
  const pipeline = device.createComputePipeline({
    layout,
    compute: { module: device.createShaderModule({ code }), entryPoint: 'reduce' },
  });

  const M = bufs.M;
  const outputBuf = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readbackBuf = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const bgCommon = device.createBindGroup({
    layout: groupCommon,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
    ],
  });
  const bgInput = device.createBindGroup({
    layout: groupInput,
    entries: [{ binding: 0, resource: { buffer: bufs.simResults } }],
  });
  const bgOutput = device.createBindGroup({
    layout: groupOutput,
    entries: [{ binding: 0, resource: { buffer: outputBuf } }],
  });

  return { pipeline, bgCommon, bgInput, bgOutput, outputBuf, readbackBuf };
}
```

## `src/gpu/reduce_dispatch.ts`

```ts
import type { GpuContext } from './init.js';
import type { ReducePipeline } from './reduce_pipeline.js';

/** Submit a reduction pass and copy the result into the readback buffer. */
export function dispatchReduce(
  ctx: GpuContext, rp: ReducePipeline,
): GPUCommandBuffer {
  const enc = ctx.device.createCommandEncoder({ label: 'reduce' });
  {
    const pass = enc.beginComputePass();
    pass.setPipeline(rp.pipeline);
    pass.setBindGroup(0, rp.bgCommon);
    pass.setBindGroup(1, rp.bgInput);
    pass.setBindGroup(2, rp.bgOutput);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
  }
  enc.copyBufferToBuffer(
    rp.outputBuf, 0, rp.readbackBuf, 0, rp.outputBuf.size,
  );
  return enc.finish();
}
```

## `src/gpu/reduce_readback.ts`

Per ADR 0006 this module no longer hand-codes byte offsets. It maps the buffer
and hands the bytes to the table-generated `decodeTileReduction` in
`structs.ts`, which also performs the `TILE_REDUCTION_SCHEMA_VERSION` check
(throwing on a stale or mismatched payload). The old `const base = 8 + M*4` /
`f32[base + N]` arithmetic is deleted.

```ts
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { ReducePipeline } from './reduce_pipeline.js';
import { decodeTileReduction } from './structs.js';

export async function readbackReduction(
  rp: ReducePipeline, M: number,
): Promise<TileReduction> {
  await rp.readbackBuf.mapAsync(GPUMapMode.READ);
  const ab = rp.readbackBuf.getMappedRange().slice(0);
  rp.readbackBuf.unmap();
  // Generated, table-derived decoder. Asserts TILE_REDUCTION_SCHEMA_VERSION;
  // throws if the GPU wrote a layout the CPU doesn't recognise.
  return decodeTileReduction(ab, M);
}
```

## Tests

### `test/unit/quadtree/lifecycle.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { canTransition, transition } from '@/quadtree/lifecycle.js';
import type { CachedTile } from '@/quadtree/types.js';

const make = (lc: any): CachedTile => ({
  id: { z: 0, tx: 0, ty: 0 },
  simBuffer: null, icBuffer: null,
  lifecycle: lc, cacheAge: 0, lastUsed: 0, computeCostMs: 0,
});

describe('lifecycle transitions', () => {
  it('allows the canonical happy path', () => {
    const t = make('unseen');
    transition(t, 'queued');     expect(t.lifecycle).toBe('queued');
    transition(t, 'computing');  expect(t.lifecycle).toBe('computing');
    transition(t, 'ready');      expect(t.lifecycle).toBe('ready');
    transition(t, 'readyRefinable');
    transition(t, 'computing');  expect(t.lifecycle).toBe('computing');
  });

  it('rejects ready → queued (no skipping computing)', () => {
    const t = make('ready');
    expect(canTransition('ready', 'queued')).toBe(false);
    expect(() => transition(t, 'queued')).toThrow();
  });

  it('allows cancellation from queued and ready', () => {
    expect(canTransition('queued', 'unseen')).toBe(true);
    expect(canTransition('ready',  'unseen')).toBe(true);
    expect(canTransition('computing', 'unseen')).toBe(true);
  });
});
```

### `test/unit/quadtree/coherence.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { compositeCoherence, COHERENCE_WEIGHTS } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

const r0: TileReduction = {
  id: { z: 0, tx: 0, ty: 0 }, level: 0,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1, suspect_fraction: 0,
  suspect_lz_fraction: 0, energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0, word_agreement: 1,
  dominant_word_hash: 0, ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0, coherence_score: 0,
  priority_score: 0, sample_count: 256, status_flags: 0,
};

describe('compositeCoherence', () => {
  it('is zero for a perfect tile', () => {
    const { sTile, cTile } = compositeCoherence(r0,
                              { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBe(0);
    expect(cTile).toBe(1);
  });

  it('respects shape-trajectory dominance', () => {
    const r = { ...r0, spread_n: 1, spread_t_end: 1 };
    const { sTile } = compositeCoherence(r,
                       { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBeCloseTo(COHERENCE_WEIGHTS.wn + COHERENCE_WEIGHTS.wt, 12);
  });

  it('zeroes ensemble term when ensembles are off', () => {
    const r = { ...r0, ensemble_outcome_agreement: 0 };
    const offS = compositeCoherence(r, { ftleEnabled: false, ensembleEnabled: false }).sTile;
    const onS  = compositeCoherence(r, { ftleEnabled: false, ensembleEnabled: true  }).sTile;
    expect(offS).toBe(0);
    expect(onS).toBeCloseTo(COHERENCE_WEIGHTS.wens, 12);
  });

  it('treats spread_diffusion = -1 (sentinel) as zero contribution', () => {
    const r = { ...r0, spread_diffusion: -1 };
    const { sTile } = compositeCoherence(r,
                       { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBe(0);
  });
});
```

### `test/unit/quadtree/split.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';

const r0 = (): TileReduction => ({
  id: { z: 0, tx: 0, ty: 0 }, level: 0,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1, suspect_fraction: 0,
  suspect_lz_fraction: 0, energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0, word_agreement: 1,
  dominant_word_hash: 0, ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0, coherence_score: 0,
  priority_score: 0, sample_count: 256, status_flags: 0,
});

const ctx0 = { level: 2, maxDepth: 8, visible: true,
               thresholds: DEFAULT_THRESHOLDS,
               ftleEnabled: false, ensembleEnabled: false };

describe('decideSplit', () => {
  it('keeps a coherent tile', () => {
    expect(decideSplit(r0(), ctx0).action).toBe('keep');
  });

  it('force-splits on outcome impurity', () => {
    const r = { ...r0(), outcome_impurity: 0.2 };
    expect(decideSplit(r, ctx0).reason).toBe('outcome_impurity');
  });

  it('force-splits on suspect fraction', () => {
    const r = { ...r0(), suspect_fraction: 0.1 };
    expect(decideSplit(r, ctx0).reason).toBe('suspect_fraction');
  });

  it('splits on coherence above τ(ℓ)', () => {
    const r = { ...r0(), coherence_score: 0.5 };
    expect(decideSplit(r, ctx0).reason).toBe('coherence');
  });

  it('keeps when AT_F32_FLOOR even with high impurity', () => {
    const r = { ...r0(), outcome_impurity: 0.9,
                status_flags: TILE_STATUS.AT_F32_FLOOR };
    expect(decideSplit(r, ctx0).action).toBe('keep');
  });

  it('keeps when at max depth', () => {
    const r = { ...r0(), coherence_score: 5 };
    expect(decideSplit(r, { ...ctx0, level: 8 }).action).toBe('keep');
  });

  it('reports merge for off-screen tiles', () => {
    expect(decideSplit(r0(), { ...ctx0, visible: false }).action).toBe('merge');
  });
});
```

### `test/unit/quadtree/eviction.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { evictionScore, pickEvictee } from '@/quadtree/eviction.js';
import type { CachedTile } from '@/quadtree/types.js';

const make = (lastUsed: number, cost: number, lc: any = 'ready'): CachedTile => ({
  id: { z: 0, tx: 0, ty: 0 },
  simBuffer: null, icBuffer: null,
  lifecycle: lc, cacheAge: 0, lastUsed, computeCostMs: cost,
});

describe('weighted eviction', () => {
  it('expensive tile beats a slightly older cheap tile', () => {
    // cheap: lastUsed 5, cost 1   → score = 5 - 4*log(2)  ≈ 2.23
    // expensive: lastUsed 3, cost 200 → score = 3 - 4*log(201) ≈ -18.21
    expect(evictionScore(make(5, 1)))
      .toBeGreaterThan(evictionScore(make(3, 200)));
  });

  it('ignores in-flight tiles', () => {
    const m = new Map<string, CachedTile>([
      ['busy', make(0, 1, 'computing')],
      ['ok',   make(10, 1)],
    ]);
    const choice = pickEvictee(m);
    expect(choice?.[0]).toBe('ok');
  });

  it('returns null when only computing tiles exist', () => {
    const m = new Map<string, CachedTile>([
      ['a', make(0, 1, 'computing')],
      ['b', make(0, 1, 'computing')],
    ]);
    expect(pickEvictee(m)).toBeNull();
  });
});
```

### `test/integration/layer2_basin_stays_coarse.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** Build a synthetic "uniform-basin" reduction: every sample escapes via
 *  the same body, no diffusion, no FTLE. */
function uniformBasinReduction(level: number): TileReduction {
  return {
    id: { z: level, tx: 0, ty: 0 }, level,
    mean_n_checkpoints: [],
    mean_arc_length_n: 0.5, mean_t_end: 12, mean_d_min: 0.3,
    mean_ftle: 0, mean_energy_drift: 1e-6, mean_diffusion: -1,
    spread_n: 0, spread_arc_length_n: 0.001, spread_t_end: 0.01,
    spread_d_min: 0.001, spread_ftle: 0, spread_energy_drift: 0,
    spread_diffusion: 0,
    outcome_impurity: 0, dominant_outcome: 2,
    suspect_fraction: 0, suspect_lz_fraction: 0,
    energy_drift_worst: 1e-6, lz_drift_worst: 1e-6,
    mean_word_length: 1, spread_word_length: 0,
    word_agreement: 1, dominant_word_hash: 0xabad1dea,
    ensemble_outcome_agreement: 1, ensemble_count: 0,
    mean_orbit_count: 0, retrograde_fraction: 0,
    coherence_score: 0, priority_score: 0,
    sample_count: 256, status_flags: 0,
  };
}

describe('basin stays coarse', () => {
  it('coherence remains below τ(ℓ) at every depth from 0 to 6', () => {
    for (let level = 0; level < 7; level++) {
      const r = uniformBasinReduction(level);
      const { sTile } = compositeCoherence(r,
                          { ftleEnabled: false, ensembleEnabled: false });
      r.coherence_score = sTile;
      const dec = decideSplit(r, {
        level, maxDepth: 12, visible: true,
        thresholds: DEFAULT_THRESHOLDS,
        ftleEnabled: false, ensembleEnabled: false,
      });
      expect(dec.action).toBe('keep');
      expect(sTile).toBeLessThan(0.05);
    }
  });
});
```

### `test/integration/layer2_boundary_refines.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** A boundary tile: high outcome impurity, large checkpoint spread. */
function boundaryReduction(level: number): TileReduction {
  return {
    id: { z: level, tx: 0, ty: 0 }, level,
    mean_n_checkpoints: [],
    mean_arc_length_n: 4, mean_t_end: 50, mean_d_min: 0.05,
    mean_ftle: 0, mean_energy_drift: 5e-5, mean_diffusion: 0.4,
    spread_n: 1.5, spread_arc_length_n: 1.2, spread_t_end: 2,
    spread_d_min: 0.05, spread_ftle: 0, spread_energy_drift: 1e-5,
    spread_diffusion: 0.6,
    outcome_impurity: 0.4, dominant_outcome: 2,
    suspect_fraction: 0.02, suspect_lz_fraction: 0.01,
    energy_drift_worst: 1e-4, lz_drift_worst: 5e-5,
    mean_word_length: 6, spread_word_length: 4,
    word_agreement: 0.4, dominant_word_hash: 0,
    ensemble_outcome_agreement: 0.6, ensemble_count: 0,
    mean_orbit_count: 1, retrograde_fraction: 0.3,
    coherence_score: 0, priority_score: 0,
    sample_count: 256, status_flags: 0,
  };
}

describe('boundary tiles refine to MAX_DEPTH', () => {
  it('every level < MAX_DEPTH triggers split', () => {
    const MAX = 12;
    for (let level = 0; level < MAX; level++) {
      const r = boundaryReduction(level);
      const { sTile } = compositeCoherence(r,
                          { ftleEnabled: false, ensembleEnabled: false });
      r.coherence_score = sTile;
      const dec = decideSplit(r, {
        level, maxDepth: MAX, visible: true,
        thresholds: DEFAULT_THRESHOLDS,
        ftleEnabled: false, ensembleEnabled: false,
      });
      expect(dec.action).toBe('split');
    }
    // At MAX_DEPTH the guard kicks in and we stop.
    const r = boundaryReduction(MAX);
    const { sTile } = compositeCoherence(r,
                        { ftleEnabled: false, ensembleEnabled: false });
    r.coherence_score = sTile;
    expect(decideSplit(r, {
      level: MAX, maxDepth: MAX, visible: true,
      thresholds: DEFAULT_THRESHOLDS,
      ftleEnabled: false, ensembleEnabled: false,
    }).action).toBe('keep');
  });
});
```

### `test/integration/layer2_offscreen_cancellation.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';
import { planFrame } from '@/quadtree/scheduler.js';
import type { QuadtreeView, TileCacheKey } from '@/quadtree/types.js';

const KEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

describe('off-screen cancellation', () => {
  it('planFrame yields zero jobs once the viewport leaves the visible region', () => {
    const cache = new TileCache(64);
    const queue = new FifoComputeQueue();

    let view: QuadtreeView = {
      cacheKey: KEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.05, 0.05],
      zBase: 4, zMax: 12, width: 1024, height: 1024, tilePix: 256,
    };
    const jobsOnscreen = planFrame(cache, view, {
      frameBudget: 16, maxInFlight: 0,
      ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobsOnscreen.length).toBeGreaterThan(0);

    // Pan completely out of bounds.
    view = { ...view, uvCentre: [10, 10] };
    const jobsOffscreen = planFrame(cache, view, {
      frameBudget: 16, maxInFlight: 0,
      ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobsOffscreen.length).toBe(0);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/quadtree
npm test -- --run test/integration/layer2
```

## Acceptance check

```bash
npm test -- --run test/integration/layer2
```

Three integration tests pass: a uniform basin holds at coherence ≤ 0.05 at
every level, a fractal boundary splits at every level below `MAX_DEPTH`,
and an off-screen viewport cancels every pending job.

## Notes for the implementer

- **The reduction shader is intentionally partial.** It computes means,
  the class histogram, suspect counts, and drift maxima — everything the
  scheduler needs. Spreads (especially `spread_n`) require a second
  pass once the means are known. M6 adds that pass and wires it into
  `coherence_score` directly on the GPU; until then the scheduler runs
  on `outcome_impurity` and `suspect_fraction`, which is enough for the
  basin / boundary gate.

- **Workgroup count.** One workgroup per tile is fine for `N ≤ 32`. At
  `N=32` you have 1024 samples and 64 lanes — each lane processes 16
  samples in the stride loop. Beyond that, partition into a two-stage
  reduction (block partials → final block). For M5 we don't need it.

- **Reduction-pass is on-tile, not on-screen.** Compared to the M3
  simulate pass, the reduction is small and read-only after the first
  barrier; CPU readback latency dominates. Group the reductions into a
  single command buffer per frame and `mapAsync` them all at once.

- **Eviction-protected lifecycle.** A tile with `lifecycle === 'computing'`
  must never be evicted, because the GPU dispatch holds a reference to
  its `simBuffer`. The cache uses `pickEvictee` from `eviction.ts` which
  enforces this.

- **Cancellation.** WebGPU dispatches cannot be aborted mid-flight. M5's
  cancellation is logical: a tile that scrolls offscreen mid-compute will
  finish its dispatch (the GPU does the work anyway), but its result is
  ingested into a tile that nobody is rendering. The eviction policy
  ensures it gets reclaimed quickly.
