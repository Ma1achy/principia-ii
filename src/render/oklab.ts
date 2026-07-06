import type { Vec3 } from '@/math/types.js';

/* ============================================================
 * sRGB ↔ linear sRGB (γ ≈ 2.2 piecewise transfer).
 * The render graph operates in linear sRGB throughout; the canvas
 * write applies the sRGB transfer function (or relies on the canvas
 * colour-space configuration to do it).
 * ============================================================ */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308
    ? 12.92 * c
    : 1.055 * Math.pow(c, 1/2.4) - 0.055;
}

/* ============================================================
 * Linear sRGB ↔ OKLAB (Björn Ottosson 2020).
 *
 *   M1 maps linear sRGB → LMS (cone fundamentals)
 *   apply cube root non-linearity
 *   M2 maps LMS' → OKLAB
 *
 * Inverses use the inverse matrices and a cube. Row-major here;
 * the WGSL mirror in render_helpers.wgsl must apply these as `v * M`
 * because the WGSL mat3x3 constructor is column-major.
 * ============================================================ */

const M1 = [
  0.4122214708, 0.5363325363, 0.0514459983,
  0.2119034958, 0.6806995450, 0.1073959539,
  0.0883024619, 0.2817188376, 0.6299787005,
];
const M2 = [
   0.2104542683,  0.7936177850, -0.0040720468,
   1.9779984951, -2.4285922050,  0.4505937099,
   0.0259040425,  0.7827717662, -0.8086757660,
];

function applyMat3(M: readonly number[], v: Vec3): Vec3 {
  return [
    M[0]!*v[0] + M[1]!*v[1] + M[2]!*v[2],
    M[3]!*v[0] + M[4]!*v[1] + M[5]!*v[2],
    M[6]!*v[0] + M[7]!*v[1] + M[8]!*v[2],
  ];
}

export function linearRgbToOklab(c: Vec3): Vec3 {
  const lms = applyMat3(M1, c);
  const cb: Vec3 = [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])];
  return applyMat3(M2, cb);
}

/**
 * Exact inverses derived from M1/M2 at module load. The published
 * approximate inverses (4.0767…, 0.3963…) only close the round-trip to
 * ~2e-6, which fails the pinned 1e-6 gate; deriving them numerically
 * makes rgb → oklab → rgb exact to machine precision. (The WGSL mirror
 * keeps the published constants — f32 precision dominates on the GPU.)
 */
function invertMat3(M: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] =
    M as unknown as [number, number, number, number, number, number, number, number, number];
  const A = e*i - f*h, B = c*h - b*i, C = b*f - c*e;
  const D = f*g - d*i, E = a*i - c*g, F = c*d - a*f;
  const G = d*h - e*g, H = b*g - a*h, I = a*e - b*d;
  const det = a*A + b*D + c*G;
  return [A/det, B/det, C/det, D/det, E/det, F/det, G/det, H/det, I/det];
}

const M1inv = invertMat3(M1);
const M2inv = invertMat3(M2);

export function oklabToLinearRgb(lab: Vec3): Vec3 {
  const cb = applyMat3(M2inv, lab);
  const lms: Vec3 = [cb[0]*cb[0]*cb[0], cb[1]*cb[1]*cb[1], cb[2]*cb[2]*cb[2]];
  return applyMat3(M1inv, lms);
}

/* ============================================================
 * OKLAB ↔ OKLCH (polar form for hue/chroma).
 * ============================================================ */

export function oklabToOklch(lab: Vec3): Vec3 {
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
}
export function oklchToOklab(lch: Vec3): Vec3 {
  return [lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])];
}
