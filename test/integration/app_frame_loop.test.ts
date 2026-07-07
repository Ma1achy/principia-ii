import { describe, it, expect } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher, FrameDeps } from '@/app/types.js';
import type { TileID } from '@/quadtree/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { tileKey } from '@/quadtree/tile.js';
import { stubReduction } from '../helpers/stub_reduction.js';

function makeDeps(): FrameDeps & { advance: (ms: number) => void } {
  let now = 0;
  return {
    now: () => now,
    schedule: () => 0,          // ticks are driven manually
    cancel: () => {},
    advance: (ms) => { now += ms; },
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** Tick + flush until every visible tile is a cache hit (bounded). */
async function settle(app: App, maxTicks = 12): Promise<ReturnType<App['loop']['tickOnce']>> {
  let stats = app.loop.tickOnce();
  await flush();
  for (let i = 0; i < maxTicks && stats.cacheHits !== stats.visible; i++) {
    stats = app.loop.tickOnce();
    await flush();
  }
  return stats;
}

interface StubStats {
  d: GpuDispatcher;
  dispatched: TileID[];
  renders: number;
  inspects: number;
}

function makeStub(): StubStats {
  const s: StubStats = {
    dispatched: [], renders: 0, inspects: 0,
    d: {
      dispatchTile: async (tileId) => {
        s.dispatched.push(tileId);
        return stubReduction(tileId);
      },
      cancel: () => {},
      render: () => { s.renders++; },
      inspect: async () => {
        s.inspects++;
        return {} as InspectorResult;
      },
    },
  };
  return s;
}

describe('App frame loop (G2)', () => {
  it('100 synthetic ticks: renders every frame, dispatches each tile at most once, converges to cache hits', async () => {
    const stub = makeStub();
    const deps = makeDeps();
    const app = new App(stub.d, deps);

    let lastStats = app.loop.tickOnce();
    await flush();
    for (let f = 1; f < 100; f++) {
      deps.advance(16);
      lastStats = app.loop.tickOnce();
      await flush();
    }

    expect(stub.renders).toBe(100);

    // Any tile dispatched at most once.
    const seen = new Set<string>();
    for (const t of stub.dispatched) {
      const k = tileKey(t);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(stub.dispatched.length).toBeGreaterThan(0);

    // Steady state: every visible tile is a cache hit, nothing dispatches.
    expect(lastStats.visible).toBeGreaterThan(0);
    expect(lastStats.cacheHits).toBe(lastStats.visible);
    expect(lastStats.jobsDispatched).toBe(0);
  });

  it('a pan reuses overlapping tiles and only dispatches the newly exposed ones', async () => {
    const stub = makeStub();
    const app = new App(stub.d, makeDeps(), { maxInFlight: 32 });

    // Zoom to a partial view of the domain (z=2: 16 tiles, ~4 visible)
    // so a pan can actually expose uncovered tiles.
    app.store.update((v) => ({ ...v, uvHalfWidth: [0.25, 0.25] }));
    await settle(app);
    const afterFirst = stub.dispatched.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Pan left by half the viewport: overlap stays cached, the newly
    // exposed column (tx = 0, the only uncovered one at z = 2 — tile
    // ranges are edge-inclusive) dispatches.
    app.store.update((v) => ({
      ...v, uvCentre: [v.uvCentre[0] - 0.25, v.uvCentre[1]],
    }));
    const stats = await settle(app);
    const afterPan = stub.dispatched.length;
    expect(afterPan).toBeGreaterThan(afterFirst);           // new tiles came in
    expect(afterPan - afterFirst).toBeLessThan(afterFirst); // …but not a full redraw
    expect(stats.cacheHits).toBe(stats.visible);
    const seen = new Set(stub.dispatched.map(tileKey));
    expect(seen.size).toBe(stub.dispatched.length);         // still no dupes
  });

  it('a zoom step deepens the frontier and dispatches the deeper tiles once', async () => {
    const stub = makeStub();
    const app = new App(stub.d, makeDeps(), { maxInFlight: 32 });
    await settle(app);
    const shallow = stub.dispatched.length;

    // Halve the UV viewport (one level deeper).
    app.store.update((v) => ({
      ...v, uvHalfWidth: [v.uvHalfWidth[0] / 2, v.uvHalfWidth[1] / 2],
    }));
    const stats = await settle(app);
    expect(stats.cacheHits).toBe(stats.visible);
    expect(stub.dispatched.length).toBeGreaterThan(shallow);
    expect(Math.max(...stub.dispatched.map((t) => t.z)))
      .toBeGreaterThan(Math.min(...stub.dispatched.map((t) => t.z)));
    const seen = new Set(stub.dispatched.map(tileKey));
    expect(seen.size).toBe(stub.dispatched.length);
  });

  it('chart switch preserves the lock and invalidates the compute cache key', async () => {
    const stub = makeStub();
    const app = new App(stub.d, makeDeps());

    app.input.lock({ s: 0.5, t: 0.5 });
    expect(app.store.snapshot().locked).toBe(true);
    const lockedBefore = app.store.snapshot().lockedPhysical!;
    const r = app.input.switchChart('lz_e');
    expect(r.ok).toBe(true);
    const lockedAfter = app.store.snapshot().lockedPhysical!;
    for (let i = 0; i < 3; i++) {
      expect(lockedAfter.r[i]![0]).toBeCloseTo(lockedBefore.r[i]![0], 4);
      expect(lockedAfter.r[i]![1]).toBeCloseTo(lockedBefore.r[i]![1], 4);
    }
  });

  it('the inspector recomputes once on lock and clears on unlock', async () => {
    const stub = makeStub();
    const app = new App(stub.d, makeDeps());
    expect(app.inspector()).toBeNull();

    app.input.lock({ s: 0.5, t: 0.5 });
    expect(app.inspector()).not.toBeNull();
    expect(stub.inspects).toBe(1);

    // Further ticks and unrelated store writes do not re-kick it.
    app.loop.tickOnce();
    app.store.update((v) => ({ ...v }));
    expect(stub.inspects).toBe(1);

    app.input.unlock();
    expect(app.inspector()).toBeNull();
    expect(stub.inspects).toBe(1);
  });

  it('a view-identical update (palette-class knob) does not trigger a compute dispatch', async () => {
    const stub = makeStub();
    const app = new App(stub.d, makeDeps());
    app.loop.tickOnce();
    await flush();
    app.loop.tickOnce();          // settle: everything cached
    const before = stub.dispatched.length;

    // Render-only knobs never feed viewStateToCacheKey; a state write
    // that leaves the cache key unchanged must not recompute.
    app.store.update((v) => ({ ...v, zoom: v.zoom }));
    const stats = app.loop.tickOnce();
    expect(stub.dispatched.length).toBe(before);
    expect(stats.jobsDispatched).toBe(0);
  });
});
