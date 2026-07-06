import type { TrajState, Triple, Vec2, TerminalLabel } from '@/math/types.js';
import { rotation, applyR, reflectX } from '@/math/rotate.js';
import { particlePositionsToJacobi } from './jacobi_particle.js';
import { signDeadband } from '@/math/scalar.js';
import { projectCOM } from '@/integrate/com.js';

/**
 * Canonicalise a state. With a canonical-frame decode this is essentially
 * a no-op; we still run it as a guard against callers that arrive through
 * non-canonical paths (lookup, exact-IC entry).
 *
 * Steps:
 *  1. COM project to absorb f64 round-off.
 *  2. Rotate so ρ̃ lies on +x.
 *  3. Dead-banded mirror so λ̃_y >= 0.
 *  4. (Optional) scale-gauge rescale; no-op if R̃ = 1 was enforced upstream.
 */
export function canonicalise(
  s: TrajState, opts: { deltaLambda: number; rColl: number },
): { state: TrajState; terminal?: TerminalLabel } {
  // 1. COM project
  const sc = projectCOM(s);

  // 2. Rotate so the (unweighted) ρ vector points along +x.
  const { rho, lambda } = particlePositionsToJacobi(sc.r, sc.m);
  const phi = Math.atan2(rho[1], rho[0]);
  const R = rotation(-phi);
  const rRot: Triple<Vec2> = [
    applyR(R, sc.r[0]), applyR(R, sc.r[1]), applyR(R, sc.r[2]),
  ];
  const pRot: Triple<Vec2> = [
    applyR(R, sc.p[0]), applyR(R, sc.p[1]), applyR(R, sc.p[2]),
  ];

  // 3. Mirror so λ_y >= 0, with deadband.
  const lambdaRot: Vec2 = [lambda[0]*Math.cos(-phi) - lambda[1]*Math.sin(-phi),
                           lambda[0]*Math.sin(-phi) + lambda[1]*Math.cos(-phi)];
  const sign = signDeadband(lambdaRot[1], opts.deltaLambda);
  const reflect = sign < 0;
  const rOut: Triple<Vec2> = reflect
    ? [reflectX(rRot[0]), reflectX(rRot[1]), reflectX(rRot[2])]
    : rRot;
  const pOut: Triple<Vec2> = reflect
    ? [reflectX(pRot[0]), reflectX(pRot[1]), reflectX(pRot[2])]
    : pRot;

  const state: TrajState = { r: rOut, p: pOut, m: sc.m, t: sc.t };

  // 4. No-holes: collision at t=0?
  const minSep = Math.min(
    Math.hypot(rOut[1][0]-rOut[0][0], rOut[1][1]-rOut[0][1]),
    Math.hypot(rOut[2][0]-rOut[0][0], rOut[2][1]-rOut[0][1]),
    Math.hypot(rOut[2][0]-rOut[1][0], rOut[2][1]-rOut[1][1]),
  );
  if (minSep < opts.rColl) {
    return { state, terminal: { kind: 'COLLISION_T0', pair: closestPair(rOut) } };
  }

  return { state };
}

function closestPair(r: Triple<Vec2>): 0 | 1 | 2 {
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  if (d01 <= d02 && d01 <= d12) return 0;
  if (d02 <= d12)               return 1;
  return 2;
}
