# M4 — Layer 1: tile cache and ancestor fallback

## Goal

The slippy-map UX. A tile cache keyed by `TileCacheKey`, a quadtree pyramid,
ancestor walking with upscaling, and a FIFO compute queue. After M4, panning
and zooming never produce a blank frame: missing children are stretched
from the nearest cached ancestor while the compute queue drains in the
background.

**Exit criterion.**

```bash
npm test -- --run test/integration/layer1
```

A scripted pan that scrolls four screens of content across a 1024² viewport
produces zero frames with a blank region. A zoom step shows a stretched
parent for exactly one frame, then sharp children once they land.

**Deliverable:** internal — tests only (no visible artifact until a later GPU/UI milestone); the tile-cache / quadtree-pyramid / ancestor-fallback logic that guarantees no blank frame while the compute queue drains, exercised in headless tests.

## File tree

```
principia/
  src/
    quadtree/
      types.ts
      tile.ts
      pyramid.ts
      camera.ts
      cache.ts
      cache_key.ts
      compute_queue.ts
      visible.ts
      index.ts
  test/
    unit/quadtree/
      tile.test.ts
      pyramid.test.ts
      camera.test.ts
      cache.test.ts
      cache_key.test.ts
      compute_queue.test.ts
    integration/
      layer1_panning.test.ts
      layer1_zoom_handoff.test.ts
```

## `src/quadtree/types.ts`

```ts
import type { Vec2, Vec8 } from '@/math/types.js';

/**
 * Quadtree tile identity. Bodies live in IC space, not screen space:
 * (z = depth, t_x / t_y = grid coordinates at that depth). At depth z
 * there are 2^z × 2^z tiles, each covering an axis-aligned square in the
 * unit-square UV domain.
 */
export interface TileID {
  readonly z:  number;
  readonly tx: number;
  readonly ty: number;
}

/** Lifecycle state machine. M4 uses only `unseen` / `queued` /
 *  `computing` / `ready`. M5 adds `readyRefinable`. */
export type Lifecycle =
  | 'unseen' | 'queued' | 'computing' | 'ready' | 'readyRefinable';

export interface CachedTile {
  id:           TileID;
  simBuffer:    GPUBuffer | null;
  icBuffer:     GPUBuffer | null;
  lifecycle:    Lifecycle;
  cacheAge:     number;       // monotonically increasing, set on insertion
  lastUsed:     number;       // updated on every cache hit
  computeCostMs:number;       // weighted-LRU input (filled in M5)
}

/**
 * The cache key. Anything that affects the contents of `simBuffer` must
 * be in here. The `payload_version` field is the safety net: bumping it
 * at the call site invalidates every cached payload of the old version.
 */
export interface TileCacheKey {
  readonly chartId:           string;
  readonly z0:                Vec8;
  readonly q1:                Vec8;
  readonly q2:                Vec8;
  readonly mag:               number;
  readonly integrator:        'kdk' | 'yoshida4' | 'yoshida6' | 'rk4';
  readonly dtMacro:           number;
  readonly nMax:              number;
  readonly THorizon:          number;
  readonly checkpoints:       number;
  readonly muMax:             number;
  readonly alphaMin:          number;
  readonly qMax:              number;
  readonly rColl:             number;
  readonly REsc:              number;
  readonly kEsc:              number;
  readonly enabledMetrics:    number;     // bitset
  readonly qualityTier:       'preview' | 'balanced' | 'research';
  readonly payloadVersion:    number;     // monotonic, see spec §6.5
}

/**
 * One screen-space frame description. The renderer walks the quadtree
 * with this in hand to decide which tiles are visible.
 */
export interface QuadtreeView {
  cacheKey:     TileCacheKey;
  uvCentre:     Vec2;       // world-UV centre of the viewport
  uvHalfWidth:  Vec2;       // half-extent of the viewport in UV space
  zBase:        number;     // desired tile depth at this zoom
  zMax:         number;     // hard cap (`MAX_DEPTH`)
  width:        number;     // viewport width in pixels (info)
  height:       number;
  tilePix:      number;     // raster resolution per tile axis (T_pix)
}
```

## `src/quadtree/tile.ts`

```ts
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
```

## `src/quadtree/pyramid.ts`

```ts
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
```

## `src/quadtree/camera.ts`

```ts
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
 * fully-resolved render.
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
```

## `src/quadtree/cache_key.ts`

```ts
import type { TileCacheKey } from './types.js';

/**
 * Stable, byte-conscious string serialisation of a cache key. Used as the
 * `Map` key in the cache. We deliberately serialise floats as fixed
 * decimals so that round-tripping through JSON does not introduce
 * precision drift in the key itself.
 *
 * The 16 components of (z0, q1, q2) dominate the length; even at full
 * precision the key is well under 1KB, which is fine for `Map<string,
 * CachedTile>`.
 */
export function serialiseCacheKey(k: TileCacheKey): string {
  const f = (xs: readonly number[]) => xs.map(x => x.toFixed(15)).join(',');
  return [
    k.chartId,
    f(k.z0), f(k.q1), f(k.q2), k.mag.toFixed(15),
    k.integrator,
    k.dtMacro.toFixed(15),
    k.nMax, k.THorizon.toFixed(8), k.checkpoints,
    k.muMax.toFixed(8), k.alphaMin.toFixed(8), k.qMax.toFixed(8),
    k.rColl.toFixed(15), k.REsc.toFixed(8), k.kEsc,
    k.enabledMetrics, k.qualityTier, k.payloadVersion,
  ].join('|');
}

/**
 * What changed between two keys. The renderer uses this to decide whether
 * a cache invalidation needs to bring down only the render cache or the
 * diagnostics cache as well (spec §6.5 invalidation matrix).
 */
export function classifyKeyChange(
  before: TileCacheKey, after: TileCacheKey,
): 'identical' | 'render-only' | 'diagnostics' {
  // A render-only change is impossible by construction: `TileCacheKey`
  // does not carry palette / overlay state, so any structural diff implies
  // a diagnostics-level invalidation. The render cache is keyed
  // separately (see M7).
  if (serialiseCacheKey(before) === serialiseCacheKey(after))
    return 'identical';
  return 'diagnostics';
}
```

## `src/quadtree/cache.ts`

```ts
import type { CachedTile, TileCacheKey, TileID } from './types.js';
import { tileKey, ancestor } from './tile.js';
import { serialiseCacheKey } from './cache_key.js';

/**
 * In-memory tile cache. Eviction is FIFO (least-recently-used by `lastUsed`)
 * for M4; M5 swaps it for a weighted variant that respects
 * `computeCostMs`.
 *
 * The cache is keyed by (TileID, TileCacheKey). When the cache key
 * changes, the old entries are not removed eagerly — they age out via
 * eviction. This is the right behaviour for short-lived knob jiggling
 * because the user typically returns to the previous setting and the
 * old entries are still warm.
 */
export class TileCache {
  private map: Map<string, CachedTile>;
  private ageCounter = 0;

  constructor(public capacity: number) {
    this.map = new Map();
  }

  get size(): number { return this.map.size; }

  private fullKey(id: TileID, k: TileCacheKey): string {
    return `${tileKey(id)}::${serialiseCacheKey(k)}`;
  }

  get(id: TileID, k: TileCacheKey): CachedTile | undefined {
    const key = this.fullKey(id, k);
    const t = this.map.get(key);
    if (t) t.lastUsed = ++this.ageCounter;
    return t;
  }

  put(id: TileID, k: TileCacheKey, tile: Omit<CachedTile, 'cacheAge'|'lastUsed'>): CachedTile {
    if (this.map.size >= this.capacity) this.evictOne();
    const cached: CachedTile = {
      ...tile,
      cacheAge: ++this.ageCounter,
      lastUsed: this.ageCounter,
    };
    this.map.set(this.fullKey(id, k), cached);
    return cached;
  }

  has(id: TileID, k: TileCacheKey): boolean {
    return this.map.has(this.fullKey(id, k));
  }

  /**
   * Walk up the tree from `id` until a cached tile is found under the
   * given `key`. Returns the ancestor and the depth difference.
   */
  walkAncestors(
    id: TileID, k: TileCacheKey, maxLevels = 8,
  ): { tile: CachedTile; ancestor: TileID; deltaZ: number } | null {
    for (let dz = 1; dz <= maxLevels; dz++) {
      const aId = ancestor(id, dz);
      if (!aId) return null;
      const t = this.get(aId, k);
      if (t) return { tile: t, ancestor: aId, deltaZ: dz };
    }
    return null;
  }

  /** Force an eviction. Returns the id that was evicted, if any. */
  private evictOne(): string | null {
    let oldestKey: string | null = null;
    let oldestUsed = Infinity;
    for (const [key, tile] of this.map) {
      if (tile.lifecycle === 'computing') continue;     // never evict in flight
      if (tile.lastUsed < oldestUsed) {
        oldestUsed = tile.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const tile = this.map.get(oldestKey)!;
      tile.simBuffer?.destroy();
      tile.icBuffer?.destroy();
      this.map.delete(oldestKey);
    }
    return oldestKey;
  }

  /** Synchronously drop everything. Used by tests and on chart switches
   *  that change the chart_id. */
  clear(): void {
    for (const tile of this.map.values()) {
      tile.simBuffer?.destroy();
      tile.icBuffer?.destroy();
    }
    this.map.clear();
  }
}
```

## `src/quadtree/compute_queue.ts`

```ts
import type { TileID } from './types.js';

/**
 * FIFO of pending tile compute requests. M5 replaces this with a priority
 * queue. Implementing FIFO as a circular buffer here keeps the
 * data-structure swap below local in M5.
 */
export class FifoComputeQueue {
  private items: TileID[] = [];
  private inflight = new Set<string>();

  push(id: TileID): void {
    const k = `${id.z}/${id.tx}/${id.ty}`;
    if (this.inflight.has(k)) return;
    if (this.items.some(t => t.z === id.z && t.tx === id.tx && t.ty === id.ty)) return;
    this.items.push(id);
  }

  pop(): TileID | undefined {
    const id = this.items.shift();
    if (id) this.inflight.add(`${id.z}/${id.tx}/${id.ty}`);
    return id;
  }

  done(id: TileID): void {
    this.inflight.delete(`${id.z}/${id.tx}/${id.ty}`);
  }

  has(id: TileID): boolean {
    const k = `${id.z}/${id.tx}/${id.ty}`;
    return this.inflight.has(k)
        || this.items.some(t => `${t.z}/${t.tx}/${t.ty}` === k);
  }

  /** Drop every queued (but not yet in flight) request. Used when the
   *  cache key changes wholesale (chart switch). */
  flush(): void { this.items = []; }

  get size(): number { return this.items.length + this.inflight.size; }
  get queued(): number { return this.items.length; }
  get running(): number { return this.inflight.size; }
}
```

## `src/quadtree/visible.ts`

```ts
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
```

## `src/quadtree/index.ts`

```ts
export * from './types.js';
export * from './tile.js';
export * from './pyramid.js';
export * from './camera.js';
export * from './cache_key.js';
export * from './cache.js';
export * from './compute_queue.js';
export * from './visible.js';
```

## Tests

### `test/unit/quadtree/tile.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  tileBounds, tileCentreHalf, ancestor, children, contains, subrect, tileKey,
} from '@/quadtree/tile.js';

describe('tileBounds', () => {
  it('depth 0 covers the unit square', () => {
    expect(tileBounds({ z: 0, tx: 0, ty: 0 }))
      .toEqual({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 });
  });

  it('depth 2 partition is exact', () => {
    const top = { z: 2, tx: 1, ty: 0 };
    const b = tileBounds(top);
    expect(b.uMin).toBeCloseTo(0.25, 12);
    expect(b.uMax).toBeCloseTo(0.5,  12);
    expect(b.vMin).toBe(0);
    expect(b.vMax).toBeCloseTo(0.25, 12);
  });
});

describe('tileCentreHalf', () => {
  it('centre is the mid-point of bounds, half is span/2', () => {
    const id = { z: 3, tx: 5, ty: 2 };
    const ch = tileCentreHalf(id);
    const b = tileBounds(id);
    expect(ch.centre[0]).toBeCloseTo((b.uMin + b.uMax)/2, 12);
    expect(ch.centre[1]).toBeCloseTo((b.vMin + b.vMax)/2, 12);
    expect(ch.half[0]).toBeCloseTo((b.uMax - b.uMin)/2, 12);
    expect(ch.half[1]).toBeCloseTo((b.vMax - b.vMin)/2, 12);
  });
});

describe('ancestor / children', () => {
  it('children-of-ancestor returns the original at NW corner of the lineage', () => {
    const id = { z: 5, tx: 7, ty: 3 };
    const a = ancestor(id, 2)!;
    expect(a).toEqual({ z: 3, tx: 1, ty: 0 });
    expect(children(a)[0]).toEqual({ z: 4, tx: 2, ty: 0 });
  });

  it('ancestor walks past the root return null', () => {
    expect(ancestor({ z: 0, tx: 0, ty: 0 })).toBeNull();
  });
});

describe('contains', () => {
  it('a contains b when b is a descendant', () => {
    const a = { z: 1, tx: 0, ty: 0 };
    const b = { z: 4, tx: 1, ty: 1 };
    expect(contains(a, b)).toBe(true);
  });

  it('siblings do not contain each other', () => {
    expect(contains({ z: 2, tx: 0, ty: 0 }, { z: 2, tx: 1, ty: 0 })).toBe(false);
  });
});

describe('subrect', () => {
  it('NW-of-NW chain shrinks toward the origin corner', () => {
    const a = { z: 0, tx: 0, ty: 0 };
    const b = { z: 3, tx: 0, ty: 0 };
    expect(subrect(a, b)).toEqual([0, 0, 0.125, 0.125]);
  });

  it('NE corner of an immediate child', () => {
    const a = { z: 1, tx: 0, ty: 0 };
    const b = { z: 2, tx: 1, ty: 0 };
    expect(subrect(a, b)).toEqual([0.5, 0, 1.0, 0.5]);
  });
});

describe('tileKey', () => {
  it('is stable across canonical IDs', () => {
    expect(tileKey({ z: 4, tx: 7, ty: 2 })).toBe('4/7/2');
  });
});
```

### `test/unit/quadtree/pyramid.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  tileCountAtDepth, tileSpan, reachedF32Floor,
} from '@/quadtree/pyramid.js';

describe('pyramid arithmetic', () => {
  it('depth 0 has 1 tile, depth k has 4^k', () => {
    expect(tileCountAtDepth(0)).toBe(1);
    expect(tileCountAtDepth(3)).toBe(64);
    expect(tileCountAtDepth(10)).toBe(1024 * 1024);
  });

  it('tileSpan halves with depth', () => {
    expect(tileSpan(0)).toBe(1);
    expect(tileSpan(2)).toBeCloseTo(0.25, 12);
  });
});

describe('reachedF32Floor', () => {
  it('is false at shallow depth', () => {
    expect(reachedF32Floor(5, 16)).toBe(false);
  });

  it('is true once sample spacing drops below ~1e-6', () => {
    // halfWidth = 2^-(z+1); spacing = halfWidth / 8 (with N=16). Solve
    // 2^-(z+5) < 1e-6 → z > ~15. Pick a deep value to be safe.
    expect(reachedF32Floor(25, 16)).toBe(true);
  });
});
```

### `test/unit/quadtree/camera.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { zoomLevel, visibleTilesAt, effectiveZ } from '@/quadtree/camera.js';
import type { QuadtreeView, TileCacheKey } from '@/quadtree/types.js';

describe('zoomLevel', () => {
  // z_base = ⌊log₂(W / (T_pix × Δu_view))⌋: a 1024-pixel viewport of
  // 256-pixel tiles needs 4×4 tiles even fully zoomed out (D4.1 — the
  // original expectations here contradicted the formula above).
  it('full unit-square view on a 1024px viewport of 256px tiles is depth 2', () => {
    expect(zoomLevel(1024, 1.0, 256)).toBe(2);
  });

  it('zooming in by 4× adds two depths', () => {
    expect(zoomLevel(1024, 0.25, 256)).toBe(4);
  });

  it('one-tile viewport is depth 0', () => {
    expect(zoomLevel(256, 1.0, 256)).toBe(0);
  });

  it('caps at zMax', () => {
    expect(zoomLevel(1024, 1e-9, 256, 10)).toBe(10);
  });
});

describe('effectiveZ', () => {
  const key = {} as TileCacheKey;   // effectiveZ never reads the cache key
  const view = (zBase: number, zMax: number): QuadtreeView => ({
    cacheKey: key, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
    zBase, zMax, width: 1024, height: 1024, tilePix: 256,
  });

  it('passes a shallow depth through', () => {
    expect(effectiveZ(view(4, 12), 16)).toBe(4);
  });

  it('walks down to the f32 floor at extreme depth', () => {
    expect(effectiveZ(view(30, 40), 16)).toBeLessThan(30);
  });

  it('applies the view zMax cap', () => {
    expect(effectiveZ(view(6, 3), 16)).toBe(3);
  });
});

describe('visibleTilesAt', () => {
  it('full viewport at depth 1 covers all four tiles', () => {
    const r = visibleTilesAt(1, [0, 0], [0.999, 0.999]);
    expect(r).toEqual({ txMin: 0, txMax: 1, tyMin: 0, tyMax: 1 });
  });

  it('off-screen viewport clamps to the pyramid', () => {
    const r = visibleTilesAt(2, [-0.5, -0.5], [-0.1, -0.1]);
    expect(r.txMax).toBeLessThan(r.txMin);   // empty rectangle
  });
});
```

### `test/unit/quadtree/cache_key.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { serialiseCacheKey, classifyKeyChange } from '@/quadtree/cache_key.js';
import type { TileCacheKey } from '@/quadtree/types.js';

const baseKey: TileCacheKey = {
  chartId: 'latent_slice',
  z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0],
  mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced',
  payloadVersion: 1,
};

describe('cache key serialisation', () => {
  it('is deterministic', () => {
    expect(serialiseCacheKey(baseKey)).toBe(serialiseCacheKey({ ...baseKey }));
  });

  it('changes when integrator changes', () => {
    expect(serialiseCacheKey(baseKey))
      .not.toBe(serialiseCacheKey({ ...baseKey, integrator: 'yoshida4' }));
  });

  it('changes when chartId changes', () => {
    expect(serialiseCacheKey(baseKey))
      .not.toBe(serialiseCacheKey({ ...baseKey, chartId: 'lz_e' }));
  });
});

describe('classifyKeyChange', () => {
  it('reports identical for the same key', () => {
    expect(classifyKeyChange(baseKey, { ...baseKey })).toBe('identical');
  });

  it('reports diagnostics-level for any structural diff', () => {
    expect(classifyKeyChange(baseKey, { ...baseKey, dtMacro: 2e-3 }))
      .toBe('diagnostics');
  });
});
```

### `test/unit/quadtree/cache.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import type { TileCacheKey, TileID } from '@/quadtree/types.js';

const k: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

const id = (z: number, tx: number, ty: number): TileID => ({ z, tx, ty });

describe('TileCache', () => {
  it('round-trips a single tile', () => {
    const c = new TileCache(8);
    c.put(id(2, 0, 0), k, {
      id: id(2, 0, 0), simBuffer: null, icBuffer: null,
      lifecycle: 'ready', computeCostMs: 4,
    });
    expect(c.get(id(2, 0, 0), k)?.lifecycle).toBe('ready');
  });

  it('walks ancestors when a child is missing', () => {
    const c = new TileCache(8);
    c.put(id(0, 0, 0), k, {
      id: id(0, 0, 0), simBuffer: null, icBuffer: null,
      lifecycle: 'ready', computeCostMs: 8,
    });
    const found = c.walkAncestors(id(3, 5, 2), k);
    expect(found?.ancestor).toEqual({ z: 0, tx: 0, ty: 0 });
    expect(found?.deltaZ).toBe(3);
  });

  it('evicts the oldest entry when capacity is exceeded', () => {
    const c = new TileCache(2);
    c.put(id(0, 0, 0), k, { id: id(0,0,0), simBuffer:null, icBuffer:null,
                            lifecycle: 'ready', computeCostMs: 1 });
    c.put(id(1, 0, 0), k, { id: id(1,0,0), simBuffer:null, icBuffer:null,
                            lifecycle: 'ready', computeCostMs: 1 });
    // Touch the first one so the second becomes oldest.
    c.get(id(0, 0, 0), k);
    c.put(id(1, 1, 0), k, { id: id(1,1,0), simBuffer:null, icBuffer:null,
                            lifecycle: 'ready', computeCostMs: 1 });
    expect(c.has(id(1, 0, 0), k)).toBe(false);     // evicted
    expect(c.has(id(0, 0, 0), k)).toBe(true);
    expect(c.has(id(1, 1, 0), k)).toBe(true);
  });

  it('never evicts a tile that is currently computing', () => {
    const c = new TileCache(1);
    c.put(id(0, 0, 0), k, { id: id(0,0,0), simBuffer:null, icBuffer:null,
                            lifecycle: 'computing', computeCostMs: 1 });
    c.put(id(1, 0, 0), k, { id: id(1,0,0), simBuffer:null, icBuffer:null,
                            lifecycle: 'ready', computeCostMs: 1 });
    // The first tile is computing; the second should have been refused
    // eviction protection — but the cache had to make room, so the
    // second insert evicts only what's evictable. Capacity now = 2.
    expect(c.has(id(0, 0, 0), k)).toBe(true);
  });
});
```

### `test/unit/quadtree/compute_queue.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';

describe('FifoComputeQueue', () => {
  it('preserves insertion order', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 1, ty: 0 });
    expect(q.pop()).toEqual({ z: 1, tx: 0, ty: 0 });
    expect(q.pop()).toEqual({ z: 1, tx: 1, ty: 0 });
  });

  it('deduplicates pending requests', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 0, ty: 0 });
    expect(q.queued).toBe(1);
  });

  it('declines duplicate inflight tiles too', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.pop();             // moves into inflight
    q.push({ z: 1, tx: 0, ty: 0 });
    expect(q.queued).toBe(0);
  });

  it('done() removes from the inflight set', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    const t = q.pop()!;
    q.done(t);
    expect(q.size).toBe(0);
  });

  it('flush() drops queued but keeps inflight', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 1, ty: 0 });
    q.pop();             // first goes inflight
    q.flush();
    expect(q.queued).toBe(0);
    expect(q.running).toBe(1);
  });
});
```

### `test/integration/layer1_panning.test.ts`

This integration test simulates a pan trajectory and asserts the screen
never blanks. It does not require a real GPU because we stub the compute
step to deliver tiles after a configurable latency.

```ts
import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';
import { visibleTiles } from '@/quadtree/visible.js';
import { tileKey } from '@/quadtree/tile.js';
import type { TileCacheKey, TileID, QuadtreeView } from '@/quadtree/types.js';

const CKEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

interface ScreenStats {
  totalFrames: number;
  framesWithBlank: number;
  framesWithStretched: number;
}

function runPan(
  cache: TileCache, queue: FifoComputeQueue,
  startView: QuadtreeView,
  endView: QuadtreeView,
  frames: number,
  computeLatency: number,    // tiles delivered after this many frames
): ScreenStats {
  const stats: ScreenStats = {
    totalFrames: 0, framesWithBlank: 0, framesWithStretched: 0,
  };

  // Track when each in-flight tile will finish.
  const finishingFrames = new Map<string, number>();

  for (let f = 0; f < frames; f++) {
    const u = f / Math.max(1, frames - 1);
    const view: QuadtreeView = {
      ...startView,
      uvCentre: [
        startView.uvCentre[0] * (1 - u) + endView.uvCentre[0] * u,
        startView.uvCentre[1] * (1 - u) + endView.uvCentre[1] * u,
      ],
    };

    const tiles = visibleTiles(view);
    let blanksThisFrame = 0;
    let stretchedThisFrame = 0;
    for (const id of tiles) {
      const cached = cache.get(id, CKEY);
      if (cached?.lifecycle === 'ready') continue;
      const fallback = cache.walkAncestors(id, CKEY);
      if (fallback) {
        stretchedThisFrame++;
      } else {
        blanksThisFrame++;
      }
      if (!queue.has(id)) queue.push(id);
    }
    if (blanksThisFrame   > 0) stats.framesWithBlank++;
    if (stretchedThisFrame > 0) stats.framesWithStretched++;
    stats.totalFrames++;

    // Drain finishing tiles.
    for (const [k, dueFrame] of finishingFrames) {
      if (dueFrame <= f) {
        // Cast: noUncheckedIndexedAccess types destructured elements as
        // number | undefined; tileKey() guarantees exactly three parts.
        const [z, tx, ty] = k.split('/').map(Number) as [number, number, number];
        const id: TileID = { z, tx, ty };
        cache.put(id, CKEY, {
          id, simBuffer: null, icBuffer: null,
          lifecycle: 'ready', computeCostMs: 4,
        });
        queue.done(id);
        finishingFrames.delete(k);
      }
    }
    // Pop new compute jobs.
    for (let i = 0; i < 4; i++) {
      const next = queue.pop();
      if (!next) break;
      finishingFrames.set(tileKey(next), f + computeLatency);
    }
  }

  return stats;
}

describe('Layer 1 panning never blanks (with ancestor)', () => {
  it('after seeding the root, a 60-frame pan has zero blank frames', () => {
    const cache = new TileCache(64);
    cache.put({ z: 0, tx: 0, ty: 0 }, CKEY, {
      id: { z: 0, tx: 0, ty: 0 }, simBuffer: null, icBuffer: null,
      lifecycle: 'ready', computeCostMs: 8,
    });
    const queue = new FifoComputeQueue();

    const start: QuadtreeView = {
      cacheKey: CKEY, uvCentre: [0.2, 0.5], uvHalfWidth: [0.05, 0.05],
      zBase: 4, zMax: 12, width: 1024, height: 1024, tilePix: 256,
    };
    const end: QuadtreeView = { ...start, uvCentre: [0.8, 0.5] };

    const stats = runPan(cache, queue, start, end, 60, 5);
    expect(stats.framesWithBlank).toBe(0);
    expect(stats.framesWithStretched).toBeGreaterThan(0); // some upscaling expected
  });

  it('without a seeded root, the first frame blanks; thereafter it does not', () => {
    const cache = new TileCache(64);
    const queue = new FifoComputeQueue();

    const view: QuadtreeView = {
      cacheKey: CKEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
      zBase: 0, zMax: 12, width: 1024, height: 1024, tilePix: 256,
    };
    const stats = runPan(cache, queue, view, view, 30, 2);
    expect(stats.framesWithBlank).toBeGreaterThan(0);   // first frame
    expect(stats.framesWithBlank).toBeLessThan(stats.totalFrames);
  });
});
```

### `test/integration/layer1_zoom_handoff.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';
import { visibleTiles } from '@/quadtree/visible.js';
import type { TileCacheKey, QuadtreeView } from '@/quadtree/types.js';

const CKEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

describe('Layer 1 zoom hand-off', () => {
  it('parent stretched for one frame, then children sharpen', () => {
    const cache = new TileCache(64);
    // Seed depth 1 fully.
    for (let tx = 0; tx < 2; tx++)
      for (let ty = 0; ty < 2; ty++)
        cache.put({ z: 1, tx, ty }, CKEY, {
          id: { z: 1, tx, ty }, simBuffer: null, icBuffer: null,
          lifecycle: 'ready', computeCostMs: 4,
        });

    const queue = new FifoComputeQueue();
    let view: QuadtreeView = {
      cacheKey: CKEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
      zBase: 1, zMax: 6, width: 1024, height: 1024, tilePix: 256,
    };

    // Zoom one level deeper.
    view = { ...view, uvCentre: [0.25, 0.25], uvHalfWidth: [0.25, 0.25],
             zBase: 2 };

    // Frame 1: every visible tile at z=2 missing; ancestor at z=1 used.
    let usedAncestors = 0;
    for (const id of visibleTiles(view)) {
      if (!cache.has(id, CKEY)) {
        const a = cache.walkAncestors(id, CKEY);
        expect(a).not.toBeNull();
        if (a) usedAncestors++;
        if (!queue.has(id)) queue.push(id);
      }
    }
    expect(usedAncestors).toBeGreaterThan(0);

    // Drain the queue (simulate immediate completion).
    while (queue.size > 0) {
      const t = queue.pop()!;
      cache.put(t, CKEY, {
        id: t, simBuffer: null, icBuffer: null,
        lifecycle: 'ready', computeCostMs: 4,
      });
      queue.done(t);
    }

    // Frame 2: every tile is sharp.
    let stretched = 0;
    for (const id of visibleTiles(view)) {
      if (!cache.has(id, CKEY)) stretched++;
    }
    expect(stretched).toBe(0);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/quadtree
npm test -- --run test/integration/layer1
```

## Acceptance check

```bash
npm test -- --run test/integration/layer1
```

Both integration tests pass: panning never blanks once the root is seeded,
and a zoom step shows the parent for one frame and then sharpens.

## Notes for the implementer

- **Where this connects to Layer 0.** The `dispatchLayer0` call from M3
  becomes the per-tile body of the loop here: each compute job pulls a
  `TileID` off the queue, fills `uv_centre` and `uv_half` from
  `tileCentreHalf(id)`, allocates a fresh `simBuffer` / `icBuffer`, and
  dispatches the M3 compute pipeline. The fragment shader for the
  full-screen render uses `subrect` to position the per-tile texture (or,
  for stretched ancestors, samples the ancestor's storage buffer directly
  with the `subrect` offset and scale).
- **The `mag` field of TileCacheKey** is the affine slice's
  half-width-in-latent-space, not the tile's UV half. The viewport's UV
  position determines `uv_centre` / `uv_half` per tile, but the latent
  geometry (`z0`, `q1`, `q2`, `mag`) is shared across all tiles in the
  same view.
- **Cache size.** The default 64-slot cache holds about 64 × 16 KB ≈ 1 MB
  of `SimResult` data at `M=8` and `N=16`. Adjust capacity to whatever
  the device's `maxBufferSize` allows; M5 introduces weighted eviction so
  expensive boundary tiles stay resident even under pressure.
- **The `inflight` protection in `evictOne()`** is the only place where
  the M4 cache departs from pure LRU. A tile mid-dispatch must not have
  its `simBuffer` destroyed; the first eviction-eligible tile is chosen
  instead. With the default capacity and a steady-state of 4 in-flight
  jobs this is invisible. Under pathological eviction pressure the cache
  may run beyond `capacity`; M5's weighted variant fixes this.
