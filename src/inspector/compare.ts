import type { InspectorResult } from './types.js';
import type { DecodedSimResult } from '@/gpu/readback.js';
import { decodeDescriptor, OutcomeClass } from '@/debug/descriptor_bits.js';

/**
 * GPU↔CPU comparison for the inspector's validation panel — the harness the
 * spec names for validating the GPU f32 tiled result against the CPU f64
 * recompute (§inspector).
 *
 * Limited to what the GPU actually computes: outcome always; FTLE only when
 * the sample's FTLE_VALID bit is set; free-group word only when the GPU word
 * is non-empty. Stubbed metrics (pre-Stage-5) therefore read as "not
 * computed", never as disagreement.
 */
export function compareToGpu(
  cpu: InspectorResult, gpu: DecodedSimResult,
): NonNullable<InspectorResult['validation']> {
  const bits = decodeDescriptor(gpu.sample_descriptor);
  const expected: Partial<Record<InspectorResult['outcome'], number>> = {
    bounded: OutcomeClass.Bounded, collision: OutcomeClass.Collision,
    escape: OutcomeClass.Escape, timeout: OutcomeClass.Timeout,
  };
  const want = expected[cpu.outcome];
  const gpuOutcomeAgrees = want !== undefined
    ? bits.outcomeClass === want
    // CPU 'failed' (h_min abort): the GPU has no SIM_FAILED class; its
    // honest analogues are degenerate/timeout.
    : bits.outcomeClass === OutcomeClass.Degenerate
      || bits.outcomeClass === OutcomeClass.Timeout;
  const gpuWordLen = (gpu.free_group_word[3] >>> 26) & 0x3f;
  return {
    gpuOutcomeAgrees,
    gpuFtleDelta: bits.ftleValid ? Math.abs(gpu.ftle - cpu.ftle) : 0,
    // Length-only until the GPU computes real words (Stage 5 refines to
    // content comparison).
    gpuWordAgrees: gpuWordLen === 0 || gpuWordLen === cpu.freeGroupWord.length,
  };
}
