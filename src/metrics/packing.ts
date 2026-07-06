/**
 * Bit-pack the per-sample status word into the 32-bit `sample_descriptor`
 * field of `SimResult`. Layout matches the spec §6.6 table exactly, and is
 * the same contract as src/debug/descriptor_bits.ts and the WGSL bit-decode
 * functions in render_layer0.wgsl — three homes, changed together.
 */
export interface SampleDescriptorFields {
  outcomeClass:    0 | 1 | 2 | 3 | 4;     // bits 0-2
  detail:          number;                 // bits 3-4
  suspectEnergy:   boolean;                // bit 5
  suspectLz:       boolean;                // bit 6
  ftleValid:       boolean;                // bit 7
  wordTruncated:   boolean;                // bit 8 (WORD_TRUNCATED)
  wordUncertain:   boolean;                // bit 9 (WORD_UNCERTAIN — ADR 0004)
  encounterCount:  number;                 // bits 10-15, 0..63
  substepLog2:     number;                 // bits 16-22, 0..127
  benettinCount:   number;                 // bits 23-29, 0..127
  dominantPair:    0 | 1 | 2;              // bits 30-31
}

export function packSampleDescriptor(f: SampleDescriptorFields): number {
  let v = 0;
  v |= (f.outcomeClass & 0x7);
  v |= (f.detail & 0x3) << 3;
  v |= f.suspectEnergy ? 1 << 5 : 0;
  v |= f.suspectLz     ? 1 << 6 : 0;
  v |= f.ftleValid     ? 1 << 7 : 0;
  v |= f.wordTruncated ? 1 << 8 : 0;
  v |= f.wordUncertain ? 1 << 9 : 0;
  v |= (Math.min(63,  Math.max(0, f.encounterCount)) & 0x3f) << 10;
  v |= (Math.min(127, Math.max(0, f.substepLog2))    & 0x7f) << 16;
  v |= (Math.min(127, Math.max(0, f.benettinCount))  & 0x7f) << 23;
  v |= (f.dominantPair & 0x3) << 30;
  return v >>> 0;
}

export function unpackSampleDescriptor(v: number): SampleDescriptorFields {
  return {
    outcomeClass:   ((v) & 0x7) as 0|1|2|3|4,
    detail:         (v >>> 3) & 0x3,
    suspectEnergy:  ((v >>> 5) & 1) === 1,
    suspectLz:      ((v >>> 6) & 1) === 1,
    ftleValid:      ((v >>> 7) & 1) === 1,
    wordTruncated:  ((v >>> 8) & 1) === 1,
    wordUncertain:  ((v >>> 9) & 1) === 1,
    encounterCount: (v >>> 10) & 0x3f,
    substepLog2:    (v >>> 16) & 0x7f,
    benettinCount:  (v >>> 23) & 0x7f,
    dominantPair:   ((v >>> 30) & 0x3) as 0|1|2,
  };
}

export interface TrajectoryStatsFields {
  tDminFrac:        number;     // 16 bits
  totalStepsLog2:   number;     // 7  bits
  orbitCount:       number;     // 6  bits, unsigned (sign in `retrograde`)
  dminPair:         0 | 1 | 2;
  retrograde:       boolean;    // sign of net winding
}

export function packTrajectoryStats(f: TrajectoryStatsFields): number {
  let v = 0;
  v |= (Math.min(0xffff, Math.max(0, f.tDminFrac)) & 0xffff);
  v |= (Math.min(127, Math.max(0, f.totalStepsLog2)) & 0x7f) << 16;
  v |= (Math.min(63,  Math.max(0, f.orbitCount))     & 0x3f) << 23;
  v |= (f.dminPair & 0x3) << 29;
  v |= f.retrograde ? 1 << 31 : 0;
  return v >>> 0;
}

export function unpackTrajectoryStats(v: number): TrajectoryStatsFields {
  return {
    tDminFrac:       v        & 0xffff,
    totalStepsLog2: (v >>> 16) & 0x7f,
    orbitCount:     (v >>> 23) & 0x3f,
    dminPair:      ((v >>> 29) & 0x3) as 0|1|2,
    retrograde:    ((v >>> 31) & 1) === 1,
  };
}
