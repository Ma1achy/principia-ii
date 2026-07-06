/**
 * GPU buffer inspector: pick a sample (x, y) on the M3 grid → readback the
 * SimResult buffer (via M3's readbackSimResults) → return a flat table of rows
 * for the decoded DecodedSimResult plus the decoded sample_descriptor bitfields.
 * The dev page renders these rows verbatim. Production never calls this — the
 * readback crosses GPU→CPU, so it lives behind the debug module only.
 */
import type { GpuContext } from '@/gpu/init.js';
import type { TileBuffers } from '@/gpu/buffers.js';
import { readbackSimResults, type DecodedSimResult } from '@/gpu/readback.js';
import { decodeDescriptor } from './descriptor_bits.js';

export interface InspectRow {
  field: string;
  value: string;
}

export interface SampleInspection {
  sample: number;        // flat index
  x: number;
  y: number;
  decoded: DecodedSimResult;
  rows: readonly InspectRow[];
}

/** Build the flat table of rows for one decoded SimResult. Pure. */
export function inspectionRows(d: DecodedSimResult): InspectRow[] {
  const bits = decodeDescriptor(d.sample_descriptor);
  const r = (field: string, value: string | number): InspectRow =>
    ({ field, value: typeof value === 'number' ? formatNum(value) : value });
  const ckRows = d.n_checkpoints.map((c, i) =>
    r(`n[${i}]`, `(${formatNum(c.x)}, ${formatNum(c.y)}, ${formatNum(c.z)}, ${formatNum(c.w)})`));
  return [
    r('outcome', `${bits.outcomeName} (${bits.outcomeClass})`),
    r('detail', bits.detail),
    r('suspect_energy', String(bits.suspectEnergy)),
    r('suspect_Lz', String(bits.suspectLz)),
    r('FTLE_VALID', String(bits.ftleValid)),
    r('word_truncated', String(bits.wordTruncated)),
    r('word_uncertain', String(bits.wordUncertain)),
    r('encounter_count', bits.encounterCount),
    r('substep_log2', bits.substepLog2),
    r('benettin_count', bits.benettinCount),
    r('dominant_pair', bits.dominantPair),
    r('t_end', d.t_end),
    r('d_min', d.d_min),
    r('ftle', d.ftle),
    r('energy_drift', d.energy_drift),
    r('delta_E_max_abs', d.delta_E_max_abs),
    r('Lz_drift', d.Lz_drift),
    r('delta_Lz_max_abs', d.delta_Lz_max_abs),
    r('E_0', d.E_0),
    r('Lz_0', d.Lz_0),
    r('arc_length_n', d.arc_length_n),
    r('diffusion', d.diffusion),
    r('descriptor(raw)', `0x${(d.sample_descriptor >>> 0).toString(16)}`),
    ...ckRows,
  ];
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);     // NaN / Infinity surface as-is
  return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? v.toFixed(6) : v.toExponential(4);
}

/**
 * Readback the whole tile and inspect one sample. `N` must match the dispatch
 * grid. Throws if (x,y) is out of range — picking off-grid is a caller bug.
 */
export async function pickSample(
  ctx: GpuContext, bufs: TileBuffers, N: number, x: number, y: number,
): Promise<SampleInspection> {
  if (x < 0 || y < 0 || x >= N || y >= N) {
    throw new Error(`pickSample out of range: (${x},${y}) for N=${N}`);
  }
  const all = await readbackSimResults(ctx, bufs);
  const sample = y * N + x;
  const decoded = all[sample]!;
  return { sample, x, y, decoded, rows: inspectionRows(decoded) };
}
