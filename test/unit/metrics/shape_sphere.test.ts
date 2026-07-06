import { describe, it, expect } from 'vitest';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';

describe('shape sphere — corrected Hopf formula', () => {
  it('inner-pair collision lands at (1, 0, 0)', () => {
    const n = shapeSphere([0, 0], [0.5, 0.3]);
    expect(n[0]).toBeCloseTo(1, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(0, 12);
  });

  it('opposite collision (λ̃ → 0) lands at (-1, 0, 0)', () => {
    const n = shapeSphere([0.7, 0], [0, 0]);
    expect(n[0]).toBeCloseTo(-1, 12);
    expect(n[1]).toBeCloseTo( 0, 12);
    expect(n[2]).toBeCloseTo( 0, 12);
  });

  it('equilateral configuration places n on the pole', () => {
    // |ρ̃| = |λ̃| and ρ̃ ⊥ λ̃ → n_1 = n_2 = 0, n_3 = ±1.
    const n = shapeSphere([1, 0], [0, 1]);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(Math.abs(n[2])).toBeCloseTo(1, 12);
  });

  it('output is unit length for any nonzero input', () => {
    for (const [r, l] of [[[0.3, -0.2], [0.5, 0.7]],
                          [[1.1, 0.0], [0.0, 0.4]],
                          [[2.0, 1.5], [-0.7, 1.2]]] as
                          [[number,number],[number,number]][]) {
      const n = shapeSphere(r, l);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12);
    }
  });
});

describe('mass-weighted Jacobi', () => {
  it('produces equal magnitudes for an equal-mass equilateral', () => {
    const m = [1/3, 1/3, 1/3] as const;
    // |ρ| = 1, |λ| = √3/2; check that |ρ̃| = |λ̃| = √(1/6)
    const { rhoT, lambdaT } = massWeightedJacobi([1, 0], [0, Math.sqrt(3)/2], m);
    const rhoMag    = Math.hypot(rhoT[0],    rhoT[1]);
    const lambdaMag = Math.hypot(lambdaT[0], lambdaT[1]);
    expect(rhoMag).toBeCloseTo(lambdaMag, 12);
  });
});
