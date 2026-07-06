import type { Chart } from '../types.js';
import { FLAGS_MASS_VARYING } from '../flags.js';
import { decodeMassSimplex } from '@/decode/mass.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

const EPS_MASS = 1e-4;

/**
 * Ternary mass simplex chart. Geometry is fixed via `chartParams.alpha`/
 * `beta`; only the masses vary per pixel.
 *
 * Parametrisation (see `massFromSimplex`): m₁ = u, m₂ = (1−u)·v,
 * m₀ = (1−u)(1−v) — a bilinear map that covers the whole simplex for
 * (u, v) ∈ [0, 1]², with `decodeMassSimplex` shrinking toward the
 * barycentre by the interior buffer ε_m. Saturation therefore means a
 * RAW component below ε_m, not u + v ≥ 1 (the map is total; half the
 * square has u + v ≥ 1 with all masses comfortably interior).
 */
export const massSimplexChart: Chart = {
  id: 'mass_simplex',
  kind: 'mass_simplex',
  flags: FLAGS_MASS_VARYING,

  decode([u, v], view) {
    const m = decodeMassSimplex(u, v, EPS_MASS);
    const alpha = (view.chartParams['alpha'] as number | undefined) ?? Math.PI / 4;
    const beta  = (view.chartParams['beta']  as number | undefined) ?? Math.PI / 2;
    const r = realiseFrozenConfig(alpha, beta, m);
    const p: Triple<Vec2> = jacobiToParticleMomenta(
      { pRho: [0, 0], pLambda: [0, 0] }, m,
    );
    const c = canonicalise({ r, p, m, t: 0 },
                           { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c.terminal) {
      return { kind: 'terminal', terminal: c.terminal,
               descriptor: makeDescriptor(c.state) };
    }
    return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
  },

  inverseEncode(ic) {
    // Invert the interior buffer, then the bilinear simplex map:
    //   m₁ = u, m₂ = (1−u)·v  ⇒  u = m₁, v = m₂ / (1 − m₁).
    const raw = [
      (ic.m[0] - EPS_MASS) / (1 - 3 * EPS_MASS),
      (ic.m[1] - EPS_MASS) / (1 - 3 * EPS_MASS),
      (ic.m[2] - EPS_MASS) / (1 - 3 * EPS_MASS),
    ] as const;
    const clamped = raw.some((x) => x < 0 || x > 1);
    const m1 = Math.min(1, Math.max(0, raw[1]));
    const m2 = Math.min(1, Math.max(0, raw[2]));
    const u = m1;
    const v = 1 - m1 < 1e-12 ? 0 : Math.min(1, m2 / (1 - m1));
    return { kind: clamped ? 'projected' : 'exact', pixel: { s: u, t: v } };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    const rawMin = Math.min((1 - u) * (1 - v), u, (1 - u) * v);
    if (rawMin < EPS_MASS) {
      return { kind: 'project', pixel: { s: u, t: v },
               reason: 'inside the simplex interior buffer' };
    }
    return { kind: 'pass' };
  },
};
