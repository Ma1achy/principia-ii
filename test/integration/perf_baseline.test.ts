import { describe, it, expect } from 'vitest';
import { kdkMacroStep } from '@/integrate/kdk.js';
import { runInspector } from '@/inspector/run.js';
import type { TrajState } from '@/math/types.js';

/**
 * CPU perf baselines (G8). Budgets are deliberately loose (CI runners
 * vary ~3×); the point is catching an accidental hot-path regression —
 * a stray per-substep allocation or a quadratic slip — not shaving
 * microseconds. Reported numbers land in the console for trend-watching.
 */

const BURRAU: TrajState = {
  m: [5 / 12, 4 / 12, 3 / 12],
  r: [[0, 0], [0.6, 0], [0, 0.8]],
  p: [[0, 0], [0, 0], [0, 0]],
  t: 0,
};

describe('perf baseline (CPU, f64)', () => {
  it('KDK macro step stays under 50 µs', () => {
    let s = BURRAU;
    const sp = { rSub: 0.05, gammaSub: 1.5, NMax: 64 };
    for (let i = 0; i < 1_000; i++) s = kdkMacroStep(s, 1e-3, sp).state;   // warm-up
    const t0 = performance.now();
    const N = 20_000;
    for (let i = 0; i < N; i++) s = kdkMacroStep(s, 1e-3, sp).state;
    const perStep = (performance.now() - t0) / N * 1e3;   // µs
    console.log(`KDK macro step: ${perStep.toFixed(2)} µs`);
    expect(Number.isFinite(s.r[0][0])).toBe(true);        // the loop was real
    expect(perStep).toBeLessThan(50);
  }, 60_000);

  it('inspector DOPRI5 run (figure-8 window) stays under 250 ms', () => {
    // A short adaptive run over a smooth stretch: catches step-loop
    // allocation regressions in the M9 path.
    const t0 = performance.now();
    const r = runInspector(BURRAU, { THorizon: 2 });
    const elapsed = performance.now() - t0;
    console.log(`inspector run to t=2: ${elapsed.toFixed(1)} ms (${r.nSteps} steps)`);
    expect(r.nSteps).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  }, 60_000);
});
