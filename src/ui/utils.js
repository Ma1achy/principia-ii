// Common UI utilities

export const $ = id => document.getElementById(id);

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
