import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { decodeMassSimplex } from '@/decode/mass.js';
import { burrauTriangle } from './euclid.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Triple, Vec2 } from '@/math/types.js';

const EPS_MASS = 1e-4;

/**
 * Burrau ternary mass chart: shape fixed at ν = ν₀, mass triple swept
 * across the open simplex.
 *
 * The Burrau "natural" mass triple for ν₀ is
 *   m_Burrau = (c, b, a) / (a + b + c)  (re-indexed)
 * which appears as a marker overlay (M11 ships the marker, M7/M10's
 * physics_overlay flag activates it).
 */
export function makeBurrauMassChart(nu0: number): Chart {
  return {
    id: 'mass_simplex',
    kind: 'mass_simplex',
    flags: FLAGS_MASS_VARYING,

    decode([u, v]) {
      const m = decodeMassSimplex(u, v, EPS_MASS);
      const { r } = burrauTriangle(nu0);     // shape only; masses overridden
      const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) {
        return { kind: 'terminal', terminal: c.terminal,
                 descriptor: makeDescriptor(c.state) };
      }
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    chartUniforms() {
      return { ...CHART_UNIFORMS_DEFAULTS, nu_burrau: nu0 };
    },

    inverseEncode() {
      return { kind: 'projected', reason: 'burrau mass chart needs ν' };
    },

    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      // Same criterion as M10's mass_simplex (D10.5): the bilinear map is
      // total on [0,1]²; saturation means a RAW component under ε_m.
      const rawMin = Math.min((1 - u) * (1 - v), u, (1 - u) * v);
      if (rawMin < EPS_MASS) {
        return { kind: 'project', pixel: { s: u, t: v },
                 reason: 'inside the simplex interior buffer' };
      }
      return { kind: 'pass' };
    },
  };
}
