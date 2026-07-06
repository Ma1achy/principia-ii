import { describe, it, expect } from 'vitest';
import { applyTilt, reorthonormalise, setTilts } from '@/interact/tilt.js';
import { defaultViewState } from '@/interact/view_state.js';
import { unitE8, dot8, norm8 } from '@/math/vec.js';

describe('applyTilt', () => {
  it('τ = 0 returns the base vector', () => {
    const q = applyTilt(unitE8(0), 3, 0);
    expect(q).toEqual(unitE8(0));
  });

  it('τ = π/2 returns the target axis', () => {
    const q = applyTilt(unitE8(0), 3, Math.PI/2);
    for (let i = 0; i < 8; i++) {
      if (i === 3) expect(q[i]).toBeCloseTo(1, 12);
      else expect(q[i]).toBeCloseTo(0, 12);
    }
  });

  it('τ = -π/2 flips sign of the target axis', () => {
    const q = applyTilt(unitE8(0), 3, -Math.PI/2);
    expect(q[3]).toBeCloseTo(-1, 12);
  });

  it('replaces, does not accumulate', () => {
    // Starting from a default z=0 view, set tilt1 to 30° then 0°: the
    // resulting q1 should be exactly e_h again.
    let v = defaultViewState();
    v = setTilts(v, { tilt1: Math.PI/6, tilt1Target: 3 });
    v = setTilts(v, { tilt1: 0,         tilt1Target: 3 });
    expect(v.q1).toEqual(unitE8(v.hAxis));
  });
});

describe('reorthonormalise', () => {
  it('produces orthonormal q1, q2 for any non-degenerate input', () => {
    const cases: [any, any][] = [
      [unitE8(0), unitE8(1)],
      [applyTilt(unitE8(0), 2, 0.4), applyTilt(unitE8(1), 3, 0.7)],
      [applyTilt(unitE8(0), 2, 0.5), applyTilt(unitE8(1), 2, 0.5)],     // same target
    ];
    for (const [a, b] of cases) {
      const [q1, q2] = reorthonormalise(a, b);
      expect(norm8(q1)).toBeCloseTo(1, 12);
      expect(norm8(q2)).toBeCloseTo(1, 12);
      expect(Math.abs(dot8(q1, q2))).toBeLessThan(1e-12);
    }
  });

  it('falls back to a substitute axis when q2_perp is degenerate', () => {
    // Both vectors point along e_3.
    const q1 = unitE8(3);
    const q2 = unitE8(3);
    const [, q2n] = reorthonormalise(q1, q2);
    // The substitute must be orthogonal to q1 and unit-length.
    expect(Math.abs(dot8(q1, q2n))).toBeLessThan(1e-12);
    expect(norm8(q2n)).toBeCloseTo(1, 12);
  });
});

describe('setTilts', () => {
  it('preserves orthogonality across tilt sweeps', () => {
    let v = defaultViewState();
    for (let i = 0; i <= 30; i++) {
      const tau = (i / 30) * (Math.PI / 2);
      v = setTilts(v, { tilt1: tau, tilt1Target: 5 });
      expect(Math.abs(dot8(v.q1, v.q2))).toBeLessThan(1e-12);
    }
  });
});
