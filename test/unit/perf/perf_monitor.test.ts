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
  it('rejects a non-positive window', () => {
    expect(() => new PerfMonitor(opts({ windowFrames: 0 }))).toThrow(RangeError);
  });

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

  it('reset clears the rings but a fresh window works again', () => {
    const m = new PerfMonitor(opts());
    for (let i = 0; i < 20; i++) m.record(cpuFrame(40));
    m.reset();
    expect(m.snapshot().frames).toBe(0);
    expect(m.budgetState()).toBe('ok');             // empty window is ok
    for (let i = 0; i < 20; i++) m.record(cpuFrame(6));
    expect(m.budgetState()).toBe('ok');
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

  it('GPU timing available but a pass never ran: no ring, no stale key', () => {
    const m = new PerfMonitor(opts({ gpuTimingAvailable: true }));
    for (let i = 0; i < 8; i++) m.record(gpuFrame(4, { simulate: 3 }));
    const s = m.snapshot();
    expect(s.gpuP95Ms.simulate).toBeCloseTo(3, 6);
    expect(s.gpuP95Ms.reduce).toBeUndefined();
    expect(s.gpuP95Ms.render).toBeUndefined();
  });

  it('CPU-only frames among GPU frames still budget against cpuMs', () => {
    const m = new PerfMonitor(opts({ gpuTimingAvailable: true }));
    for (let i = 0; i < 18; i++) m.record(gpuFrame(4, { simulate: 2 }));
    m.record(cpuFrame(40)); m.record(cpuFrame(40)); // dropped GPU samples
    expect(m.budgetState()).toBe('over');           // 2/20 slow cpu frames trip p95
  });
});
