import type { Vec3 } from '@/math/types.js';
import { massFromLogits, massFromSimplex, logitsFromMasses } from '@/math/softmax.js';
import { artanh, clamp } from '@/math/scalar.js';

export function decodeMassSoftmax(
  zMu1: number, zMu2: number, muMax: number,
): Vec3 {
  return massFromLogits(zMu1, zMu2, muMax);
}

export function decodeMassSimplex(t1: number, t2: number, epsM: number): Vec3 {
  const m = massFromSimplex(t1, t2);
  // Apply interior buffer: shrink toward barycentre.
  return [
    (1 - 3*epsM) * m[0] + epsM,
    (1 - 3*epsM) * m[1] + epsM,
    (1 - 3*epsM) * m[2] + epsM,
  ];
}

/**
 * Inverse of `decodeMassSoftmax`. Caller-controlled clamp via `epsMu`
 * keeps `μ_k / μ_max` away from the open-interval endpoints before
 * `artanh`.
 */
export function inverseMass(
  m: Vec3, muMax: number, epsMu: number,
): { zMu1: number; zMu2: number; clamped: boolean } {
  const { mu1, mu2 } = logitsFromMasses(m);
  let clamped = false;
  const norm = (mu: number) => {
    const x = mu / muMax;
    if (x <= -1 + epsMu || x >= 1 - epsMu) clamped = true;
    return clamp(x, -1 + epsMu, 1 - epsMu);
  };
  return { zMu1: artanh(norm(mu1)), zMu2: artanh(norm(mu2)), clamped };
}
