import { describe, it, expect } from 'vitest';
import { rotation, applyR, reflectX } from '@/math/rotate.js';
import { norm2 } from '@/math/vec.js';

describe('rotation', () => {
  it('preserves length', () => {
    const v = [3, 4] as const;
    for (const theta of [0, 0.1, 1, Math.PI/2, Math.PI, 2*Math.PI - 1e-9]) {
      const Rv = applyR(rotation(theta), v);
      expect(norm2(Rv)).toBeCloseTo(5, 12);
    }
  });

  it('R(π/2) maps (1,0) to (0,1)', () => {
    const Rv = applyR(rotation(Math.PI/2), [1, 0]);
    expect(Rv[0]).toBeCloseTo(0, 14);
    expect(Rv[1]).toBeCloseTo(1, 14);
  });

  it('R(-θ) ∘ R(θ) = identity', () => {
    const v = [0.7, -1.3] as const;
    const out = applyR(rotation(-0.4), applyR(rotation(0.4), v));
    expect(out[0]).toBeCloseTo(v[0], 12);
    expect(out[1]).toBeCloseTo(v[1], 12);
  });
});

describe('reflectX', () => {
  it('flips the y component', () => {
    expect(reflectX([2, -3])).toEqual([2, 3]);
  });
  it('is involutive', () => {
    const v = [1.7, -0.4] as const;
    expect(reflectX(reflectX(v))).toEqual(v);
  });
});
