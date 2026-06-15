# G10 — Performance budgeting & profiling

## Goal

Principia's frame loop (G2) currently reports a single `cpuMs` per tick and an
optional `gpuMs` it never fills. That is not enough to keep the slippy-map under
budget: at Research tier a single over-long frame stutters the pan, and the
scheduler has no signal to back off. G10 adds a `PerfMonitor` that the G2
`FrameLoop` feeds each frame — rolling per-frame CPU timings plus per-pass GPU
timestamps (via the optional WebGPU `timestamp-query` feature, detected through
G9's `CapabilityProfile.features`, and degrading cleanly to CPU-only timing when
it is absent) — computes rolling mean/p95, and emits an **over-budget signal**
that feeds back into the scheduler (reduce dispatches-per-frame, and, when the
overrun is sustained, recommend a tier drop). The pure stats math and the budget
feedback are GPU-free and fully unit-testable; the GPU timestamp helper is a thin
query-set wrapper that pairs with G7's device-loss recovery (a lost device drops
its query set; the monitor keeps its CPU rings). This is the profiling
counterpart to G8's hot-path patches — G8 sketched the `BufferPool`; G10 ships
the actual labelled integrations into M1/M5/M6 inner loops.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/perf/perf_monitor
```

passes with at least **15** green tests covering: rolling-window mean/p95
(including p95 on a partial window), the over-budget classifier
(`ok`/`over`/`sustained`), the `recommend()` feedback (dispatch-cap reduction and
the tier-drop recommendation per ADR 0003 ordering), CPU-only degradation when
`timestamp-query` is absent, and per-pass GPU label accumulation when it is
present.

## File tree

```
principia/
  src/
    perf/
      perf_monitor.ts        # NEW: PerfMonitor (rolling CPU+GPU stats, budget feedback)
      gpu_timing.ts          # NEW: GpuTimer (timestamp-query set + resolve), cap-gated factory
      stats.ts               # NEW: pure RollingWindow + percentile (no GPU, no DOM)
      pooled_buffers.ts      # MODIFIED (G8): BufferPool reused by the hot-path patches below
    app/
      types.ts               # MODIFIED: FrameStats gains timing fields (see patch)
      frame_loop.ts          # MODIFIED: tickOnce records into PerfMonitor (see patch)
  test/
    unit/
      perf/
        perf_monitor.test.ts # NEW: pure stats + budget feedback + degradation (no real GPU)
        stats.test.ts        # NEW: RollingWindow / percentile unit tests
    integration/
      perf_timing_probe.test.ts # NEW: real timestamp-query probe, skipped without WebGPU
```

## Depends on / pairs with

- **G2** (`FrameLoop.tickOnce(): FrameStats`, `FrameStats`, `JobLedger`, `App`) —
  G10 extends `FrameStats` and has `tickOnce` record into the monitor; the
  `recommend()` output flows back through `FrameLoopOpts.maxInFlight` /
  `frameBudget` and the store's tier.
- **G9** (`CapabilityProfile.features`) — the monitor reads `features.includes('timestamp-query')`
  to decide whether to build a `GpuTimer`; absent ⇒ CPU-only, no error.
- **G7** (device-loss recovery) — a lost device's `GPUQuerySet` is gone; the
  monitor's CPU rings survive, and `GpuTimer` is rebuilt by G7's
  `rebuildPipelines` hook on a fresh device.
- **G8** (`BufferPool` / `pooled_buffers.ts`, `perf_baseline.test.ts`) — G10
  supplies the actual M1/M5/M6 hot-path integrations G8 only sketched.
- Contracts: quality tiers per **ADR 0003** (`preview → balanced → research`,
  FTLE Research-only); outcome enum **ADR 0002**; `DEGENERATE` reason enum
  **ADR 0007** (unchanged — referenced by the hot-path patches, not modified).

## `src/perf/stats.ts`

Pure rolling-window statistics. No GPU, no DOM, no allocation in the hot path
(the ring reuses a single `Float64Array`). `noUncheckedIndexedAccess`-safe.

```ts
/**
 * Fixed-capacity rolling window of f64 samples with O(1) push and
 * O(k log k) percentile (k = current fill). Pure and synchronous — the
 * whole point is that PerfMonitor's math is unit-testable without a GPU.
 */
export class RollingWindow {
  private readonly buf: Float64Array;
  private head = 0;        // next write index
  private count = 0;       // number of valid samples (≤ capacity)
  private runningSum = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('RollingWindow capacity must be > 0');
    this.buf = new Float64Array(capacity);
  }

  /** Push one sample, overwriting the oldest when full. */
  push(x: number): void {
    if (this.count === this.capacity) {
      // Evict the value we are about to overwrite from the running sum.
      this.runningSum -= this.buf[this.head] ?? 0;
    } else {
      this.count++;
    }
    this.buf[this.head] = x;
    this.runningSum += x;
    this.head = (this.head + 1) % this.capacity;
  }

  get size(): number { return this.count; }

  /** Arithmetic mean of the current window; 0 when empty. */
  mean(): number {
    return this.count === 0 ? 0 : this.runningSum / this.count;
  }

  /** Snapshot the valid samples (oldest → newest) into a fresh array. */
  toArray(): number[] {
    const out: number[] = [];
    const start = this.count < this.capacity
      ? 0
      : this.head;                       // when full, head points at the oldest
    for (let i = 0; i < this.count; i++) {
      out.push(this.buf[(start + i) % this.capacity] ?? 0);
    }
    return out;
  }

  /**
   * Linear-interpolated percentile (p in [0,1]) over the current window.
   * Returns 0 when empty. p=0 → min, p=1 → max.
   */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    if (p <= 0) return Math.min(...this.toArray());
    if (p >= 1) return Math.max(...this.toArray());
    const sorted = this.toArray().sort((a, b) => a - b);
    const rank = p * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const frac = rank - lo;
    const a = sorted[lo] ?? 0;
    const b = sorted[hi] ?? 0;
    return a + (b - a) * frac;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.runningSum = 0;
    this.buf.fill(0);
  }
}

/** Convenience: p95 of a window. */
export function p95(w: RollingWindow): number {
  return w.percentile(0.95);
}
```

## `src/perf/gpu_timing.ts`

A thin GPU timestamp helper: a two-element `GPUQuerySet` (begin/end) per pass,
written via `timestampWrites` on a compute pass, resolved into a buffer, and read
back as nanoseconds → milliseconds. The factory is **cap-gated**: it returns
`null` when `timestamp-query` is not in `CapabilityProfile.features`, so the
monitor degrades to CPU-only timing with no branching at the call sites beyond a
null check.

```ts
import type { CapabilityProfile } from '@/gpu/capability.js';

/** Names of the GPU passes G10 times per frame. Stable keys for the rings. */
export type GpuPass = 'simulate' | 'reduce' | 'reduce_spreads' | 'render';

export const GPU_PASSES: readonly GpuPass[] = [
  'simulate', 'reduce', 'reduce_spreads', 'render',
];

/** A resolved per-pass GPU timing (milliseconds), keyed by pass. */
export type GpuPassTimings = Partial<Record<GpuPass, number>>;

/** Minimal device surface we need — keeps the helper mockable without WebGPU. */
export interface TimingDevice {
  createQuerySet(desc: { type: 'timestamp'; count: number; label?: string }): GPUQuerySet;
  createBuffer(desc: GPUBufferDescriptor): GPUBuffer;
}

/**
 * Owns one timestamp query-set per pass plus the resolve/readback buffers.
 * `timestampWrites(pass)` returns the descriptor you spread into
 * `beginComputePass({ timestampWrites })`; `resolve(encoder)` copies the raw
 * query results into the readback staging buffer; `read()` maps them back as ms.
 *
 * Pairs with G7: on device loss the query sets and buffers are gone — discard
 * this instance and rebuild a fresh one on the recovered device.
 */
export class GpuTimer {
  private readonly sets = new Map<GpuPass, GPUQuerySet>();
  private readonly resolveBuf: GPUBuffer;
  private readonly readBuf: GPUBuffer;
  /** 2 timestamps (begin/end) × 8 bytes (u64) per pass. */
  private static readonly STRIDE = 2 * 8;

  constructor(private readonly device: TimingDevice, passes = GPU_PASSES) {
    for (const pass of passes) {
      this.sets.set(pass, device.createQuerySet({
        type: 'timestamp', count: 2, label: `principia.timing.${pass}`,
      }));
    }
    const total = passes.length * GpuTimer.STRIDE;
    this.resolveBuf = device.createBuffer({
      size: total,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      label: 'principia.timing.resolve',
    });
    this.readBuf = device.createBuffer({
      size: total,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'principia.timing.read',
    });
  }

  /** Spread into `beginComputePass`/`beginRenderPass({ ...timestampWrites })`. */
  timestampWrites(pass: GpuPass): GPUComputePassTimestampWrites | undefined {
    const set = this.sets.get(pass);
    if (!set) return undefined;
    return { querySet: set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  /** Encode resolve copies for every pass into the command encoder. */
  resolve(encoder: GPUCommandEncoder): void {
    let offset = 0;
    for (const set of this.sets.values()) {
      encoder.resolveQuerySet(set, 0, 2, this.resolveBuf, offset);
      offset += GpuTimer.STRIDE;
    }
    encoder.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0,
      this.sets.size * GpuTimer.STRIDE);
  }

  /**
   * Map the readback buffer and decode each pass's (end − begin) into ms.
   * Timestamps are u64 nanoseconds; we read them as BigInt to avoid f64
   * precision loss, then convert the delta to ms.
   */
  async read(): Promise<GpuPassTimings> {
    await this.readBuf.mapAsync(GPUMapMode.READ);
    const view = new BigUint64Array(this.readBuf.getMappedRange());
    const out: GpuPassTimings = {};
    let i = 0;
    for (const pass of this.sets.keys()) {
      const begin = view[i * 2] ?? 0n;
      const end = view[i * 2 + 1] ?? 0n;
      const deltaNs = end > begin ? end - begin : 0n;
      out[pass] = Number(deltaNs) / 1e6;          // ns → ms
      i++;
    }
    this.readBuf.unmap();
    return out;
  }

  destroy(): void {
    for (const set of this.sets.values()) set.destroy();
    this.resolveBuf.destroy();
    this.readBuf.destroy();
  }
}

/**
 * Build a GpuTimer only when the device advertises `timestamp-query`
 * (G9's CapabilityProfile.features). Otherwise return null and let the
 * monitor fall back to CPU-only timing. Never throws on a missing feature.
 */
export function makeGpuTimer(
  device: TimingDevice,
  profile: Pick<CapabilityProfile, 'features'>,
): GpuTimer | null {
  if (!profile.features.includes('timestamp-query')) return null;
  return new GpuTimer(device);
}
```

## `src/perf/perf_monitor.ts`

The monitor itself. It owns one CPU ring for whole-frame time and one ring per
GPU pass, computes rolling mean/p95, classifies budget state, and produces a
`PerfRecommendation` the scheduler consumes. Pure of any GPU dependency beyond
the optional `GpuPassTimings` it is *handed* — the frame loop reads the GPU
timings (via `GpuTimer.read()`) and passes them in, so the monitor's logic is
fully testable with plain objects.

```ts
import { RollingWindow } from './stats.js';
import { GPU_PASSES, type GpuPass, type GpuPassTimings } from './gpu_timing.js';
// QualityTier's canonical home is G9's '@/gpu/capability.js'. M8's
// ViewState.qualityTier is the SAME union (identical members) — `recommend()`
// takes `view.qualityTier` directly; do not re-declare a parallel type.
import type { QualityTier } from '@/gpu/capability.js';

/** Per-frame sample handed to the monitor. */
export interface FrameTimingSample {
  cpuMs: number;
  /** Resolved per-pass GPU timings (ms); empty/absent when CPU-only. */
  gpu?: GpuPassTimings;
  jobsDispatched: number;
}

export type BudgetState = 'ok' | 'over' | 'sustained';

export interface PerfSnapshot {
  frames: number;
  cpuMeanMs: number;
  cpuP95Ms: number;
  /** Per-pass GPU p95 (ms); empty when timestamp-query is unavailable. */
  gpuP95Ms: GpuPassTimings;
  gpuTimingAvailable: boolean;
  budget: BudgetState;
  /** Fraction of the window's frames that exceeded the budget. */
  overFraction: number;
}

/** What the monitor recommends the scheduler do next frame. */
export interface PerfRecommendation {
  /** Multiply the current per-frame dispatch cap by this (≤ 1 backs off). */
  dispatchCapScale: number;
  /** Suggested next tier, or null to keep the current one. ADR 0003 order. */
  recommendTier: QualityTier | null;
  reason: string;
}

export interface PerfMonitorOpts {
  /** Rolling window length in frames. */
  windowFrames: number;
  /** Target frame budget in ms (G2's frameBudget is in jobs; this is wall-clock). */
  frameBudgetMs: number;
  /**
   * p95/budget ratio above which a single window counts as "over"; and the
   * overFraction above which "over" escalates to "sustained".
   */
  overRatio: number;          // e.g. 1.0  (p95 over budget)
  sustainedFraction: number;  // e.g. 0.5  (≥50% of frames over)
  /** Whether the device exposes timestamp-query (from G9 features). */
  gpuTimingAvailable: boolean;
}

const TIER_ORDER: readonly QualityTier[] = ['preview', 'balanced', 'research'];

/** Next-lower tier per ADR 0003, or null at the floor. */
export function lowerTier(t: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(t);
  return i > 0 ? TIER_ORDER[i - 1]! : null;
}

export class PerfMonitor {
  private readonly cpu: RollingWindow;
  private readonly wall: RollingWindow;        // per-frame effective wall time (ms)
  private readonly gpu = new Map<GpuPass, RollingWindow>();
  private readonly overFlags: RollingWindow;   // 1 = over budget that frame
  private frames = 0;

  constructor(private readonly opts: PerfMonitorOpts) {
    if (opts.windowFrames <= 0) throw new RangeError('windowFrames must be > 0');
    this.cpu = new RollingWindow(opts.windowFrames);
    this.wall = new RollingWindow(opts.windowFrames);
    this.overFlags = new RollingWindow(opts.windowFrames);
    for (const pass of GPU_PASSES) this.gpu.set(pass, new RollingWindow(opts.windowFrames));
  }

  /** Record one frame's timings. Pure bookkeeping — no GPU calls. */
  record(sample: FrameTimingSample): void {
    this.frames++;
    this.cpu.push(sample.cpuMs);
    // The "wall-clock" we budget against is the max of CPU planning and the
    // summed GPU passes when timestamps exist, else CPU time. The over flag and
    // the budget classifier both read this single wall metric so they agree.
    const wall = this.frameWallMs(sample);
    this.wall.push(wall);
    this.overFlags.push(wall > this.opts.frameBudgetMs ? 1 : 0);
    if (this.opts.gpuTimingAvailable && sample.gpu) {
      for (const pass of GPU_PASSES) {
        const v = sample.gpu[pass];
        if (typeof v === 'number') this.gpu.get(pass)!.push(v);
      }
    }
  }

  /** The frame's effective wall time used for budgeting. */
  private frameWallMs(sample: FrameTimingSample): number {
    if (this.opts.gpuTimingAvailable && sample.gpu) {
      // GPU passes run after CPU planning; the frame is bounded by the larger.
      const gpuTotal = GPU_PASSES.reduce((s, p) => s + (sample.gpu![p] ?? 0), 0);
      return Math.max(sample.cpuMs, gpuTotal);
    }
    return sample.cpuMs;
  }

  /**
   * Classify the current window's budget state. Uses the same summed wall
   * metric the over flag is derived from (max of CPU and summed GPU passes),
   * so the p95 ratio and the over fraction can never disagree.
   */
  budgetState(): BudgetState {
    if (this.wall.size === 0) return 'ok';
    const wallRatio = this.wall.percentile(0.95) / this.opts.frameBudgetMs;
    if (wallRatio <= this.opts.overRatio) return 'ok';
    return this.overFlags.mean() >= this.opts.sustainedFraction ? 'sustained' : 'over';
  }

  snapshot(): PerfSnapshot {
    const gpuP95Ms: GpuPassTimings = {};
    if (this.opts.gpuTimingAvailable) {
      for (const [pass, w] of this.gpu) gpuP95Ms[pass] = w.percentile(0.95);
    }
    return {
      frames: this.frames,
      cpuMeanMs: this.cpu.mean(),
      cpuP95Ms: this.cpu.percentile(0.95),
      gpuP95Ms,
      gpuTimingAvailable: this.opts.gpuTimingAvailable,
      budget: this.budgetState(),
      overFraction: this.overFlags.mean(),
    };
  }

  /**
   * Feed back into the scheduler. `over` trims the dispatch cap (gentle
   * back-pressure that keeps the map responsive); `sustained` additionally
   * recommends dropping a tier (ADR 0003 order) so the next batch is cheaper.
   * Below a minimum sample count we stay neutral to avoid reacting to noise.
   */
  recommend(currentTier: QualityTier): PerfRecommendation {
    const neutral: PerfRecommendation = {
      dispatchCapScale: 1, recommendTier: null, reason: 'within budget',
    };
    if (this.cpu.size < Math.max(4, Math.floor(this.opts.windowFrames / 4))) {
      return { ...neutral, reason: 'insufficient samples' };
    }
    switch (this.budgetState()) {
      case 'ok':
        return neutral;
      case 'over':
        return {
          dispatchCapScale: 0.5,
          recommendTier: null,
          reason: `p95 over ${this.opts.frameBudgetMs}ms budget; halving dispatch cap`,
        };
      case 'sustained': {
        const next = lowerTier(currentTier);
        return {
          dispatchCapScale: 0.25,
          recommendTier: next,
          reason: next
            ? `sustained overrun (${(this.overFlags.mean() * 100).toFixed(0)}% of frames); ` +
              `recommend tier ${currentTier} → ${next}`
            : `sustained overrun at floor tier '${currentTier}'; holding, cap quartered`,
        };
      }
    }
  }

  reset(): void {
    this.frames = 0;
    this.cpu.reset();
    this.wall.reset();
    this.overFlags.reset();
    for (const w of this.gpu.values()) w.reset();
  }
}
```

## Integration patch — `FrameStats` (`src/app/types.ts`)

G2's `FrameStats` (~line 108) gains the per-pass GPU timing slot and an explicit
over-budget flag. MODIFIED, additive — existing fields and callers are unchanged.

```ts
// src/app/types.ts — extend the existing FrameStats interface.
import type { GpuPassTimings } from '@/perf/gpu_timing.js';

export interface FrameStats {
  frame:           number;
  visible:         number;
  cacheHits:       number;
  ancestorFalls:   number;
  jobsDispatched:  number;
  jobsCompleted:   number;
  cpuMs:           number;
  gpuMs?:          number;          // unchanged: total GPU ms (sum of passes)
  // --- G10 additions ---
  gpuPassMs?:      GpuPassTimings;  // per-pass GPU timings (when timestamp-query)
  overBudget?:     boolean;         // this frame's wall time exceeded frameBudgetMs
}
```

## Integration patch — `FrameLoop.tickOnce` (`src/app/frame_loop.ts`)

`tickOnce` already measures `cpuMs` (`stats.cpuMs = this.deps.now() - t0`). G10
threads a `PerfMonitor` through `FrameLoop`, records the frame, and applies the
recommendation as back-pressure on the dispatch cap. GPU per-pass timings arrive
asynchronously (the previous frame's resolved `GpuTimer.read()`), so the loop
records last frame's GPU numbers against this frame — standard one-frame-latency
profiling. Only the changed lines are shown.

```ts
// src/app/frame_loop.ts (patch)
import { PerfMonitor } from '@/perf/perf_monitor.js';
import type { GpuPassTimings } from '@/perf/gpu_timing.js';

export interface FrameLoopOpts {
  frameBudget:     number;   // unchanged: tile-jobs/frame (G2)
  maxInFlight:     number;
  ftleEnabled:     boolean;
  ensembleEnabled: boolean;
  // --- G10 additions ---
  frameBudgetMs:   number;   // wall-clock budget, e.g. 16
  perfWindow:      number;   // rolling window length in frames, e.g. 120
  gpuTimingAvailable: boolean; // from ctx.capability.features.includes('timestamp-query')
}

// In the constructor, build the monitor and a mutable dispatch cap:
//   this.perf = new PerfMonitor({
//     windowFrames: opts.perfWindow,
//     frameBudgetMs: opts.frameBudgetMs,
//     overRatio: 1.0, sustainedFraction: 0.5,
//     gpuTimingAvailable: opts.gpuTimingAvailable,
//   });
//   this.dispatchCap = opts.maxInFlight;

// The dispatcher hands back the *previous* frame's resolved GPU timings (or
// undefined when CPU-only). FrameLoop stores the most recent ones here:
//   private pendingGpu: GpuPassTimings | undefined;

tickOnce(): FrameStats {
  const t0 = this.deps.now();
  this.frameNum++;
  const view = this.store.snapshot();
  const stats: FrameStats = {
    frame: this.frameNum, visible: 0,
    cacheHits: 0, ancestorFalls: 0,
    jobsDispatched: 0, jobsCompleted: 0,
    cpuMs: 0,
  };

  // ... unchanged: build the render plan, walk ancestors ...

  // Schedule new compute jobs, but cap by the perf-driven back-pressure.
  const jobPlan = planFrame(this.cache, view, {
    frameBudget: this.opts.frameBudget,
    maxInFlight: Math.min(this.dispatchCap, this.opts.maxInFlight),
    ftleEnabled: this.opts.ftleEnabled,
    ensembleEnabled: this.opts.ensembleEnabled,
  });
  for (const job of jobPlan) {
    if (this.ledger.dispatch(job.id, view)) stats.jobsDispatched++;
  }
  this.ledger.cancelOffscreen(visibleKeys);

  // Render this frame.
  this.dispatcher.render(plan);

  stats.cpuMs = this.deps.now() - t0;

  // --- G10: record + feed back. pendingGpu is last frame's resolved timings. ---
  const gpu: GpuPassTimings | undefined = this.pendingGpu;
  this.perf.record({ cpuMs: stats.cpuMs, gpu, jobsDispatched: stats.jobsDispatched });
  const rec = this.perf.recommend(view.qualityTier);
  this.dispatchCap = Math.max(1, Math.round(this.dispatchCap * rec.dispatchCapScale));
  // Do NOT mutate the tier — and do NOT write it onto ViewState (it has no
  // recommendedTier field; ViewState is a closed interface). The recommendation
  // already lives on the monitor: the UI reads `frameLoop.perf.recommend(tier)`
  // (or the cached `rec` exposed via a getter) and either auto-applies (default)
  // or shows a toast. PerfMonitor is the single source of the suggestion.
  if (gpu) {
    stats.gpuPassMs = gpu;
    stats.gpuMs = (Object.values(gpu) as number[]).reduce((s, x) => s + x, 0);
  }
  stats.overBudget = this.perf.snapshot().budget !== 'ok';
  return stats;
}
```

The matching dispatcher change: the real `GpuDispatcher` (G2 `makeRealDispatcher`)
wraps each compute/render pass with `timer?.timestampWrites(pass)` in its
`beginComputePass`/`beginRenderPass` descriptors, calls `timer?.resolve(encoder)`
before `queue.submit`, and `await timer?.read()` one frame later — storing the
result so `FrameLoop` picks it up as `pendingGpu`. When `makeGpuTimer` returns
`null` (no `timestamp-query`), every `timer?.*` is a no-op and the loop stays
CPU-only.

## Hot-path patches (BufferPool integration)

These ship G8's sketched `BufferPool` into the three TS-side inner loops. Each is
a labelled patch, not a rewrite — the surrounding M1/M5/M6 functions keep their
signatures and their golden behaviour.

### PATCH M1 — Flat6 KDK macro step (`src/integrate/kdk.ts`)

The Flat6 KDK substep loop allocated a fresh position/momentum `Float64Array`
per substep. Borrow from a module-level pool and return on exit; build the
immutable `TrajState` only at the return.

```ts
// src/integrate/kdk.ts (patch — top of file)
import { BufferPool } from '@/perf/pooled_buffers.js';

const flat6Pool = new BufferPool(6);   // [r0x,r0y, r1x,r1y, r2x,r2y] etc.

// Inside kdkMacroStep, replace per-substep `new Float64Array(6)` with:
//   const R = flat6Pool.borrow();
//   const P = flat6Pool.borrow();
//   try { /* substep KDK kicks/drifts mutate R,P in place */ }
//   finally { flat6Pool.return(R); flat6Pool.return(P); }
// Construct the returned TrajState from R,P exactly once before the finally.
```

### PATCH M5 — reduction first pass scratch (`src/quadtree/reduce_host.ts`)

M5's CPU-side coherence/priority finalisation (post-readback) allocated a per-tile
scratch array for the class histogram. Reuse a pooled buffer sized to the 5-class
ADR 0002 enum (`BOUNDED..TIMEOUT`).

```ts
// src/quadtree/reduce_host.ts (patch)
import { BufferPool } from '@/perf/pooled_buffers.js';

const histPool = new BufferPool(5);    // one slot per ADR 0002 outcome class

// In finalizeReduction(...), replace `const hist = new Float64Array(5)` with:
//   const hist = histPool.borrow();
//   hist.fill(0);
//   try { /* accumulate outcome_impurity / dominant_outcome */ }
//   finally { histPool.return(hist); }
```

### PATCH M6 — metricsTick scratch (`src/metrics/metrics.ts`)

M6's `metricsTick` allocated the shape-sphere vector and unwrapped-phase pairs on
every call. Pre-allocate them on the accumulator (G8's `MetricsAccumulator`
fields) and mutate in place; downstream reads `prevN` (also mutated, not
replaced), so the golden values are unchanged.

```ts
// src/metrics/metrics.ts (patch — MetricsAccumulator already gained these in G8)
//   _scratchN: Float64Array(3); _scratchRho: Float64Array(2); _scratchLambda: Float64Array(2)
// Inside metricsTick, write into acc._scratchN instead of `const n = [..]`,
// then copy into acc.prevN (in place) at the end of the tick. No allocation
// in the steady state.
```

Effect, per G8's measured baseline: ~3× throughput on M1's Burrau golden
(GC-pressure dominated) and ~1.4× on the M5 finalisation pass; M6 drops to zero
steady-state allocation per tick. The `perf_baseline.test.ts` budgets from G8
(KDK macro step < 50 µs) still hold and gate these patches.

## Tests

### `test/unit/perf/stats.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { RollingWindow, p95 } from '@/perf/stats.js';

describe('RollingWindow', () => {
  it('mean of a partial window', () => {
    const w = new RollingWindow(5);
    w.push(2); w.push(4); w.push(6);
    expect(w.size).toBe(3);
    expect(w.mean()).toBeCloseTo(4, 12);
  });

  it('evicts the oldest sample and updates the running mean', () => {
    const w = new RollingWindow(3);
    [1, 2, 3, 4].forEach(x => w.push(x));   // 1 evicted
    expect(w.toArray()).toEqual([2, 3, 4]);
    expect(w.mean()).toBeCloseTo(3, 12);
  });

  it('toArray returns oldest → newest after wraparound', () => {
    const w = new RollingWindow(3);
    [10, 20, 30, 40, 50].forEach(x => w.push(x));
    expect(w.toArray()).toEqual([30, 40, 50]);
  });

  it('percentile interpolates linearly', () => {
    const w = new RollingWindow(4);
    [1, 2, 3, 4].forEach(x => w.push(x));
    // rank for p=0.5 over 4 samples = 0.5*3 = 1.5 → between 2 and 3 = 2.5
    expect(w.percentile(0.5)).toBeCloseTo(2.5, 12);
    expect(w.percentile(0)).toBe(1);
    expect(w.percentile(1)).toBe(4);
  });

  it('p95 on a partial window does not throw and is ≤ max', () => {
    const w = new RollingWindow(120);
    [5, 5, 5, 100].forEach(x => w.push(x));
    expect(p95(w)).toBeLessThanOrEqual(100);
    expect(p95(w)).toBeGreaterThanOrEqual(5);
  });

  it('empty window yields 0 for mean and percentile', () => {
    const w = new RollingWindow(8);
    expect(w.mean()).toBe(0);
    expect(w.percentile(0.95)).toBe(0);
  });
});
```

### `test/unit/perf/perf_monitor.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  PerfMonitor, lowerTier,
  type PerfMonitorOpts, type FrameTimingSample,
} from '@/perf/perf_monitor.js';
import type { GpuPassTimings } from '@/perf/gpu_timing.js';

const opts = (over: Partial<PerfMonitorOpts> = {}): PerfMonitorOpts => ({
  windowFrames: 20,
  frameBudgetMs: 16,
  overRatio: 1.0,
  sustainedFraction: 0.5,
  gpuTimingAvailable: false,
  ...over,
});

const cpuFrame = (cpuMs: number): FrameTimingSample =>
  ({ cpuMs, jobsDispatched: 4 });

const gpuFrame = (cpuMs: number, gpu: GpuPassTimings): FrameTimingSample =>
  ({ cpuMs, gpu, jobsDispatched: 4 });

describe('lowerTier (ADR 0003 ordering)', () => {
  it('research → balanced → preview → null', () => {
    expect(lowerTier('research')).toBe('balanced');
    expect(lowerTier('balanced')).toBe('preview');
    expect(lowerTier('preview')).toBeNull();
  });
});

describe('PerfMonitor: rolling stats', () => {
  it('reports CPU mean and p95 over the window', () => {
    const m = new PerfMonitor(opts());
    for (const x of [8, 8, 8, 8, 8, 8, 8, 8, 8, 40]) m.record(cpuFrame(x));
    const s = m.snapshot();
    expect(s.frames).toBe(10);
    expect(s.cpuMeanMs).toBeCloseTo((8 * 9 + 40) / 10, 6);
    expect(s.cpuP95Ms).toBeGreaterThan(8);          // the 40ms outlier pulls p95 up
  });

  it('rolls off old frames beyond the window', () => {
    const m = new PerfMonitor(opts({ windowFrames: 4 }));
    for (const x of [100, 100, 1, 1, 1, 1]) m.record(cpuFrame(x));
    // window now holds the last four 1ms frames
    expect(m.snapshot().cpuMeanMs).toBeCloseTo(1, 6);
  });
});

describe('PerfMonitor: budget classifier', () => {
  it('comfortably-under-budget window is ok', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(6));
    expect(m.budgetState()).toBe('ok');
  });

  it('a few slow frames classify as over (not sustained)', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 18; i++) m.record(cpuFrame(6));
    m.record(cpuFrame(40)); m.record(cpuFrame(40));   // 2/20 over budget
    expect(m.budgetState()).toBe('over');
  });

  it('majority-over-budget window classifies as sustained', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(40));   // every frame over
    expect(m.snapshot().overFraction).toBeCloseTo(1, 6);
    expect(m.budgetState()).toBe('sustained');
  });
});

describe('PerfMonitor: feedback / recommend', () => {
  it('stays neutral until it has enough samples', () => {
    const m = new PerfMonitor(opts({ windowFrames: 20 }));
    m.record(cpuFrame(40));            // 1 sample < windowFrames/4 = 5
    const r = m.recommend('balanced');
    expect(r.dispatchCapScale).toBe(1);
    expect(r.recommendTier).toBeNull();
    expect(r.reason).toMatch(/insufficient/);
  });

  it('within budget → no back-pressure', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(6));
    const r = m.recommend('balanced');
    expect(r.dispatchCapScale).toBe(1);
    expect(r.recommendTier).toBeNull();
  });

  it('over budget → halves the dispatch cap, keeps the tier', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 18; i++) m.record(cpuFrame(6));
    m.record(cpuFrame(40)); m.record(cpuFrame(40));
    const r = m.recommend('balanced');
    expect(r.dispatchCapScale).toBe(0.5);
    expect(r.recommendTier).toBeNull();
  });

  it('sustained overrun → quarters the cap and recommends a tier drop', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(40));
    const r = m.recommend('research');
    expect(r.dispatchCapScale).toBe(0.25);
    expect(r.recommendTier).toBe('balanced');     // ADR 0003 next-lower
    expect(r.reason).toMatch(/research → balanced/);
  });

  it('sustained overrun at the floor tier holds the tier', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(40));
    const r = m.recommend('preview');
    expect(r.recommendTier).toBeNull();
    expect(r.dispatchCapScale).toBe(0.25);
    expect(r.reason).toMatch(/floor tier/);
  });
});

describe('PerfMonitor: timestamp-query degradation', () => {
  it('CPU-only: ignores GPU timings and exposes no gpuP95', () => {
    const m = new PerfMonitor(opts({ gpuTimingAvailable: false }));
    for (let i = 0; i < 10; i++) {
      m.record(gpuFrame(6, { simulate: 99, reduce: 99 }));   // GPU numbers present
    }
    const s = m.snapshot();
    expect(s.gpuTimingAvailable).toBe(false);
    expect(s.gpuP95Ms).toEqual({});               // GPU passes not tracked
    expect(s.budget).toBe('ok');                  // budget from cpuMs (6ms) only
  });

  it('GPU timing available: budgets against the larger of CPU and GPU passes', () => {
    const m = new PerfMonitor(opts({ gpuTimingAvailable: true }));
    // CPU is cheap (4ms) but the simulate+reduce passes blow the 16ms budget.
    for (let i = 0; i < 20; i++) {
      m.record(gpuFrame(4, { simulate: 14, reduce: 10, render: 2 }));
    }
    const s = m.snapshot();
    expect(s.gpuTimingAvailable).toBe(true);
    expect(s.gpuP95Ms.simulate).toBeCloseTo(14, 6);
    expect(s.budget).toBe('sustained');           // 26ms wall > 16ms every frame
    expect(m.recommend('research').recommendTier).toBe('balanced');
  });
});
```

### `test/integration/perf_timing_probe.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeGpuTimer, GPU_PASSES } from '@/perf/gpu_timing.js';

// Real-device probe: only runs where WebGPU + timestamp-query exist. Mirrors
// G9's capability_probe — skips cleanly on headless CI.
const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

describe.skipIf(!hasGpu)('GpuTimer (real adapter, timestamp-query)', () => {
  it('builds only when the feature is present and resolves a timing', async () => {
    const gpu = (navigator as unknown as { gpu: GPUMVP }).gpu as any;
    const adapter = await gpu.requestAdapter();
    const features = [...(adapter.features ?? [])].map(String);
    const device = await adapter.requestDevice(
      features.includes('timestamp-query')
        ? { requiredFeatures: ['timestamp-query'] }
        : {},
    );
    const timer = makeGpuTimer(device, { features });
    if (!features.includes('timestamp-query')) {
      expect(timer).toBeNull();                   // graceful degradation
      return;
    }
    expect(timer).not.toBeNull();
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass({ timestampWrites: timer!.timestampWrites('simulate') });
    pass.end();
    timer!.resolve(enc);
    device.queue.submit([enc.finish()]);
    const t = await timer!.read();
    expect(GPU_PASSES).toContain('simulate');
    expect(typeof t.simulate).toBe('number');
    expect(t.simulate).toBeGreaterThanOrEqual(0);
    timer!.destroy();
  });
});

type GPUMVP = unknown;
```

## Run it

```bash
npm test -- --run test/unit/perf/perf_monitor
npm test -- --run test/unit/perf/stats
npm test -- --run test/integration/perf_timing_probe   # real GPU only; skips otherwise
```

## Acceptance check

```bash
npm test -- --run test/unit/perf/perf_monitor
```

`test/unit/perf/perf_monitor.test.ts` passes with ≥15 green tests: rolling
mean/p95 (incl. partial windows), the three-state budget classifier, the
`recommend()` feedback (dispatch-cap reduction on `over`, additional tier-drop on
`sustained` following ADR 0003's `research → balanced → preview` order, holding at
the floor), CPU-only degradation when `timestamp-query` is absent, and per-pass
GPU p95 accumulation when it is present. `makeGpuTimer` returns `null` (never
throws) on a device without `timestamp-query`, and the real-device probe resolves
a non-negative per-pass timing on a capable machine while skipping cleanly
without one.

## Notes for the implementer

- **One-frame profiling latency is intentional.** GPU timestamps are resolved and
  mapped asynchronously; `await timer.read()` for *this* frame would stall the
  loop. The dispatcher hands the loop the *previous* frame's timings, which the
  monitor records against the current frame. Over a 120-frame window the
  one-frame shift is invisible to mean/p95.
- **Budget feedback is advisory for tier, mandatory for the cap.** The dispatch
  cap is the monitor's own knob and is applied immediately. The tier
  recommendation is **not** a ViewState field — it is exposed from `PerfMonitor`
  (`recommend()`/`snapshot()`); the UI (G8) reads it off the monitor and decides
  whether to auto-apply or prompt — never silently change what the user picked
  without surfacing it. The cap recovers naturally: once frames are back under
  budget, `dispatchCapScale` returns `1` and `Math.min(dispatchCap, maxInFlight)`
  lets it climb back to the configured ceiling.
- **CPU-only is the common case.** `timestamp-query` is an opt-in WebGPU feature
  (G9 §6.4.2). Treat its absence as normal: budget against `cpuMs` and skip the
  `GpuTimer` entirely. Do not require the feature anywhere.
- **Pair with G7.** A `GPUQuerySet` does not survive `device.lost`. On recovery,
  drop the old `GpuTimer`, re-read `ctx.capability.features` on the fresh device
  (a fallback adapter may not advertise `timestamp-query`), and rebuild via
  `makeGpuTimer`. The `PerfMonitor`'s CPU rings persist across the loss, so the
  rolling stats are continuous through a TDR.
- **Stats math stays pure.** `RollingWindow` and `PerfMonitor` never touch the
  GPU or the DOM — that is why the exit suite needs no WebGPU. Keep new logic on
  this side of the line; anything that needs a device goes in `gpu_timing.ts`
  behind the cap gate.
- **Hot-path patches must not change goldens.** The BufferPool integrations are
  pure allocation elimination: borrow/mutate/return, construct the immutable
  result once. Run the M1 Burrau and M5/M6 goldens after applying them; any value
  drift means a buffer was returned to the pool before its data was copied out.
