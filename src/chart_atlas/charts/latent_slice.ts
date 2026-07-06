import type { Chart } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import { add8, scale8 } from '@/math/vec.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export const latentSliceChart: Chart = {
  id: 'latent_slice',
  kind: 'affine',
  flags: FLAGS_DEFAULT,

  decode([u, v], view) {
    const su = (2 * u - 1) * view.mag;
    const sv = (2 * v - 1) * view.mag;
    const z = add8(view.z0, add8(scale8(view.q1, su), scale8(view.q2, sv)));
    return decodeLatent(z, KNOBS);
  },

  inverseEncode(ic) {
    const enc = inverseEncodeLatent(ic, KNOBS);
    return { kind: enc.clamped ? 'projected' : 'exact', z: enc.z, clamped: enc.clamped };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of [0, 1]² range' };
    }
    return { kind: 'pass' };
  },
};
