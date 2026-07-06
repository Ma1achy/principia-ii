import type { Vec2, Vec3, Vec8 } from './types.js';

/* ============================================================ */
/*  Vec2                                                         */
/* ============================================================ */

export const ZERO2: Vec2 = [0, 0];

export function v2(x: number, y: number): Vec2 { return [x, y]; }

export function add2(a: Vec2, b: Vec2): Vec2 { return [a[0]+b[0], a[1]+b[1]]; }
export function sub2(a: Vec2, b: Vec2): Vec2 { return [a[0]-b[0], a[1]-b[1]]; }
export function neg2(a: Vec2):          Vec2 { return [-a[0], -a[1]]; }
export function scale2(a: Vec2, s: number): Vec2 { return [a[0]*s, a[1]*s]; }
export function dot2(a: Vec2, b: Vec2): number { return a[0]*b[0] + a[1]*b[1]; }
export function norm2(a: Vec2): number { return Math.hypot(a[0], a[1]); }
export function normSq2(a: Vec2): number { return a[0]*a[0] + a[1]*a[1]; }

/** Planar cross product (z-component). */
export function crossZ(a: Vec2, b: Vec2): number {
  return a[0]*b[1] - a[1]*b[0];
}

/** 90° anti-clockwise rotation: J(x, y) = (-y, x). Used pervasively in
 *  the L_z chart and rotational decompositions. */
export function J(v: Vec2): Vec2 { return [-v[1], v[0]]; }

export function normalize2(a: Vec2): Vec2 {
  const n = norm2(a);
  if (n === 0) return [0, 0];
  return [a[0]/n, a[1]/n];
}

/* ============================================================ */
/*  Vec3 (used for mass triples and Cartesian shape-sphere n)    */
/* ============================================================ */

export const ZERO3: Vec3 = [0, 0, 0];

export function v3(x: number, y: number, z: number): Vec3 { return [x, y, z]; }

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
}
export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0]*s, a[1]*s, a[2]*s];
}
export function dot3(a: Vec3, b: Vec3): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
export function norm3(a: Vec3): number {
  return Math.sqrt(dot3(a, a));
}
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
export function normalize3(a: Vec3): Vec3 {
  const n = norm3(a);
  if (n === 0) return [0, 0, 1];     // canonical fallback
  return [a[0]/n, a[1]/n, a[2]/n];
}

/* ============================================================ */
/*  Vec8 (latent space)                                          */
/* ============================================================ */

export const ZERO8: Vec8 = [0, 0, 0, 0, 0, 0, 0, 0];

export function v8(...xs: number[]): Vec8 {
  if (xs.length !== 8) throw new Error(`v8 needs 8 components, got ${xs.length}`);
  return xs as unknown as Vec8;
}

export function unitE8(k: number): Vec8 {
  if (k < 0 || k >= 8) throw new Error(`unitE8 index out of range: ${k}`);
  const v = [0, 0, 0, 0, 0, 0, 0, 0];
  v[k] = 1;
  return v as unknown as Vec8;
}

export function add8(a: Vec8, b: Vec8): Vec8 {
  return [
    a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3],
    a[4]+b[4], a[5]+b[5], a[6]+b[6], a[7]+b[7],
  ];
}
export function sub8(a: Vec8, b: Vec8): Vec8 {
  return [
    a[0]-b[0], a[1]-b[1], a[2]-b[2], a[3]-b[3],
    a[4]-b[4], a[5]-b[5], a[6]-b[6], a[7]-b[7],
  ];
}
export function scale8(a: Vec8, s: number): Vec8 {
  return [
    a[0]*s, a[1]*s, a[2]*s, a[3]*s,
    a[4]*s, a[5]*s, a[6]*s, a[7]*s,
  ];
}
export function dot8(a: Vec8, b: Vec8): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
       + a[4]*b[4] + a[5]*b[5] + a[6]*b[6] + a[7]*b[7];
}
export function norm8(a: Vec8): number {
  return Math.sqrt(dot8(a, a));
}
export function normalize8(a: Vec8): Vec8 {
  const n = norm8(a);
  if (n === 0) throw new Error('normalize8 of zero vector');
  return scale8(a, 1 / n);
}
