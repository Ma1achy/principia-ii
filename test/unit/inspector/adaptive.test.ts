import { describe, it, expect } from 'vitest';
import { tryStep } from '@/inspector/adaptive.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('adaptive step control', () => {
  it('accepts a small step on a smooth orbit', () => {
    const s = {
      m: [0.5, 0.5, 1e-12] as const,
      r: [[0.5,0], [-0.5,0], [1e6,0]] as const,
      p: [[0, 0.25],[0,-0.25],[0,0]] as const, t: 0,
    };
    const r = tryStep(s as any, 1e-4, RK45_DEFAULTS);
    expect(r.accepted).toBe(true);
    expect(r.hNext).toBeGreaterThanOrEqual(1e-4);
  });

  it('rejects an over-large step with stiff-ish dynamics', () => {
    const s = {
      m: [1/3, 1/3, 1/3] as const,
      r: [[0,0], [1e-3, 0], [0, 1]] as const,    // very tight inner pair
      p: [[0,0],[0,0],[0,0]] as const, t: 0,
    };
    const r = tryStep(s as any, 1e-1, RK45_DEFAULTS);
    expect(r.accepted).toBe(false);
    expect(r.hNext).toBeLessThan(1e-1);
  });
});
