import { describe, it, expect } from 'vitest';
import { evictionScore, pickEvictee } from '@/quadtree/eviction.js';
import type { CachedTile } from '@/quadtree/types.js';

const make = (lastUsed: number, cost: number, lc: any = 'ready'): CachedTile => ({
  id: { z: 0, tx: 0, ty: 0 },
  simBuffer: null, icBuffer: null,
  lifecycle: lc, cacheAge: 0, lastUsed, computeCostMs: cost,
});

describe('weighted eviction', () => {
  it('expensive tile beats a slightly older cheap tile', () => {
    // cheap: lastUsed 5, cost 1   → score = 5 - 4*log(2)  ≈ 2.23
    // expensive: lastUsed 3, cost 200 → score = 3 - 4*log(201) ≈ -18.21
    expect(evictionScore(make(5, 1)))
      .toBeGreaterThan(evictionScore(make(3, 200)));
  });

  it('ignores in-flight tiles', () => {
    const m = new Map<string, CachedTile>([
      ['busy', make(0, 1, 'computing')],
      ['ok',   make(10, 1)],
    ]);
    const choice = pickEvictee(m);
    expect(choice?.[0]).toBe('ok');
  });

  it('returns null when only computing tiles exist', () => {
    const m = new Map<string, CachedTile>([
      ['a', make(0, 1, 'computing')],
      ['b', make(0, 1, 'computing')],
    ]);
    expect(pickEvictee(m)).toBeNull();
  });
});
