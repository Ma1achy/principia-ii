import type { TrajState } from '@/math/types.js';
import type { RK45Opts } from './types.js';
import { dopri5Step } from './dopri5.js';
import { projectCOM } from '@/integrate/com.js';

const SAFETY = 0.9;
const ORDER  = 5;

/**
 * One adaptive-step iteration. Tries `h`, accepts/rejects based on
 * `epsRel + epsAbs`, returns the new (s, h_next) plus a flag.
 */
export function tryStep(
  s: TrajState, h: number, opts: RK45Opts,
): { accepted: boolean; s: TrajState; hNext: number; rejected: boolean } {
  const { s5, errNorm } = dopri5Step(s, h);

  // Tolerance: epsAbs + epsRel * ||state||_∞.
  const ref = Math.max(
    Math.hypot(...flatPos(s.r)), Math.hypot(...flatPos(s.p)),
    1,
  );
  const tol = opts.epsAbs + opts.epsRel * ref;
  const ratio = tol / Math.max(errNorm, 1e-30);

  if (ratio >= 1) {
    // Accept; project to COM (cheap at f64) and grow h.
    const projected = projectCOM(s5);
    const hNext = Math.min(opts.hMax, h * SAFETY * Math.pow(ratio, 1/ORDER));
    return { accepted: true, s: projected, hNext, rejected: false };
  } else {
    const hNext = Math.max(opts.hMin, h * SAFETY * Math.pow(ratio, 1/ORDER));
    return { accepted: false, s, hNext, rejected: true };
  }
}

function flatPos(r: TrajState['r' | 'p']): number[] {
  return [r[0][0], r[0][1], r[1][0], r[1][1], r[2][0], r[2][1]];
}
