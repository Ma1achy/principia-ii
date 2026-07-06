import type { Vec2 } from './types.js';

/**
 * 2x2 rotation matrix as `[c, -s, s, c]` row-major. Multiplies on the left:
 * `applyR(R, v) = R · v`.
 */
export type Mat2 = readonly [number, number, number, number];

export function rotation(theta: number): Mat2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, s, c];
}

export function applyR(R: Mat2, v: Vec2): Vec2 {
  return [R[0]*v[0] + R[1]*v[1], R[2]*v[0] + R[3]*v[1]];
}

/**
 * Reflect across the x-axis: (x, y) -> (x, -y). Used by the canonicaliser's
 * dead-banded mirror rule.
 */
export function reflectX(v: Vec2): Vec2 { return [v[0], -v[1]]; }
