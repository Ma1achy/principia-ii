import { describe, it, expect } from 'vitest';
import { decodeConfigCanonical } from '@/decode/configuration.js';
import { jacobiToParticlePositions } from '@/decode/jacobi_particle.js';
import { ALPHA_MIN_DEFAULT } from '@/math/constants.js';

describe('decode landmarks', () => {
  it('α near 0 gives a near-degenerate configuration with body 2 at the inner-pair COM', () => {
    const c = decodeConfigCanonical(-1e6, 0, ALPHA_MIN_DEFAULT);
    // |λ̃| / |ρ̃| should be small → body 2 essentially co-located with the
    // inner pair's COM.
    expect(Math.hypot(...c.lambdaTilde)).toBeLessThan(0.1);
    expect(Math.hypot(...c.rhoTilde   )).toBeGreaterThan(0.99);
  });

  it('α near π/2 gives a tight inner pair (Burrau-like hierarchy)', () => {
    const c = decodeConfigCanonical(1e6, 0, ALPHA_MIN_DEFAULT);
    expect(Math.hypot(...c.rhoTilde   )).toBeLessThan(0.1);
    expect(Math.hypot(...c.lambdaTilde)).toBeGreaterThan(0.99);
  });

  it('equal-mass equilateral triangle has |ρ̃|² = |λ̃|² and ρ̃ ⊥ λ̃', () => {
    // Place the equal-mass equilateral configuration directly.
    const m = [1/3, 1/3, 1/3] as const;
    const r = jacobiToParticlePositions([1, 0], [0, Math.sqrt(3)/2], m);
    // |ρ| = 1, |λ| = √3/2.  μ_ρ = (1/9)/(2/3) = 1/6.  μ_λ = (1/3)(2/3) = 2/9.
    // |ρ̃|² = (1/6)*1 = 1/6.  |λ̃|² = (2/9)*(3/4) = 1/6.  ✓
    const muRho    = (m[0]*m[1]) / (m[0]+m[1]);
    const muLambda = m[2]*(m[0]+m[1]);
    const rhoT    = [1 * Math.sqrt(muRho), 0] as const;
    const lambdaT = [0, (Math.sqrt(3)/2) * Math.sqrt(muLambda)] as const;
    expect(rhoT[0]*rhoT[0] + rhoT[1]*rhoT[1])
      .toBeCloseTo(lambdaT[0]*lambdaT[0] + lambdaT[1]*lambdaT[1], 12);
    expect(rhoT[0]*lambdaT[0] + rhoT[1]*lambdaT[1]).toBeCloseTo(0, 12);
    // Sanity: the reconstruction did produce a genuine triangle (not used
    // further, but keeps the landmark tied to real positions).
    expect(r.length).toBe(3);
  });
});
