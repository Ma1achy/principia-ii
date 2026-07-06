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

describe('(L_z, K) chart', () => {
  it('is a distinct id with the invariant flags', () => {
    expect(lzKChart.id).toBe('lz_k');
    expect(lzKChart.flags.forbids_energy_normalisation).toBe(true);
  });

  it('shares the (L_z, E) decode: identical states at identical (u, v)', () => {
    // With the configuration frozen, E = U + K*, so the two charts are
    // the same map with relabelled axes.
    const a = lzKChart.decode([0.65, 0.4], view);
    const b = lzEChart.decode([0.65, 0.4], view);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    for (let i = 0; i < 3; i++) {
      expect(a.state.r[i]![0]).toBe(b.state.r[i]![0]);
      expect(a.state.r[i]![1]).toBe(b.state.r[i]![1]);
      expect(a.state.p[i]![0]).toBe(b.state.p[i]![0]);
      expect(a.state.p[i]![1]).toBe(b.state.p[i]![1]);
    }
  });
});
