import { describe, it, expect } from 'vitest';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

const N = 4, M = 8, STRIDE = sizeOfSimResult(M);

function blankBuffer(): ArrayBuffer { return new ArrayBuffer(STRIDE * N * N); }

describe('scanNonFinite', () => {
  it('an all-zero (finite) buffer yields no hits', () => {
    expect(scanNonFinite(blankBuffer(), N, M)).toEqual([]);
  });

  it('finds a NaN in energy_drift and an Inf in a checkpoint lane', () => {
    const ab = blankBuffer();
    // sample 5: energy_drift NaN. scalar base lane = M*4 + 4 = 36; energy_drift is index 4.
    new Float32Array(ab, 5 * STRIDE, STRIDE / 4)[36 + 4] = NaN;
    // sample 9: n_checkpoints[2].y = +Inf (lane 2*4 + 1 = 9).
    new Float32Array(ab, 9 * STRIDE, STRIDE / 4)[9] = Infinity;
    const hits = scanNonFinite(ab, N, M);
    expect(hits.some((h) => h.sample === 5 && h.field === 'energy_drift')).toBe(true);
    expect(hits.some((h) => h.sample === 9 && h.field === 'n_checkpoints[2].y')).toBe(true);
    expect(nonFiniteSamples(hits)).toEqual([5, 9]);
  });

  it('does NOT flag the u32 free-group word (it is not scanned as f32)', () => {
    const ab = blankBuffer();
    // Set the free-group word bytes to a u32 that, as f32, would be NaN.
    new Uint32Array(ab, 3 * STRIDE, STRIDE / 4)[M * 4] = 0x7fc00000;
    expect(scanNonFinite(ab, N, M)).toEqual([]);
  });
});
