import { describe, it, expect } from 'vitest';
import { run } from '@/integrate/run.js';

/**
 * Burrau 3-4-5 (Pythagorean problem) — physical validation, NOT a precision
 * golden.
 *
 * The published outcome (Szebehely & Peters 1967) is that after a sequence of
 * close encounters the lightest body (mass 3/12, our body 2) is ejected,
 * leaving the two heavier bodies as a binary. Our non-regularized adaptive
 * leapfrog reproduces that qualitative outcome, but the trajectory passes
 * through r_min ~ 1e-3–1e-4 close approaches that put it firmly in the
 * "numerically suspect" drift regime (≥ 1e-4, per the numerics skill) — the
 * escape *time* is not converged across dt and checkpoint positions cannot be
 * pinned. Resolving Burrau to reference accuracy requires close-encounter
 * regularization (KS / Levi-Civita), tracked as milestone G19.
 *
 * So this test asserts exactly the robust, literature-matching facts and no
 * more: the run completes (no NaN / substep blow-up), the lightest body
 * escapes, and drift stays within the empirically observed envelope.
 */
describe('Burrau 3-4-5 physical validation', () => {
  it('ejects the lightest body, matching Szebehely & Peters', () => {
    // Classical Burrau setup, 0-indexed: masses (5, 4, 3)/12; body 0 at the
    // right angle, body 1 at (0.8, 0), body 2 at (0, 0.6); all at rest.
    const m = [5/12, 4/12, 3/12] as const;
    const s0 = {
      m,
      r: [[0, 0], [0.8, 0], [0, 0.6]] as const,
      p: [[0, 0], [0, 0], [0, 0]] as const,
      t: 0,
    };

    const result = run(s0 as any, {
      integrator: 'yoshida6',
      dtMacro: 5e-5,
      THorizon: 80,
      rColl: 1e-4,
      REsc: 10,
      kEsc: 8,
      substep: { rSub: 0.05, gammaSub: 1.5, NMax: 8192 },
    });

    // 1. The run reaches a physical terminal (no NaN, no substep saturation).
    expect(result.terminal.kind).toBe('ESCAPE');

    // 2. The escaping body is the lightest (body 2, mass 3/12).
    if (result.terminal.kind === 'ESCAPE') {
      expect(result.terminal.body).toBe(2);
    }

    // 3. Drift stays inside the observed envelope for this config (~2e-2).
    //    This is a regression tripwire, not an accuracy claim.
    expect(result.diagnostics.energyDrift).toBeLessThan(5e-2);

    // 4. Lz is conserved to high precision throughout (rotational symmetry is
    //    exact for the leapfrog, so this SHOULD hold even through encounters).
    expect(result.diagnostics.lzDrift).toBeLessThan(1e-6);
  }, 120000);
});
