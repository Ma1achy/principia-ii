import { describe, it, expect } from 'vitest';
import { compareToGpu } from '@/inspector/compare.js';
import type { InspectorResult } from '@/inspector/types.js';
import type { DecodedSimResult } from '@/gpu/readback.js';

const FTLE_VALID = 1 << 7;

function cpu(overrides: Partial<InspectorResult> = {}): InspectorResult {
  return {
    t: [], r: [], p: [], nShape: [], energy: [], lz: [],
    outcome: 'bounded', tEnd: 80, dMin: 1, deltaEMax: 0,
    ftle: 0.5, freeGroupWord: 'abA',
    ic: { m: [1, 1, 1], r: [[0, 0], [1, 0], [0, 1]], p: [[0, 0], [0, 0], [0, 0]] },
    nSteps: 1, nReject: 0, cpuMs: 0,
    ...overrides,
  } as InspectorResult;
}

function gpu(descriptor: number, overrides: Partial<DecodedSimResult> = {}): DecodedSimResult {
  return {
    n_checkpoints: [], free_group_word: [0, 0, 0, 0],
    arc_length_n: 0, t_end: 80, d_min: 1, ftle: 0, energy_drift: 0,
    diffusion: -1, delta_E_max_abs: 0, Lz_drift: 0, delta_Lz_max_abs: 0,
    E_0: 0, Lz_0: 0, sample_descriptor: descriptor, trajectory_stats: 0,
    ...overrides,
  };
}

describe('compareToGpu — inspector validation semantics', () => {
  it('outcome classes map: bounded=0, collision=1, escape=2, timeout=4', () => {
    expect(compareToGpu(cpu({ outcome: 'bounded' }), gpu(0)).gpuOutcomeAgrees).toBe(true);
    expect(compareToGpu(cpu({ outcome: 'collision' }), gpu(1)).gpuOutcomeAgrees).toBe(true);
    expect(compareToGpu(cpu({ outcome: 'escape' }), gpu(2)).gpuOutcomeAgrees).toBe(true);
    expect(compareToGpu(cpu({ outcome: 'timeout' }), gpu(4)).gpuOutcomeAgrees).toBe(true);
    // Disagreement: CPU bounded vs GPU escape.
    expect(compareToGpu(cpu({ outcome: 'bounded' }), gpu(2)).gpuOutcomeAgrees).toBe(false);
  });

  it("CPU 'failed' accepts GPU degenerate or timeout, nothing else", () => {
    expect(compareToGpu(cpu({ outcome: 'failed' }), gpu(3)).gpuOutcomeAgrees).toBe(true);
    expect(compareToGpu(cpu({ outcome: 'failed' }), gpu(4)).gpuOutcomeAgrees).toBe(true);
    expect(compareToGpu(cpu({ outcome: 'failed' }), gpu(0)).gpuOutcomeAgrees).toBe(false);
  });

  it('FTLE delta only counts when the GPU sample sets FTLE_VALID', () => {
    // GPU ftle stubbed (0) with the bit clear: no disagreement is reported.
    expect(compareToGpu(cpu({ ftle: 0.5 }), gpu(0)).gpuFtleDelta).toBe(0);
    // Bit set: honest delta.
    expect(compareToGpu(cpu({ ftle: 0.5 }), gpu(FTLE_VALID, { ftle: 0.2 }))
      .gpuFtleDelta).toBeCloseTo(0.3, 12);
  });

  it('word agreement gates on a non-empty GPU word (length in .w bits 26-31)', () => {
    // Stubbed (all-zero) GPU word: not computed, agrees by definition.
    expect(compareToGpu(cpu({ freeGroupWord: 'abA' }), gpu(0)).gpuWordAgrees).toBe(true);
    // GPU word of length 3 vs CPU word of length 3: agrees (length-only pre-Stage-5).
    const len3 = gpu(0, { free_group_word: [0, 0, 0, 3 << 26] });
    expect(compareToGpu(cpu({ freeGroupWord: 'abA' }), len3).gpuWordAgrees).toBe(true);
    // GPU word of length 5 vs CPU word of length 3: disagrees.
    const len5 = gpu(0, { free_group_word: [0, 0, 0, 5 << 26] });
    expect(compareToGpu(cpu({ freeGroupWord: 'abA' }), len5).gpuWordAgrees).toBe(false);
  });
});
