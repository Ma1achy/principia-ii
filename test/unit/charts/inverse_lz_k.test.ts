import { describe, it, expect } from 'vitest';
import { lzKChart } from '@/chart_atlas/charts/lz_k.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('lz_k inverseEncode', () => {
  it('shares the lz_e inverse implementation (inherited via the spread)', () => {
    // Both charts pixel-map through K, exactly like the shared decode —
    // the same function object serves both.
    expect(lzKChart.inverseEncode).toBe(lzEChart.inverseEncode);
  });

  it('round-trips its own decode to 1e-9', () => {
    const out = lzKChart.decode([0.35, 0.6], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const inv = lzKChart.inverseEncode(out.state, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.35, 9);
    expect(inv.pixel?.t).toBeCloseTo(0.6, 9);
  });

  it('respects view chartParams (a different Kmax shifts the v readout)', () => {
    const out = lzKChart.decode([0.5, 0.5], view);   // K = 2 · 0.25 = 0.5
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const wide: ChartView = { ...view, chartParams: { ...view.chartParams, Kmax: 8 } };
    const inv = lzKChart.inverseEncode(out.state, wide);
    expect(inv.kind).toBe('exact');
    // v = (K / Kmax)^(1/γ) = (0.5 / 8)^(1/2) = 0.25.
    expect(inv.pixel?.t).toBeCloseTo(0.25, 9);
  });
});
