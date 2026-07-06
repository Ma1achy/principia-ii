import { describe, it, expect } from 'vitest';
import { projectCOM } from '@/integrate/com.js';

describe('projectCOM', () => {
  it('removes COM offset and total momentum', () => {
    const s = {
      r: [[1,0],[2,1],[3,2]] as const,
      p: [[1,1],[1,1],[1,1]] as const,        // total p = (3,3) ≠ 0
      m: [0.3, 0.3, 0.4] as const, t: 0,
    };
    const out = projectCOM(s);
    const Rx = 0.3*out.r[0][0] + 0.3*out.r[1][0] + 0.4*out.r[2][0];
    const Ry = 0.3*out.r[0][1] + 0.3*out.r[1][1] + 0.4*out.r[2][1];
    const Px = out.p[0][0] + out.p[1][0] + out.p[2][0];
    const Py = out.p[0][1] + out.p[1][1] + out.p[2][1];
    expect(Rx).toBeCloseTo(0, 14);
    expect(Ry).toBeCloseTo(0, 14);
    expect(Px).toBeCloseTo(0, 14);
    expect(Py).toBeCloseTo(0, 14);
  });

  it('is idempotent', () => {
    const s = {
      r: [[1,0],[2,1],[3,2]] as const,
      p: [[1,1],[1,1],[1,1]] as const,
      m: [0.3, 0.3, 0.4] as const, t: 0,
    };
    const a = projectCOM(s);
    const b = projectCOM(a);
    for (let i = 0; i < 3; i++) {
      expect(b.r[i]![0]).toBeCloseTo(a.r[i]![0], 14);
      expect(b.r[i]![1]).toBeCloseTo(a.r[i]![1], 14);
      expect(b.p[i]![0]).toBeCloseTo(a.p[i]![0], 14);
      expect(b.p[i]![1]).toBeCloseTo(a.p[i]![1], 14);
    }
  });
});
