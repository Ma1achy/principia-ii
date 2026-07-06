import type { TrajState, Triple, Vec2, Vec3 } from './types.js';
import type { SubstepParams } from './types.js';
import { forces, minPairSeparation } from './forces.js';
import { projectCOM } from './com.js';

/**
 * Compute the substep count for the next macro step using the spec's
 * adaptive rule:
 *     N_sub = clamp(⌈ (r_sub / r_min)^γ ⌉, 1, N_max).
 */
export function substepCount(rMin: number, p: SubstepParams): number {
  const raw = Math.ceil(Math.pow(p.rSub / Math.max(rMin, 1e-30), p.gammaSub));
  return Math.min(p.NMax, Math.max(1, raw));
}

/**
 * One macro KDK step with adaptive substepping. COM projection runs once
 * per macro step (after the final half-kick), not per substep.
 *
 * Returns the new state plus telemetry for diagnostics. `nSub` is this step's
 * substep count; `maxSub` is the peak per-constituent-KDK-step count (equal to
 * `nSub` for a bare KDK step, but distinct once Yoshida sums several — see
 * `yoshida.ts`). The MAX_SUBSTEPS saturation terminal keys off `maxSub`, never
 * the sum, so a composition isn't spuriously flagged as saturated.
 */
export function kdkMacroStep(
  s: TrajState, dtMacro: number, substepP: SubstepParams,
): { state: TrajState; nSub: number; maxSub: number } {
  const rMin = minPairSeparation(s.r).d;
  const nSub = substepCount(rMin, substepP);
  const dt   = dtMacro / nSub;

  // Mutable copies for the substep loop. We deliberately keep this
  // monomorphic and allocation-light.
  const r0 = s.r[0][0], r1 = s.r[0][1];
  const r2 = s.r[1][0], r3 = s.r[1][1];
  const r4 = s.r[2][0], r5 = s.r[2][1];
  let R: [number,number,number,number,number,number] = [r0,r1,r2,r3,r4,r5];
  let P: [number,number,number,number,number,number] = [
    s.p[0][0], s.p[0][1], s.p[1][0], s.p[1][1], s.p[2][0], s.p[2][1],
  ];

  for (let sub = 0; sub < nSub; sub++) {
    let F = forcesFromFlat(s.m, R);
    P = kickFlat(P, F, dt / 2);
    R = driftFlat(R, P, s.m, dt);
    F = forcesFromFlat(s.m, R);
    P = kickFlat(P, F, dt / 2);
  }

  const newState: TrajState = {
    r: [[R[0], R[1]], [R[2], R[3]], [R[4], R[5]]],
    p: [[P[0], P[1]], [P[2], P[3]], [P[4], P[5]]],
    m: s.m, t: s.t + dtMacro,
  };
  return { state: projectCOM(newState), nSub, maxSub: nSub };
}

/* --------- monomorphic helpers, kept private --------- */

type Flat6 = [number, number, number, number, number, number];

function forcesFromFlat(m: Vec3, R: Flat6): Flat6 {
  // Reuse the regular forces() to avoid duplicating the math.
  const r: Triple<Vec2> = [[R[0],R[1]], [R[2],R[3]], [R[4],R[5]]];
  const F = forces(m, r);
  return [F[0][0], F[0][1], F[1][0], F[1][1], F[2][0], F[2][1]];
}

function kickFlat(P: Flat6, F: Flat6, h: number): Flat6 {
  return [
    P[0] + h*F[0], P[1] + h*F[1],
    P[2] + h*F[2], P[3] + h*F[3],
    P[4] + h*F[4], P[5] + h*F[5],
  ];
}

function driftFlat(R: Flat6, P: Flat6, m: Vec3, h: number): Flat6 {
  return [
    R[0] + h*P[0]/m[0], R[1] + h*P[1]/m[0],
    R[2] + h*P[2]/m[1], R[3] + h*P[3]/m[1],
    R[4] + h*P[4]/m[2], R[5] + h*P[5]/m[2],
  ];
}
