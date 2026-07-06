import type { ConfigCanonical } from './types.js';
import { sigmoid, logit, clamp } from '@/math/scalar.js';

/**
 * Canonical-frame hyperspherical mass-weighted Jacobi.
 *
 * α is the polar angle on the configuration sphere with the convention
 *   |ρ̃| = R̃ cos α,  |λ̃| = R̃ sin α.
 * α near 0  → body 2 sits at the inner-pair COM (large |ρ|).
 * α near π/2 → bodies 0,1 collide (tight inner pair).
 *
 * β is the angle between ρ̃ and λ̃ in the canonical frame, restricted to [0, π]
 * because the mirror gauge identifies β and 2π − β.
 */
export function decodeConfigCanonical(
  zAlpha: number, zBeta: number, alphaMin: number, RTilde = 1,
): ConfigCanonical {
  const alpha = alphaMin + (Math.PI/2 - 2*alphaMin) * sigmoid(zAlpha);
  const beta  = Math.PI * sigmoid(zBeta);
  const rhoTilde:    [number, number] = [RTilde * Math.cos(alpha), 0];
  const lambdaTilde: [number, number] = [
    RTilde * Math.sin(alpha) * Math.cos(beta),
    RTilde * Math.sin(alpha) * Math.sin(beta),
  ];
  return { rhoTilde, lambdaTilde, alpha, beta };
}

/** Inverse: recover (z_α, z_β) from (α, β) with sigmoid clamp. */
export function inverseConfigCanonical(
  alpha: number, beta: number, alphaMin: number, epsZ: number,
): { zAlpha: number; zBeta: number; clamped: boolean } {
  const sA = (alpha - alphaMin) / (Math.PI/2 - 2*alphaMin);
  const sB = beta / Math.PI;
  let clamped = false;
  const cl = (s: number) => {
    if (s <= epsZ || s >= 1 - epsZ) clamped = true;
    return clamp(s, epsZ, 1 - epsZ);
  };
  return { zAlpha: logit(cl(sA)), zBeta: logit(cl(sB)), clamped };
}
