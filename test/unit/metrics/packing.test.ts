import { describe, it, expect } from 'vitest';
import {
  packSampleDescriptor, unpackSampleDescriptor,
  packTrajectoryStats,  unpackTrajectoryStats,
} from '@/metrics/packing.js';

describe('sample_descriptor pack / unpack', () => {
  it('round-trips', () => {
    const f = {
      outcomeClass: 2 as const, detail: 1, suspectEnergy: true,
      suspectLz: false, ftleValid: true, wordTruncated: false,
      wordUncertain: true,
      encounterCount: 17, substepLog2: 6, benettinCount: 12,
      dominantPair: 1 as const,
    };
    const packed = packSampleDescriptor(f);
    expect(unpackSampleDescriptor(packed)).toEqual(f);
  });

  it('clamps overlarge values', () => {
    const f = {
      outcomeClass: 0 as const, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: false, wordTruncated: false, wordUncertain: false,
      encounterCount: 1000, substepLog2: 1000, benettinCount: 1000,
      dominantPair: 0 as const,
    };
    const u = unpackSampleDescriptor(packSampleDescriptor(f));
    expect(u.encounterCount).toBe(63);
    expect(u.substepLog2).toBe(127);
    expect(u.benettinCount).toBe(127);
  });
});

describe('trajectory_stats pack / unpack', () => {
  it('round-trips', () => {
    const f = {
      tDminFrac: 32768, totalStepsLog2: 12,
      orbitCount: 3, dminPair: 2 as const, retrograde: true,
    };
    expect(unpackTrajectoryStats(packTrajectoryStats(f))).toEqual(f);
  });
});
