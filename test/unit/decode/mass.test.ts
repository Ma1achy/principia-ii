import { describe, it, expect } from 'vitest';
import {
  decodeMassSoftmax, decodeMassSimplex, inverseMass,
} from '@/decode/mass.js';

describe('decodeMassSoftmax / inverseMass', () => {
  it('round-trips for non-saturated points', () => {
    for (const [z1, z2] of [
      [0, 0], [0.3, -0.5], [-1.2, 1.7], [0.01, 0.02],
    ] as [number, number][]) {
      const m = decodeMassSoftmax(z1, z2, 100);   // muMax large → tanh ≈ id
      const back = inverseMass(m, 100, 1e-6);
      expect(back.clamped).toBe(false);
      // Re-decode and compare masses.
      const m2 = decodeMassSoftmax(back.zMu1, back.zMu2, 100);
      for (let i = 0; i < 3; i++) expect(m2[i]!).toBeCloseTo(m[i]!, 9);
    }
  });

  it('flags clamping for saturated points', () => {
    const m = decodeMassSoftmax(50, 0, 5);        // strongly saturated
    const back = inverseMass(m, 5, 1e-6);
    expect(back.clamped).toBe(true);
  });
});

describe('decodeMassSimplex', () => {
  it('respects the interior buffer', () => {
    const m = decodeMassSimplex(0.001, 0.001, 1e-3);
    expect(m[0]).toBeGreaterThan(1e-3);
    expect(m[1]).toBeGreaterThan(1e-3);
    expect(m[2]).toBeGreaterThan(1e-3);
    expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
  });
});
