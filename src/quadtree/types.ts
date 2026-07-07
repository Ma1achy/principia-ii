import type { Vec2, Vec8 } from '@/math/types.js';
import type { TileReduction } from './reduction_types.js';

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
  /** Last-known CPU-side reduction (G7). Survives device loss — the
   *  ancestor-fallback baseline while the tile recomputes. */
  reduction?:   TileReduction | null;
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
