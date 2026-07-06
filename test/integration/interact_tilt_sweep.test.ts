import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { setTilts } from '@/interact/tilt.js';
import { dot8 } from '@/math/vec.js';

describe('tilt sweep into a hidden dimension', () => {
  it('produces a smooth sequence of orthonormal slice bases', () => {
    let v = defaultViewState();
    const samples: { tilt: number; ortho: number; q1norm: number; q2norm: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const tau = (i / 60) * (Math.PI / 2);
      v = setTilts(v, { tilt1: tau, tilt1Target: 5 });
      const q1 = v.q1, q2 = v.q2;
      const q1n = Math.hypot(...q1);
      const q2n = Math.hypot(...q2);
      samples.push({
        tilt: tau,
        ortho: Math.abs(dot8(q1, q2)),
        q1norm: q1n, q2norm: q2n,
      });
    }
    for (const s of samples) {
      expect(s.ortho).toBeLessThan(1e-12);
      expect(s.q1norm).toBeCloseTo(1, 12);
      expect(s.q2norm).toBeCloseTo(1, 12);
    }
  });
});
