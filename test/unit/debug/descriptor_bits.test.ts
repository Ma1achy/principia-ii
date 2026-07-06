import { describe, it, expect } from 'vitest';
import { decodeDescriptor, classOf, OUTCOME_NAMES } from '@/debug/descriptor_bits.js';

describe('decodeDescriptor', () => {
  it('M3 collision with pair=2 → class 1, detail 2, no flags', () => {
    const raw = (1 & 0x7) | ((2 & 0x3) << 3);     // exactly what simulate.wgsl writes
    const b = decodeDescriptor(raw);
    expect(b.outcomeClass).toBe(1);
    expect(b.outcomeName).toBe('COLLISION');
    expect(b.detail).toBe(2);
    expect(b.suspectEnergy).toBe(false);
    expect(b.suspectLz).toBe(false);
    expect(b.ftleValid).toBe(false);
    expect(b.wordTruncated).toBe(false);
    expect(b.wordUncertain).toBe(false);
    expect(b.encounterCount).toBe(0);
    expect(b.substepLog2).toBe(0);
    expect(b.benettinCount).toBe(0);
    expect(b.dominantPair).toBe(0);
  });

  it('decodes the upper M6 fields (exact M6 layout)', () => {
    const raw =
      (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) |
      ((0x2a & 0x3f) << 10) |    // encounterCount = 42
      ((0x55 & 0x7f) << 16) |    // substepLog2 = 85
      ((0x33 & 0x7f) << 23) |    // benettinCount = 51
      ((2 & 0x3) << 30);         // dominantPair = 2
    const b = decodeDescriptor(raw);
    expect(b.suspectEnergy).toBe(true);
    expect(b.suspectLz).toBe(true);
    expect(b.ftleValid).toBe(true);
    expect(b.wordTruncated).toBe(true);
    expect(b.wordUncertain).toBe(true);
    expect(b.encounterCount).toBe(42);
    expect(b.substepLog2).toBe(85);
    expect(b.benettinCount).toBe(51);
    expect(b.dominantPair).toBe(2);
  });

  it('classOf matches the M3 mask', () => {
    expect(classOf(0xffffffff)).toBe(7);
    expect(classOf(4)).toBe(4);
  });

  it('OUTCOME_NAMES covers classes 0..4', () => {
    expect(OUTCOME_NAMES.slice(0, 5)).toEqual(
      ['BOUNDED', 'COLLISION', 'ESCAPE', 'DEGENERATE', 'TIMEOUT']);
  });
});
