/**
 * Decoder for the SimResult.sample_descriptor bitfield (see G17 contract table).
 * Pure, GPU-free. The WGSL debug branch in render_layer0.wgsl mirrors these
 * masks/shifts exactly — change both in the same commit.
 */

export enum OutcomeClass {
  Bounded = 0,
  Collision = 1,
  Escape = 2,
  Degenerate = 3,
  Timeout = 4,
}

export const OUTCOME_NAMES: readonly string[] = [
  'BOUNDED', 'COLLISION', 'ESCAPE', 'DEGENERATE', 'TIMEOUT',
  'RESERVED5', 'RESERVED6', 'RESERVED7',
];

export interface DescriptorBits {
  raw: number;
  outcomeClass: number;       // bits 0..2 (only 0..4 defined)
  outcomeName: string;
  detail: number;             // bits 3..4: collision pair / escape body
  suspectEnergy: boolean;     // bit 5
  suspectLz: boolean;         // bit 6
  ftleValid: boolean;         // bit 7
  wordTruncated: boolean;     // bit 8 (WORD_TRUNCATED)
  wordUncertain: boolean;     // bit 9 (WORD_UNCERTAIN — ADR 0004)
  encounterCount: number;     // bits 10..15, 0..63
  substepLog2: number;        // bits 16..22, 0..127
  benettinCount: number;      // bits 23..29, 0..127
  dominantPair: number;       // bits 30..31, 0..2
}

const bit = (v: number, n: number): boolean => ((v >>> n) & 1) === 1;

/**
 * Decode a raw u32 descriptor into named fields. Never throws.
 * Mirrors M6's `unpackSampleDescriptor` (milestones/M6_metrics.md §6.6) exactly.
 */
export function decodeDescriptor(raw: number): DescriptorBits {
  const r = raw >>> 0;
  const outcomeClass = r & 0x7;
  return {
    raw: r,
    outcomeClass,
    outcomeName: OUTCOME_NAMES[outcomeClass] ?? `CLASS${outcomeClass}`,
    detail: (r >>> 3) & 0x3,
    suspectEnergy: bit(r, 5),
    suspectLz: bit(r, 6),
    ftleValid: bit(r, 7),
    wordTruncated: bit(r, 8),
    wordUncertain: bit(r, 9),
    encounterCount: (r >>> 10) & 0x3f,
    substepLog2: (r >>> 16) & 0x7f,
    benettinCount: (r >>> 23) & 0x7f,
    dominantPair: (r >>> 30) & 0x3,
  };
}

/** Convenience: just the outcome class, matches M3's outcome-class mask (descriptor & 0x7). */
export function classOf(raw: number): number {
  return (raw >>> 0) & 0x7;
}
