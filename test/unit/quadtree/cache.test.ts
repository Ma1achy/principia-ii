import { describe, it, expect } from 'vitest';
import { TileCache } from '@/quadtree/cache.js';
import type { TileCacheKey, TileID } from '@/quadtree/types.js';

const k: TileCacheKey = {
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
