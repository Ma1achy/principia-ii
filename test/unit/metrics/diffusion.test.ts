import { describe, it, expect } from 'vitest';
import { fitOmega, diffusion } from '@/metrics/diffusion.js';

describe('windowed frequency fit', () => {
  it('recovers the slope of a perfect line', () => {
    const t  = [0, 1, 2, 3, 4];
    const tt = t.map(x => 2.5 * x + 7);
    expect(fitOmega(t, tt)).toBeCloseTo(2.5, 12);
  });

  it('returns null for too-few samples', () => {
    expect(fitOmega([0, 1], [0, 1])).toBeNull();
  });
});

describe('diffusion sentinel', () => {
  it('returns -1 when one window has no samples', () => {
    const T = 80;
    // Samples only inside W_1 = [20, 40]; W_2 = [40, 60] stays empty.
    const t1 = [22, 24, 26, 28, 30];
    const tt1 = t1.map(x => 0.1 * x);
    expect(diffusion(t1, tt1, T).value).toBe(-1);
  });

  it('returns the absolute slope difference for a deliberately ramped frequency', () => {
    const T = 80;
    const t: number[] = [];
    const tt: number[] = [];
    // Gradually accelerate: phase = 0.1 t  for t < 40, phase = 0.3 t - 8 for t ≥ 40.
    for (let i = 0; i < 80; i++) {
      const x = i + 0.5;
      t.push(x);
      tt.push(x < 40 ? 0.1 * x : 0.3 * x - 8);
    }
    const d = diffusion(t, tt, T);
    expect(d.value).toBeCloseTo(0.2, 2);
  });
});
