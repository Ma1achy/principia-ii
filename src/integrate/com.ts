import type { TrajState, Triple, Vec2 } from './types.js';

/**
 * Project to the COM frame: subtract the centre-of-mass position and the
 * total-momentum drift. The atlas already produces a COM-consistent
 * initial state; this is housekeeping that keeps f32 / f64 round-off from
 * reintroducing the redundant modes.
 *
 * Mathematically idempotent; numerically idempotent to within rounding.
 */
export function projectCOM(s: TrajState): TrajState {
  const m = s.m;
  const M = m[0] + m[1] + m[2];

  const Rx = (m[0]*s.r[0][0] + m[1]*s.r[1][0] + m[2]*s.r[2][0]) / M;
  const Ry = (m[0]*s.r[0][1] + m[1]*s.r[1][1] + m[2]*s.r[2][1]) / M;
  const Px = s.p[0][0] + s.p[1][0] + s.p[2][0];
  const Py = s.p[0][1] + s.p[1][1] + s.p[2][1];

  const r: Triple<Vec2> = [
    [s.r[0][0] - Rx, s.r[0][1] - Ry],
    [s.r[1][0] - Rx, s.r[1][1] - Ry],
    [s.r[2][0] - Rx, s.r[2][1] - Ry],
  ];
  const p: Triple<Vec2> = [
    [s.p[0][0] - Px * m[0]/M, s.p[0][1] - Py * m[0]/M],
    [s.p[1][0] - Px * m[1]/M, s.p[1][1] - Py * m[1]/M],
    [s.p[2][0] - Px * m[2]/M, s.p[2][1] - Py * m[2]/M],
  ];
  return { r, p, m, t: s.t };
}
