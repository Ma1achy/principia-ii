import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { buildReducePipeline } from '@/gpu/reduce_pipeline.js';
import { dispatchReduce } from '@/gpu/reduce_dispatch.js';
import { readbackReduction } from '@/gpu/reduce_readback.js';
import { DeviceRecovery } from '@/gpu/device_recovery.js';
import { TileCache } from '@/quadtree/cache.js';
import type { TileCacheKey } from '@/quadtree/types.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';
import { wgslLink } from '@/gpu/wgsl/link.js';
import {
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT, DT_MACRO_DEFAULT,
  N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
} from '@/math/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shaderDir = path.join(here, '../../src/gpu/shaders');
const S = (f: string): string => readFileSync(path.join(shaderDir, f), 'utf-8');
const sources = Object.fromEntries(
  ['helpers.wgsl', 'free_group.wgsl', 'observe.wgsl', 'events.wgsl', 'integrate.wgsl',
   'decode.wgsl', 'decode_linear.wgsl', 'simulate.wgsl'].map((f) => [f, S(f)]));
const SIMULATE = wgslLink({ entryPath: 'simulate.wgsl', sources }).module;
const RENDER = S('render_layer0.wgsl');
const REDUCE = S('reduce.wgsl');

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

const N = 16, M = 8;
const uniforms = {
  G: 1,
  dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
  r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
  T_horizon: 5,
  r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
  eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N, integrator: 0,
};
// The full M3 latent slice: a mixed-outcome (fractal-boundary) region.
const tile = {
  z: 0, tx: 0, ty: 0, level: 0,
  uv_centre: [0.5, 0.5] as const, uv_half: [0.5, 0.5] as const,
  flags: 0,
};

describe.skipIf(!hasWebGPU())('G7: ensembles, spreads, device recovery', () => {
  it('ensemble dispatch fills distinct per-copy slices; reduce reports agreement', async () => {
    const ctx = await initGpu();
    const E = 4;
    const bufs = createTileBuffers(ctx, N, M, E);
    const pl = await buildPipelines(ctx, bufs, { simulate: SIMULATE, render: RENDER });
    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();

    dispatchLayer0(ctx, bufs, pl,
      { uniforms, tile, ensemble: { E, patternId: 1 } }, target);
    const all = await readbackSimResults(ctx, bufs);
    expect(all).toHaveLength(N * N * E);

    // Jittered copies must actually differ somewhere (fractal boundary ⇒
    // at least one pixel flips class between copies).
    let interCopyDiff = 0;
    for (let p = 0; p < N * N; p++) {
      const c0 = all[p]!.sample_descriptor & 0x7;
      for (let e = 1; e < E; e++) {
        if ((all[e * N * N + p]!.sample_descriptor & 0x7) !== c0) { interCopyDiff++; break; }
      }
    }
    expect(interCopyDiff).toBeGreaterThan(0);

    const rp = await buildReducePipeline(ctx, bufs, REDUCE);
    ctx.device.queue.submit([dispatchReduce(ctx, rp)]);
    const red = await readbackReduction(rp, M);

    expect(red.ensemble_count).toBe(E);
    expect(red.ensemble_outcome_agreement).toBeGreaterThan(0);
    expect(red.ensemble_outcome_agreement).toBeLessThan(1);   // boundary tile
    expect(red.status_flags & TILE_STATUS.HAS_ENSEMBLE).toBeTruthy();
    expect(red.sample_count).toBe(N * N * E);
  }, 240_000);

  it('the spread pass writes real variance on a mixed tile', async () => {
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, { simulate: SIMULATE, render: RENDER });
    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();

    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, target);
    const rp = await buildReducePipeline(ctx, bufs, REDUCE);
    ctx.device.queue.submit([dispatchReduce(ctx, rp)]);
    const red = await readbackReduction(rp, M);

    // The M3 slice mixes early collisions with T-horizon survivors:
    // t_end and d_min vary strongly, so their spreads must be non-zero.
    expect(red.spread_t_end).toBeGreaterThan(0);
    expect(red.spread_d_min).toBeGreaterThan(0);
    // Checkpoint means are now real (G7): at least one lane non-zero.
    const anyCkpt = red.mean_n_checkpoints.some(
      (c) => c.x !== 0 || c.y !== 0 || c.z !== 0);
    expect(anyCkpt).toBe(true);
    // Shape-trajectory spread: mixed tile ⇒ real angular deviation.
    expect(red.spread_n).toBeGreaterThan(0);
  }, 240_000);

  it('device loss recovery: cache reductions survive, fresh dispatch works', async () => {
    const ctx = await initGpu();
    let bufs = createTileBuffers(ctx, N, M);
    let pl = await buildPipelines(ctx, bufs, { simulate: SIMULATE, render: RENDER });
    const mkTarget = (c: typeof ctx): GPUTextureView => c.device.createTexture({
      size: { width: N, height: N }, format: c.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();

    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, mkTarget(ctx));
    const before = await readbackSimResults(ctx, bufs);
    const histBefore = new Map<number, number>();
    for (const r of before) {
      const c = r.sample_descriptor & 0x7;
      histBefore.set(c, (histBefore.get(c) ?? 0) + 1);
    }

    const cache = new TileCache(8);
    const key: TileCacheKey = {
      chartId: 'latent_slice',
  chartParams: '{}', z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0], mag: 1,
      integrator: 'kdk', dtMacro: 1e-3, nMax: 64,
      THorizon: 80, checkpoints: 8,
      muMax: 5, alphaMin: 0.05, qMax: 2,
      rColl: 1e-4, REsc: 10, kEsc: 8,
      enabledMetrics: 0, qualityTier: 'balanced',
  samplesPerAxis: 16, ensembleCount: 0, payloadVersion: 1,
    };
    cache.put({ z: 0, tx: 0, ty: 0 }, key, {
      id: { z: 0, tx: 0, ty: 0 },
      simBuffer: bufs.simResults, icBuffer: bufs.icDesc,
      lifecycle: 'ready', computeCostMs: 5,
      reduction: { mean_t_end: 1.5 } as never,
    });

    const rec = new DeviceRecovery(ctx, cache, {
      rebuildPipelines: async (fresh) => {
        bufs = createTileBuffers(fresh, N, M);
        pl = await buildPipelines(fresh, bufs, { simulate: SIMULATE, render: RENDER });
      },
      reallocateBuffers: () => {},
    });

    ctx.device.destroy();
    await ctx.device.lost;
    // Let the loss listener run its recovery to completion.
    for (let i = 0; i < 50 && rec.ctx() === ctx; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(rec.ctx()).not.toBe(ctx);

    const entry = cache.get({ z: 0, tx: 0, ty: 0 }, key)!;
    expect(entry.lifecycle).toBe('unseen');
    expect(entry.simBuffer).toBeNull();
    expect((entry.reduction as { mean_t_end: number }).mean_t_end).toBe(1.5);

    // The fresh device renders the same tile with the same classes.
    const fresh = rec.ctx();
    dispatchLayer0(fresh, bufs, pl, { uniforms, tile }, mkTarget(fresh));
    const after = await readbackSimResults(fresh, bufs);
    const histAfter = new Map<number, number>();
    for (const r of after) {
      const c = r.sample_descriptor & 0x7;
      histAfter.set(c, (histAfter.get(c) ?? 0) + 1);
    }
    expect([...histAfter.entries()].sort()).toEqual([...histBefore.entries()].sort());
    rec.dispose();
  }, 240_000);
});
