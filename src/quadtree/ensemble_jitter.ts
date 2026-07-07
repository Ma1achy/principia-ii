/**
 * Per-pixel sub-pixel jitter for ensemble dispatch (G7, spec §4.4). Each
 * ensemble copy e ∈ [0, E) perturbs the sample point within its pixel by
 * one of these offsets (in pixel units, each component in [−0.5, 0.5)).
 *
 * Patterns (`TileRequest.sample_pattern_id`):
 *   0 = no jitter (E = 1)
 *   1 = stratified: √E × √E sub-cells, sample at each sub-cell centre
 *   2 = Halton (base 2, base 3) low-discrepancy sequence
 */
export interface JitterOffset { du: number; dv: number }

export const ENSEMBLE_E_MAX = 16;

export function jitterOffsets(patternId: number, E: number): JitterOffset[] {
  if (E <= 1) return [{ du: 0, dv: 0 }];
  const n = Math.min(E, ENSEMBLE_E_MAX);
  switch (patternId) {
    case 1:  return stratifiedOffsets(n);
    case 2:  return haltonOffsets(n);
    default: return Array.from({ length: n }, () => ({ du: 0, dv: 0 }));
  }
}

function stratifiedOffsets(E: number): JitterOffset[] {
  const side = Math.ceil(Math.sqrt(E));
  const out: JitterOffset[] = [];
  for (let j = 0; j < side && out.length < E; j++) {
    for (let i = 0; i < side && out.length < E; i++) {
      out.push({
        du: (i + 0.5) / side - 0.5,
        dv: (j + 0.5) / side - 0.5,
      });
    }
  }
  return out;
}

function haltonOffsets(E: number): JitterOffset[] {
  const out: JitterOffset[] = [];
  for (let i = 1; i <= E; i++) {
    out.push({ du: halton(i, 2) - 0.5, dv: halton(i, 3) - 0.5 });
  }
  return out;
}

function halton(i: number, base: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}
