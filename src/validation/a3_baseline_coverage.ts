import { registerAcceptance } from './acceptance.js';
import { TileCache } from '@/quadtree/cache.js';
import type { TileCacheKey } from '@/quadtree/types.js';

const KEY: TileCacheKey = {
  chartId: 'latent_slice',
  chartParams: '{}', z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64, THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced',
  samplesPerAxis: 16, ensembleCount: 0, payloadVersion: 1,
};

registerAcceptance(
  'A3', 'baseline coverage during refinement',
  () => {
    const c = new TileCache(64);
    c.put({ z: 0, tx: 0, ty: 0 }, KEY, {
      id: { z: 0, tx: 0, ty: 0 }, simBuffer: null, icBuffer: null,
      lifecycle: 'ready', computeCostMs: 8,
    });
    // For any descendant tile, walkAncestors returns the seeded root:
    // the renderer can always draw SOMETHING while children are pending.
    const found = c.walkAncestors({ z: 4, tx: 5, ty: 3 }, KEY);
    return Promise.resolve({
      id: 'A3', name: 'baseline coverage during refinement',
      passed: !!found,
    });
  },
);
