import type { Vec2, Vec3, Triple } from '@/math/types.js';
import type { JacobiMomenta } from './types.js';

/**
 * Reconstruct particle positions from unweighted Jacobi vectors:
 *   r_{01} = -m_2 λ
 *   r_2    =  M_{01} λ
 *   r_0    = r_{01} - (m_1/M_{01}) ρ
 *   r_1    = r_{01} + (m_0/M_{01}) ρ
 */
export function jacobiToParticlePositions(
  rho: Vec2, lambda: Vec2, m: Vec3,
): Triple<Vec2> {
  const M01 = m[0] + m[1];
  const r01x = -m[2] * lambda[0], r01y = -m[2] * lambda[1];
  const r2: Vec2 = [M01 * lambda[0], M01 * lambda[1]];
  const r0: Vec2 = [r01x - (m[1] / M01) * rho[0], r01y - (m[1] / M01) * rho[1]];
  const r1: Vec2 = [r01x + (m[0] / M01) * rho[0], r01y + (m[0] / M01) * rho[1]];
  return [r0, r1, r2];
}

/**
 * Inverse of the position reconstruction.
 *   ρ = r_1 - r_0
 *   λ = r_2 - (m_0 r_0 + m_1 r_1) / M_{01}
 */
export function particlePositionsToJacobi(
  r: Triple<Vec2>, m: Vec3,
): { rho: Vec2; lambda: Vec2 } {
  const M01 = m[0] + m[1];
  const cx = (m[0]*r[0][0] + m[1]*r[1][0]) / M01;
  const cy = (m[0]*r[0][1] + m[1]*r[1][1]) / M01;
  return {
    rho:    [r[1][0] - r[0][0], r[1][1] - r[0][1]],
    lambda: [r[2][0] - cx,      r[2][1] - cy],
  };
}

/**
 * Jacobi momenta to particle momenta (COM frame, M = 1):
 *   p_0 = -p_ρ - (m_0 / M_{01}) p_λ
 *   p_1 =  p_ρ - (m_1 / M_{01}) p_λ
 *   p_2 =  p_λ
 */
export function jacobiToParticleMomenta(
  jm: JacobiMomenta, m: Vec3,
): Triple<Vec2> {
  const M01 = m[0] + m[1];
  const p0: Vec2 = [-jm.pRho[0] - (m[0]/M01) * jm.pLambda[0],
                    -jm.pRho[1] - (m[0]/M01) * jm.pLambda[1]];
  const p1: Vec2 = [ jm.pRho[0] - (m[1]/M01) * jm.pLambda[0],
                     jm.pRho[1] - (m[1]/M01) * jm.pLambda[1]];
  const p2: Vec2 = [jm.pLambda[0], jm.pLambda[1]];
  return [p0, p1, p2];
}

/** Inverse: p_λ = p_2,  p_ρ = p_1 + (m_1/M_{01}) p_λ. */
export function particleMomentaToJacobi(
  p: Triple<Vec2>, m: Vec3,
): JacobiMomenta {
  const M01 = m[0] + m[1];
  const pLambda: Vec2 = p[2];
  const pRho: Vec2 = [
    p[1][0] + (m[1]/M01) * pLambda[0],
    p[1][1] + (m[1]/M01) * pLambda[1],
  ];
  return { pRho, pLambda };
}
