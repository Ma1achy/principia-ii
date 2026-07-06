import { describe, it, expect } from 'vitest';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';

const view: ChartView = {
  chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('(L_z, E) chart', () => {
  it('rest start at (0.5, 0) lands at the parabola apex (Lz=0, K=0)', () => {
    const out = lzEChart.decode([0.5, 0], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    // K = 0 means zero kinetic energy → all p = 0.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out.state.p[i]![0])).toBeLessThan(1e-12);
      expect(Math.abs(out.state.p[i]![1])).toBeLessThan(1e-12);
    }
  });

  it('the decoded state carries the requested (Lz, K) exactly', () => {
    // (u, v) = (0.7, 0.8): K = 2·0.8² = 1.28, Lmax = √(2K) = 1.6,
    // Lz = (2·0.7 − 1)·1.6 = 0.64. Canonicalisation only rotates
    // (β = π/2 → no mirror), which preserves both invariants.
    const out = lzEChart.decode([0.7, 0.8], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { m, r, p } = out.state;
    const K = (p[0][0] ** 2 + p[0][1] ** 2) / (2 * m[0])
            + (p[1][0] ** 2 + p[1][1] ** 2) / (2 * m[1])
            + (p[2][0] ** 2 + p[2][1] ** 2) / (2 * m[2]);
    expect(angularMomentum(r, p)).toBeCloseTo(0.64, 12);
    expect(K).toBeCloseTo(1.28, 12);
    // And E = U + K by definition.
    const E = totalEnergy(m, r, p);
    expect(E - K).toBeLessThan(0);       // U < 0
  });

  it('forbids energy normalisation', () => {
    expect(lzEChart.flags.forbids_energy_normalisation).toBe(true);
  });

  it('decodes every pixel without throwing', () => {
    for (let j = 0; j <= 10; j++) {
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, v = j / 10;
        const out = lzEChart.decode([u, v], view);
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});
