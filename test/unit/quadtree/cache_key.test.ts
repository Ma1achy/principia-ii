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
