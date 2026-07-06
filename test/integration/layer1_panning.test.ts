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
