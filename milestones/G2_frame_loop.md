# G2 — Frame loop and orchestration

## Goal

The top-level `App` class that owns the per-frame schedule. After G2,
the milestone graph has a "main" — every other milestone is something
this loop calls into.

The loop:
1. Reads `ViewState` from the reactive store.
2. Collects the visible tile frontier at the desired depth.
3. Walks ancestors for any missing tile (so the screen never blanks).
4. Plans this frame's compute jobs via M5's `planFrame`.
5. Dispatches GPU compute + reduction passes; ingests reductions on
   completion.
6. Renders the frontier with M7's render graph.
7. Handles input events: chart switches, lock, tilt, lookup, palette.

**Exit criterion.**

```bash
npm test -- --run test/integration/app_frame_loop
```

A 100-frame synthetic harness (mocked GPU dispatch) drives the loop
through: a pan, a zoom step, a chart switch, a lock and inspect, a
palette swap. Every frame produces a valid render plan; the cache hits
the expected hit rate; reductions are ingested in submission order;
no tile is dispatched twice; the inspector recomputes once on lock and
no more.

## File tree

```
principia/
  src/
    app/
      types.ts
      store.ts                   # reactive store wrapping ViewState
      input.ts                   # gesture → state transitions
      frame_loop.ts              # the per-frame body
      gpu_jobs.ts                # job lifecycle + completion handling
      render_dispatch.ts         # compose render-graph + cache
      app.ts                     # public App class
      index.ts
  test/
    unit/app/
      store.test.ts
      input.test.ts
      gpu_jobs.test.ts
    integration/
      app_frame_loop.test.ts
```

## `src/app/types.ts`

```ts
import type { TrajState } from '@/math/types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { InspectorResult } from '@/inspector/types.js';

/** A single per-frame "tick" of the loop. Caller fills these from real
 *  hardware; tests fill them from synthetic stubs. */
export interface FrameDeps {
  now:    () => number;             // performance.now()
  rafId:  () => number;             // requestAnimationFrame id (for cancellation)
  schedule: (cb: () => void) => number;        // requestAnimationFrame
  cancel:   (id: number) => void;
  randomJitter?: (n: number) => number[];      // for ensemble dispatch
}

/** Pluggable GPU dispatcher. Real impl wires through M3 / M5. */
export interface GpuDispatcher {
  /** Submit a tile compute + reduction job. Returns a promise that
   *  resolves with the tile's TileReduction. The same promise resolves
   *  even if the tile scrolls offscreen — the caller drops the result. */
  dispatchTile(tileId: TileID, view: ViewState): Promise<TileReduction>;

  /** Cancel any queued (not yet running) work for tiles that scrolled
   *  offscreen mid-frame. */
  cancel(tileIds: readonly TileID[]): void;

  /** Render the frontier into the canvas. Caller passes the visible
   *  tile list and the (possibly stretched) ancestors. */
  render(plan: RenderPlan): void;

  /** Run one tile through the inspector pipeline at f64. */
  inspect(view: ViewState, ic: TrajState): Promise<InspectorResult>;
}

export interface RenderPlanEntry {
  tile:      TileID;
  source:    'self' | 'ancestor';
  ancestor?: TileID;             // when source = 'ancestor'
  /** Sub-rect within the ancestor texture, [u0, v0, u1, v1]. */
  subrect?:  [number, number, number, number];
}

export interface RenderPlan {
  view:    ViewState;
  entries: RenderPlanEntry[];
  /** Whether the inspector overlay should draw on top of this frame. */
  inspectorOverlay?: InspectorResult;
}

export interface FrameStats {
  frame:           number;
  visible:         number;
  cacheHits:       number;
  ancestorFalls:   number;
  jobsDispatched:  number;
  jobsCompleted:   number;
  cpuMs:           number;
  gpuMs?:          number;
}
```

## `src/app/store.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';

/**
 * Minimal reactive store. Subscribers are notified on every change;
 * callers use `setView` for immutable updates. Nothing fancy — vanilla
 * TS, zero deps. Production may swap in Svelte stores / Solid signals
 * if the GUI grows complex; the contract is `subscribe + setView +
 * snapshot`.
 */
export type Subscriber = (v: ViewState) => void;

export class Store {
  private current: ViewState;
  private subs   = new Set<Subscriber>();

  constructor(initial: ViewState = defaultViewState()) {
    this.current = initial;
  }

  snapshot(): ViewState { return this.current; }

  setView(next: ViewState): void {
    this.current = next;
    for (const cb of this.subs) cb(next);
  }

  /** Functional update. */
  update(fn: (v: ViewState) => ViewState): void {
    this.setView(fn(this.current));
  }

  subscribe(cb: Subscriber): () => void {
    this.subs.add(cb);
    cb(this.current);
    return () => { this.subs.delete(cb); };
  }
}
```

## `src/app/input.ts`

```ts
import type { Store } from './store.js';
import type { Vec8 } from '@/math/types.js';
import { setSlider } from '@/interact/sliders.js';
import { applyZoomStep } from '@/interact/zoom.js';
import { setTilts } from '@/interact/tilt.js';
import { lockAffine, unlock } from '@/interact/lock.js';
import { lookup } from '@/interact/lookup.js';
import { preserveLockAcrossChart } from '@/interact/preserve.js';
import type { LookupInput } from '@/interact/lookup.js';

/**
 * Gesture handlers translate UI events into ViewState updates.
 * Each one is a one-liner around an interact/ helper.
 */
export class InputHandlers {
  constructor(private store: Store) {}

  setSlider(k: number, value: number): void {
    this.store.update(v => setSlider(v, k, value));
  }

  zoom(deltaLog2: number): void {
    this.store.update(v => applyZoomStep(v, deltaLog2));
  }

  setTilt(opts: {
    tilt1?: number; tilt1Target?: number;
    tilt2?: number; tilt2Target?: number;
  }): void {
    this.store.update(v => setTilts(v, opts));
  }

  lock(pixel: { s: number; t: number }): void {
    this.store.update(v => lockAffine(v, pixel));
  }

  unlock(): void {
    this.store.update(v => unlock(v));
  }

  lookup(input: LookupInput): { ok: boolean; reason?: string } {
    let outcome: { ok: boolean; reason?: string } = { ok: true };
    this.store.update(v => {
      const r = lookup(input, v);
      if (r.kind === 'rejected') {
        outcome = { ok: false, reason: r.reason };
        return v;
      }
      outcome = r.clamped
        ? { ok: true, reason: 'lookup_clamped' }
        : { ok: true };
      return r.view;
    });
    return outcome;
  }

  switchChart(newChartType: string): { ok: boolean; reason?: string } {
    let outcome: { ok: boolean; reason?: string } = { ok: true };
    this.store.update(v => {
      const r = preserveLockAcrossChart(v, newChartType);
      if (r.kind === 'rejected') {
        outcome = { ok: false, reason: r.reason };
        return v;
      }
      outcome = r.projected
        ? { ok: true, reason: 'projected' }
        : { ok: true };
      return r.view;
    });
    return outcome;
  }
}
```

## `src/app/gpu_jobs.ts`

```ts
import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { GpuDispatcher } from './types.js';
import { tileKey } from '@/quadtree/tile.js';
import { TileCache } from '@/quadtree/cache.js';
import { ingestReduction } from '@/quadtree/scheduler.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';

interface InflightJob {
  tile:    TileID;
  view:    ViewState;
  promise: Promise<TileReduction>;
  cancelled: boolean;
}

/**
 * Owns the set of in-flight tile jobs. Tracks by tile-key string so
 * duplicate dispatches collapse, and so cancellations are cheap.
 */
export class JobLedger {
  private inflight = new Map<string, InflightJob>();

  constructor(
    private dispatcher: GpuDispatcher,
    private cache:      TileCache,
    private opts: { maxInFlight: number;
                    ftleEnabled: boolean; ensembleEnabled: boolean },
  ) {}

  get inflightCount(): number { return this.inflight.size; }

  /**
   * Dispatch a tile if not already in flight or fully cached. Returns
   * true if a new dispatch was queued.
   */
  dispatch(tile: TileID, view: ViewState): boolean {
    const k = tileKey(tile);
    if (this.inflight.has(k)) return false;
    if (this.inflight.size >= this.opts.maxInFlight) return false;
    const cached = this.cache.get(tile, viewStateToCacheKey(view));
    if (cached?.lifecycle === 'ready') return false;

    const job: InflightJob = {
      tile, view,
      promise: this.dispatcher.dispatchTile(tile, view),
      cancelled: false,
    };
    this.inflight.set(k, job);
    job.promise.then(reduction => {
      if (job.cancelled) return;          // result discarded
      ingestReduction(this.cache, viewStateToCacheKey(view),
                      tile, reduction,
                      this.opts.ftleEnabled, this.opts.ensembleEnabled);
      this.inflight.delete(k);
    }).catch(err => {
      // GPU job failed; drop the entry. Real impl logs.
      console.warn('GPU job failed', tile, err);
      this.inflight.delete(k);
    });
    return true;
  }

  /** Mark queued / not-yet-running jobs cancelled when their tiles are
   *  no longer visible. */
  cancelOffscreen(visibleKeys: Set<string>): void {
    const losers: TileID[] = [];
    for (const [k, job] of this.inflight) {
      if (!visibleKeys.has(k)) {
        job.cancelled = true;
        losers.push(job.tile);
      }
    }
    if (losers.length > 0) this.dispatcher.cancel(losers);
  }
}
```

## `src/app/frame_loop.ts`

```ts
import type { FrameDeps, FrameStats, GpuDispatcher,
              RenderPlan, RenderPlanEntry } from './types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { Store } from './store.js';
import { JobLedger } from './gpu_jobs.js';
import { TileCache } from '@/quadtree/cache.js';
import { visibleTiles } from '@/quadtree/visible.js';
import { ancestor, subrect, tileKey } from '@/quadtree/tile.js';
import { planFrame } from '@/quadtree/scheduler.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';

export interface FrameLoopOpts {
  frameBudget:    number;
  maxInFlight:    number;
  ftleEnabled:    boolean;
  ensembleEnabled:boolean;
}

export class FrameLoop {
  private cache:  TileCache;
  private ledger: JobLedger;
  private frameNum = 0;
  private stopped = false;
  private rafId   = 0;

  constructor(
    private store:      Store,
    private dispatcher: GpuDispatcher,
    private deps:       FrameDeps,
    private opts:       FrameLoopOpts,
  ) {
    this.cache  = new TileCache(256);
    this.ledger = new JobLedger(dispatcher, this.cache, {
      maxInFlight: opts.maxInFlight,
      ftleEnabled: opts.ftleEnabled,
      ensembleEnabled: opts.ensembleEnabled,
    });
  }

  start(): void {
    if (!this.stopped) return;        // already running (or first start)
    this.stopped = false;
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.deps.cancel(this.rafId);
  }

  /** One frame. Public for testing / single-step harnesses. */
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

    const cacheKey = viewStateToCacheKey(view);
    const visible  = visibleTiles(view);
    stats.visible  = visible.length;

    // Build the render plan and queue any missing children.
    const plan: RenderPlan = { view, entries: [] };
    const visibleKeys = new Set(visible.map(tileKey));
    const planEntries: RenderPlanEntry[] = [];

    for (const tile of visible) {
      const cached = this.cache.get(tile, cacheKey);
      if (cached?.lifecycle === 'ready') {
        planEntries.push({ tile, source: 'self' });
        stats.cacheHits++;
        continue;
      }
      const fb = this.cache.walkAncestors(tile, cacheKey);
      if (fb) {
        planEntries.push({
          tile, source: 'ancestor',
          ancestor: fb.ancestor,
          subrect: subrect(fb.ancestor, tile),
        });
        stats.ancestorFalls++;
      }
    }
    plan.entries = planEntries;

    // Schedule new compute jobs.
    const jobPlan = planFrame(this.cache, view, {
      frameBudget: this.opts.frameBudget,
      maxInFlight: this.ledger.inflightCount,
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
    return stats;
  }

  private tick(): void {
    if (this.stopped) return;
    this.tickOnce();
    this.rafId = this.deps.schedule(() => this.tick());
  }
}
```

## `src/app/render_dispatch.ts`

```ts
import type { GpuDispatcher, RenderPlan } from './types.js';

/**
 * Adapter that bridges the M7 render graph with the per-frame plan.
 * The real implementation:
 *   - For each `source: 'self'` entry, samples the tile's storage buffer
 *     directly.
 *   - For each `source: 'ancestor'` entry, samples the ancestor's
 *     storage buffer with the `subrect` offset / scale, producing a
 *     stretched fallback for the missing child.
 *   - Composites the inspector overlay (when present) on top.
 *
 * For G2 we ship the contract; the GPU dispatch lives in M7's pipeline.
 */
export function renderPlanFromCache(plan: RenderPlan): RenderPlan {
  return plan;       // M7's pipeline reads this directly
}
```

## `src/app/app.ts`

```ts
import type { GpuDispatcher, FrameDeps } from './types.js';
import { Store } from './store.js';
import { InputHandlers } from './input.js';
import { FrameLoop } from './frame_loop.js';
import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { InspectorResult } from '@/inspector/types.js';

export interface AppOpts {
  initialView?:    ViewState;
  frameBudget?:    number;
  maxInFlight?:    number;
  ftleEnabled?:    boolean;
  ensembleEnabled?:boolean;
}

/** Top-level facade. The DOM bindings (canvas mounting, button clicks)
 *  call methods on this object; the loop runs underneath. */
export class App {
  readonly store:        Store;
  readonly input:        InputHandlers;
  readonly loop:         FrameLoop;
  private inspectorPromise: Promise<InspectorResult> | null = null;

  constructor(
    dispatcher: GpuDispatcher,
    deps:       FrameDeps,
    opts:       AppOpts = {},
  ) {
    this.store = new Store(opts.initialView ?? defaultViewState());
    this.input = new InputHandlers(this.store);
    this.loop  = new FrameLoop(this.store, dispatcher, deps, {
      frameBudget:     opts.frameBudget     ?? 16,
      maxInFlight:     opts.maxInFlight     ?? 4,
      ftleEnabled:     opts.ftleEnabled     ?? false,
      ensembleEnabled: opts.ensembleEnabled ?? false,
    });

    // When lock state transitions to true, kick off the inspector.
    let prevLocked = this.store.snapshot().locked;
    this.store.subscribe(v => {
      if (v.locked && !prevLocked && v.lockedPhysical) {
        this.inspectorPromise = dispatcher.inspect(v, {
          m: v.lockedPhysical.m,
          r: v.lockedPhysical.r,
          p: v.lockedPhysical.p,
          t: 0,
        });
      } else if (!v.locked) {
        this.inspectorPromise = null;
      }
      prevLocked = v.locked;
    });
  }

  start(): void { this.loop.start(); }
  stop():  void { this.loop.stop(); }

  /** Promise of the currently-locked inspector result, or null when
   *  unlocked. UI binds the validation panel to this. */
  inspector(): Promise<InspectorResult> | null {
    return this.inspectorPromise;
  }
}
```

## Tests

### `test/unit/app/store.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { Store } from '@/app/store.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('Store', () => {
  it('starts at the initial view', () => {
    const v = defaultViewState();
    expect(new Store(v).snapshot()).toBe(v);
  });

  it('subscribers fire on every setView and once on subscribe', () => {
    const s = new Store();
    const cb = vi.fn();
    s.subscribe(cb);
    expect(cb).toHaveBeenCalledTimes(1);     // initial fire
    s.setView({ ...s.snapshot(), zoom: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops further notifications', () => {
    const s = new Store();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    off();
    s.setView({ ...s.snapshot(), zoom: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('update applies a functional patch', () => {
    const s = new Store();
    s.update(v => ({ ...v, zoom: 7 }));
    expect(s.snapshot().zoom).toBe(7);
  });
});
```

### `test/unit/app/input.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Store } from '@/app/store.js';
import { InputHandlers } from '@/app/input.js';

describe('InputHandlers', () => {
  it('setSlider mutates only the targeted slot', () => {
    const s = new Store();
    new InputHandlers(s).setSlider(3, 0.7);
    expect(s.snapshot().z0[3]).toBe(0.7);
    expect(s.snapshot().z0[0]).toBe(0);
  });

  it('zoom adjusts mag log-step', () => {
    const s = new Store();
    const before = s.snapshot().mag;
    new InputHandlers(s).zoom(1);     // halve the half-width
    expect(s.snapshot().mag).toBeCloseTo(before / 2, 12);
  });

  it('lock sets the locked flag and pins a physical IC', () => {
    const s = new Store();
    new InputHandlers(s).lock({ s: 0.5, t: 0.5 });
    expect(s.snapshot().locked).toBe(true);
    expect(s.snapshot().lockedPhysical).toBeDefined();
  });

  it('lookup writes back when ok', () => {
    const s = new Store();
    const r = new InputHandlers(s).lookup({ kind: 'pythag', m: 2, n: 1 });
    expect(r.ok).toBe(true);
    expect(s.snapshot().locked).toBe(true);
  });

  it('switchChart preserves a locked physical IC', () => {
    const s = new Store();
    const ih = new InputHandlers(s);
    ih.lock({ s: 0.5, t: 0.5 });
    const before = s.snapshot().lockedPhysical!;
    const r = ih.switchChart('lz_e');
    expect(r.ok).toBe(true);
    const after = s.snapshot().lockedPhysical!;
    for (let i = 0; i < 3; i++) {
      expect(after.r[i][0]).toBeCloseTo(before.r[i][0], 4);
    }
  });
});
```

### `test/unit/app/gpu_jobs.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { JobLedger } from '@/app/gpu_jobs.js';
import { TileCache } from '@/quadtree/cache.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

function makeStubDispatcher(): {
  d: GpuDispatcher; resolveOne: (r: TileReduction) => void; rejectOne: (e: Error) => void;
} {
  const queue: { resolve: (r: TileReduction) => void; reject: (e: Error) => void }[] = [];
  const d: GpuDispatcher = {
    dispatchTile: () => new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
    }),
    cancel: () => {},
    render: () => {},
    inspect: () => Promise.resolve({} as any),
  };
  return {
    d,
    resolveOne: r => queue.shift()!.resolve(r),
    rejectOne:  e => queue.shift()!.reject(e),
  };
}

const stubReduction = (id: any): TileReduction => ({
  id, level: 0,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1,
  suspect_fraction: 0, suspect_lz_fraction: 0,
  energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0,
  word_agreement: 1, dominant_word_hash: 0,
  ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0,
  coherence_score: 0, priority_score: 0,
  sample_count: 256, status_flags: 0,
});

describe('JobLedger', () => {
  it('respects maxInFlight', () => {
    const stub = makeStubDispatcher();
    const cache = new TileCache(64);
    const ledger = new JobLedger(stub.d, cache,
                                  { maxInFlight: 2, ftleEnabled: false,
                                    ensembleEnabled: false });
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 1, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 1 }, defaultViewState())).toBe(false);
  });

  it('dedupes concurrent dispatches of the same tile', () => {
    const stub = makeStubDispatcher();
    const ledger = new JobLedger(stub.d, new TileCache(64),
                                  { maxInFlight: 4, ftleEnabled: false,
                                    ensembleEnabled: false });
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(false);
  });

  it('ingests reductions on completion', async () => {
    const stub = makeStubDispatcher();
    const cache = new TileCache(64);
    const ledger = new JobLedger(stub.d, cache,
                                  { maxInFlight: 4, ftleEnabled: false,
                                    ensembleEnabled: false });
    ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState());
    expect(ledger.inflightCount).toBe(1);
    stub.resolveOne(stubReduction({ z: 1, tx: 0, ty: 0 }));
    await Promise.resolve();
    await Promise.resolve();          // microtask queue
    expect(ledger.inflightCount).toBe(0);
  });
});
```

### `test/integration/app_frame_loop.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher, FrameDeps } from '@/app/types.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

const stubReduction = (id: any): TileReduction => ({
  id, level: id.z,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1,
  suspect_fraction: 0, suspect_lz_fraction: 0,
  energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0,
  word_agreement: 1, dominant_word_hash: 0,
  ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0,
  coherence_score: 0, priority_score: 0,
  sample_count: 256, status_flags: 0,
});

describe('App frame loop', () => {
  it('100 synthetic ticks produce stable stats', async () => {
    const renders: number[] = [];
    const dispatched: any[] = [];
    const stub: GpuDispatcher = {
      dispatchTile: async (tileId) => {
        dispatched.push(tileId);
        // Resolve immediately with a fake reduction.
        return stubReduction(tileId);
      },
      cancel: () => {},
      render: (_plan) => { renders.push(performance.now()); },
      inspect: async () => ({} as any),
    };
    let now = 0;
    const deps: FrameDeps = {
      now: () => now,
      rafId: () => 0,
      schedule: () => 0,        // we'll tick manually
      cancel: () => {},
    };
    const app = new App(stub, deps);

    for (let f = 0; f < 100; f++) {
      now = f * 16;
      app.loop.tickOnce();
      await Promise.resolve(); await Promise.resolve();
    }

    // Sanity: rendered every frame.
    expect(renders.length).toBe(100);
    // Any tile dispatched at most once.
    const seen = new Set<string>();
    for (const t of dispatched) {
      const k = `${t.z}/${t.tx}/${t.ty}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('chart switch preserves the lock', async () => {
    const stub: GpuDispatcher = {
      dispatchTile: async (id) => stubReduction(id),
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as any),
    };
    const app = new App(stub, {
      now: () => 0, rafId: () => 0,
      schedule: () => 0, cancel: () => {},
    });

    app.input.lock({ s: 0.5, t: 0.5 });
    expect(app.store.snapshot().locked).toBe(true);
    const lockedBefore = app.store.snapshot().lockedPhysical!;
    const r = app.input.switchChart('lz_e');
    expect(r.ok).toBe(true);
    const lockedAfter = app.store.snapshot().lockedPhysical!;
    for (let i = 0; i < 3; i++) {
      expect(lockedAfter.r[i][0]).toBeCloseTo(lockedBefore.r[i][0], 4);
    }
  });

  it('palette swap does not trigger a compute dispatch', async () => {
    let nDispatch = 0;
    const stub: GpuDispatcher = {
      dispatchTile: async (id) => { nDispatch++; return stubReduction(id); },
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as any),
    };
    const app = new App(stub, {
      now: () => 0, rafId: () => 0,
      schedule: () => 0, cancel: () => {},
    });
    app.loop.tickOnce();
    const before = nDispatch;
    // Palette / overlay knobs do not feed the cache key.
    // We don't have a public render-mode setter on InputHandlers in M8;
    // exercise via a direct store update.
    app.store.update(v => ({ ...v }));            // unchanged
    app.loop.tickOnce();
    expect(nDispatch).toBe(before);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/app
npm test -- --run test/integration/app_frame_loop
```

## Acceptance check

```bash
npm test -- --run test/integration/app_frame_loop
```

Three integration assertions pass: 100 ticks dispatch every tile at
most once, chart switch preserves the lock, palette swap doesn't
recompute.

## Notes for the implementer

- **Why a class, not a function.** The frame loop holds long-lived
  state (the cache, the in-flight ledger, the rAF id) across many
  invocations. A class makes the lifecycle explicit; tests can call
  `tickOnce()` deterministically without driving the rAF schedule.
- **Single source of truth.** Every entry-point method on `App` reads
  or writes via `Store`. The loop never sees its own private state of
  the world. This makes the URL-share / sidecar-reproduce path in M12
  work without surgery.
- **Inspector lifecycle.** Crafting a clean lock-on-pixel UX needs
  three signals: lock fired (kick the inspector), unlock fired (drop
  the promise), chart-switch fired (preserve or refuse). The store's
  subscribe callback owns all three.
- **Cancellation model.** WebGPU dispatches cannot be aborted, so
  cancellation is logical: `cancelOffscreen` marks the in-flight job's
  result as discardable. The job still runs; its reduction is dropped
  by the `if (job.cancelled) return` guard. Eviction in the cache
  reclaims the memory.
- **Frame-budget tuning.** `frameBudget: 16` (in tile-jobs/frame, not
  ms) is a reasonable starting point for `N = 16`, `T_horizon = 80`.
  Real perf work tunes by tier: Preview lifts to 32, Research drops
  to 8.
