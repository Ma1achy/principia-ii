import type { Vec3 } from '@/math/types.js';
import { dot3 } from '@/math/vec.js';
import { clamp } from '@/math/scalar.js';

/**
 * Geodesic distance between two unit vectors on S².
 *   d(a, b) = arccos(clamp(a · b, -1, 1))
 */
export function geodesic(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot3(a, b), -1, 1));
}

/**
 * Total arc length of a sampled path on S². Used as the "activity proxy"
 * scalar in coherence and rendering.
 */
export function arcLength(path: readonly Vec3[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) {
    L += geodesic(path[i - 1]!, path[i]!);
  }
  return L;
}
