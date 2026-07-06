import { describe, it, expect } from 'vitest';
import { cubehelix, viridis } from '@/render/palettes.js';

describe('cubehelix', () => {
  it('starts dark and ends light', () => {
    const a = cubehelix(0.0);
    const b = cubehelix(1.0);
    const lumA = 0.299*a[0] + 0.587*a[1] + 0.114*a[2];
    const lumB = 0.299*b[0] + 0.587*b[1] + 0.114*b[2];
    expect(lumB).toBeGreaterThan(lumA);
  });
  it('output is in [0, 1]', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const c = cubehelix(t);
      for (const x of c) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('viridis', () => {
  it('endpoints match the canonical first / last stops', () => {
    expect(viridis(0)[0]).toBeCloseTo(0.267, 3);
    expect(viridis(1)[2]).toBeCloseTo(0.144, 3);
  });
});
