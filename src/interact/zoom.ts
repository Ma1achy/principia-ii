import type { ViewState } from './view_state.js';

/**
 * Multiplicative zoom in latent space. Callers pass a log-step (positive
 * = zoom in / smaller `mag`). Zoom is bounded to keep the slice
 * within reasonable numeric range.
 */
export function applyZoomStep(v: ViewState, deltaLog2: number): ViewState {
  const newMag = v.mag * Math.pow(2, -deltaLog2);
  const clamped = Math.max(1e-12, Math.min(1e6, newMag));
  return { ...v, mag: clamped, zoom: v.zoom + deltaLog2 };
}
