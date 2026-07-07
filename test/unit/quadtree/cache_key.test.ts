import { describe, it, expect } from 'vitest';
import { serialiseCacheKey, classifyKeyChange } from '@/quadtree/cache_key.js';
import type { TileCacheKey } from '@/quadtree/types.js';

const baseKey: TileCacheKey = {
  chartId: 'latent_slice',
  chartParams: '{}',
  z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0],
  mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced',
  samplesPerAxis: 16, ensembleCount: 0,
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

  it('changes when a chart knob changes (chartParams is in the key)', () => {
    expect(serialiseCacheKey(baseKey))
      .not.toBe(serialiseCacheKey({ ...baseKey, chartParams: '{"Kmax":4}' }));
  });

  it('changes when samples/axis or ensemble count change (buffer contents)', () => {
    expect(serialiseCacheKey(baseKey))
      .not.toBe(serialiseCacheKey({ ...baseKey, samplesPerAxis: 32 }));
    expect(serialiseCacheKey(baseKey))
      .not.toBe(serialiseCacheKey({ ...baseKey, ensembleCount: 4 }));
  });
});

describe('stableChartParams', () => {
  it('is insensitive to object key order, sensitive to values', async () => {
    const { stableChartParams } = await import('@/interact/view_state.js');
    expect(stableChartParams({ a: 1, b: [2, 3] }))
      .toBe(stableChartParams({ b: [2, 3], a: 1 }));
    expect(stableChartParams({ a: 1 }))
      .not.toBe(stableChartParams({ a: 2 }));
    expect(stableChartParams({ nested: { y: 1, x: 2 } }))
      .toBe(stableChartParams({ nested: { x: 2, y: 1 } }));
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
