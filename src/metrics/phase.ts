/**
 * Phase angle of n(t)'s equatorial projection.
 *   θ(t) = atan2(n_y, n_x), in (-π, π].
 *
 * Uses n_2, n_1 — that is the axis convention from the corrected formula.
 * (n_x, n_y) = (n_1, n_2).
 */
export function phaseFromN(n: readonly [number, number, number]): number {
  return Math.atan2(n[1], n[0]);
}

/**
 * Update the unwrapped phase by adding the minimal-magnitude jump.
 * Inputs:
 *   prevTheta   — last raw atan2 in (-π, π]
 *   curTheta    — new raw atan2 in (-π, π]
 *   thetaTilde  — running unwrapped phase
 * Returns the new thetaTilde.
 */
export function unwrapPhase(
  prevTheta: number, curTheta: number, thetaTilde: number,
): number {
  let delta = curTheta - prevTheta;
  if (delta >  Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return thetaTilde + delta;
}
