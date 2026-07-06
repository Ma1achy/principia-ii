import type { Chart } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Vec3, Triple } from '@/math/types.js';

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
    const a = 1 - nu * nu;
    const b = 2 * nu;
    const c = 1 + nu * nu;
    const total = a + b + c;
    // Re-indexed: body 1→0 (right angle), 2→1, 3→2.
    const m: Vec3 = [c / total, b / total, a / total];
    // Geometric positions (Burrau classical: sides opposite the masses).
    const r: Triple<Vec2> = [[0, 0], [a / c, 0], [0, b / c]];
    const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
    const c2 = canonicalise({ r, p, m, t: 0 },
                            { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c2.terminal) {
      return { kind: 'terminal', terminal: c2.terminal,
               descriptor: makeDescriptor(c2.state) };
    }
    return { kind: 'ok', state: c2.state, descriptor: makeDescriptor(c2.state) };
  },

  inverseEncode() {
    return { kind: 'projected',
             reason: 'burrau_euclid inverse via mass triple lookup' };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
