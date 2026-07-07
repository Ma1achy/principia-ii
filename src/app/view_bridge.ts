import type { ViewState } from '@/interact/view_state.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';
import type { QuadtreeView } from '@/quadtree/types.js';
import { zoomLevel } from '@/quadtree/camera.js';

/** Physical viewport the loop renders into. */
export interface Viewport {
  widthPx:  number;
  heightPx: number;
  tilePix:  number;      // raster resolution per tile axis (T_pix)
}

export const DEFAULT_VIEWPORT: Viewport = {
  widthPx: 800, heightPx: 600, tilePix: 256,
};

/**
 * Bridge M8's ViewState (interaction source of truth) to M4/M5's
 * QuadtreeView (what visibleTiles / planFrame / computePriority take).
 * The desired depth comes from the camera's zoomLevel formula on the
 * viewport's UV width; the hard cap is the view's maxDepth.
 */
export function toQuadtreeView(v: ViewState, viewport: Viewport): QuadtreeView {
  const uvWidth = 2 * v.uvHalfWidth[0];
  return {
    cacheKey:    viewStateToCacheKey(v),
    uvCentre:    v.uvCentre,
    uvHalfWidth: v.uvHalfWidth,
    zBase:       zoomLevel(viewport.widthPx, uvWidth, viewport.tilePix, v.maxDepth),
    zMax:        v.maxDepth,
    width:       viewport.widthPx,
    height:      viewport.heightPx,
    tilePix:     viewport.tilePix,
  };
}
