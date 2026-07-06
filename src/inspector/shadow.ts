import type { TrajState } from '@/math/types.js';
import type { RK45Opts } from './types.js';
import { tryStep } from './adaptive.js';

/**
 * Run the inspector with a Benettin-style shadow trajectory at distance
 * δ_0 to estimate the FTLE. Returns the FTLE and the renormalisation
 * count.
 */
export function inspectorWithShadow(
  s0: TrajState, opts: RK45Opts, delta0 = 1e-8,
): { lambda: number; renorms: number; valid: boolean } {
  let base = s0;
  let shadow: TrajState = perturb(s0, delta0);
  let h = opts.hInit;
  let S = 0;
  let renorms = 0;
  let stepsSinceRenorm = 0;
  const RENORM_EVERY = 50;

  while (base.t < opts.THorizon) {
    const a = tryStep(base, h, opts);
    if (!a.accepted) {
      if (h <= opts.hMin) return { lambda: 0, renorms, valid: false };
      h = a.hNext;
      continue;
    }
    base = a.s;
    // Step the shadow with the same h (or its own adaptive — for
    // simplicity we use the same h here; production may decouple).
    const b = tryStep(shadow, h, opts);
    shadow = b.accepted ? b.s : shadow;
    h = a.hNext;
    stepsSinceRenorm++;

    if (stepsSinceRenorm >= RENORM_EVERY) {
      const dj = sep(base, shadow);
      if (!Number.isFinite(dj) || dj === 0) {
        return { lambda: 0, renorms, valid: false };
      }
      S += Math.log(dj / delta0);
      shadow = renorm(base, shadow, delta0);
      renorms++;
      stepsSinceRenorm = 0;
    }
  }
  return { lambda: S / Math.max(base.t - s0.t, 1e-30), renorms, valid: renorms > 0 };
}

function perturb(s: TrajState, d: number): TrajState {
  // ADR 0003 / spec §4.3.3.1: the canonical full phase-space FTLE seed
  // perturbs BOTH positions and momenta. A position-only seed measured
  // in the phase-space `sep` norm must NOT be labelled canonical FTLE.
  // Seed a normalised split across all 12 phase-space components so the
  // perturbation spans the momentum dimensions; the Benettin
  // renormalisation washes out the exact seed direction.
  const scale = d / Math.sqrt(12);              // total seed magnitude = d
  return {
    m: s.m, t: s.t,
    r: [
      [s.r[0][0] + scale, s.r[0][1] + scale],
      [s.r[1][0] + scale, s.r[1][1] + scale],
      [s.r[2][0] + scale, s.r[2][1] + scale],
    ],
    p: [
      [s.p[0][0] + scale, s.p[0][1] + scale],
      [s.p[1][0] + scale, s.p[1][1] + scale],
      [s.p[2][0] + scale, s.p[2][1] + scale],
    ],
  };
}

function sep(a: TrajState, b: TrajState): number {
  let s2 = 0;
  for (const i of [0, 1, 2] as const) {
    const dx = b.r[i][0] - a.r[i][0]; const dy = b.r[i][1] - a.r[i][1];
    s2 += a.m[i] * (dx*dx + dy*dy);
    const dpx = b.p[i][0] - a.p[i][0]; const dpy = b.p[i][1] - a.p[i][1];
    s2 += (dpx*dpx + dpy*dpy) / a.m[i];
  }
  return Math.sqrt(s2);
}

function renorm(base: TrajState, shadow: TrajState, d0: number): TrajState {
  const d = sep(base, shadow);
  if (d === 0) return shadow;
  const sc = d0 / d;
  return {
    m: shadow.m, t: shadow.t,
    r: [
      [base.r[0][0] + (shadow.r[0][0] - base.r[0][0]) * sc,
       base.r[0][1] + (shadow.r[0][1] - base.r[0][1]) * sc],
      [base.r[1][0] + (shadow.r[1][0] - base.r[1][0]) * sc,
       base.r[1][1] + (shadow.r[1][1] - base.r[1][1]) * sc],
      [base.r[2][0] + (shadow.r[2][0] - base.r[2][0]) * sc,
       base.r[2][1] + (shadow.r[2][1] - base.r[2][1]) * sc],
    ],
    p: [
      [base.p[0][0] + (shadow.p[0][0] - base.p[0][0]) * sc,
       base.p[0][1] + (shadow.p[0][1] - base.p[0][1]) * sc],
      [base.p[1][0] + (shadow.p[1][0] - base.p[1][0]) * sc,
       base.p[1][1] + (shadow.p[1][1] - base.p[1][1]) * sc],
      [base.p[2][0] + (shadow.p[2][0] - base.p[2][0]) * sc,
       base.p[2][1] + (shadow.p[2][1] - base.p[2][1]) * sc],
    ],
  };
}
