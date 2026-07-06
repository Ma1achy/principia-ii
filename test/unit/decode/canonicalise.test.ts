import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/decode/canonicalise.js';

describe('canonicalise', () => {
  it('is idempotent', () => {
    const s = {
      r: [[0.5, 0], [-0.5, 0], [0, 0.7]] as const,
      p: [[0, 0.1], [0, -0.1], [0.1, 0]] as const,
      m: [1/3, 1/3, 1/3] as const, t: 0,
    };
    const a = canonicalise(s, { deltaLambda: 1e-12, rColl: 1e-4 }).state;
    const b = canonicalise(a, { deltaLambda: 1e-12, rColl: 1e-4 }).state;
    for (let i = 0; i < 3; i++) {
      expect(b.r[i]![0]).toBeCloseTo(a.r[i]![0], 14);
      expect(b.r[i]![1]).toBeCloseTo(a.r[i]![1], 14);
      expect(b.p[i]![0]).toBeCloseTo(a.p[i]![0], 14);
      expect(b.p[i]![1]).toBeCloseTo(a.p[i]![1], 14);
    }
  });

  it('detects collision-at-t=0', () => {
    const s = {
      r: [[0,0], [1e-5, 0], [10, 10]] as const,
      p: [[0,0],[0,0],[0,0]] as const,
      m: [1/3, 1/3, 1/3] as const, t: 0,
    };
    const c = canonicalise(s, { deltaLambda: 1e-12, rColl: 1e-4 });
    expect(c.terminal?.kind).toBe('COLLISION_T0');
  });
});
