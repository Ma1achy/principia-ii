import type { Triple, Vec2, Vec3, Force } from './types.js';
import { G } from '@/math/constants.js';
import { v2 } from '@/math/vec.js';

/**
 * Pairwise gravitational force on each body. F_i = Σ_{j≠i} G m_i m_j (r_j - r_i)/|r_j-r_i|^3.
 *
 * Allocates one fresh array; the integrator's hot loop should reuse buffers
 * via the in-place variant below in production. For clarity, this version
 * is allocation-free in the inner numeric work.
 */
export function forces(m: Vec3, r: Triple<Vec2>): Force {
  let f0x = 0, f0y = 0, f1x = 0, f1y = 0, f2x = 0, f2y = 0;

  // pair (0, 1)
  {
    const dx = r[1][0] - r[0][0], dy = r[1][1] - r[0][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[0] * m[1] / r3;
    f0x += f * dx; f0y += f * dy;
    f1x -= f * dx; f1y -= f * dy;
  }
  // pair (0, 2)
  {
    const dx = r[2][0] - r[0][0], dy = r[2][1] - r[0][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[0] * m[2] / r3;
    f0x += f * dx; f0y += f * dy;
    f2x -= f * dx; f2y -= f * dy;
  }
  // pair (1, 2)
  {
    const dx = r[2][0] - r[1][0], dy = r[2][1] - r[1][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[1] * m[2] / r3;
    f1x += f * dx; f1y += f * dy;
    f2x -= f * dx; f2y -= f * dy;
  }
  return [v2(f0x, f0y), v2(f1x, f1y), v2(f2x, f2y)];
}

/** Minimum pair separation, with the index of the achieving pair. Pair codes:
 *  0 = (0,1), 1 = (0,2), 2 = (1,2). */
export function minPairSeparation(r: Triple<Vec2>): { d: number; pair: 0 | 1 | 2 } {
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  if (d01 <= d02 && d01 <= d12) return { d: d01, pair: 0 };
  if (d02 <= d12)               return { d: d02, pair: 1 };
  return { d: d12, pair: 2 };
}

/**
 * Total energy E = K + U. K = Σ |p|²/(2m). U = -G Σ_{i<j} m_i m_j / |r_i-r_j|.
 */
export function totalEnergy(m: Vec3, r: Triple<Vec2>, p: Triple<Vec2>): number {
  const K = (p[0][0]*p[0][0] + p[0][1]*p[0][1]) / (2*m[0])
          + (p[1][0]*p[1][0] + p[1][1]*p[1][1]) / (2*m[1])
          + (p[2][0]*p[2][0] + p[2][1]*p[2][1]) / (2*m[2]);
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  const U = - G*(m[0]*m[1]/d01 + m[0]*m[2]/d02 + m[1]*m[2]/d12);
  return K + U;
}

/** Angular momentum L_z = Σ m_i (x_i v_{y,i} - y_i v_{x,i})
 *                      = Σ (x_i p_{y,i} - y_i p_{x,i}). */
export function angularMomentum(r: Triple<Vec2>, p: Triple<Vec2>): number {
  return r[0][0]*p[0][1] - r[0][1]*p[0][0]
       + r[1][0]*p[1][1] - r[1][1]*p[1][0]
       + r[2][0]*p[2][1] - r[2][1]*p[2][0];
}
