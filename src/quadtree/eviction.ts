import type { CachedTile } from './types.js';

/**
 * Weighted-LRU score. A tile that took 100 ms to compute is worth ~25× a
 * tile that took 4 ms; we don't want to throw away the expensive one
 * just because it was used a moment longer ago.
 *
 * Score = lastUsed - α · log(1 + computeCostMs)
 *
 * Lower score → more evictable. α = 4 by default — empirically chosen so
 * that a tile that took 200 ms gets ~21 frames of "head start" against a
 * 1 ms tile.
 */
export function evictionScore(t: CachedTile, alpha = 4): number {
  return t.lastUsed - alpha * Math.log(1 + t.computeCostMs);
}

/** Pick the tile with the smallest eviction score, skipping computing
 *  tiles. Returns null if no eligible tile exists. */
export function pickEvictee(
  tiles: Iterable<[string, CachedTile]>,
  alpha = 4,
): [string, CachedTile] | null {
  let chosen: [string, CachedTile] | null = null;
  let chosenScore = Infinity;
  for (const entry of tiles) {
    const t = entry[1];
    if (t.lifecycle === 'computing') continue;
    const s = evictionScore(t, alpha);
    if (s < chosenScore) { chosen = entry; chosenScore = s; }
  }
  return chosen;
}
