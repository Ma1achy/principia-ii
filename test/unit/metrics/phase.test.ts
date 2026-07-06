import { describe, it, expect } from 'vitest';
import { phaseFromN, unwrapPhase } from '@/metrics/phase.js';

describe('phase + unwrap', () => {
  it('phase of (1, 0, 0) is 0', () => {
    expect(phaseFromN([1, 0, 0])).toBe(0);
  });
  it('phase of (0, 1, 0) is π/2', () => {
    expect(phaseFromN([0, 1, 0])).toBeCloseTo(Math.PI/2, 12);
  });

  it('handles a forward sweep across the antimeridian', () => {
    // From just below π to just above -π (winding once forward).
    const tt = unwrapPhase(Math.PI - 0.01, -Math.PI + 0.01, 0);
    expect(tt).toBeCloseTo(0.02, 6);
  });

  it('handles a backward sweep', () => {
    const tt = unwrapPhase(-Math.PI + 0.01, Math.PI - 0.01, 0);
    expect(tt).toBeCloseTo(-0.02, 6);
  });

  it('accumulates over many wraps', () => {
    let tt = 0;
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const cur = (((i + 1) * 0.5 + Math.PI) % (2 * Math.PI)) - Math.PI;
      tt = unwrapPhase(prev, cur, tt);
      prev = cur;
    }
    expect(tt).toBeCloseTo(50, 1);   // total angular travel
  });
});
