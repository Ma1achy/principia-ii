import type { Chart } from '../types.js';
import { FLAGS_INVARIANT } from '../flags.js';
import { lzEChart } from './lz_e.js';

/**
 * (L_z, K) chart. Shares lz_e's decode outright: with the configuration
 * frozen, E = U(r) + K*, so the two charts produce identical states for
 * identical (u, v) — the axes differ only in labelling (K directly vs
 * E relative to U) and in what inverseEncode reports.
 */
export const lzKChart: Chart = {
  ...lzEChart,
  id: 'lz_k',
  flags: FLAGS_INVARIANT,

  inverseEncode(ic) {
    const K = (ic.p[0][0] ** 2 + ic.p[0][1] ** 2) / (2 * ic.m[0])
            + (ic.p[1][0] ** 2 + ic.p[1][1] ** 2) / (2 * ic.m[1])
            + (ic.p[2][0] ** 2 + ic.p[2][1] ** 2) / (2 * ic.m[2]);
    return {
      kind: 'projected',
      pixel: { s: 0.5, t: 0.5 },
      reason: `lz_k inverse needs chart params (K=${K.toPrecision(6)})`,
    };
  },
};
