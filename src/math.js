// 10D vector math helpers
export function dot10(a, b) {
  let s = 0;
  for (let i = 0; i < 10; i++) s += a[i] * b[i];
  return s;
}
export function add10(a, b) {
  const r = new Array(10);
  for (let i = 0; i < 10; i++) r[i] = a[i] + b[i];
  return r;
}
export function sub10(a, b) {
  const r = new Array(10);
  for (let i = 0; i < 10; i++) r[i] = a[i] - b[i];
  return r;
}
export function scale10(a, k) {
  const r = new Array(10);
  for (let i = 0; i < 10; i++) r[i] = a[i] * k;
  return r;
}
export function norm10(a) {
  return Math.sqrt(Math.max(1e-18, dot10(a, a)));
}
export function normalize10(a) {
  const n = norm10(a);
  return scale10(a, 1 / n);
}
export function basis10(dim) {
  const e = new Array(10).fill(0);
  e[dim] = 1;
  return e;
}

// IC decode helpers (CPU-side probe)
const PI = Math.PI;
const ALPHA_MIN = 0.05;
const MU_MAX = 5.0;
const Q_MAX = 2.0;

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function softmax3(a, b, c) {
  const m = Math.max(a, b, c);
  const ea = Math.exp(a - m), eb = Math.exp(b - m), ec = Math.exp(c - m);
  const s = ea + eb + ec;
  return [ea / s, eb / s, ec / s];
}

export function decodeICParamsFromZ(z) {
  const mu1 = MU_MAX * (2 * sigmoid(z[8]) - 1);
  const mu2 = MU_MAX * (2 * sigmoid(z[9]) - 1);
  const m = softmax3(0.0, mu1, mu2);
  const M01 = m[0] + m[1];
  const alpha = ALPHA_MIN + (PI / 2 - 2 * ALPHA_MIN) * sigmoid(z[1]);
  const beta = PI * sigmoid(z[0]);
  const pRho = [Q_MAX * (2 * sigmoid(z[4]) - 1), Q_MAX * (2 * sigmoid(z[5]) - 1)];
  const pLam = [Q_MAX * (2 * sigmoid(z[6]) - 1), Q_MAX * (2 * sigmoid(z[7]) - 1)];
  return { m, M01, alpha, beta, pRho, pLam, mu1, mu2 };
}
