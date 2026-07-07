import { describe, it, expect } from 'vitest';
import { run } from '@/integrate/run.js';

/**
 * Burrau 3-4-5 — legs-swapped VARIANT — integrator physical regression,
 * NOT a precision golden and NOT the canonical Burrau IC.
 *
 * M11's reconciliation against the spec (eq. burrau_positions, matching
 * Szebehely & Peters' coordinates) found this fixture has the legs
 * swapped: canonically mass 4/12 sits at (0.6, 0) and mass 3/12 at
 * (0, 0.8) — each mass opposite its own side. The CANONICAL IC at f64
 * dips below r_coll = 1e-4 at t ≈ 4.90 (a converged, tolerance-robust
 * COLLISION at project thresholds — see test/golden/burrau_family_345);
 * the famous escape needs close-encounter regularization — landed as
 * G19's LogH path; the precision golden is test/golden/burrau_regularized.
 * The non-regularized symplectic path blows up on it (drift ~1e+4).
 *
 * This swapped variant is KEPT as an integrator regression because its
 * encounter history is mild enough for the fixed-substep path to
 * complete with a stable outcome and pinned drift envelope: the run
 * completes (no NaN / substep blow-up), the lightest body escapes, and
 * drift stays within the empirically observed envelope. (Its qualitative
 * outcome — lightest ejected — happens to match the classical result.)
 */
describe('Burrau 3-4-5 legs-swapped variant: integrator regression', () => {
  it('completes and ejects the lightest body', () => {
    // Legs-swapped variant, 0-indexed: masses (5, 4, 3)/12; body 0 at the
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
