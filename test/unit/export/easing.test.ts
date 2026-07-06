import { describe, it, expect } from 'vitest';
import { ease } from '@/export/easing.js';

describe('easing functions', () => {
  it('linear is identity on [0, 1]', () => {
    expect(ease('linear', 0)).toBe(0);
    expect(ease('linear', 0.5)).toBe(0.5);
    expect(ease('linear', 1)).toBe(1);
  });

  it('ease_in_out is symmetric around 0.5', () => {
    expect(ease('ease_in_out', 0.25)).toBeCloseTo(1 - ease('ease_in_out', 0.75), 12);
  });

  it('hold returns 0 for any t', () => {
    for (const t of [0, 0.25, 0.5, 1]) expect(ease('hold', t)).toBe(0);
  });

  it('step jumps to 1 only at t = 1', () => {
    expect(ease('step', 0.5)).toBe(0);
    expect(ease('step', 0.999)).toBe(0);
    expect(ease('step', 1)).toBe(1);
  });

  it('log is slow at the start, fast at the end', () => {
    expect(ease('log', 0.1)).toBeLessThan(0.3);
    expect(ease('log', 0.9)).toBeGreaterThan(0.95);
  });
});
