import type { TrajState } from '@/math/types.js';
import type { LatentZ } from './types.js';
import { inverseMass } from './mass.js';
import { inverseConfigCanonical } from './configuration.js';
import { inverseFreeJacobiMomenta } from './momentum_free.js';
import {
  particlePositionsToJacobi, particleMomentaToJacobi,
} from './jacobi_particle.js';
import { canonicalise } from './canonicalise.js';

/**
 * Invert the full pipeline: physical IC → latent z. Used by the lookup /
 * lock paths in M8.
 */
export function inverseEncodeLatent(
  s: TrajState,
  knobs: { muMax: number; alphaMin: number; qMax: number;
           epsMu: number; epsZ: number; deltaLambda: number; rColl: number },
): { z: LatentZ; clamped: boolean } {
  // 1. Canonicalise the input (rotate ρ to +x, mirror, COM project).
  const c = canonicalise(s, { deltaLambda: knobs.deltaLambda, rColl: knobs.rColl });
  const sc = c.state;

  // 2. Recover the canonical Jacobi pair.
  const { rho, lambda } = particlePositionsToJacobi(sc.r, sc.m);
  const muRho    = (sc.m[0] * sc.m[1]) / (sc.m[0] + sc.m[1]);
  const muLambda = sc.m[2] * (sc.m[0] + sc.m[1]);
  const rhoT:    [number, number] = [rho[0]    * Math.sqrt(muRho),
                                     rho[1]    * Math.sqrt(muRho)];
  const lambdaT: [number, number] = [lambda[0] * Math.sqrt(muLambda),
                                     lambda[1] * Math.sqrt(muLambda)];

  // 3. Read α and β.
  const alpha = Math.atan2(Math.hypot(...lambdaT), Math.hypot(...rhoT));
  const beta  = Math.atan2(lambdaT[1], lambdaT[0]);   // already in [0, π] post-mirror

  // 4. Invert sigmoid wrapping for α and β.
  const cb = inverseConfigCanonical(alpha, beta, knobs.alphaMin, knobs.epsZ);

  // 5. Mass.
  const cm = inverseMass(sc.m, knobs.muMax, knobs.epsMu);

  // 6. Free momenta.
  const jm = particleMomentaToJacobi(sc.p, sc.m);
  const cq = inverseFreeJacobiMomenta(jm, knobs.qMax, knobs.epsZ);

  const z: LatentZ = [
    cb.zAlpha, cb.zBeta,
    cq.zq[0], cq.zq[1], cq.zq[2], cq.zq[3],
    cm.zMu1, cm.zMu2,
  ];
  return { z, clamped: cb.clamped || cm.clamped || cq.clamped };
}
