import { describe, it, expect } from 'vitest';
import {
  decodeConfigCanonical, inverseConfigCanonical,
} from '@/decode/configuration.js';
import { ALPHA_MIN_DEFAULT } from '@/math/constants.js';

describe('decodeConfigCanonical', () => {
  it('places the centre of latent space at α = π/4, β = π/2', () => {
    const c = decodeConfigCanonical(0, 0, 0);
    expect(c.alpha).toBeCloseTo(Math.PI/4, 12);
    expect(c.beta).toBeCloseTo(Math.PI/2, 12);
  });

  it('respects the α_min buffer', () => {
    const c = decodeConfigCanonical(-1e6, 0, 0.05);
    expect(c.alpha).toBeGreaterThan(0.04);     // strict 0 < ε
  });

  it('reproduces |ρ̃| = cos α and |λ̃| = sin α at R̃ = 1', () => {
    const c = decodeConfigCanonical(0.7, -0.4, ALPHA_MIN_DEFAULT, 1);
    expect(Math.hypot(...c.rhoTilde   )).toBeCloseTo(Math.cos(c.alpha), 12);
    expect(Math.hypot(...c.lambdaTilde)).toBeCloseTo(Math.sin(c.alpha), 12);
  });

  it('round-trips with inverseConfigCanonical', () => {
    for (const z of [-1, -0.3, 0, 0.5, 1.5]) {
      for (const w of [-2, 0, 0.7]) {
        const c = decodeConfigCanonical(z, w, ALPHA_MIN_DEFAULT);
        const inv = inverseConfigCanonical(c.alpha, c.beta, ALPHA_MIN_DEFAULT, 1e-6);
        expect(inv.zAlpha).toBeCloseTo(z, 9);
        expect(inv.zBeta ).toBeCloseTo(w, 9);
      }
    }
  });
});
