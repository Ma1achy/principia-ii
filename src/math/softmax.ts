import type { Vec3 } from './types.js';

/**
 * Reference-logit softmax with hyperbolic-tangent saturation, exactly as
 * specified in spec §1.6.1.
 *
 * The reference logit μ₀ is fixed at 0; μ₁ and μ₂ are saturated through
 * tanh(z_μ) before exponentiation. The output sums to 1 and is positive
 * everywhere.
 */
export function massFromLogits(zMu1: number, zMu2: number, muMax: number): Vec3 {
  const mu1 = muMax * Math.tanh(zMu1);
  const mu2 = muMax * Math.tanh(zMu2);
  // numerically stable softmax: subtract the maximum logit
  const max = Math.max(0, mu1, mu2);
  const e0 = Math.exp(   - max);
  const e1 = Math.exp(mu1 - max);
  const e2 = Math.exp(mu2 - max);
  const Z  = e0 + e1 + e2;
  return [e0 / Z, e1 / Z, e2 / Z];
}

/**
 * Direct simplex parameterisation (spec §1.6.1, alternative path used by
 * the ternary mass chart). Maps (t1, t2) ∈ [0,1]² to the simplex.
 * Caller may apply an interior buffer εₘ.
 *
 * The mapping x = t1, y = (1-t1)·t2, then (m0, m1, m2) = (1-x-y, x, y)
 * is a bijection from [0,1]² onto the simplex (spec ternary-mass map).
 */
export function massFromSimplex(t1: number, t2: number): Vec3 {
  const x = t1;
  const y = (1 - t1) * t2;
  const m0 = 1 - x - y;
  const m1 = x;
  const m2 = y;
  return [m0, m1, m2];
}

/**
 * Inverse of {@link massFromLogits}. Caller is responsible for clamping
 * `m_k / m_0` away from 0 and ∞ before calling.
 */
export function logitsFromMasses(m: Vec3): { mu1: number; mu2: number } {
  return { mu1: Math.log(m[1] / m[0]), mu2: Math.log(m[2] / m[0]) };
}
