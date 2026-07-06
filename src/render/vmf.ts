import type { Vec3 } from '@/math/types.js';
import { oklabToLinearRgb } from './oklab.js';

/**
 * Six poles at the axis directions ±x̂, ±ŷ, ±ẑ. Hue assignments depend
 * on the scheme (full OKLAB vs Okabe–Ito CB-safe). All angles in degrees,
 * converted to radians inside.
 */
export const POLE_DIRECTIONS: Vec3[] = [
  [ 1,  0,  0], [-1,  0,  0],
  [ 0,  1,  0], [ 0, -1,  0],
  [ 0,  0,  1], [ 0,  0, -1],
];

export const HUE_OKLAB = [0, 180, 120, 300, 240, 60].map(d => d * Math.PI / 180);
export const HUE_OKABE_ITO = [250, 70, 30, 210, 170, 350].map(d => d * Math.PI / 180);

/** Spherical von Mises–Fisher weight w_i = exp(κ n̂ · p̂_i). */
function vmfWeights(n: Vec3, kappa: number, poles: Vec3[]): number[] {
  let max = -Infinity;
  const dots = poles.map(p => n[0]*p[0] + n[1]*p[1] + n[2]*p[2]);
  for (const d of dots) if (kappa * d > max) max = kappa * d;
  // Subtract max for stability.
  return dots.map(d => Math.exp(kappa * d - max));
}

/**
 * VMF blend in OKLAB with optional CB-safe hues. Returns linear sRGB.
 */
export function vmfBlend(
  n: Vec3, hues: number[], opts: {
    kappa: number; chroma: number; lightness: number;
  },
): Vec3 {
  const w = vmfWeights(n, opts.kappa, POLE_DIRECTIONS);
  const Z = w.reduce((s, x) => s + x, 0);
  let aSum = 0, bSum = 0;
  for (let i = 0; i < hues.length; i++) {
    aSum += w[i]! * Math.cos(hues[i]!);
    bSum += w[i]! * Math.sin(hues[i]!);
  }
  const a = opts.chroma * aSum / Z;
  const b = opts.chroma * bSum / Z;
  return oklabToLinearRgb([opts.lightness, a, b]);
}
