import { describe, it, expect } from 'vitest';
import {
  ZERO2, add2, sub2, dot2, norm2, crossZ, J, normalize2,
  ZERO3, cross3, norm3, normalize3,
  ZERO8, add8, scale8, dot8, norm8, normalize8, unitE8, v8,
} from '@/math/vec.js';

describe('Vec2 algebra', () => {
  it('add2 / sub2 are inverses', () => {
    const a = [3, -2] as const, b = [1, 4] as const;
    expect(sub2(add2(a, b), b)).toEqual(a);
  });

  it('dot2 with self equals norm²', () => {
    const a = [3, 4] as const;
    expect(dot2(a, a)).toBe(25);
    expect(norm2(a)).toBe(5);
  });

  it('crossZ is anti-symmetric', () => {
    const a = [1, 2] as const, b = [3, 4] as const;
    expect(crossZ(a, b)).toBe(-crossZ(b, a));
  });

  it('J ∘ J = -I', () => {
    const v = [3.7, -1.2] as const;
    const Jv = J(v), JJv = J(Jv);
    expect(JJv[0]).toBeCloseTo(-v[0], 15);
    expect(JJv[1]).toBeCloseTo(-v[1], 15);
  });

  it('normalize2 of zero is zero (no NaN)', () => {
    expect(normalize2(ZERO2)).toEqual(ZERO2);
  });
});

describe('Vec3 algebra', () => {
  it('cross3 is right-handed for standard basis', () => {
    expect(cross3([1,0,0], [0,1,0])).toEqual([0, 0, 1]);
  });

  it('cross3(a, a) is zero', () => {
    const a = [2, -3, 7] as const;
    expect(cross3(a, a)).toEqual([0, 0, 0]);
  });

  it('normalize3 preserves direction', () => {
    const u = normalize3([3, 4, 0]);
    expect(u[0]).toBeCloseTo(0.6, 12);
    expect(u[1]).toBeCloseTo(0.8, 12);
    expect(u[2]).toBe(0);
    expect(norm3(u)).toBeCloseTo(1, 12);
  });

  it('normalize3 of zero falls back to (0,0,1)', () => {
    expect(normalize3(ZERO3)).toEqual([0, 0, 1]);
  });
});

describe('Vec8 algebra', () => {
  it('unitE8 has length 1 and the right component set', () => {
    for (let k = 0; k < 8; k++) {
      const e = unitE8(k);
      expect(norm8(e)).toBe(1);
      expect(e[k]).toBe(1);
    }
  });

  it('add8 / scale8 distribute', () => {
    const a = v8(1,2,3,4,5,6,7,8);
    const b = v8(8,7,6,5,4,3,2,1);
    const lhs = scale8(add8(a, b), 2);
    const rhs = add8(scale8(a, 2), scale8(b, 2));
    for (let i = 0; i < 8; i++) expect(lhs[i]!).toBeCloseTo(rhs[i]!, 15);
  });

  it('dot8 of orthogonal basis vectors is zero', () => {
    expect(dot8(unitE8(0), unitE8(3))).toBe(0);
  });

  it('normalize8 of zero throws', () => {
    expect(() => normalize8(ZERO8)).toThrow();
  });
});
