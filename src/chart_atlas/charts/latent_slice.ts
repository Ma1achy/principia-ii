import type { Chart } from '../types.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
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

  inverseEncode(ic, view) {
    const enc = inverseEncodeLatent(ic, KNOBS);
    if (!view) {
      // No slice to project onto — return the latent point alone (the
      // pre-G5 behaviour; M8's lookup projects it against its own view).
      return { kind: enc.clamped ? 'projected' : 'exact', z: enc.z, clamped: enc.clamped };
    }
    // Project z − z0 onto the slice axes. Off-plane residual means the IC
    // does not live on this 2D slice — still return the nearest pixel,
    // marked projected.
    const d = enc.z.map((zi, i) => zi - view.z0[i]!);
    const dotQ = (q: readonly number[]): [number, number] => {
      let num = 0, den = 0;
      for (let i = 0; i < 8; i++) { num += d[i]! * q[i]!; den += q[i]! * q[i]!; }
      return [num, den];
    };
    const [h, hh] = dotQ(view.q1);
    const [w, ww] = dotQ(view.q2);
    const su = hh > 0 ? h / hh : 0;
    const sv = ww > 0 ? w / ww : 0;
    let off = 0;
    for (let i = 0; i < 8; i++) {
      const inPlane = su * view.q1[i]! + sv * view.q2[i]!;
      off += (d[i]! - inPlane) ** 2;
    }
    const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
    const s = clamp01((su / view.mag + 1) / 2);
    const t = clamp01((sv / view.mag + 1) / 2);
    const offPlane = Math.sqrt(off) > 1e-6;
    const projected = enc.clamped || offPlane;
    return {
      kind: projected ? 'projected' : 'exact',
      pixel: { s, t },
      z: enc.z,
      clamped: projected,
      ...(offPlane ? { reason: 'IC lies off this 2D latent slice' } : {}),
    };
  },

  chartUniforms() {
    return CHART_UNIFORMS_DEFAULTS;
  },

  affineSlice(view) {
    // decode() above IS the affine map — hand the GPU the same slice.
    return { z0: view.z0, q1: view.q1, q2: view.q2, mag: view.mag };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of [0, 1]² range' };
    }
    return { kind: 'pass' };
  },
};
