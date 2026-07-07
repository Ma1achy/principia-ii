import type { Chart } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { latentSliceChart } from './latent_slice.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import type { Vec8 } from '@/math/types.js';

export type AxisSpec =
  | { kind: 'latent';   index: number; range: [number, number] }
  | { kind: 'mass';     parameter: 'm1' | 'm2'; range: [number, number] }
  | { kind: 'lz';       range: [number, number] }
  | { kind: 'energy';   range: [number, number] }
  | { kind: 'shape_alpha'; range: [number, number] }
  | { kind: 'shape_beta';  range: [number, number] };

type LatentAxis = Extract<AxisSpec, { kind: 'latent' }>;

/** Axis kinds the factory can construct today. Non-latent kinds land in
 *  Stage 4 (mass / lz / energy / shape axes); until then they are rejected
 *  HERE, at construction — never per pixel. */
export const CONSTRUCTIBLE_AXIS_KINDS: readonly AxisSpec['kind'][] = ['latent'];

/**
 * Mixed-axis chart factory. Each axis is independent; the remaining 6
 * latent coordinates are frozen at the centre `z0`.
 *
 * Decode totality: unsupported axis pairings throw at CONSTRUCTION time,
 * so a registered mixed-axis chart can never throw per pixel — `decode`
 * on any constructed chart is total (terminal labels, never exceptions).
 */
const LATENT_KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export function makeMixedAxisChart(opts: {
  hAxis: AxisSpec; vAxis: AxisSpec;
}): Chart {
  // Construction-time rejection (the decode-totality guard). The previous
  // revision documented this contract but threw from decode() per pixel.
  if (opts.hAxis.kind !== 'latent' || opts.vAxis.kind !== 'latent') {
    throw new Error(
      `mixed_axis: ${opts.hAxis.kind} × ${opts.vAxis.kind} is not constructible yet `
      + `(supported: ${CONSTRUCTIBLE_AXIS_KINDS.join(', ')}; Stage 4 adds the rest)`,
    );
  }
  const hAxis: LatentAxis = opts.hAxis;
  const vAxis: LatentAxis = opts.vAxis;

  return {
    id: 'mixed_axis',
    kind: 'mixed',
    flags: FLAGS_DEFAULT,
    chartUniforms() {
      return CHART_UNIFORMS_DEFAULTS;
    },
    affineSlice(view) {
      // latent × latent is affine: z[h] = hLo + (hHi − hLo)·u is
      // midpoint + (2u − 1)·halfRange, so with mag = 1 the axes carry the
      // half-ranges and z0 carries the midpoints (other lanes frozen at
      // the view's z0, exactly as decode() below composes them).
      type Mut8 = [number, number, number, number, number, number, number, number];
      const zero8 = (): Mut8 => [0, 0, 0, 0, 0, 0, 0, 0];
      const z0 = [...view.z0] as Mut8;
      const q1 = zero8();
      const q2 = zero8();
      const [hLo, hHi] = hAxis.range;
      const [vLo, vHi] = vAxis.range;
      z0[hAxis.index] = (hLo + hHi) / 2;
      z0[vAxis.index] = (vLo + vHi) / 2;
      q1[hAxis.index] = (hHi - hLo) / 2;
      q2[vAxis.index] = (vHi - vLo) / 2;
      return { z0: z0 as Vec8, q1: q1 as Vec8, q2: q2 as Vec8, mag: 1 };
    },
    decode([u, v], view) {
      // Compose: write the per-axis derivation into the view's z0, then
      // decode the frozen point through the latent slice (total by the
      // shared pipeline's terminal labelling).
      const z0 = [...view.z0] as [
        number, number, number, number, number, number, number, number,
      ];
      const [hLo, hHi] = hAxis.range;
      const [vLo, vHi] = vAxis.range;
      z0[hAxis.index] = hLo + (hHi - hLo) * u;
      z0[vAxis.index] = vLo + (vHi - vLo) * v;
      return latentSliceChart.decode([0.5, 0.5], { ...view, z0: z0 as Vec8 });
    },
    inverseEncode(ic) {
      // Recover the full latent z, then read each axis back through its range.
      const enc = inverseEncodeLatent(ic, LATENT_KNOBS);
      const [hLo, hHi] = hAxis.range;
      const [vLo, vHi] = vAxis.range;
      const clampU = (x: number): number => Math.min(1, Math.max(0, x));
      const s = clampU((enc.z[hAxis.index]! - hLo) / (hHi - hLo));
      const t = clampU((enc.z[vAxis.index]! - vLo) / (vHi - vLo));
      return { kind: enc.clamped ? 'projected' : 'exact',
               pixel: { s, t }, z: enc.z, clamped: enc.clamped };
    },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      return { kind: 'pass' };
    },
  };
}
