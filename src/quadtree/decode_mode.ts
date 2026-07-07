/**
 * Decode-path switchover policy (G6). At depth >= the threshold, the CPU
 * precomputes a LinearisedReference for the tile and the GPU decodes via
 * `decode_linear`; below it, the full nonlinear path runs. No per-pixel
 * mixing — the choice is per tile (a per-sample branch would cost more
 * than it saves at typical N = 16).
 */
export const LINEARISED_DECODER_DEPTH = 20;

/**
 * Whether a tile at this depth should use the linearised decoder.
 * `atF32Floor` is the adaptive override: a tile whose reduction reports
 * TILE_STATUS.AT_F32_FLOOR (M5) linearises even above the threshold.
 */
export function shouldLineariseAtDepth(
  depth: number, atF32Floor = false,
): boolean {
  return atF32Floor || depth >= LINEARISED_DECODER_DEPTH;
}
