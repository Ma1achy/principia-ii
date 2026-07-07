import type { ViewState } from '@/interact/view_state.js';

/**
 * Viewport (slippy-map) navigation: pan and zoom move the UV window
 * (uvCentre/uvHalfWidth) over the SAME slice, so cached tiles stay
 * valid and zooming refines the quadtree. This is distinct from
 * `applyZoomStep` (M8), which rescales `mag` — the latent extent of the
 * slice itself — and therefore recomputes every tile (mag is in the
 * cache key).
 */

const MIN_HALF = 2 ** -28;    // past the f32 floor; G6 linearises long before
const MAX_HALF = 0.5;

function clampWindow(
  centre: [number, number], half: [number, number],
): { uvCentre: [number, number]; uvHalfWidth: [number, number] } {
  const hx = Math.min(MAX_HALF, Math.max(MIN_HALF, half[0]));
  const hy = Math.min(MAX_HALF, Math.max(MIN_HALF, half[1]));
  const cx = Math.min(1 - hx, Math.max(hx, centre[0]));
  const cy = Math.min(1 - hy, Math.max(hy, centre[1]));
  return { uvCentre: [cx, cy], uvHalfWidth: [hx, hy] };
}

/** Pan by (du, dv) in UV units (positive = right/down). */
export function panViewport(v: ViewState, du: number, dv: number): ViewState {
  return {
    ...v,
    ...clampWindow(
      [v.uvCentre[0] + du, v.uvCentre[1] + dv],
      [v.uvHalfWidth[0], v.uvHalfWidth[1]]),
  };
}

/**
 * Zoom the viewport by `factor` (< 1 zooms in) about a focus point given
 * in screen UV ([0,1]², y down). The focus stays put on screen.
 */
export function zoomViewport(
  v: ViewState, factor: number, focus: [number, number] = [0.5, 0.5],
): ViewState {
  const fx = v.uvCentre[0] + (2 * focus[0] - 1) * v.uvHalfWidth[0];
  const fy = v.uvCentre[1] + (2 * focus[1] - 1) * v.uvHalfWidth[1];
  const hx = v.uvHalfWidth[0] * factor;
  const hy = v.uvHalfWidth[1] * factor;
  // Keep the world point under the cursor fixed: c' = f − (f − c)·k.
  const cx = fx - (fx - v.uvCentre[0]) * factor;
  const cy = fy - (fy - v.uvCentre[1]) * factor;
  return { ...v, ...clampWindow([cx, cy], [hx, hy]) };
}
