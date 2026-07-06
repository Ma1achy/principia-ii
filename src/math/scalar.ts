/**
 * Numerically stable sigmoid that avoids `exp` overflow for large negative z.
 *
 * For z >= 0:  σ(z) = 1 / (1 + exp(-z))
 * For z <  0:  σ(z) = exp(z) / (1 + exp(z))
 */
export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  } else {
    const e = Math.exp(z);
    return e / (1 + e);
  }
}

/**
 * Inverse of sigmoid on (0, 1). Caller is responsible for clamping the
 * input away from the endpoints (use {@link clamp01}).
 */
export function logit(s: number): number {
  return Math.log(s / (1 - s));
}

/**
 * artanh for inputs in (-1, 1). Caller clamps.
 */
export function artanh(x: number): number {
  return 0.5 * Math.log((1 + x) / (1 - x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/**
 * Hermite smoothstep; matches the WGSL `smoothstep` exactly, including the
 * out-of-range plateau behaviour.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Symmetric log: linear within ±epsilon, log outside. Used for the
 * energy colour palette (spec §5.3.1).
 */
export function symlog(x: number, eps = 1e-3): number {
  if (Math.abs(x) <= eps) return x / eps;
  return Math.sign(x) * (1 + Math.log(Math.abs(x) / eps));
}

/**
 * ε-deadbanded sign: returns 0 inside [-ε, ε], otherwise the sign.
 */
export function signDeadband(x: number, eps: number): -1 | 0 | 1 {
  if (x >  eps) return  1;
  if (x < -eps) return -1;
  return 0;
}
