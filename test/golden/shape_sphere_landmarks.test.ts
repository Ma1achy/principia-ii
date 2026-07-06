import { describe, it, expect } from 'vitest';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';

const m = [1/3, 1/3, 1/3] as const;

describe('shape-sphere landmark coordinates (equal masses)', () => {
  it('BC pair (0,1) collision → b̂_1 = (1, 0, 0)', () => {
    // ρ → 0; λ arbitrary nonzero.
    const { rhoT, lambdaT } = massWeightedJacobi([0, 0], [0.7, 0.3], m);
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(1, 12);
  });

  it('BC pair (1,2) collision → equator at (-1/2, ±√3/2, 0)', () => {
    // r_1 = r_2 ⇒ ρ = √3 λ in mass-weighted Jacobi; angle between them = 0.
    // Build the configuration directly with α = π/6, β = 0.
    const alpha = Math.PI/6;
    const rhoT    = [Math.cos(alpha), 0] as const;
    const lambdaT = [Math.sin(alpha) * Math.cos(0),
                     Math.sin(alpha) * Math.sin(0)] as const;
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(-0.5,  6);
    expect(n[1]).toBeCloseTo(-Math.sqrt(3)/2, 6); // sign from -2 ρ̃·λ̃
    expect(n[2]).toBeCloseTo(0,    12);
  });

  it('Lagrange L^+ at α = π/4, β = π/2', () => {
    const alpha = Math.PI/4;
    const beta  = Math.PI/2;
    const rhoT    = [Math.cos(alpha), 0] as const;
    const lambdaT = [Math.sin(alpha) * Math.cos(beta),
                     Math.sin(alpha) * Math.sin(beta)] as const;
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(1, 12);   // north pole
  });
});
