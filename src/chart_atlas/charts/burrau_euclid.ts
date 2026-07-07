import type { Chart } from '../types.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { burrauTriangle, recoverNuFromTriangle } from '@/burrau/euclid.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

/**
 * Burrau Euclid display chart: the horizontal axis is `m` (display only),
 * vertical is `ν = n/m`. Only ν affects the physics. Primitive triples
 * appear as overlay landmarks in the m-axis (M11 supplies them).
 */
export const burrauEuclidChart: Chart = {
  id: 'burrau_euclid',
  kind: 'mixed',          // technically 1D, but rendered as 2D
  flags: FLAGS_DEFAULT,

  decode([, v]) {
    const nuMin = 1 / 32, nuMax = 31 / 32;
    const nu = nuMin + (nuMax - nuMin) * v;
    // Canonical ν → triangle map (spec eq. burrau_positions) — single
    // source in src/burrau/euclid.ts, shared with the M11 family module.
    const { r, m } = burrauTriangle(nu);
    const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
    const c2 = canonicalise({ r, p, m, t: 0 },
                            { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c2.terminal) {
      return { kind: 'terminal', terminal: c2.terminal,
               descriptor: makeDescriptor(c2.state) };
    }
    return { kind: 'ok', state: c2.state, descriptor: makeDescriptor(c2.state) };
  },

  inverseEncode(ic) {
    // ν from the triangle's leg ratio (rotation-invariant, so the
    // canonicalised state recovers it exactly); the u axis is
    // display-only for this 1D physical chart — 0.5 by convention.
    const nu = recoverNuFromTriangle(ic.r);
    const nuMin = 1 / 32, nuMax = 31 / 32;
    if (nu < nuMin || nu > nuMax) {
      return {
        kind: 'projected',
        pixel: { s: 0.5, t: nu < nuMin ? 0 : 1 },
        reason: `nu = ${nu.toPrecision(6)} outside [1/32, 31/32]`,
        clamped: true,
      };
    }
    return { kind: 'exact',
             pixel: { s: 0.5, t: (nu - nuMin) / (nuMax - nuMin) } };
  },

  chartUniforms(view) {
    return {
      ...CHART_UNIFORMS_DEFAULTS,
      nu_burrau: (view.chartParams['nu'] as number | undefined) ?? 0.5,
    };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
