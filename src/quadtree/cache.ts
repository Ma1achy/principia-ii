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

  /** Iterate every cached entry (G7: device recovery walks the cache to
   *  null dead GPU buffers while keeping the CPU-side reductions). */
  *entries(): IterableIterator<CachedTile> {
    yield* this.map.values();
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
