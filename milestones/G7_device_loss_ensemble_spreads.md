# G7 — Device-loss recovery, ensemble dispatch, spread second pass

> **Status: LANDED** (branch `feat/g7-device-loss`). This doc was folded
> back to the as-built reality after the acceptance gates ran green —
> binding slots, the spread-pass shape, and the recovery contract all
> changed against the original draft. Deviations are ledgered as DG7.x
> in `docs/build-decisions-ledger.md`.

## Goal

Three smaller bundled fixes:

1. **Device-loss recovery.** WebGPU devices vanish on TDR (Windows
   timeout-detection-and-recovery), driver crash, or explicit
   `device.destroy()`. Spec §7.6 requires graceful recovery: the
   `TileReduction` cache survives the loss; the GPU buffers don't;
   the user sees the last-known render while tiles repopulate.

2. **Ensemble dispatch.** Spec §4.4: per-pixel jittered copies (E = 2,
   4, or 16 depending on tier) using stratified or quasi-random
   patterns. M3-M5 left room in the `TileRequest` but never shipped
   the actual `E`-times-bigger SimResult buffer dispatch.

3. **Spread second pass.** M5's `reduce.wgsl` left every spread field
   at zero (it computed means but the spread requires a second pass
   over `SimResult` after means are known). Without spreads, M5's
   coherence score is dominated by the constant-zero terms and the
   adaptive refinement decisions are weaker than designed.

After G7: the app survives a forced device loss without dropping the
slippy-map; ensemble mode produces `E`-fold finer tile classification
with cheap stratified jitter; coherence scores include real spread
contributions across all relevant fields.

**Exit criterion.**

```bash
npm test -- --run test/unit/gpu/device_recovery \
  test/unit/gpu/ensemble test/unit/quadtree/ensemble_jitter \
  test/integration/gap_g7
npm run gpu:check     # real-GPU proof: spreads / ensemble / recovery gates
```

The Vitest GPU integration suite (`gap_g7`) self-skips without
`navigator.gpu`; the real proof is `npm run gpu:check`, whose three G7
gates assert (1) non-zero spreads + real checkpoint means on the mixed
M3 tile, (2) an E = 4 stratified ensemble with `ensemble_count = 4`,
agreement strictly inside (0, 1), the `HAS_ENSEMBLE` status bit, and
`sample_count = N²·E`, and (3) a forced `device.destroy()` recovered by
`DeviceRecovery` with the cache's reduction intact and a post-loss
re-dispatch reproducing the pre-loss class histogram exactly (measured
~13 ms recovery on SwiftShader; gate < 10 s).

**Deliverable:** the app survives a forced device loss without blanking
the slippy-map, ensemble mode dispatches `E`-fold jittered copies along
the workgroup z-axis, and the reduce writes real spread fields — all
three proven on a real device by the `gpu:check` gates.

## File tree (as landed)

```
principia/
  src/
    gpu/
      device_recovery.ts        # DeviceRecovery class
      ensemble.ts               # packEnsembleOffsets (g0b5 uniform, 256B)
      buffers.ts                # createTileBuffers gains EMax param
      layouts.ts                # frame layout gains binding 5
      structs.ts                # TileRequest spare lanes: ensemble_e, sample_pattern_id
      dispatch_layer0.ts        # DispatchView.ensemble; z-axis dispatch
      reduce_pipeline.ts        # ReducePipeline gains `spreads` pipeline
      reduce_dispatch.ts        # two passes in one encoder
      shaders/
        reduce.wgsl             # + reduce_spreads entry, + checkpoint means
        simulate.wgsl           # + EnsembleOffsets b5, gid.z slice select
    quadtree/
      ensemble_jitter.ts        # jitterOffsets: stratified / Halton(2,3)
      cache.ts                  # + public entries() iterator
      types.ts                  # CachedTile gains reduction?: TileReduction
  test/
    unit/gpu/
      device_recovery.test.ts   # 5 tests (controllable lost promise)
      ensemble.test.ts          # offset packing
      layouts.test.ts           # b5 pin
      structs.test.ts           # spare-lane pins
    unit/quadtree/
      ensemble_jitter.test.ts   # 5 tests
    integration/
      gap_g7.test.ts            # 3 real-GPU tests (self-skipping)
```

There is **no** `reduce_spreads.wgsl` and **no**
`pipelines/reduce_spreads.ts`: the spread pass landed as a second
`@compute` entry **inside `reduce.wgsl`** sharing the existing
`pipelineReduce` layout (DG7.2). A separate file would have required a
fifth hand-kept copy of the shared structs; the original draft's six
per-scalar pipelines collapse to one entry that computes every spread
in a single N²·E sweep.

## 1. Device-loss recovery

### `src/gpu/device_recovery.ts` (as landed)

```ts
export interface DeviceRecoveryHooks {
  rebuildPipelines: (ctx: GpuContext) => Promise<void>;
  reallocateBuffers: (ctx: GpuContext) => void;
  onRecovering?: () => void;      // optional UI notifications
  onRecovered?: () => void;
}

export class DeviceRecovery {
  constructor(
    initial: GpuContext,
    cache: TileCache,
    hooks: DeviceRecoveryHooks,
    acquire: () => Promise<GpuContext> = () => initGpu(),  // injectable
  );
  isRecovering(): boolean;
  ctx(): GpuContext;
  recover(): Promise<void>;   // manual trigger (tests, forced re-init)
  dispose(): void;            // stop reacting to loss events
}
```

`recover()` runs: `onRecovering` → `acquire()` → `rebuildPipelines` →
`reallocateBuffers` → `markCachedTilesForRecompute` → swap `currentCtx`
→ reattach a loss listener on the fresh device → `onRecovered`.

Three contract points the original draft missed:

- **Stale-listener guard.** The loss handler checks
  `this.currentCtx.device !== device` before triggering: after a
  recovery, the OLD device's `lost` promise may still resolve (e.g. a
  delayed destroy) and must not re-trigger a rebuild (DG7.4). A fresh
  listener is attached per device — `device.lost` resolves once, so
  without reattachment a second loss on the fresh device is invisible.
- **Injectable `acquire`.** Unit tests inject fake contexts with
  controllable `lost` promises; production defaults to `initGpu()`.
- **Public cache iteration.** `markCachedTilesForRecompute` walks
  `cache.entries()` — a real iterator added to `TileCache` — instead of
  the draft's `(cache as any).map` (DG7.5). For each entry it nulls
  `simBuffer`/`icBuffer` (never `destroy()` through a lost device),
  resets `lifecycle` to `'unseen'`, and **keeps `entry.reduction`** —
  the CPU-side `TileReduction` survives the loss and provides the
  ancestor-fallback baseline while children re-render. `CachedTile`
  gained the optional `reduction?: TileReduction | null` field this
  contract requires (type-only import; no runtime cycle).

The frame loop (G2) checks `recovery.isRecovering()` before
dispatching; during recovery it renders only from cached
`TileReduction` data.

## 2. Ensemble dispatch

### Scoping: `TileRequest` spare lanes, not new uniforms

`E` and the pattern id are **per-tile**, so they live in the
`TileRequest`'s spare lanes — `i32[9] = ensemble_e`,
`i32[10] = sample_pattern_id` — not in `SimUniforms` (DG7.3). The 48-byte
buffer is unchanged; the TS fields are optional and pack as 0, so every
pre-G7 frame capture and caller stays valid. Pattern ids: 0 = none,
1 = stratified (√E × √E sub-cell centres), 2 = Halton(2, 3).
`ENSEMBLE_E_MAX = 16`.

### `src/quadtree/ensemble_jitter.ts`

`jitterOffsets(patternId, E)` returns `{du, dv}[]` in pixel units
(each |·| ≤ 0.5): stratified sub-cell centres or Halton(2,3) points;
`E ≤ 1` or an unknown pattern returns centre samples (never throws);
`E` is capped at `ENSEMBLE_E_MAX`.

### `src/gpu/ensemble.ts` + the `g0b5` uniform

`packEnsembleOffsets(offsets)` packs 16 × vec4 (du, dv, 0, 0) into a
256-byte uniform bound at **`g0` binding 5** (compute-only). The
original draft put it at `g0b3`, which G4 had already assigned to
`ChartUniforms` (DG7.1). The canonical frame bind group is now:

| binding | struct            | size | owner |
|---------|-------------------|------|-------|
| 0       | SimUniforms       | 64B  | M3    |
| 1       | TileRequest       | 48B  | M3    |
| 2       | DebugUniform      | 16B  | G17   |
| 3       | ChartUniforms     | 64B  | G4    |
| 4       | LinearisedRef     | 256B | G6    |
| 5       | EnsembleOffsets   | 256B | G7    |

Zero-filled defaults keep every binding behaviour-identical when its
feature is off.

### Buffers and dispatch

`createTileBuffers(ctx, N, M, EMax = 1)` scales `simResults`, `icDesc`
and the readback buffer by `max(1, EMax)` copies; `TileBuffers` records
`EMax`. `DispatchView` gains
`ensemble?: { E: number; patternId: 0 | 1 | 2 }`;
`dispatchLayer0` throws if `E > bufs.EMax`, writes the packed offsets,
and dispatches `dispatchWorkgroups(⌈N/8⌉, ⌈N/8⌉, E)`. In
`simulate.wgsl`, `gid.z` selects the copy:

```wgsl
let idx = gid.z * N * N + gid.y * N + gid.x;
let t = (vec2(f32(gid.x), f32(gid.y)) + 0.5) / f32(N)
      + ensemble.offsets[gid.z].xy / f32(N);
```

## 3. Spread second pass

### Shape: one `reduce_spreads` entry inside `reduce.wgsl`

The draft's six per-scalar pipelines in a separate file collapse to a
single `@compute @workgroup_size(64) fn reduce_spreads` in
`reduce.wgsl`, sharing the file's structs and the `pipelineReduce`
layout. `ReducePipeline` gains a `spreads: GPUComputePipeline`
(same module, entry point `reduce_spreads`) and `dispatchReduce`
encodes **both passes in one command encoder** — pass ordering makes
the means visible to the spread pass; no CPU round-trip between them.
Note the `results` binding is `var<storage, read_write>` (not the
draft's `read`): the canonical shared perTile layout binds it as type
`'storage'`, and the shader's access mode must match (the G3 rule).

### Prerequisite the draft missed: real checkpoint means

The draft's `spread_n` reads `reduction.mean_n_checkpoints[m]` — but
M5's reduce still **zeroed** those lanes ("M6 fills this"). G7
therefore landed checkpoint means in the **main** reduce first: per-lane
`ckpt_sum: array<vec4<f32>, 8>` accumulators, tree-reduced through a
`var<workgroup> shared_ckpt: array<array<vec4<f32>, 8>, 64>` (~8 KB,
within the 16 KB workgroup floor), written as raw vector averages
(DG7.6). The spread pass renormalises the mean direction before its
angular comparison and skips checkpoints whose mean length is < 1e-6
(an all-antipodal degenerate mean carries no direction).

### What `reduce_spreads` computes

One strided sweep over all `N²·E` samples accumulates, per lane, the
squared deviations for `arc_length_n`, `t_end`, `d_min`,
`energy_drift`, and (sentinel-guarded: only when both the sample and
the mean are ≥ 0) `diffusion`; plus the running max angular deviation
from the renormalised mean checkpoint direction. Tree reductions then
produce **population** standard deviations `sqrt(Σd²/n)` and the max
angle → `spread_n`. The main reduce zero-fills every spread lane before
the second pass runs, so a skipped spread pass can never leak a
previous tile's values.

When `E ≥ 2`, a second loop computes **ensemble outcome agreement**:
per pixel, a 5-bin histogram over the E copies' outcome classes at
`results[e·N² + p]`, `dom/E` summed and averaged over the tile →
`ensemble_outcome_agreement`, plus `ensemble_count = E`. The main
reduce writes `ensemble_outcome_agreement = 1.0` / `ensemble_count = 0`
defaults (no ensemble ⇒ perfect agreement).

### Status flags

The main reduce propagates the request-side facts it can observe into
`status_flags`: `HAS_ENSEMBLE` (bit 0) when `E ≥ 2` and
`DECODE_LINEAR` (bit 1) mirroring `TILE_REQUEST_FLAGS.DECODE_LINEAR`;
the schema version stays in bits 6-7.

### WGSL gotcha: explicitly zero loop-local accumulators

SwiftShader does **not** re-zero a bare `var hist: array<u32, 5>;` on
each loop-body re-entry, so per-pixel votes accumulated across a lane's
strided pixels and the measured agreement came out **> 1** (1.82 on the
E = 4 gate). WGSL's zero-init-on-scope-entry cannot be relied on inside
loops on real backends: write
`var hist = array<u32, 5>(0u, 0u, 0u, 0u, 0u);` (DG7.7). The same
explicit-init treatment was applied to the main reduce's histogram and
the `ckpt_sum` accumulator.

## Run it

```bash
npm test -- --run test/unit/gpu/device_recovery
npm test -- --run test/unit/gpu/ensemble
npm test -- --run test/unit/quadtree/ensemble_jitter
npm test -- --run test/integration/gap_g7   # self-skips without a GPU
npm run gpu:check                            # the real-GPU G7 gates
```

## Acceptance check

```bash
npm run gpu:check
```

All six page gates green (M3 chaos-calibrated, M5 histogram, G6 A/B,
G7 spreads, G7 ensemble, G7 recovery), plus the full Vitest suite,
`npm run typecheck`, `npm run lint`, and the four page checks
(`g17_page_check`, `m5_page_check`, `m7_render_check`,
`depth_stress_check`).

**Known behaviour change:** with real spreads feeding
`compositeCoherence`, the depth-stress harness's "uniform" chase no
longer settles early at `keep('coherent')` — that early settle was an
artifact of zero-filled spreads. The min-impurity child of the M3
latent slice stays honestly incoherent (impurity 0.11-0.22 through
z = 12, then genuine trajectory spread) until the f32 floor, where all
samples decode identically and S collapses below τ. The check now
asserts the robust facts: the stop is coherent-or-floor-guarded and the
final tile is quiescent on both axes (DG7.8).

## Notes for the implementer

- **Device-loss subtlety.** The `device.lost` promise resolves once
  per device: reattach a fresh listener after every acquire, and guard
  against the OLD device's promise resolving late (stale-listener
  check). Never call `destroy()` on buffers through a lost device —
  null the references instead.
- **Format trap in recovery harnesses.** A canvas-less `initGpu()`
  returns `format: 'rgba8unorm'`; render targets created for the fresh
  device must use the FRESH context's format. A mismatch invalidates
  the whole submission — compute passes included — and WebGPU
  validation errors don't throw, so the symptom is an all-zero
  readback, not an exception.
- **Ensemble in the dispatch grid.** The third `dispatchWorkgroups`
  axis carries the ensemble copies; each thread reads `gid.z` for its
  jitter offset and writes its own `N²` slice. The reduce's means
  aggregate over ALL `N²·E` samples.
- **Spread-pass cost.** One extra N²·E sweep per tile in the same
  submission — no second queue round-trip. `coherence_score` is still
  patched on the CPU after readback; G7 supplies the missing inputs.
- **Sentinel handling for diffusion.** Skip samples with
  `r.diffusion < 0` (and a sentinel mean) with a branch in the lane
  loop, not a workgroup-wide guard.
- **Vacuity.** The ensemble gate must assert agreement strictly
  **inside** (0, 1) on a fractal-boundary tile: 1.0 would mean the
  jitter did nothing (or E collapsed to 1), 0 would mean the histogram
  never counted.
