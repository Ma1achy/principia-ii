import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { inspectionRows } from '@/debug/inspector.js';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { captureFrame, serializeFrame, deserializeFrame, packedInputs } from '@/debug/frame_capture.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { sizeOfSimResult } from '@/gpu/structs.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { wgslLink } from '@/gpu/wgsl/link.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = (f: string): string =>
  readFileSync(path.join(here, '../../src/gpu/shaders', f), 'utf-8');
// Linked by wgslLink (G1; replaces the M3 hand concat), with the
// G17-modified render module.
const sources = Object.fromEntries(
  ['helpers.wgsl', 'observe.wgsl', 'events.wgsl', 'integrate.wgsl',
   'decode.wgsl', 'decode_linear.wgsl', 'simulate.wgsl'].map((f) => [f, S(f)]));
const simulate = wgslLink({ entryPath: 'simulate.wgsl', sources }).module;
const render = S('render_layer0.wgsl');

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

describe.skipIf(!hasWebGPU())('debug harness (real M3 dispatch)', () => {
  const N = 16, M = 8;
  const uniforms: SimUniforms = {
    G: 1,
    dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
    r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
    quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
  };
  const tile: TileRequest = {
    z: 0, tx: 0, ty: 0, level: 0, uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
  };

  it('dispatches, inspects a sample, scans for NaN, and round-trips a capture', async () => {
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, { simulate, render });

    const fakeView = ctx.device.createTexture({
      size: { width: N * 32, height: N * 32 }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }).createView();
    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, fakeView);

    const all = await readbackSimResults(ctx, bufs);
    expect(all).toHaveLength(N * N);

    // Inspector produces a non-empty table for a real sample.
    const rows = inspectionRows(all[Math.floor(N * N / 2)]!);
    expect(rows.some((r) => r.field === 'outcome')).toBe(true);

    // A correct M3 run emits no non-finite metric lanes.
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(bufs.simResults, 0, bufs.readback, 0, bufs.simResults.size);
    ctx.device.queue.submit([enc.finish()]);
    await bufs.readback.mapAsync(GPUMapMode.READ);
    const ab = bufs.readback.getMappedRange().slice(0);
    bufs.readback.unmap();
    expect(ab.byteLength).toBe(sizeOfSimResult(M) * N * N);
    expect(nonFiniteSamples(scanNonFinite(ab, N, M))).toEqual([]);

    // Capture this exact frame and confirm the round-trip re-packs identically.
    const f1 = deserializeFrame(serializeFrame(
      captureFrame(N, M, uniforms, tile, CHART_UNIFORMS_DEFAULTS)));
    const re = packedInputs(f1);
    expect(re.uniforms.byteLength).toBe(64);
    expect(re.tile.byteLength).toBe(48);
    expect(re.chart.byteLength).toBe(64);
  }, 120_000);
});
