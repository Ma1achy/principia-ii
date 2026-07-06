import { describe, it, expect } from 'vitest';
import '@/chart_atlas/index.js';
import { getChart } from '@/chart_atlas/registry.js';
import type { ChartView } from '@/chart_atlas/types.js';

describe('chart hand-off: lock at equilateral pole, switch to (Lz, E)', () => {
  it('lands at parabola apex K = 0 with zero momenta', () => {
    const sphere = getChart('shape_sphere');
    const view: ChartView = {
      chartParams: { poleBuffer: 0.05 },
      z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
      mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
      alphaMin: 0.05, muMax: 5, qMax: 2,
      rColl: 1e-4, deltaLambda: 1e-12,
    };
    // Equilateral L+: u = 0 (theta = 0 + buffer), v = 0 (phi = 0).
    const out = sphere.decode([0.01, 0], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;

    // Re-decode the same shape via the (Lz, E) chart at K=0, Lz=0.
    const lzE = getChart('lz_e');
    const view2: ChartView = {
      ...view,
      chartParams: {
        Kmax: 2, gammaK: 2,
        alpha: Math.PI / 4,            // equilateral has α near π/4
        beta:  Math.PI / 2,
      },
    };
    const out2 = lzE.decode([0.5, 0], view2);
    expect(out2.kind).toBe('ok');
    if (out2.kind !== 'ok') return;
    // K = 0 ⇒ all momenta zero: the feasibility-parabola apex (Lz=0, E=U).
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out2.state.p[i]![0])).toBeLessThan(1e-12);
      expect(Math.abs(out2.state.p[i]![1])).toBeLessThan(1e-12);
    }
  });
});
