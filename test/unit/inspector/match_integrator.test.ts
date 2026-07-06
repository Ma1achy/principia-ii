import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectorMatch } from '@/inspector/match_integrator.js';
import type { TrajState } from '@/math/types.js';

// Smooth bounded fixture: the M1 figure-8 (an equilateral REST start
// would free-fall collapse and eject — not bounded).
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(
  readFileSync(path.join(here, '../../golden/figure8_reference.json'), 'utf-8'),
) as { ic: { m: number[]; r: number[][]; p: number[][] } };

function figure8IC(): TrajState {
  const [m0, m1, m2] = REF.ic.m as [number, number, number];
  return {
    m: [m0, m1, m2],
    r: REF.ic.r as unknown as TrajState['r'],
    p: REF.ic.p as unknown as TrajState['p'],
    t: 0,
  };
}

describe('match-integrator mode', () => {
  it('Yoshida-4 reproduces the run() result with the same params', () => {
    const r = inspectorMatch(figure8IC(), {
      integrator: 'yoshida4', dtMacro: 1e-3, THorizon: 5,
      NMax: 64, rSub: 0.05, gammaSub: 1.5,
      rColl: 1e-4, REsc: 10, kEsc: 8,
    });
    expect(r.outcome).toBe('bounded');
    // The fixed-step run() overshoots the horizon by at most one macro
    // step (fp accumulation of 5000 × 1e-3 lands just under 5.0).
    expect(r.tEnd).toBeGreaterThanOrEqual(5);
    expect(r.tEnd).toBeLessThan(5 + 1e-3);
    expect(r.nSteps).toBeGreaterThan(0);   // checkpointed trace populated
  });
});
