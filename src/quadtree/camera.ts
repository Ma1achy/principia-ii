import type { QuadtreeView } from './types.js';
import { Z_MAX_DEFAULT, tileSpan, reachedF32Floor } from './pyramid.js';
import { clamp } from '@/math/scalar.js';

/**
 * Map a viewport (UV centre + half-width) to a desired tile depth.
 *
 *   z_base = clamp( ⌊log₂(W / (T_pix × Δu_view))⌋, 0, Z_max )
 *
 * `Δu_view` is the viewport width in UV space (= 2 × halfWidth.x). At
 * `z_base` the tile span equals roughly the per-pixel UV span of a
 * fully-resolved render: a W-pixel viewport of T_pix-pixel tiles needs
 * W / T_pix tiles across, i.e. depth log₂(W / (T_pix × Δu_view)).
 */
export function zoomLevel(
  viewportPixelWidth: number, viewportUvWidth: number,
  tilePix: number, zMax = Z_MAX_DEFAULT,
): number {
  if (viewportUvWidth === 0) return zMax;
  const ratio = viewportPixelWidth / (tilePix * viewportUvWidth);
  return Math.floor(clamp(Math.log2(ratio), 0, zMax));
}

/** Visible tiles at a given depth, given a viewport rectangle in UV. */
export function visibleTilesAt(
  z: number, uvMin: [number, number], uvMax: [number, number],
): { txMin: number; txMax: number; tyMin: number; tyMax: number } {
  const span = tileSpan(z);
  return {
    txMin: Math.max(0, Math.floor(uvMin[0] / span)),
    txMax: Math.min(Math.pow(2, z) - 1, Math.floor(uvMax[0] / span)),
    tyMin: Math.max(0, Math.floor(uvMin[1] / span)),
    tyMax: Math.min(Math.pow(2, z) - 1, Math.floor(uvMax[1] / span)),
  };
}

/** Adapt the requested z down to whatever the f32 precision floor
 *  (`pyramid.reachedF32Floor`) allows, then apply the view's hard cap. */
export function effectiveZ(view: QuadtreeView, samplesPerAxis: number): number {
  let z = view.zBase;
  while (z > 0 && reachedF32Floor(z, samplesPerAxis)) z--;
  return Math.min(z, view.zMax);
}
