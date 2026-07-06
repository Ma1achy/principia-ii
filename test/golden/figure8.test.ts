import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from '@/integrate/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(path.join(here, 'figure8_reference.json'),
                                    'utf-8'));

/**
 * Strict golden: the figure-8 choreography is smooth (min pair separation
 * ≈ 0.69, no substepping) and linearly stable, so the leapfrog resolves it to
 * reference accuracy. Any change to forces / KDK / Yoshida / COM projection
 * that shifts the trajectory shows up here immediately.
 */
describe('figure-8 choreography golden', () => {
  it('reproduces the pinned reference to within tolerance', () => {
    const s0 = { m: REF.ic.m, r: REF.ic.r, p: REF.ic.p, t: 0 };

    const result = run(s0 as any, {
      integrator: REF.params.integrator,
      dtMacro: REF.params.dt,
      THorizon: REF.params.THorizon,
      rColl: REF.params.rColl,
      REsc: REF.params.REsc,
      kEsc: REF.params.kEsc,
      substep: { rSub: REF.params.rSub,
                 gammaSub: REF.params.gammaSub,
                 NMax: REF.params.NMax },
    }, { checkpoints: 220 });

    // 1. Energy drift bound (measured 8.5e-13 at generation time).
    expect(result.diagnostics.energyDrift)
      .toBeLessThan(REF.energy_drift_max);

    // 2. Terminal class agreement: bounded for the full horizon.
    expect(result.terminal.kind).toBe(REF.expected_terminal.kind);

    // 3. Checkpoint position agreement (linear interp from the trace).
    const trace = result.trace!;
    for (const cp of REF.checkpoints) {
      const interp = interpolateAtT(trace, cp.t);
      expect(interp).not.toBeNull();
      for (const k of [0, 1, 2] as const) {
        const dx = interp!.r[k]![0]! - cp[`r${k}`][0];
        const dy = interp!.r[k]![1]! - cp[`r${k}`][1];
        expect(Math.hypot(dx, dy)).toBeLessThan(REF.tolerance_position);
      }
    }
  }, 60000);
});

function interpolateAtT(trace: any[], t: number) {
  for (let i = 0; i < trace.length - 1; i++) {
    if (trace[i].t <= t && trace[i+1].t >= t) {
      const a = trace[i], b = trace[i+1];
      const u = (t - a.t) / (b.t - a.t);
      return {
        r: [
          [a.r[0][0]*(1-u) + b.r[0][0]*u, a.r[0][1]*(1-u) + b.r[0][1]*u],
          [a.r[1][0]*(1-u) + b.r[1][0]*u, a.r[1][1]*(1-u) + b.r[1][1]*u],
          [a.r[2][0]*(1-u) + b.r[2][0]*u, a.r[2][1]*(1-u) + b.r[2][1]*u],
        ],
      };
    }
  }
  return null;
}
