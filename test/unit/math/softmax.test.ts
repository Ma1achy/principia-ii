import { describe, it, expect } from 'vitest';
import {
  massFromLogits, massFromSimplex, logitsFromMasses,
} from '@/math/softmax.js';

describe('massFromLogits', () => {
  it('gives equal masses at z = (0, 0)', () => {
    const m = massFromLogits(0, 0, 5);
    expect(m[0]).toBeCloseTo(1/3, 12);
    expect(m[1]).toBeCloseTo(1/3, 12);
    expect(m[2]).toBeCloseTo(1/3, 12);
  });

  it('always sums to 1', () => {
    for (const z1 of [-100, -3, -0.1, 0, 0.5, 7, 1000]) {
      for (const z2 of [-50, 0, 2.2, 1e6]) {
        const m = massFromLogits(z1, z2, 5);
        expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
        expect(m[0]).toBeGreaterThan(0);
        expect(m[1]).toBeGreaterThan(0);
        expect(m[2]).toBeGreaterThan(0);
      }
    }
  });

  it('saturates symmetrically as z_μ1 → ±∞', () => {
    const muMax = 3;
    const mPlus  = massFromLogits(  1e9, 0, muMax);   // tanh saturates at +1
    const mMinus = massFromLogits(- 1e9, 0, muMax);
    // m1 saturates at e^muMax / (1 + e^muMax + 1) when z1→+∞ and z2=0
    const expHi = Math.exp(muMax);
    const Z = 1 + expHi + 1;
    expect(mPlus[1]).toBeCloseTo(expHi / Z, 9);
    // and at e^(-muMax) / (1 + e^(-muMax) + 1) when z1→-∞
    const expLo = Math.exp(-muMax);
    const Z2 = 1 + expLo + 1;
    expect(mMinus[1]).toBeCloseTo(expLo / Z2, 9);
  });

  it('round-trips through logitsFromMasses for non-saturated points', () => {
    for (const z1 of [-1, -0.3, 0, 0.7, 2]) {
      for (const z2 of [-2, 0, 1.5]) {
        const m = massFromLogits(z1, z2, 100);   // muMax large -> tanh ≈ identity
        const { mu1, mu2 } = logitsFromMasses(m);
        // At muMax=100, tanh(z) ≈ z for our z values; mu_k ≈ 100*tanh(z_k) ≈ ...
        // So we round-trip mu, not z. Just check that re-decoding gives the
        // same masses.
        const m2 = massFromLogits(Math.atanh(mu1/100), Math.atanh(mu2/100), 100);
        for (let i = 0; i < 3; i++) expect(m2[i]!).toBeCloseTo(m[i]!, 9);
      }
    }
  });
});

describe('massFromSimplex (direct parameterisation)', () => {
  it('hits the simplex interior for all (t1, t2) ∈ [0,1]²', () => {
    for (let t1 = 0.05; t1 < 1; t1 += 0.1) {
      for (let t2 = 0.05; t2 < 1; t2 += 0.1) {
        const m = massFromSimplex(t1, t2);
        expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
        expect(m[0]).toBeGreaterThan(0);
        expect(m[1]).toBeGreaterThan(0);
        expect(m[2]).toBeGreaterThan(0);
      }
    }
  });

  it('reaches the corners under x = t1, y = (1-t1)·t2', () => {
    // (0,0): x=0, y=0  -> [1, 0, 0]
    expect(massFromSimplex(0, 0)).toEqual([1, 0, 0]);
    // (1,0): x=1, y=0  -> [0, 1, 0]
    expect(massFromSimplex(1, 0)).toEqual([0, 1, 0]);
    // (0,1): x=0, y=1  -> [0, 0, 1]
    expect(massFromSimplex(0, 1)).toEqual([0, 0, 1]);
    // (1,1): x=1, y=0  -> [0, 1, 0]
    expect(massFromSimplex(1, 1)).toEqual([0, 1, 0]);
  });
});
