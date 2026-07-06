import { describe, it, expect } from 'vitest';
import { dopri5Step } from '@/inspector/dopri5.js';

describe('Dormand–Prince 5(4)', () => {
  it('reproduces a circular Kepler over a small step to high accuracy', () => {
    const m = [0.5, 0.5, 1e-12] as const;
    const v0 = Math.sqrt(0.25 / 1);
    const s = {
      r: [[ 0.5, 0], [-0.5, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    const { s5, errNorm } = dopri5Step(s as any, 1e-3);
    // For a smooth Kepler orbit at h=1e-3, the embedded error estimate
    // should be tiny.
    expect(errNorm).toBeLessThan(1e-10);
    // Energy preserved to many digits over one step.
    const totalEnergy = (st: any) => {
      const K = (st.p[0][0]**2+st.p[0][1]**2)/(2*st.m[0])
              + (st.p[1][0]**2+st.p[1][1]**2)/(2*st.m[1]);
      const r = Math.hypot(st.r[1][0]-st.r[0][0], st.r[1][1]-st.r[0][1]);
      const U = -(st.m[0]*st.m[1])/r;
      return K + U;
    };
    expect(Math.abs(totalEnergy(s5) - totalEnergy(s as any))).toBeLessThan(1e-10);
    expect(s5.t).toBeCloseTo(1e-3, 15);
  });
});
