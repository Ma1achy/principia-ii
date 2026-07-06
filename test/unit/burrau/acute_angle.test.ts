import { describe, it, expect } from 'vitest';
import { makeAcuteAngleKChart } from '@/burrau/acute_angle.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('acute-angle × K chart', () => {
  it('forbids energy normalisation', () => {
    const c = makeAcuteAngleKChart({});
    expect(c.flags.forbids_energy_normalisation).toBe(true);
  });

  it('decode at K = 0 produces zero kinetic energy', () => {
    const c = makeAcuteAngleKChart({ Kmax: 2, gammaK: 2 });
    const out = c.decode([0.5, 0], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out.state.p[i]![0])).toBeLessThan(1e-10);
      expect(Math.abs(out.state.p[i]![1])).toBeLessThan(1e-10);
    }
  });

  it('the decoded state carries the requested K exactly', () => {
    // Jacobi K = |p_ρ|²/(2μ_ρ), so the seed carries the √μ_ρ factor.
    const c = makeAcuteAngleKChart({ Kmax: 2, gammaK: 2 });
    const out = c.decode([0.3, 0.7], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { m, p } = out.state;
    const K = (p[0][0] ** 2 + p[0][1] ** 2) / (2 * m[0])
            + (p[1][0] ** 2 + p[1][1] ** 2) / (2 * m[1])
            + (p[2][0] ** 2 + p[2][1] ** 2) / (2 * m[2]);
    expect(K).toBeCloseTo(2 * 0.7 ** 2, 12);
  });
});
