import type { Chart } from '../types.js';
import { FLAGS_DEFAULT, FLAGS_MASS_VARYING } from '../flags.js';
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

/**
 * Mixed-axis chart factory. Each axis is independent; the remaining 6
 * latent coordinates are frozen at the centre `z0`. The factory
 * propagates flags: any mass axis sets `requires_per_pixel_mass = true`.
 *
 * M10 ships only the latent × latent variant; other combinations throw
 * AT CONSTRUCTION-TIME semantics (unconstructible pairing), so
 * `makeMixedAxisChart` rejects them up front rather than letting a
 * registered chart violate decode totality per pixel.
 */
const LATENT_KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export function makeMixedAxisChart(opts: {
  hAxis: AxisSpec; vAxis: AxisSpec;
}): Chart {
  const flags =
    opts.hAxis.kind === 'mass' || opts.vAxis.kind === 'mass'
      ? FLAGS_MASS_VARYING : FLAGS_DEFAULT;

  return {
    id: 'mixed_axis',
    kind: 'mixed',
    flags,
    chartUniforms() {
      return CHART_UNIFORMS_DEFAULTS;
    },
    decode([u, v], view) {
      // Compose: write the per-axis derivation into the view's z0, then
      // decode the frozen point through the latent slice. M10 ships only
      // the latent + latent variant and declares the contract for the
      // rest (M11 / M12 fill in mass / shape / momentum axes).
      if (opts.hAxis.kind === 'latent' && opts.vAxis.kind === 'latent') {
        const z0 = [...view.z0] as [
          number, number, number, number, number, number, number, number,
        ];
        const [hLo, hHi] = opts.hAxis.range;
        const [vLo, vHi] = opts.vAxis.range;
        z0[opts.hAxis.index] = hLo + (hHi - hLo) * u;
        z0[opts.vAxis.index] = vLo + (vHi - vLo) * v;
        return latentSliceChart.decode([0.5, 0.5], { ...view, z0: z0 as Vec8 });
      }
      throw new Error(
        `mixed_axis: ${opts.hAxis.kind} × ${opts.vAxis.kind} not implemented`,
      );
    },
    inverseEncode(ic) {
      // latent × latent: recover the full latent z, then read each axis
      // back through its range. Other axis kinds are unconstructible in
      // M10's factory (decode throws), so their inverse stays projected.
      if (opts.hAxis.kind === 'latent' && opts.vAxis.kind === 'latent') {
        const enc = inverseEncodeLatent(ic, LATENT_KNOBS);
        const [hLo, hHi] = opts.hAxis.range;
        const [vLo, vHi] = opts.vAxis.range;
        const clampU = (x: number): number => Math.min(1, Math.max(0, x));
        const s = clampU((enc.z[opts.hAxis.index]! - hLo) / (hHi - hLo));
        const t = clampU((enc.z[opts.vAxis.index]! - vLo) / (vHi - vLo));
        return { kind: enc.clamped ? 'projected' : 'exact',
                 pixel: { s, t }, z: enc.z, clamped: enc.clamped };
      }
      return { kind: 'projected',
               reason: 'mixed_axis inverse depends on factory args' };
    },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      return { kind: 'pass' };
    },
  };
}
