import { describe, it, expect } from 'vitest';
import {
  massPerturbationFromBurrau,
  energyIncreaseAtFixedLz,
  burrauToUnconstrained,
} from '@/interact/named_directions.js';
import { norm8, unitE8 } from '@/math/vec.js';

describe('named compound directions', () => {
  it('mass-perturbation from Burrau is unit-length and nonzero in mass slots only', () => {
    const m = [5/12, 4/12, 3/12] as const;
    const dir = massPerturbationFromBurrau(m);
    expect(norm8(dir)).toBeCloseTo(1, 12);
    for (let i = 0; i < 6; i++) expect(dir[i]).toBe(0);
    // Sign: pulling toward (1/3, 1/3, 1/3) means z_μ1, z_μ2 each move
    // toward 0. For our re-indexed (5/12, 4/12, 3/12), m_0 = 5/12 is the
    // largest mass, so μ_1 = log(m_1/m_0) < 0 and μ_2 = log(m_2/m_0) < 0;
    // direction "toward equal" pushes them toward 0, so positive.
    expect(dir[6]).toBeGreaterThan(0);
    expect(dir[7]).toBeGreaterThan(0);
  });

  it('mass-perturbation at equal masses falls back to unit e_6', () => {
    const dir = massPerturbationFromBurrau([1/3, 1/3, 1/3]);
    expect(dir).toEqual(unitE8(6));
  });

  it('energy-increase-at-fixed-Lz is unit e_2', () => {
    expect(energyIncreaseAtFixedLz()).toEqual(unitE8(2));
  });

  it('burrauToUnconstrained accepts indices 2..7', () => {
    expect(() => burrauToUnconstrained(1)).toThrow();
    expect(burrauToUnconstrained(5)).toEqual(unitE8(5));
  });
});
