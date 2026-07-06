import { describe, it, expect } from 'vitest';
import { benettinFTLE } from '@/metrics/ftle.js';
import { kdkMacroStep } from '@/integrate/kdk.js';
import type { TrajState } from '@/math/types.js';

const sp = { rSub: 0.05, gammaSub: 1.5, NMax: 64 };

function regularOrbit(): TrajState {
  // Equal-mass binary on a circular orbit; third body far away and inert.
  // Circular momentum at separation 1 with m ≈ 1/2 each: v² = F·r/m
  // = 0.25·0.5/0.5 → v = 0.5, p = m·v ≈ 0.25. (The doc's 0.7071 gave an
  // UNBOUND pair — E > 0 — which is not a regular reference orbit.)
  return {
    m: [0.4999, 0.4999, 0.0002] as const,
    r: [[0.5, 0], [-0.5, 0], [50, 0]] as const,
    p: [[0, 0.25], [0, -0.25], [0, 0]] as const,
    t: 0,
  };
}

function burrauScattering(): TrajState {
  // Legs-swapped Burrau-family variant at rest (M1's regression fixture;
  // see burrau.test.ts). Kept: any strongly chaotic IC serves this test,
  // and this one's FTLE contrast is already calibrated.
  const m = [5/12, 4/12, 3/12] as const;
  return {
    m, r: [[0,0], [0.8, 0], [0, 0.6]],
    p: [[0,0],[0,0],[0,0]] as const, t: 0,
  };
}

function runBenettin(ic: TrajState, T: number, delta0: number) {
  let base = ic;
  let shadow: TrajState = perturb(ic, delta0);

  return benettinFTLE(
    {
      step: () => {
        base   = kdkMacroStep(base,   1e-3, sp).state;
        shadow = kdkMacroStep(shadow, 1e-3, sp).state;
      },
      separation: () => sep(base, shadow),
      renormalise: () => { shadow = renorm(base, shadow, delta0); },
    },
    T, 1e-3, 50, delta0,
  );
}

function perturb(s: TrajState, delta: number): TrajState {
  return {
    m: s.m, t: s.t,
    r: [
      [s.r[0][0] + delta, s.r[0][1]],
      [s.r[1][0]        , s.r[1][1]],
      [s.r[2][0]        , s.r[2][1]],
    ],
    p: s.p,
  };
}

function sep(a: TrajState, b: TrajState): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const dx = b.r[i]![0] - a.r[i]![0];
    const dy = b.r[i]![1] - a.r[i]![1];
    s += a.m[i]! * (dx*dx + dy*dy);
    const dpx = b.p[i]![0] - a.p[i]![0];
    const dpy = b.p[i]![1] - a.p[i]![1];
    s += (dpx*dpx + dpy*dpy) / a.m[i]!;
  }
  return Math.sqrt(s);
}

function renorm(base: TrajState, shadow: TrajState, delta0: number): TrajState {
  const d = sep(base, shadow); if (d === 0) return shadow;
  const scale = delta0 / d;
  return {
    m: shadow.m, t: shadow.t,
    r: [
      [base.r[0][0] + (shadow.r[0][0] - base.r[0][0]) * scale,
       base.r[0][1] + (shadow.r[0][1] - base.r[0][1]) * scale],
      [base.r[1][0] + (shadow.r[1][0] - base.r[1][0]) * scale,
       base.r[1][1] + (shadow.r[1][1] - base.r[1][1]) * scale],
      [base.r[2][0] + (shadow.r[2][0] - base.r[2][0]) * scale,
       base.r[2][1] + (shadow.r[2][1] - base.r[2][1]) * scale],
    ],
    p: [
      [base.p[0][0] + (shadow.p[0][0] - base.p[0][0]) * scale,
       base.p[0][1] + (shadow.p[0][1] - base.p[0][1]) * scale],
      [base.p[1][0] + (shadow.p[1][0] - base.p[1][0]) * scale,
       base.p[1][1] + (shadow.p[1][1] - base.p[1][1]) * scale],
      [base.p[2][0] + (shadow.p[2][0] - base.p[2][0]) * scale,
       base.p[2][1] + (shadow.p[2][1] - base.p[2][1]) * scale],
    ],
  };
}

describe('FTLE: chaotic ≫ regular', () => {
  it('Burrau scattering ≥ 10× regular binary FTLE', () => {
    const reg = runBenettin(regularOrbit(),  20, 1e-8);
    const cha = runBenettin(burrauScattering(), 20, 1e-8);
    expect(reg.valid).toBe(true);
    expect(cha.valid).toBe(true);
    expect(cha.lambda).toBeGreaterThan(10 * reg.lambda);
  }, 60_000);
});
