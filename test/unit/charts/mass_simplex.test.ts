import { describe, it, expect } from 'vitest';
import { massSimplexChart } from '@/chart_atlas/charts/mass_simplex.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('mass simplex chart', () => {
  it('declares per-pixel mass requirement', () => {
    expect(massSimplexChart.flags.requires_per_pixel_mass).toBe(true);
  });

  it('respects interior buffer at every corner', () => {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const out = massSimplexChart.decode([u, v], view);
      expect(out.kind).toBe('ok');
      if (out.kind !== 'ok') continue;
      for (let i = 0; i < 3; i++) {
        // No mass ever saturates: all at least ε_m, none within 2·ε_m of 1.
        expect(out.state.m[i]!).toBeGreaterThan(1e-5);
        expect(out.state.m[i]!).toBeLessThan(1 - 1e-5);
      }
    }
  });

  it('flags saturated pixels and passes interior ones', () => {
    // (0.6, 0.6) decodes to raw masses (0.16, 0.6, 0.24) — comfortably
    // interior; the bilinear map covers the simplex for ALL of [0,1]²,
    // so u + v ≥ 1 is NOT a saturation criterion.
    expect(massSimplexChart.validate([0.6, 0.6], view).kind).toBe('pass');
    // Near u = 1 the raw m₀ = (1−u)(1−v) vanishes → interior buffer.
    expect(massSimplexChart.validate([0.99999, 0.5], view).kind)
      .toBe('project');
    // Corner (0, 0): raw m₁ = m₂ = 0 → buffered.
    expect(massSimplexChart.validate([0, 0], view).kind).toBe('project');
  });

  it('inverseEncode inverts decode away from the buffer', () => {
    const out = massSimplexChart.decode([0.3, 0.55], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const enc = massSimplexChart.inverseEncode(out.state);
    expect(enc.kind).toBe('exact');
    expect(enc.pixel!.s).toBeCloseTo(0.3, 10);
    expect(enc.pixel!.t).toBeCloseTo(0.55, 10);
  });
});
