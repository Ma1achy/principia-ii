import { describe, it, expect } from 'vitest';
import {
  tileCountAtDepth, tileSpan, reachedF32Floor,
} from '@/quadtree/pyramid.js';

describe('pyramid arithmetic', () => {
  it('depth 0 has 1 tile, depth k has 4^k', () => {
    expect(tileCountAtDepth(0)).toBe(1);
    expect(tileCountAtDepth(3)).toBe(64);
    expect(tileCountAtDepth(10)).toBe(1024 * 1024);
  });

  it('tileSpan halves with depth', () => {
    expect(tileSpan(0)).toBe(1);
    expect(tileSpan(2)).toBeCloseTo(0.25, 12);
  });
});

describe('reachedF32Floor', () => {
  it('is false at shallow depth', () => {
    expect(reachedF32Floor(5, 16)).toBe(false);
  });

  it('is true once sample spacing drops below ~1e-6', () => {
    // halfWidth = 2^-(z+1); spacing = halfWidth / 8 (with N=16). Solve
    // 2^-(z+5) < 1e-6 → z > ~15. Pick a deep value to be safe.
    expect(reachedF32Floor(25, 16)).toBe(true);
  });
});
