import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInspector } from '@/inspector/run.js';
import { inspectorMatch } from '@/inspector/match_integrator.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';
import type { TrajState } from '@/math/types.js';

/**
 * The smooth-orbit fixture must actually BE smooth: the doc's original
 * "equal-mass equilateral rest start" is the classic free-fall
 * triple-collapse configuration (Lagrange central configuration, zero
 * velocity) — it collapses homothetically and ejects a body. The M1
 * figure-8 fixture is the genuine smooth bounded orbit.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(
  readFileSync(path.join(here, 'figure8_reference.json'), 'utf-8'),
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

describe('match-integrator t_end agrees with adaptive on smooth orbits', () => {
  it('agrees within 1 ms over T = 5 on the figure-8 orbit', () => {
    const s0 = figure8IC();
    const adaptive = runInspector(s0, { ...RK45_DEFAULTS, THorizon: 5 });
    const matched  = inspectorMatch(s0, {
      integrator: 'yoshida4', dtMacro: 1e-3, THorizon: 5,
      NMax: 64, rSub: 0.05, gammaSub: 1.5,
      rColl: 1e-4, REsc: 10, kEsc: 8,
    });
    expect(adaptive.outcome).toBe('bounded');
    expect(matched.outcome).toBe('bounded');
    expect(Math.abs(adaptive.tEnd - matched.tEnd)).toBeLessThan(1e-3);
  });
});
