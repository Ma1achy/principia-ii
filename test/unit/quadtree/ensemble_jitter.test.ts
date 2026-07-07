import { describe, it, expect } from 'vitest';
import { jitterOffsets, ENSEMBLE_E_MAX } from '@/quadtree/ensemble_jitter.js';

describe('ensemble jitter patterns (G7)', () => {
  it('E = 1 returns the pixel centre with no offset', () => {
    expect(jitterOffsets(1, 1)).toEqual([{ du: 0, dv: 0 }]);
    expect(jitterOffsets(2, 0)).toEqual([{ du: 0, dv: 0 }]);
  });

  it('stratified divides the pixel into √E × √E sub-cells', () => {
    const o = jitterOffsets(1, 4);
    expect(o).toHaveLength(4);
    for (const { du, dv } of o) {
      expect(Math.abs(du)).toBeLessThan(0.5);
      expect(Math.abs(dv)).toBeLessThan(0.5);
    }
    // First two entries share a sub-row: same dv, different du.
    expect(o[0]!.dv).toBeCloseTo(o[1]!.dv, 12);
    expect(o[0]!.du).not.toBeCloseTo(o[1]!.du, 12);
  });

  it('Halton produces E distinct in-pixel points', () => {
    const o = jitterOffsets(2, 16);
    expect(o).toHaveLength(16);
    const keys = new Set(o.map((x) => `${x.du.toFixed(9)},${x.dv.toFixed(9)}`));
    expect(keys.size).toBe(16);
    for (const { du, dv } of o) {
      expect(Math.abs(du)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(dv)).toBeLessThanOrEqual(0.5);
    }
  });

  it('caps E at the offset-table capacity', () => {
    expect(jitterOffsets(2, 99)).toHaveLength(ENSEMBLE_E_MAX);
  });

  it('unknown pattern falls back to centre samples (never throws)', () => {
    const o = jitterOffsets(7, 4);
    expect(o).toHaveLength(4);
    for (const x of o) expect(x).toEqual({ du: 0, dv: 0 });
  });
});
