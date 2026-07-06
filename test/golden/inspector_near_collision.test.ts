import { describe, it, expect } from 'vitest';
import { runInspector } from '@/inspector/run.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('near-collision chase', () => {
  it('classifies a Burrau IC before timeout', () => {
    // Burrau (3, 4, 5) re-indexed.
    const m = [5/12, 4/12, 3/12] as const;
    const s0 = {
      r: [[0,0], [0.8, 0], [0, 0.6]] as const,
      p: [[0,0],[0,0],[0,0]] as const,
      m, t: 0,
    };
    const r = runInspector(s0 as any, {
      ...RK45_DEFAULTS, THorizon: 80, hMin: 1e-12, fullTrace: false,
    });
    // Adaptive RK45 should chase the close encounters down and CLASSIFY —
    // no timeout, no h_min failure. 'collision' is a legitimate (indeed
    // likely) outcome: with hMin=1e-12 the chase resolves the encounter
    // below r_coll=1e-4 instead of giving up the way the GPU's
    // fixed-budget path does with MAX_SUBSTEPS.
    expect(['escape', 'bounded', 'collision']).toContain(r.outcome);
    expect(r.dMin).toBeLessThan(0.1);
  }, 60_000);
});
