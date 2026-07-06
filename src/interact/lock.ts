import type { ViewState } from './view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import { add8, scale8 } from '@/math/vec.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

/**
 * Lock onto a pixel (s, t) ∈ [0,1]² in the current view's UV space. For
 * affine charts this is closed-form — no GPU readback needed. The lock
 * operation:
 *
 *   1. Compute z_locked from (s, t) and the slice basis.
 *   2. Decode the physical IC (canonicalised).
 *   3. Store both the latent z and the physical IC on the new ViewState.
 *
 * Nonlinear charts (M10) override `lockAffine` with a chart-specific
 * implementation that may need GPU readback.
 */
export function lockAffine(
  v: ViewState, pixel: { s: number; t: number },
): ViewState {
  const su = (2 * pixel.s - 1) * v.mag;
  const sv = (2 * pixel.t - 1) * v.mag;
  const z0 = add8(v.z0, add8(scale8(v.q1, su), scale8(v.q2, sv)));

  const dec = decodeLatent(z0, KNOBS);
  if (dec.kind === 'terminal') {
    // Locking on a terminal pixel still records the position; the inspector
    // reports the terminal class explicitly. We don't reject the lock.
    return { ...v, z0, locked: true, lockedPhysical: undefined };
  }
  return {
    ...v,
    z0,
    locked: true,
    lockedPhysical: { m: dec.state.m, r: dec.state.r, p: dec.state.p },
  };
}

/** Release the lock and clear the physical IC pin. */
export function unlock(v: ViewState): ViewState {
  return { ...v, locked: false, lockedPhysical: undefined };
}

/**
 * Round-trip a locked physical IC back into latent z. Used by the
 * lock-preservation logic when chart switches require re-encoding.
 */
export function physicalToLatent(
  m: NonNullable<ViewState['lockedPhysical']>['m'],
  r: NonNullable<ViewState['lockedPhysical']>['r'],
  p: NonNullable<ViewState['lockedPhysical']>['p'],
): { z: ViewState['z0']; clamped: boolean } {
  const enc = inverseEncodeLatent({ m, r, p, t: 0 }, KNOBS);
  return { z: enc.z, clamped: enc.clamped };
}
