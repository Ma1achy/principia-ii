/** Maximum allowed depth in the quadtree. The hard cap is also constrained
 *  by f32 precision (spec §6.4); see {@link reachedF32Floor}. */
export const Z_MAX_DEFAULT = 20;

/** Number of tiles at depth `z`. */
export function tileCountAtDepth(z: number): number {
  return Math.pow(2, z) * Math.pow(2, z);
}

/** Tile span (UV-space side length) at depth `z`. */
export function tileSpan(z: number): number {
  return 1 / Math.pow(2, z);
}

/**
 * f32 representable-precision floor for tile-local coordinates.
 *
 * At depth z the tile half-width is 2^-(z+1). f32 mantissa supports ~7
 * decimal digits, so depths beyond ~23 push individual sample positions
 * inside a tile below 1 ULP. Defaults to 23 with a small safety margin.
 */
export function reachedF32Floor(z: number, samplesPerAxis: number): boolean {
  const halfWidth = Math.pow(2, -(z + 1));
  const sampleSpacing = (2 * halfWidth) / samplesPerAxis;
  // f32 ULP at the canvas-relative coordinate ≈ 2 / 2^23. We say the floor
  // is reached when sample spacing falls within ~10× ULP.
  return sampleSpacing < 1e-6;
}
