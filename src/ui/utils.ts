/**
 * Common UI utilities
 */

/**
 * Shorthand for document.getElementById
 * @param id - Element ID
 * @returns The element or null if not found
 */
export const $ = (id: string): HTMLElement | null => document.getElementById(id);

/**
 * Clamp a value between min and max
 * @param v - Value to clamp
 * @param lo - Minimum value
 * @param hi - Maximum value
 * @returns Clamped value
 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
