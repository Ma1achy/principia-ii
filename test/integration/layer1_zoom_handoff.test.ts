import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';
import { visibleTiles } from '@/quadtree/visible.js';
import type { TileCacheKey, QuadtreeView } from '@/quadtree/types.js';

const CKEY: TileCacheKey = {
  chartId: 'latent_slice',
  chartParams: '{}', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced',
  samplesPerAxis: 16, ensembleCount: 0, payloadVersion: 1,
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
