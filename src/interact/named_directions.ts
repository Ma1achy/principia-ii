import type { Vec3, Vec8 } from '@/math/types.js';
import { unitE8 } from '@/math/vec.js';
import { logitsFromMasses } from '@/math/softmax.js';

/**
 * Mass-perturbation direction from a Burrau mass triple toward equal masses.
 * The latent indices for masses are 6 and 7 (z_μ1, z_μ2); other
 * components zero.
 */
export function massPerturbationFromBurrau(burrauMass: Vec3): Vec8 {
  const { mu1, mu2 } = logitsFromMasses(burrauMass);
  const norm = Math.hypot(mu1, mu2);
  if (norm === 0) {
    // Burrau already at equal masses; fall back to z_μ1.
    return unitE8(6);
  }
  // Direction: from current logits → 0 (equal masses), normalised in R^8.
  const v: Vec8 = [0,0,0,0,0,0, -mu1 / norm, -mu2 / norm];
  return v;
}

/**
 * Energy-increase-at-fixed-Lz direction. The radial momentum direction
 * `p_ρ` lives at latent indices 2, 3. Returns the unit vector along z[2]
 * (radial-x). For the full directional family, M10 supplies the complete
 * set keyed off the chart's frozen configuration.
 */
export function energyIncreaseAtFixedLz(): Vec8 {
  return unitE8(2);
}

/**
 * Burrau-to-unconstrained morph: tilt one of the configuration axes
 * (z_α, z_β) toward a non-Burrau direction. Used by the Stage-4
 * persistence probe in M11.
 */
export function burrauToUnconstrained(targetIndex: number): Vec8 {
  if (targetIndex < 2 || targetIndex > 7) {
    throw new RangeError(`burrauToUnconstrained target ${targetIndex} out of [2..7]`);
  }
  return unitE8(targetIndex);
}
