import { describe, it, expect } from 'vitest';
import { kdkMacroStep, substepCount } from '@/integrate/kdk.js';
import { totalEnergy } from '@/integrate/forces.js';
import { N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT } from '@/math/constants.js';

const sp = { rSub: R_SUB_DEFAULT, gammaSub: GAMMA_SUB_DEFAULT, NMax: N_MAX_DEFAULT };

describe('substepCount', () => {
  it('clamps to 1 at large r_min', () => {
    expect(substepCount(10, sp)).toBe(1);
  });
  it('saturates at N_max for very small r_min', () => {
    expect(substepCount(1e-6, sp)).toBe(N_MAX_DEFAULT);
  });
});

describe('kdkMacroStep', () => {
  it('two-body Kepler holds energy to better than 1e-8 over T = 100', () => {
    // Equal-mass binary on a circular orbit, third body at infinity-ish
    const m = [0.5, 0.5, 1e-12] as const;
    const r0 = 1, v0 = Math.sqrt(0.25 / 1);    // |v| for circular: G m_total / r
    const s = {
      r: [[ r0/2, 0], [-r0/2, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    const E0 = totalEnergy(m, s.r, s.p);
    let cur = s as any;
    const dt = 1e-2, T = 100;
    for (let t = 0; t < T; t += dt) {
      cur = kdkMacroStep(cur, dt, sp).state;
    }
    const E = totalEnergy(m, cur.r, cur.p);
    expect(Math.abs(E - E0) / Math.abs(E0)).toBeLessThan(1e-8);
  });
});
