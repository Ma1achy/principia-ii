/**
 * Non-finite-lane hunter. Scans a readback SimResult ArrayBuffer (the same
 * bytes readbackSimResults reads) for NaN / ±Inf in any f32 metric lane and
 * reports the exact (sample index, field name) pairs. M3 should never emit a
 * non-finite metric for a non-degenerate sample; when it does, this is the
 * first stop.
 */
import { sizeOfSimResult, M_DEFAULT } from '@/gpu/structs.js';

export interface NonFiniteHit {
  sample: number;       // flat sample index (row-major, y*N + x)
  field: string;        // field name from the SimResult layout
  value: number;        // the offending value (NaN encoded as NaN)
}

const F32_FIELD_NAMES: readonly string[] = [
  'arc_length_n', 't_end', 'd_min', 'ftle', 'energy_drift', 'diffusion',
  'delta_E_max_abs', 'Lz_drift', 'delta_Lz_max_abs', 'E_0', 'Lz_0',
];

/**
 * Scan N*N samples for non-finite f32 lanes: the M checkpoint vec4 lanes plus
 * the 11 scalar metrics. Returns one hit per offending lane; an all-finite
 * buffer returns []. Pure; no GPU.
 */
export function scanNonFinite(
  ab: ArrayBuffer, N: number, M: number = M_DEFAULT,
): NonFiniteHit[] {
  const stride = sizeOfSimResult(M);
  const count = N * N;
  const hits: NonFiniteHit[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * stride;
    const f32 = new Float32Array(ab, off, stride / 4);
    // checkpoint vec4 lanes
    for (let m = 0; m < M; m++) {
      const o = m * 4;
      for (let c = 0; c < 4; c++) {
        const v = f32[o + c]!;
        if (!Number.isFinite(v)) {
          hits.push({ sample: i, field: `n_checkpoints[${m}].${'xyzw'[c]}`, value: v });
        }
      }
    }
    // scalar metrics (skip the vec4<u32> free-group word at lane base = M*4)
    const base = M * 4 + 4;
    for (let k = 0; k < F32_FIELD_NAMES.length; k++) {
      const v = f32[base + k]!;
      if (!Number.isFinite(v)) {
        hits.push({ sample: i, field: F32_FIELD_NAMES[k]!, value: v });
      }
    }
  }
  return hits;
}

/** Just the distinct offending sample indices, sorted ascending. */
export function nonFiniteSamples(hits: readonly NonFiniteHit[]): number[] {
  return [...new Set(hits.map((h) => h.sample))].sort((a, b) => a - b);
}
