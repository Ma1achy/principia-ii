/**
 * 10D vector math helpers
 * Used for high-dimensional geometry operations in the simulation
 */

export type Vec10 = [number, number, number, number, number, number, number, number, number, number];

export function dot10(a: Vec10, b: Vec10): number {
  let s = 0;
  for (let i = 0; i < 10; i++) s += a[i] * b[i];
  return s;
}

export function add10(a: Vec10, b: Vec10): Vec10 {
  const r = new Array(10) as unknown as Vec10;
  for (let i = 0; i < 10; i++) r[i] = a[i] + b[i];
  return r;
}

export function sub10(a: Vec10, b: Vec10): Vec10 {
  const r = new Array(10) as unknown as Vec10;
  for (let i = 0; i < 10; i++) r[i] = a[i] - b[i];
  return r;
}

export function scale10(a: Vec10, k: number): Vec10 {
  const r = new Array(10) as unknown as Vec10;
  for (let i = 0; i < 10; i++) r[i] = a[i] * k;
  return r;
}

export function norm10(a: Vec10): number {
  return Math.sqrt(Math.max(1e-18, dot10(a, a)));
}

export function normalize10(a: Vec10): Vec10 {
  const n = norm10(a);
  return scale10(a, 1 / n);
}

export function basis10(dim: number): Vec10 {
  const e = new Array(10).fill(0) as unknown as Vec10;
  e[dim] = 1;
  return e;
}

/**
 * Initial condition parameters decoded from z-coordinates
 */
export interface ICParams {
  m: [number, number, number];
  M01: number;
  alpha: number;
  beta: number;
  pRho: [number, number];
  pLam: [number, number];
  mu1: number;
  mu2: number;
}

// IC decode helpers (CPU-side probe)
const PI = Math.PI;
const ALPHA_MIN = 0.05;
const MU_MAX = 5.0;
const Q_MAX = 2.0;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function softmax3(a: number, b: number, c: number): [number, number, number] {
  const m = Math.max(a, b, c);
  const ea = Math.exp(a - m), eb = Math.exp(b - m), ec = Math.exp(c - m);
  const s = ea + eb + ec;
  return [ea / s, eb / s, ec / s];
}

export function decodeICParamsFromZ(z: Vec10): ICParams {
  const mu1 = MU_MAX * (2 * sigmoid(z[8]) - 1);
  const mu2 = MU_MAX * (2 * sigmoid(z[9]) - 1);
  const m = softmax3(0.0, mu1, mu2);
  const M01 = m[0] + m[1];
  const alpha = ALPHA_MIN + (PI / 2 - 2 * ALPHA_MIN) * sigmoid(z[1]);
  const beta = PI * sigmoid(z[0]);
  const pRho: [number, number] = [Q_MAX * (2 * sigmoid(z[4]) - 1), Q_MAX * (2 * sigmoid(z[5]) - 1)];
  const pLam: [number, number] = [Q_MAX * (2 * sigmoid(z[6]) - 1), Q_MAX * (2 * sigmoid(z[7]) - 1)];
  return { m, M01, alpha, beta, pRho, pLam, mu1, mu2 };
}
