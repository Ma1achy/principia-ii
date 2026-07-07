# G10 — Performance budgeting & profiling

> **As-built.** Rewritten after landing (living-document discipline). The
> draft's `GpuTimer` had an invalid resolve layout, its back-pressure patch
> targeted the wrong scheduler knob, and its "hot-path BufferPool patches"
> addressed allocation sites that do not exist in the landed tree — see
> "What changed and why" and ledger entries DG10.1–DG10.5.

## Goal

The G2 frame loop reported a single `cpuMs` per tick and no GPU time at
all. That is not enough to keep the slippy-map under budget: at Research
tier a single over-long frame stutters the pan, and the scheduler has no
signal to back off. G10 adds a `PerfMonitor` fed by `FrameLoop.tickOnce`
each frame — rolling per-frame CPU timings plus per-pass GPU timestamps
(via the optional WebGPU `timestamp-query` feature, degrading cleanly to
CPU-only timing when absent) — computes rolling mean/p95, and emits an
**over-budget signal** that feeds back into the scheduler (reduce
dispatches-per-frame; when the overrun is sustained, recommend a tier
drop per ADR 0003). The stats math and budget feedback are GPU-free and
fully unit-testable; the GPU timestamp helper is a thin query-set wrapper
that pairs with G7's device-loss recovery (a lost device drops its query
set; the monitor's CPU rings survive).

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/perf/perf_monitor
```

passes with at least **15** green tests (17 landed) covering:
rolling-window mean/p95 (including p95 on a partial window), the
over-budget classifier (`ok`/`over`/`sustained`), the `recommend()`
feedback (dispatch-cap reduction and the tier-drop recommendation per
ADR 0003 ordering, holding at the floor), CPU-only degradation when
`timestamp-query` is absent, and per-pass GPU accumulation when present.

**Deliverable:** internal — tests only; a `PerfMonitor` fed by the G2
frame loop computes rolling CPU/GPU-timestamp mean/p95 and emits an
over-budget signal that backs off the scheduler and recommends tier
drops, with `timestamp-query` degrading to CPU-only timing. Live in the
shell: `__principia.app.loop.perf.snapshot()` /
`lastStats.gpuPassMs` on a device with `timestamp-query`.

## File tree (as landed)

```
principia/
  src/
    perf/
      stats.ts               # pure RollingWindow + percentile (no GPU, no DOM)
      gpu_timing.ts          # GpuTimer (ONE shared query set) + cap-gated factory
      perf_monitor.ts        # PerfMonitor (rolling CPU+GPU stats, budget feedback)
      index.ts               # barrel
    gpu/
      init.ts                # MODIFIED: opts into timestamp-query at requestDevice
      reduce_dispatch.ts     # MODIFIED: optional per-pass timestampWrites param
    app/
      types.ts               # MODIFIED: FrameStats +gpuMs/gpuPassMs/overBudget;
                             #           GpuDispatcher +takeGpuTimings? (optional)
      frame_loop.ts          # MODIFIED: PerfMonitor + dispatch-cap back-pressure
      dispatcher.ts          # MODIFIED: timestampWrites on all passes + harvest
      app.ts                 # MODIFIED: AppOpts pass-through for the perf knobs
  test/
    unit/
      perf/
        stats.test.ts            # 8 tests
        perf_monitor.test.ts     # 17 tests (the exit gate)
      app/
        frame_loop_perf.test.ts  # 5 tests: loop × monitor back-pressure
    integration/
      perf_timing_probe.test.ts  # real-device probe, self-skips without WebGPU
```

Not landed from the draft: `src/perf/pooled_buffers.ts` and the M1/M5/M6
"hot-path BufferPool patches" — **rejected on evidence** (DG10.5, below).

## `src/perf/stats.ts`

Pure rolling-window statistics: fixed-capacity `Float64Array` ring with
O(1) push + running mean, `toArray()` oldest→newest across wraparound,
linear-interpolated `percentile(p)` (p=0 min, p=1 max, 0 when empty),
`reset()`. `noUncheckedIndexedAccess`-safe. `p95(w)` convenience.

## `src/perf/gpu_timing.ts`

`GpuPass = 'simulate' | 'reduce' | 'reduce_spreads' | 'render'`;
`GpuPassTimings = Partial<Record<GpuPass, number>>` (milliseconds).

`GpuTimer` owns **one** timestamp query set with a (begin, end) pair per
pass at indices (2i, 2i+1), plus resolve/readback buffers:

- `timestampWrites(pass)` → the descriptor to spread into
  `beginComputePass`/`beginRenderPass`; marks the pass *written*.
- `resolve(encoder)` → one `resolveQuerySet` over the whole set at
  offset 0 + copy to the mappable buffer. Returns `false` (encodes
  nothing) when a read is in flight or nothing was written.
- `read()` → maps, decodes (end − begin) as BigInt ns → ms, and reports
  **only the passes captured by that resolve** — resolving blindly would
  attribute stale timestamps to passes that never ran this cycle.

**DG10.1 (the draft's layout was invalid):** `resolveQuerySet`'s
destination offset must be **256-byte aligned**. The draft used one
query set per pass resolved into tightly-packed 16-byte slots (offsets
16/32/48…) — every submission carrying it validates as an error and is
silently dropped (caught live by the `uncapturederror` listener during
the shell spec, SwiftShader). One shared set with a single resolve at
offset 0 needs no padding at all.

`makeGpuTimer(device, profile)` returns `null` unless
`profile.features` includes `'timestamp-query'`; never throws.

## `src/perf/perf_monitor.ts`

As drafted: per-frame `record({cpuMs, gpu?, jobsDispatched})` pushes into
CPU/wall/per-pass rings; the budget wall metric is
`max(cpuMs, Σ gpu passes)` when timings exist, else `cpuMs`;
`budgetState()` = `ok` (wall p95 ≤ budget·overRatio) / `over` /
`sustained` (over-fraction ≥ sustainedFraction); `recommend(tier)` is
neutral below max(4, window/4) samples, halves the dispatch cap on
`over`, quarters it and recommends `lowerTier()` (ADR 0003
`research → balanced → preview`, null at the floor) on `sustained`.
`QualityTier` is imported from G9's `@/gpu/capability.js` — M8's
`ViewState.qualityTier` is the same union; no parallel type.

One divergence: `snapshot().gpuP95Ms` only carries passes whose ring has
samples — no zero-filled keys for passes that never ran.

## Integration (as landed)

- **`src/gpu/init.ts` (DG10.2 — the draft never patched it):** a query
  set cannot be created unless `timestamp-query` was requested **at
  `requestDevice` time**. `initGpu` now requests it iff the live adapter
  advertises it (never required — a post-TDR fallback adapter may not).
- **`src/gpu/reduce_dispatch.ts`:** `dispatchReduce(ctx, rp, timing?)`
  takes optional `{reduce?, reduce_spreads?}` timestamp writes for its
  two internally-encoded passes.
- **`src/app/dispatcher.ts`:** builds the timer gated on
  **`device.features`** (the honest source — the detection-time profile
  may describe a different adapter); wraps simulate / reduce /
  reduce_spreads / render with `timestampWrites`; after each submit,
  `harvestTimings()` encodes a resolve and fire-and-forgets `read()`
  into a pending slot. `takeGpuTimings()` (new **optional**
  `GpuDispatcher` member — mocked dispatchers omit it) hands the loop
  the most recent resolved timings and clears them: one-frame-late by
  design.
- **`src/app/frame_loop.ts`:** `FrameLoopOpts` gains optional
  `frameBudgetMs` (default 16), `perfWindow` (default 120),
  `gpuTimingAvailable` (default false) — G2 callers unchanged. Each
  tick records `{cpuMs, gpu}` and applies the recommendation to a
  `dispatchCap` that scales **`planFrame`'s `frameBudget`** — the
  dispatches-per-frame knob. **DG10.3:** the draft scaled `maxInFlight`,
  but landed `planFrame` semantics take `maxInFlight` as "jobs already
  running" (`budget = frameBudget − maxInFlight`); scaling it would have
  *raised* the budget under pressure. The cap recovers instantly to the
  configured ceiling once the window is back under budget. The tier is
  **never mutated** — `loop.perf` and `loop.lastRecommendation` are
  exposed for the UI (G12/G18 surface them). `FrameStats` gains
  `gpuMs?`/`gpuPassMs?`/`overBudget?`.

## Tests

- `test/unit/perf/stats.test.ts` — ring semantics (partial window,
  eviction, wraparound order, interpolated percentile, empty, reset).
- `test/unit/perf/perf_monitor.test.ts` — the 17-test exit gate (see
  exit criterion).
- `test/unit/app/frame_loop_perf.test.ts` — loop × monitor: a synthetic
  clock scripts cpuMs per tick; under-budget stays neutral; sustained
  overrun flags `overBudget`, recommends `balanced → preview`, and the
  backed-off cap limits dispatches for a newly-visible frontier to 1;
  GPU timings thread into `stats.gpuPassMs/gpuMs`; dispatchers without
  `takeGpuTimings` keep working.
- `test/integration/perf_timing_probe.test.ts` — real-device probe
  (self-skips without WebGPU): `makeGpuTimer` returns null without the
  feature; with it, an empty timed pass resolves a non-negative
  `simulate` timing and never-written passes stay unreported.

## Run it

```bash
npm test -- --run test/unit/perf/perf_monitor
npm test -- --run test/unit/perf/stats
npm test -- --run test/unit/app/frame_loop_perf
npm test -- --run test/integration/perf_timing_probe   # real GPU only; skips otherwise
npm run test:gpu    # shell e2e — exercises the live timing path end-to-end
```

## Acceptance check

```bash
npm test -- --run test/unit/perf/perf_monitor    # 17 passed (≥15 required)
```

Landed alongside: full suite 543 passed / 8 skipped; `gpu:check` all
gates green; the Playwright shell spec passes headless (SwiftShader,
which advertises `timestamp-query` — the timing path runs live in CI)
and headed on Metal.

## What changed and why (hot-path patches rejected — DG10.5)

The draft prescribed `BufferPool` integrations into M1's KDK, M5's
reduction finalisation, and M6's `metricsTick`, promising ~3×. Checked
against the landed tree:

- `src/integrate/kdk.ts` contains **zero** `Float64Array` allocations —
  M1 landed flat-tuple monomorphic (the same finding that rejected G8's
  pooling, DG8.4). Measured baseline: **0.75 µs** per macro step vs the
  50 µs budget.
- `src/quadtree/reduce_host.ts` **does not exist** — reduction
  finalisation happens on the GPU in `reduce.wgsl`; the CPU only decodes
  the 208-byte `TileReduction`.
- `metricsTick` (`src/metrics/observe_extended.ts`) is the CPU twin used
  by tests and the M9 inspector; production metrics run in WGSL. Not a
  hot path.

`test/integration/perf_baseline.test.ts` (G8) remains the regression
gate. If a future profile shows a real allocation-bound path, pooling
can be reconsidered against evidence.

## Notes for the implementer

- **`resolveQuerySet` offsets are 256-byte aligned.** Use one query set
  and one resolve at offset 0; per-pass sets with packed slots validate
  as errors, and WebGPU validation errors never throw — the submission
  is silently dropped (keep the `uncapturederror` listener installed).
- **Request `timestamp-query` at device creation** or the timer can
  never exist. Gate the timer on `device.features`, not the
  detection-time profile.
- **One-frame profiling latency is intentional.** Awaiting `read()` in
  the frame would stall the loop; the monitor records last frame's GPU
  numbers against this frame. Over a 120-frame window the shift is
  invisible to mean/p95.
- **Back off `frameBudget`, not `maxInFlight`.** In the landed scheduler
  `maxInFlight` is an *input count*, not a cap; the dispatch knob is
  `frameBudget`.
- **Budget feedback is advisory for tier, mandatory for the cap.** The
  cap is the monitor's own knob, applied immediately and recovering
  instantly when the window clears. The tier recommendation is surfaced
  (`loop.lastRecommendation`) — never silently change what the user
  picked.
- **Timing is sampling, not accounting.** Drops (overlapping reads,
  device loss mid-read) are expected and harmless; rings tolerate gaps.
- **Stats math stays pure.** Anything that needs a device goes in
  `gpu_timing.ts` behind the cap gate; the exit suite runs without
  WebGPU.
