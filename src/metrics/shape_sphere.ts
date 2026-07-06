import type { Vec2, Vec3 } from '@/math/types.js';
import { dot2, crossZ, normSq2 } from '@/math/vec.js';

/**
 * Corrected shape-sphere coordinate (post spec revisions). Inner-pair
 * collision (ρ̃ → 0) maps to (1, 0, 0); equilateral configurations map to
 * (0, 0, ±1); other binary collisions land on the equator at
 * (-1/2, ±√3/2, 0) for equal masses.
 *
 * The Hopf components, in slot order:
 *   n_1 = (|λ̃|² - |ρ̃|²) / I
 *   n_2 = -2 ρ̃ · λ̃ / I
 *   n_3 =  2 (ρ̃ × λ̃)_z / I
 *
 * The WGSL copy lives in metrics.wgsl shape_sphere() — change both in the
 * same commit.
 */
export function shapeSphere(rhoTilde: Vec2, lambdaTilde: Vec2): Vec3 {
  const rhoSq    = normSq2(rhoTilde);
  const lambdaSq = normSq2(lambdaTilde);
  const I = rhoSq + lambdaSq;
  if (I === 0) return [0, 0, 1];        // canonical fallback
  return [
    (lambdaSq - rhoSq) / I,
    -2 * dot2(rhoTilde, lambdaTilde) / I,
     2 * crossZ(rhoTilde, lambdaTilde) / I,
  ];
}

/**
 * Mass-weight a pair of unweighted Jacobi vectors. Caller-supplied
 * masses determine the reduced masses μ_ρ and μ_λ.
 */
export function massWeightedJacobi(
  rho: Vec2, lambda: Vec2, m: readonly [number, number, number],
): { rhoT: Vec2; lambdaT: Vec2 } {
  const M01 = m[0] + m[1];
  const muRho    = (m[0] * m[1]) / M01;
  const muLambda = m[2] * M01;
  const sR = Math.sqrt(muRho), sL = Math.sqrt(muLambda);
  return {
    rhoT:    [rho[0]    * sR, rho[1]    * sR],
    lambdaT: [lambda[0] * sL, lambda[1] * sL],
  };
}
