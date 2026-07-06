import type { Vec2, Vec3, Triple } from '@/math/types.js';

/**
 * Continuous Euclid parametrisation. For real m > n > 0 the formulae
 *   a = m² - n²,  b = 2 m n,  c = m² + n²
 * give a Pythagorean-style triple with a² + b² = c² for any m, n.
 *
 * The single ratio ν = n / m ∈ (0, 1) determines the triangle shape;
 * `m` itself sets the absolute scale (irrelevant after the I = 1 gauge).
 */
export function euclidSides(m: number, n: number): { a: number; b: number; c: number } {
  return { a: m * m - n * n, b: 2 * m * n, c: m * m + n * n };
}

/** Normalised by m² so a, b, c depend only on ν. */
export function normalisedSides(nu: number): { a: number; b: number; c: number } {
  return { a: 1 - nu * nu, b: 2 * nu, c: 1 + nu * nu };
}

/** Acute angle as a function of ν. θ(ν) = arctan((1 - ν²) / (2 ν)). */
export function acuteAngle(nu: number): number {
  return Math.atan2(1 - nu * nu, 2 * nu);
}

/** Inverse: ν as a function of θ ∈ (0, π/4]. ν = sec θ - tan θ. */
export function nuFromAcuteAngle(theta: number): number {
  return 1 / Math.cos(theta) - Math.tan(theta);
}

/**
 * Burrau triangle at unit hypotenuse, per the canonical spec
 * (eq. burrau_positions): right angle at the origin with mass c/Σ, the
 * a/c leg along +x holding mass b/Σ, the b/c leg along +y holding mass
 * a/Σ — each mass equal to its OPPOSITE side (classical Burrau rule,
 * matching Szebehely & Peters' coordinates). Re-indexed to 0-based:
 *
 *   body 1 → 0  (right angle, mass = c / Σ)
 *   body 2 → 1  (at (a/c, 0),  mass = b / Σ)
 *   body 3 → 2  (at (0, b/c),  mass = a / Σ)
 */
export function burrauTriangle(nu: number): {
  r: Triple<Vec2>;
  m: Vec3;
} {
  const { a, b, c } = normalisedSides(nu);
  const total = a + b + c;
  return {
    r: [[0, 0], [a / c, 0], [0, b / c]],
    m: [c / total, b / total, a / total],
  };
}

/** Inverse: recover ν from the geometry of a Burrau-style triangle.
 *  Useful for lookup of arbitrary right-triangle ICs. */
export function recoverNuFromTriangle(r: Triple<Vec2>): number {
  // Body 0 sits at the right angle; legs are a/c (to body 1) and b/c
  // (to body 2). Recover the ratio a/b = (1-ν²)/(2ν).
  const a = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);    // (a/c)
  const b = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);    // (b/c)
  // 2ν (a/b) = 1 - ν²  →  ν² + 2(a/b)ν - 1 = 0  →  ν = -a/b + √((a/b)² + 1)
  if (b === 0) return 0;
  const k = a / b;
  return -k + Math.sqrt(k * k + 1);
}
