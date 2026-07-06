import { describe, it, expect } from 'vitest';
import { zoomLevel, visibleTilesAt, effectiveZ } from '@/quadtree/camera.js';
import type { QuadtreeView, TileCacheKey } from '@/quadtree/types.js';

describe('zoomLevel', () => {
  // z_base = ⌊log₂(W / (T_pix × Δu_view))⌋: a 1024-pixel viewport of
  // 256-pixel tiles needs 4×4 tiles even fully zoomed out (D4.1).
  it('full unit-square view on a 1024px viewport of 256px tiles is depth 2', () => {
    expect(zoomLevel(1024, 1.0, 256)).toBe(2);
  });

  it('zooming in by 4× adds two depths', () => {
    expect(zoomLevel(1024, 0.25, 256)).toBe(4);
  });

  it('one-tile viewport is depth 0', () => {
    expect(zoomLevel(256, 1.0, 256)).toBe(0);
  });

  it('caps at zMax', () => {
    expect(zoomLevel(1024, 1e-9, 256, 10)).toBe(10);
  });
});

describe('visibleTilesAt', () => {
  it('full viewport at depth 1 covers all four tiles', () => {
    const r = visibleTilesAt(1, [0, 0], [0.999, 0.999]);
    expect(r).toEqual({ txMin: 0, txMax: 1, tyMin: 0, tyMax: 1 });
  });

  it('off-screen viewport clamps to the pyramid', () => {
    const r = visibleTilesAt(2, [-0.5, -0.5], [-0.1, -0.1]);
    expect(r.txMax).toBeLessThan(r.txMin);   // empty rectangle
  });
});

describe('effectiveZ', () => {
  const key = {} as TileCacheKey;   // effectiveZ never reads the cache key
  const view = (zBase: number, zMax: number): QuadtreeView => ({
    cacheKey: key, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
    zBase, zMax, width: 1024, height: 1024, tilePix: 256,
  });

  it('passes a shallow depth through', () => {
    expect(effectiveZ(view(4, 12), 16)).toBe(4);
  });

  it('walks down to the f32 floor at extreme depth', () => {
    expect(effectiveZ(view(30, 40), 16)).toBeLessThan(30);
  });

  it('applies the view zMax cap', () => {
    expect(effectiveZ(view(6, 3), 16)).toBe(3);
  });
});
