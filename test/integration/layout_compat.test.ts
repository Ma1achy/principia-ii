import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { buildLayouts } from '@/gpu/layouts.js';
import { createTileBuffers, createTileBindGroups } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { buildReducePipeline } from '@/gpu/reduce_pipeline.js';
import { buildRenderGraph } from '@/render/pipeline.js';
import { wgslLink } from '@/gpu/wgsl/link.js';

const SHADER_DIR = fileURLToPath(new URL('../../src/gpu/shaders/', import.meta.url));

function readAllShaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(SHADER_DIR)) {
    if (f.endsWith('.wgsl')) out[f] = readFileSync(join(SHADER_DIR, f), 'utf8');
  }
  return out;
}

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
  return !!nav?.gpu;
}

describe('buildLayouts identity', () => {
  it('is memoised per device (same objects on every call)', async () => {
    if (!hasWebGPU()) return;
    const ctx = await initGpu();
    const a = buildLayouts(ctx.device);
    const b = buildLayouts(ctx.device);
    expect(a).toBe(b);
    expect(a.perTile).toBe(b.perTile);
  });
});

describe('bind-group layout compatibility across pipelines', () => {
  // The doc's original test only called setBindGroup and never dispatched —
  // WebGPU validates bind-group/pipeline compatibility at dispatch/draw, so
  // that asserted nothing. This version builds the REAL pipelines from the
  // real linked shaders, binds ONE canonical bind-group set in all three,
  // actually dispatches/draws, and asserts the validation error scope is
  // clean.
  it('one canonical bind-group set dispatches in simulate, reduce, and render', async () => {
    if (!hasWebGPU()) return;
    const ctx = await initGpu();
    const { device } = ctx;
    const N = 16, M = 8;
    const bufs = createTileBuffers(ctx, N, M);
    const sources = readAllShaders();

    const pl = await buildPipelines(ctx, bufs, {
      simulate: wgslLink({ entryPath: 'simulate.wgsl', sources }).module,
      render: sources['render_layer0.wgsl']!,
    });
    const rp = await buildReducePipeline(ctx, bufs, sources['reduce.wgsl']!);
    const rg = await buildRenderGraph(
      ctx, bufs, wgslLink({ entryPath: 'render_graph.wgsl', sources }).module);

    // ONE canonical set — the same objects every builder handed back.
    const layouts = buildLayouts(device);
    const bgs = createTileBindGroups(ctx, layouts, bufs);
    expect(pl.bindGroupSim).toBe(rp.bgInput);
    expect(rp.bgInput).toBe(rg.bgStorage);

    device.pushErrorScope('validation');

    const enc = device.createCommandEncoder();
    {
      const pass = enc.beginComputePass({ label: 'compat.simulate' });
      pass.setPipeline(pl.simulate);
      pass.setBindGroup(0, bgs.frame);
      pass.setBindGroup(1, bgs.perTile);
      pass.dispatchWorkgroups(N / 8, N / 8, 1);
      pass.end();
    }
    {
      const pass = enc.beginComputePass({ label: 'compat.reduce' });
      pass.setPipeline(rp.pipeline);
      pass.setBindGroup(0, bgs.frame);
      pass.setBindGroup(1, bgs.perTile);
      pass.setBindGroup(2, bgs.reduction);
      pass.dispatchWorkgroups(1, 1, 1);
      pass.end();
    }
    {
      const target = device.createTexture({
        size: { width: N, height: N }, format: ctx.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      }).createView();
      const pass = enc.beginRenderPass({
        label: 'compat.render_graph',
        colorAttachments: [{
          view: target, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(rg.pipeline);
      pass.setBindGroup(0, bgs.frame);
      pass.setBindGroup(1, bgs.perTile);
      pass.setBindGroup(2, bgs.reduction);
      pass.setBindGroup(3, rg.bgRenderParams);
      pass.draw(3, 1);
      pass.end();
    }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();

    const err = await device.popErrorScope();
    expect(err, err ? err.message : '').toBeNull();
  }, 60_000);
});
