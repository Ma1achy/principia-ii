import type { Chart } from '../types.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { FLAGS_SPHERE } from '../flags.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

/**
 * Shape-sphere chart: the rendering surface and the dynamical state space
 * coincide. Each pixel is a point (θ, φ) on S²; the realisation map
 * recovers the canonical Jacobi (α, β) and decodes through the shared
 * pipeline.
 *
 * The chart sets `has_redundant_hemisphere = true`: φ ∈ (π, 2π) is the
 * reflection-equivalent copy of φ ∈ (0, π).
 */
export const shapeSphereChart: Chart = {
  id: 'shape_sphere',
  kind: 'sphere',
  flags: FLAGS_SPHERE,

  decode([u, v], view) {
    const eps   = (view.chartParams['poleBuffer'] as number | undefined) ?? 0.05;
    const theta = eps + (Math.PI - 2 * eps) * u;
    const phi   = 2 * Math.PI * v;

    // Realisation map: (θ, φ) → (α, β), from the spec revision:
    //   2α = arccos(−sin θ cos φ)
    //   β  = atan2(cos θ, −sin θ sin φ), folded into [0, π].
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const alpha = Math.acos(-sinT * cosPhi) / 2;
    let beta = Math.atan2(cosT, -sinT * sinPhi);
    if (beta < 0) beta += 2 * Math.PI;
    if (beta > Math.PI) beta = 2 * Math.PI - beta;     // hemisphere fold

    const m = view.m ?? [1 / 3, 1 / 3, 1 / 3];
    const r = realiseFrozenConfig(alpha, beta, m);

    const pRho    = (view.chartParams['pRho']    as Vec2 | undefined) ?? [0, 0];
    const pLambda = (view.chartParams['pLambda'] as Vec2 | undefined) ?? [0, 0];
    const p: Triple<Vec2> = jacobiToParticleMomenta({ pRho, pLambda }, m);

    const c = canonicalise({ r, p, m, t: 0 },
                           { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c.terminal) {
      return { kind: 'terminal', terminal: c.terminal,
               descriptor: makeDescriptor(c.state) };
    }
    return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
  },

  inverseEncode() {
    return { kind: 'projected',
             reason: 'shape_sphere inverse not unique without chart params' };
  },

  chartUniforms(view) {
    return {
      ...CHART_UNIFORMS_DEFAULTS,
      pole_buffer: (view.chartParams['poleBuffer'] as number | undefined) ?? 0.05,
    };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    // Pole buffer is enforced via theta(u) so no further check needed.
    return { kind: 'pass' };
  },
};
