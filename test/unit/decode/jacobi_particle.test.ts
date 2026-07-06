import { describe, it, expect } from 'vitest';
import {
  jacobiToParticlePositions, particlePositionsToJacobi,
  jacobiToParticleMomenta,  particleMomentaToJacobi,
} from '@/decode/jacobi_particle.js';

const m = [1/3, 1/3, 1/3] as const;

describe('Jacobi position round-trip', () => {
  it('inverts cleanly', () => {
    const rho:    [number, number] = [0.7, 0.0];
    const lambda: [number, number] = [-0.3, 0.4];
    const r = jacobiToParticlePositions(rho, lambda, m);
    const back = particlePositionsToJacobi(r, m);
    expect(back.rho   [0]).toBeCloseTo(rho   [0], 14);
    expect(back.rho   [1]).toBeCloseTo(rho   [1], 14);
    expect(back.lambda[0]).toBeCloseTo(lambda[0], 14);
    expect(back.lambda[1]).toBeCloseTo(lambda[1], 14);
  });

  it('produces a COM-zero configuration', () => {
    const r = jacobiToParticlePositions([0.5, 0.0], [0.1, 0.3], m);
    const cx = m[0]*r[0][0] + m[1]*r[1][0] + m[2]*r[2][0];
    const cy = m[0]*r[0][1] + m[1]*r[1][1] + m[2]*r[2][1];
    expect(cx).toBeCloseTo(0, 14);
    expect(cy).toBeCloseTo(0, 14);
  });
});

describe('Jacobi momentum round-trip', () => {
  it('inverts cleanly', () => {
    const jm = { pRho: [0.2, -0.5] as const, pLambda: [0.4, 0.1] as const };
    const p = jacobiToParticleMomenta(jm, m);
    const back = particleMomentaToJacobi(p, m);
    expect(back.pRho   [0]).toBeCloseTo(jm.pRho   [0], 14);
    expect(back.pRho   [1]).toBeCloseTo(jm.pRho   [1], 14);
    expect(back.pLambda[0]).toBeCloseTo(jm.pLambda[0], 14);
    expect(back.pLambda[1]).toBeCloseTo(jm.pLambda[1], 14);
  });

  it('produces a zero-total-momentum configuration', () => {
    const p = jacobiToParticleMomenta(
      { pRho: [0.4, 0.0], pLambda: [-0.1, 0.3] }, m);
    const px = p[0][0] + p[1][0] + p[2][0];
    const py = p[0][1] + p[1][1] + p[2][1];
    expect(px).toBeCloseTo(0, 14);
    expect(py).toBeCloseTo(0, 14);
  });
});
