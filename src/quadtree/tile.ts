import type { TileID } from './types.js';

/**
 * Bounds of a tile at a given depth, in world UV coordinates.
 *
 * At depth `z` the tile width is `2^-z`. The 2D index `(tx, ty)` ranges
 * over `[0, 2^z)`.
 */
export function tileBounds(id: TileID): {
  uMin: number; uMax: number; vMin: number; vMax: number;
} {
  const span = 1 / Math.pow(2, id.z);
  return {
    uMin: id.tx * span, uMax: (id.tx + 1) * span,
    vMin: id.ty * span, vMax: (id.ty + 1) * span,
  };
}

/** Tile centre and half-width in UV space. Used to fill the GPU's
 *  `uv_centre`/`uv_half` uniforms (spec §6.4 tile-local precision). */
export function tileCentreHalf(id: TileID): {
  centre: [number, number]; half: [number, number];
} {
  const span = 1 / Math.pow(2, id.z);
  const half = span / 2;
  return {
    centre: [id.tx * span + half, id.ty * span + half],
    half:   [half, half],
  };
}

/**
 * Walk up the tree by `levels` (default 1) to the parent ID. Returns null
 * if walking would go above the root.
 */
export function ancestor(id: TileID, levels = 1): TileID | null {
  if (id.z - levels < 0) return null;
  return {
    z:  id.z - levels,
    tx: id.tx >> levels,
    ty: id.ty >> levels,
  };
}

/** Direct-children identities, in (NW, NE, SW, SE) order. */
export function children(id: TileID): [TileID, TileID, TileID, TileID] {
  const z = id.z + 1;
  const x = id.tx * 2, y = id.ty * 2;
  return [
    { z, tx: x,     ty: y     },
    { z, tx: x + 1, ty: y     },
    { z, tx: x,     ty: y + 1 },
    { z, tx: x + 1, ty: y + 1 },
  ];
}

/** Stable string key for `Map` lookups. */
export function tileKey(id: TileID): string {
  return `${id.z}/${id.tx}/${id.ty}`;
}

/** True iff `a` is an ancestor (proper or equal) of `b`. */
export function contains(a: TileID, b: TileID): boolean {
  if (a.z > b.z) return false;
  const dz = b.z - a.z;
  return (b.tx >> dz) === a.tx && (b.ty >> dz) === a.ty;
}

/**
 * Sub-rectangle of `descendant` within `ancestor`, expressed as
 * `[u0, v0, u1, v1]` in the ancestor's local [0,1]² coordinate. Used to
 * upscale a parent tile texture onto a child's screen footprint.
 */
export function subrect(
  ancestor: TileID, descendant: TileID,
): [number, number, number, number] {
  const dz = descendant.z - ancestor.z;
  const span = 1 / Math.pow(2, dz);
  const xOff = descendant.tx - (ancestor.tx << dz);
  const yOff = descendant.ty - (ancestor.ty << dz);
  return [xOff * span, yOff * span, (xOff + 1) * span, (yOff + 1) * span];
}
