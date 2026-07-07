import { describe, it, expect } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher, FrameDeps } from '@/app/types.js';
import type { GpuPassTimings } from '@/perf/gpu_timing.js';
import type { InspectorResult } from '@/inspector/types.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

/**
 * G10: the frame loop feeds the PerfMonitor and applies its back-pressure.
 * The clock is synthetic: each now() call advances by `stepMs`, so every
 * tick's cpuMs IS stepMs — over/under budget is scripted, not raced.
 */

function makeDeps(stepMs: number): FrameDeps {
  let now = 0;
  return {
    now: () => { const t = now; now += stepMs; return t; },
    schedule: () => 0,
    cancel: () => {},
  };
}

function makeStub(gpu?: () => GpuPassTimings | undefined): GpuDispatcher {
  return {
    dispatchTile: async (tileId) => stubReduction(tileId),
    cancel: () => {},
    render: () => {},
    inspect: async () => ({} as InspectorResult),
    ...(gpu ? { takeGpuTimings: gpu } : {}),
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('FrameLoop × PerfMonitor (G10)', () => {
  it('under-budget ticks stay neutral: no overBudget, scale 1', async () => {
    const app = new App(makeStub(), makeDeps(4), { perfWindow: 20 });
    let stats = app.loop.tickOnce();
    for (let i = 0; i < 30; i++) { stats = app.loop.tickOnce(); await flush(); }
    expect(stats.overBudget).toBe(false);
    expect(app.loop.lastRecommendation?.dispatchCapScale).toBe(1);
    expect(app.loop.lastRecommendation?.recommendTier).toBeNull();
  });

  it('sustained over-budget ticks flag overBudget and back off the cap', async () => {
    const app = new App(makeStub(), makeDeps(40), { perfWindow: 20 });
    let stats = app.loop.tickOnce();
    for (let i = 0; i < 30; i++) { stats = app.loop.tickOnce(); await flush(); }
    expect(stats.overBudget).toBe(true);
    expect(app.loop.perf.budgetState()).toBe('sustained');
    expect(app.loop.lastRecommendation?.dispatchCapScale).toBeLessThan(1);
    // default tier is 'balanced' → the sustained recommendation is 'preview'
    expect(app.loop.lastRecommendation?.recommendTier).toBe('preview');
  });

  it('the backed-off cap limits dispatches for newly-visible tiles', async () => {
    const app = new App(makeStub(), makeDeps(40), {
      perfWindow: 20, maxInFlight: 32, frameBudget: 16,
    });
    for (let i = 0; i < 30; i++) { app.loop.tickOnce(); await flush(); }
    expect(app.loop.perf.budgetState()).toBe('sustained');  // cap is floored at 1

    // Zoom in: a deeper frontier of uncached tiles becomes visible.
    const v = app.store.snapshot();
    app.store.setView({ ...v, uvHalfWidth: [0.125, 0.125] });
    const stats = app.loop.tickOnce();
    expect(stats.visible).toBeGreaterThan(1);
    expect(stats.jobsDispatched).toBeLessThanOrEqual(1);    // cap, not frameBudget
  });

  it('threads dispatcher GPU timings into stats when available', async () => {
    let served = false;
    const gpu = (): GpuPassTimings | undefined => {
      if (served) return undefined;
      served = true;
      return { simulate: 5, render: 1 };
    };
    const app = new App(makeStub(gpu), makeDeps(4), { gpuTimingAvailable: true });
    const stats = app.loop.tickOnce();
    expect(stats.gpuPassMs).toEqual({ simulate: 5, render: 1 });
    expect(stats.gpuMs).toBeCloseTo(6, 9);
    const s2 = app.loop.tickOnce();                 // timings were taken (cleared)
    expect(s2.gpuPassMs).toBeUndefined();
  });

  it('mocked dispatchers without takeGpuTimings keep working (optional member)', () => {
    const app = new App(makeStub(), makeDeps(4), {});
    const stats = app.loop.tickOnce();
    expect(stats.gpuPassMs).toBeUndefined();
    expect(stats.gpuMs).toBeUndefined();
  });
});
