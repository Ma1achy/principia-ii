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

  // inverseEncode inherited from lzEChart via the spread: both charts
  // pixel-map through K, so the shared closed-form inverse (G5) serves
  // both — mirroring the shared decode.
};
