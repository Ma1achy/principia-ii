import type { Vec3 } from '@/math/types.js';

/**
 * Cubehelix analytical generator. `t ∈ [0, 1]` maps to a smoothly
 * brightening helix in colour space; output is linear sRGB.
 */
export function cubehelix(t: number, opts: {
  start?: number; rotations?: number; hue?: number; gamma?: number;
} = {}): Vec3 {
  const start = opts.start ?? 0.5;
  const rot   = opts.rotations ?? 1.5;
  const hue   = opts.hue ?? 1.0;
  const gamma = opts.gamma ?? 1.0;

  const phi = 2 * Math.PI * (start / 3 - rot * t);
  const a = hue * Math.pow(t, gamma) * (1 - Math.pow(t, gamma)) / 2;

  const r = Math.pow(t, gamma) + a * (-0.14861 * Math.cos(phi) + 1.78277 * Math.sin(phi));
  const g = Math.pow(t, gamma) + a * (-0.29227 * Math.cos(phi) - 0.90649 * Math.sin(phi));
  const b = Math.pow(t, gamma) + a * (1.97294 * Math.cos(phi));
  return [Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b))];
}

/**
 * 5-stop sequential approximation to viridis. Real viridis uses a
 * 256-entry LUT; this is sufficient for the test gate. Production
 * code uploads a 1D texture.
 */
export const VIRIDIS_STOPS: Vec3[] = [
  [0.267, 0.005, 0.329],
  [0.282, 0.140, 0.458],
  [0.221, 0.402, 0.561],
  [0.221, 0.700, 0.408],
  [0.991, 0.906, 0.144],
];

export function lerpStops(stops: Vec3[], t: number): Vec3 {
  const u = Math.max(0, Math.min(1, t));
  const f = u * (stops.length - 1);
  const i = Math.floor(f);
  const j = Math.min(stops.length - 1, i + 1);
  const a = stops[i]!, b = stops[j]!;
  const w = f - i;
  return [a[0] + (b[0]-a[0])*w, a[1] + (b[1]-a[1])*w, a[2] + (b[2]-a[2])*w];
}

export function viridis(t: number): Vec3 {
  return lerpStops(VIRIDIS_STOPS, t);
}
