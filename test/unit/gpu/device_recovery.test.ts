import { describe, it, expect } from 'vitest';
import { DeviceRecovery } from '@/gpu/device_recovery.js';
import { TileCache } from '@/quadtree/cache.js';
import type { GpuContext } from '@/gpu/init.js';
import type { TileCacheKey, TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** A device whose `lost` promise we control. */
function fakeCtx(): { ctx: GpuContext; lose: (reason: string) => void } {
  let lose!: (reason: string) => void;
  const lost = new Promise<{ reason: string; message: string }>((res) => {
    lose = (reason: string) => res({ reason, message: 'test-forced' });
  });
  const ctx = { device: { lost } } as unknown as GpuContext;
  return { ctx, lose: (r) => lose(r) };
}

const KEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
  THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};
const ID: TileID = { z: 2, tx: 1, ty: 1 };

function seedCache(): TileCache {
  const cache = new TileCache(8);
  cache.put(ID, KEY, {
    id: ID,
    simBuffer: { label: 'dead-sim' } as unknown as GPUBuffer,
    icBuffer:  { label: 'dead-ic' }  as unknown as GPUBuffer,
    lifecycle: 'ready',
    computeCostMs: 4,
    reduction: { mean_t_end: 42 } as unknown as TileReduction,
  });
  return cache;
}

describe('DeviceRecovery (G7)', () => {
  it('recover() rebuilds, reallocates, and resets cache entries — keeping reductions', async () => {
    const { ctx } = fakeCtx();
    const cache = seedCache();
    const calls: string[] = [];
    const fresh = fakeCtx().ctx;

    const rec = new DeviceRecovery(ctx, cache, {
      rebuildPipelines: async () => { calls.push('pipelines'); },
      reallocateBuffers: () => { calls.push('buffers'); },
      onRecovering: () => { calls.push('recovering'); },
      onRecovered:  () => { calls.push('recovered'); },
    }, async () => { calls.push('acquire'); return fresh; });

    await rec.recover();

    expect(calls).toEqual(['recovering', 'acquire', 'pipelines', 'buffers', 'recovered']);
    expect(rec.ctx()).toBe(fresh);
    expect(rec.isRecovering()).toBe(false);

    const entry = cache.get(ID, KEY)!;
    expect(entry.lifecycle).toBe('unseen');
    expect(entry.simBuffer).toBeNull();
    expect(entry.icBuffer).toBeNull();
    // The CPU-side reduction SURVIVES the loss — ancestor-fallback baseline.
    expect((entry.reduction as { mean_t_end: number }).mean_t_end).toBe(42);
  });

  it('a device-loss event triggers recovery automatically', async () => {
    const { ctx, lose } = fakeCtx();
    const cache = seedCache();
    let rebuilt = 0;
    new DeviceRecovery(ctx, cache, {
      rebuildPipelines: async () => { rebuilt++; },
      reallocateBuffers: () => {},
    }, async () => fakeCtx().ctx);

    lose('destroyed');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(rebuilt).toBe(1);
    expect(cache.get(ID, KEY)!.lifecycle).toBe('unseen');
  });

  it('a second loss on the FRESH device is observed (listener reattached)', async () => {
    const first = fakeCtx();
    const second = fakeCtx();
    const third = fakeCtx();
    const acquired = [second.ctx, third.ctx];
    let rebuilt = 0;
    const rec = new DeviceRecovery(first.ctx, seedCache(), {
      rebuildPipelines: async () => { rebuilt++; },
      reallocateBuffers: () => {},
    }, async () => acquired.shift()!);

    first.lose('unknown');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(rebuilt).toBe(1);
    expect(rec.ctx()).toBe(second.ctx);

    second.lose('unknown');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(rebuilt).toBe(2);
    expect(rec.ctx()).toBe(third.ctx);
  });

  it('a STALE device losing after recovery does not re-trigger', async () => {
    const first = fakeCtx();
    const second = fakeCtx();
    let rebuilt = 0;
    const rec = new DeviceRecovery(first.ctx, seedCache(), {
      rebuildPipelines: async () => { rebuilt++; },
      reallocateBuffers: () => {},
    }, async () => second.ctx);

    await rec.recover();          // manual recovery swaps to `second`
    expect(rebuilt).toBe(1);

    first.lose('unknown');        // the OLD device dies afterwards
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(rebuilt).toBe(1);      // no double recovery
  });

  it('dispose() stops loss reactions', async () => {
    const { ctx, lose } = fakeCtx();
    let rebuilt = 0;
    const rec = new DeviceRecovery(ctx, seedCache(), {
      rebuildPipelines: async () => { rebuilt++; },
      reallocateBuffers: () => {},
    }, async () => fakeCtx().ctx);

    rec.dispose();
    lose('destroyed');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(rebuilt).toBe(0);
  });
});
