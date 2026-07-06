import { decodeSimResults } from '@/gpu/readback.js';
import type { DecodedSimResult } from '@/gpu/readback.js';

/**
 * Decode a SimResult buffer to a JSON-friendly array of objects.
 * Heavyweight — only used for small datasets (< ~100k samples).
 *
 * Reuses M3's `decodeSimResults` — the ONE SimResult layout decoder —
 * rather than carrying a second copy of the field offsets.
 */
export function decodeSimResultsToJson(
  ab: ArrayBuffer, count: number, M: number,
): DecodedSimResult[] {
  return decodeSimResults(ab, count, M);
}
