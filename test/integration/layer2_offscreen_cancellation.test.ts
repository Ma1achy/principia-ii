import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import { planFrame } from '@/quadtree/scheduler.js';
import type { QuadtreeView, TileCacheKey } from '@/quadtree/types.js';

const KEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

describe('off-screen cancellation', () => {
  it('planFrame yields zero jobs once the viewport leaves the visible region', () => {
    const cache = new TileCache(64);

    let view: QuadtreeView = {
      cacheKey: KEY, uvCentre: [0.5, 0.5], uvHalfWidth: [0.05, 0.05],
      zBase: 4, zMax: 12, width: 1024, height: 1024, tilePix: 256,
    };
    const jobsOnscreen = planFrame(cache, view, {
      frameBudget: 16, maxInFlight: 0,
      ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobsOnscreen.length).toBeGreaterThan(0);

    // Pan completely out of bounds.
    view = { ...view, uvCentre: [10, 10] };
    const jobsOffscreen = planFrame(cache, view, {
      frameBudget: 16, maxInFlight: 0,
      ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobsOffscreen.length).toBe(0);
  });
});
