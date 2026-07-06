import type { TileID, QuadtreeView } from './types.js';
import { visibleTilesAt } from './camera.js';

/**
 * Tiles intersecting the viewport at the desired depth. Returned in
 * raster order (rows top-to-bottom, columns left-to-right) so that the
 * scheduler can do simple top-of-page-first scheduling.
 */
export function visibleTiles(view: QuadtreeView): TileID[] {
  const uvMin: [number, number] = [
    view.uvCentre[0] - view.uvHalfWidth[0],
    view.uvCentre[1] - view.uvHalfWidth[1],
  ];
  const uvMax: [number, number] = [
    view.uvCentre[0] + view.uvHalfWidth[0],
    view.uvCentre[1] + view.uvHalfWidth[1],
  ];
  const r = visibleTilesAt(view.zBase, uvMin, uvMax);

  const out: TileID[] = [];
  for (let ty = r.tyMin; ty <= r.tyMax; ty++) {
    for (let tx = r.txMin; tx <= r.txMax; tx++) {
      out.push({ z: view.zBase, tx, ty });
    }
  }
  return out;
}
