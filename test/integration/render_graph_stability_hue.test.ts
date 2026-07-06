import { describe, it, expect } from 'vitest';
import { vmfBlend, HUE_OKABE_ITO } from '@/render/vmf.js';
import { linearRgbToOklab, oklabToLinearRgb } from '@/render/oklab.js';

/**
 * CPU-side reference for the stability×hue mode. Every pixel:
 *   1. shape-sphere n  →  vmf (Okabe–Ito hues) → base RGB
 *   2. compute proximity-to-BC (max over 3 BC unit vectors)
 *   3. L = 0.25 + 0.55 * 0.5 * (1 - prox)
 *   4. replace L in OKLAB
 *
 * The test asserts light/dark in OKLAB lightness — the quantity the mode
 * sets directly (0.25 at a BC, 0.525 at a Lagrange pole). Linear-sRGB
 * luminance is NOT the right measuring stick here: OKLAB L is roughly the
 * cube root of luminance, so even the brightest pixel this mode can
 * produce (L = 0.525) has linear luminance ≈ 0.14.
 */
function cpuStabilityHue(n: [number, number, number]): [number, number, number] {
  const base = vmfBlend(n, HUE_OKABE_ITO,
                        { kappa: 3, chroma: 0.15, lightness: 0.7 });
  const b1 = [ 1, 0, 0] as const;
  const b2 = [-0.5,  Math.sqrt(3)/2, 0] as const;
  const b3 = [-0.5, -Math.sqrt(3)/2, 0] as const;
  const dot = (u: readonly number[], v: readonly number[]) =>
    u[0]!*v[0]! + u[1]!*v[1]! + u[2]!*v[2]!;
  const prox = Math.max(dot(n, b1), dot(n, b2), dot(n, b3));
  const L = 0.25 + 0.55 * 0.5 * (1 - prox);
  const lab = linearRgbToOklab(base);
  const out = oklabToLinearRgb([L, lab[1], lab[2]]);
  return [out[0], out[1], out[2]];
}

const lightness = (c: [number, number, number]): number =>
  linearRgbToOklab(c)[0];

describe('stability × hue reference values', () => {
  it('binary collisions are dark', () => {
    // prox = 1 at a BC → L = 0.25 exactly.
    expect(lightness(cpuStabilityHue([1, 0, 0]))).toBeLessThan(0.30);
  });

  it('Lagrange poles are light', () => {
    // prox = 0 at a pole → L = 0.525, the brightest this mode produces.
    expect(lightness(cpuStabilityHue([0, 0, 1]))).toBeGreaterThan(0.50);
  });

  it('luminance ordering: pole > mid-equator > binary collision', () => {
    const lPole = lightness(cpuStabilityHue([0, 0, 1]));
    const lMid  = lightness(cpuStabilityHue([0, 1, 0]));
    const lBC   = lightness(cpuStabilityHue([1, 0, 0]));
    expect(lPole).toBeGreaterThan(lMid);
    expect(lMid).toBeGreaterThan(lBC);
  });
});
