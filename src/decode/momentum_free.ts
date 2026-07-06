import type { Vec2 } from '@/math/types.js';
import type { JacobiMomenta } from './types.js';
import { sigmoid, logit, clamp } from '@/math/scalar.js';

/**
 * Free Jacobi-momentum decode: q_k = q_max (2 σ(z_qk) - 1).
 * The four scalars are packed (p_ρx, p_ρy, p_λx, p_λy) by convention.
 */
export function decodeFreeJacobiMomenta(
  zq: readonly [number, number, number, number], qMax: number,
): JacobiMomenta {
  const q0 = qMax * (2*sigmoid(zq[0]) - 1);
  const q1 = qMax * (2*sigmoid(zq[1]) - 1);
  const q2 = qMax * (2*sigmoid(zq[2]) - 1);
  const q3 = qMax * (2*sigmoid(zq[3]) - 1);
  return { pRho: [q0, q1] as Vec2, pLambda: [q2, q3] as Vec2 };
}

export function inverseFreeJacobiMomenta(
  jm: JacobiMomenta, qMax: number, epsZ: number,
): { zq: [number, number, number, number]; clamped: boolean } {
  let clamped = false;
  const back = (q: number): number => {
    const s = 0.5 * (q / qMax + 1);
    if (s <= epsZ || s >= 1 - epsZ) clamped = true;
    return logit(clamp(s, epsZ, 1 - epsZ));
  };
  return {
    zq: [back(jm.pRho[0]), back(jm.pRho[1]),
         back(jm.pLambda[0]), back(jm.pLambda[1])],
    clamped,
  };
}
