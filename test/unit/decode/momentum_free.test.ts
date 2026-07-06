import { describe, it, expect } from 'vitest';
import {
  decodeFreeJacobiMomenta, inverseFreeJacobiMomenta,
} from '@/decode/momentum_free.js';

describe('free Jacobi momenta', () => {
  it('z = 0 → zero momentum', () => {
    const jm = decodeFreeJacobiMomenta([0, 0, 0, 0], 2);
    expect(jm.pRho[0]).toBe(0);
    expect(jm.pRho[1]).toBe(0);
    expect(jm.pLambda[0]).toBe(0);
    expect(jm.pLambda[1]).toBe(0);
  });

  it('saturates at ±q_max', () => {
    const jm = decodeFreeJacobiMomenta([1e9, -1e9, 1e9, -1e9], 2);
    expect(jm.pRho[0]   ).toBeCloseTo( 2, 9);
    expect(jm.pRho[1]   ).toBeCloseTo(-2, 9);
    expect(jm.pLambda[0]).toBeCloseTo( 2, 9);
    expect(jm.pLambda[1]).toBeCloseTo(-2, 9);
  });

  it('round-trips for non-saturated input', () => {
    for (const z of [[0.1, -0.2, 0.3, -0.4], [1.0, 0.0, -1.5, 2.0]] as
                    [number,number,number,number][]) {
      const jm = decodeFreeJacobiMomenta(z, 5);
      const inv = inverseFreeJacobiMomenta(jm, 5, 1e-6);
      for (let i = 0; i < 4; i++) expect(inv.zq[i]!).toBeCloseTo(z[i]!, 9);
    }
  });
});
