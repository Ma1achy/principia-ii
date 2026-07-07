import { describe, it, expect } from 'vitest';
import { checkPerf, type PerfBaseline } from '@/regression/perf_gate.js';
import type { PerfSnapshot } from '@/perf/perf_monitor.js';

const baseline: PerfBaseline = {
  cpuP95Ms: 14,
  gpuP95Ms: { simulate: 9.5, reduce: 0.8 },
  budget: 'ok',
};

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  frames: 600,
  cpuMeanMs: 12,
  cpuP95Ms: 14,
  gpuP95Ms: { simulate: 9.5, reduce: 0.8 },
  gpuTimingAvailable: true,
  budget: 'ok',
  overFraction: 0,
  ...over,
});

describe('checkPerf: regression classifier', () => {
  it('a matching snapshot passes', () => {
    expect(checkPerf(snap(), baseline).passed).toBe(true);
  });

  it('within +25% (default) is tolerated', () => {
    const r = checkPerf(snap({ cpuP95Ms: 17 }), baseline); // 17/14 = 1.21
    expect(r.passed).toBe(true);
  });

  it('a >25% CPU regression fails and is reported', () => {
    const r = checkPerf(snap({ cpuP95Ms: 20 }), baseline); // 20/14 = 1.43
    expect(r.passed).toBe(false);
    expect(r.regressions[0]!.metric).toBe('cpuP95Ms');
    expect(r.regressions[0]!.factor!).toBeGreaterThan(1.25);
  });

  it('a per-pass GPU regression is caught with the gpu: prefix', () => {
    const r = checkPerf(snap({ gpuP95Ms: { simulate: 13, reduce: 0.8 } }), baseline);
    expect(r.passed).toBe(false);
    expect(r.regressions.some(x => x.metric === 'gpu:simulate')).toBe(true);
  });

  it('a worsened budget state fails even if timings match', () => {
    const r = checkPerf(snap({ budget: 'over' }), baseline);
    expect(r.passed).toBe(false);
    expect(r.regressions.some(x => x.metric === 'budget')).toBe(true);
  });

  it('an improved budget state passes', () => {
    const r = checkPerf(snap({ budget: 'ok' }), { ...baseline, budget: 'over' });
    expect(r.passed).toBe(true);
  });

  it('tiny deltas under the noise floor are not regressions', () => {
    // A real regression on a small base still fails…
    const r = checkPerf(snap({ cpuP95Ms: 14.1 }), { ...baseline, cpuP95Ms: 0.3 },
      { noiseFloorMs: 0.2, allowedRegression: 0 });
    expect(r.passed).toBe(false);
    // …but a sub-noise-floor delta on the same base is forgiven.
    const tiny = checkPerf(snap({ cpuP95Ms: 0.35 }), { ...baseline, cpuP95Ms: 0.3 },
      { noiseFloorMs: 0.2, allowedRegression: 0 });
    expect(tiny.passed).toBe(true); // Δ=0.05 < noise floor
  });

  it('a GPU pass missing from the observed snapshot is ignored', () => {
    const r = checkPerf(snap({ gpuP95Ms: { reduce: 0.8 } }), baseline); // no `simulate`
    expect(r.passed).toBe(true);
  });
});
