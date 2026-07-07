import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { wgslLink } from '@/gpu/wgsl/link.js';
import { packSliceUniforms, DEFAULT_SLICE } from '@/gpu/slice_uniforms.js';
import {
  packUploadedICs, buildUploadedICs, type UploadedICSample,
} from '@/gpu/uploaded_ics.js';
import { TILE_REQUEST_FLAGS } from '@/gpu/structs.js';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import { getChart } from '@/chart_atlas/index.js';
import type { ChartView } from '@/chart_atlas/types.js';
import { stateEnergy } from '@/integrate/regularize.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT, EPS_DEADBAND,
  DT_MACRO_DEFAULT, N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
} from '@/math/constants.js';

/**
 * The chart/latent-slicing fix, proven on a live device: the GPU decode
 * must FOLLOW the view — a slice change must change the frame, and both
 * decode inputs (SliceUniforms for latent-affine charts, uploaded ICs for
 * the rest) must land on the CPU chart's own initial conditions.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const shaderDir = path.join(here, '../../src/gpu/shaders');
const RENDER = readFileSync(path.join(shaderDir, 'render_layer0.wgsl'), 'utf-8');
const SIM_SOURCES = Object.fromEntries(
  ['helpers.wgsl', 'observe.wgsl', 'events.wgsl', 'integrate.wgsl',
   'decode.wgsl', 'decode_linear.wgsl', 'simulate.wgsl']
    .map((f) => [f, readFileSync(path.join(shaderDir, f), 'utf-8')]));
const linked = (): string =>
  wgslLink({ entryPath: 'simulate.wgsl', sources: SIM_SOURCES }).module;

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

const N = 8, M = 8;
const uniforms = {
  G: 1,
  dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
  r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
  T_horizon: 1,                     // decode is checked at t = 0 (E_0)
  r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
  eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N, integrator: 0,
};
const tile = {
  z: 0, tx: 0, ty: 0, level: 0,
  uv_centre: [0.5, 0.5] as const,
  uv_half:   [0.5, 0.5] as const,
  flags: 0,
};
const view: ChartView = {
  chartParams: {},
  z0: [0.4, -0.3, 0.6, 0.1, -0.5, 0.2, 0.3, -0.1],
  q1: [0, 0, 1, 0, 0, 0, 0, 0],     // slice through z[2] × z[4] — NOT the
  q2: [0, 0, 0, 0, 1, 0, 0, 0],     // M3 default (z[0] × z[1]) mapping
  mag: 1.5,
  alphaMin: ALPHA_MIN_DEFAULT, muMax: MU_MAX_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
};

describe('chart decode on the GPU (slice uniforms + uploaded ICs)', () => {
  it('a slice change changes the decode, and matches the CPU chart at t=0', async () => {
    if (!hasWebGPU()) {
      console.warn('skipping: WebGPU unavailable');
      return;
    }
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs,
      { simulate: linked(), render: RENDER });
    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();

    // Pass 1: the seeded DEFAULT_SLICE (M3 behaviour).
    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, target);
    const before = await readbackSimResults(ctx, bufs);

    // Pass 2: the view's own slice, as the dispatcher now uploads it.
    const s = latentSliceChart.affineSlice!(view)!;
    ctx.device.queue.writeBuffer(bufs.slice, 0, packSliceUniforms(s));
    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, target);
    const after = await readbackSimResults(ctx, bufs);

    // The regression that motivated the fix: recomputing with a different
    // slice must NOT reproduce the same frame.
    const moved = after.some((r, i) =>
      r.E_0 !== before[i]!.E_0 ||
      r.sample_descriptor !== before[i]!.sample_descriptor);
    expect(moved).toBe(true);

    // And the decode must be the CPU chart's: compare initial energies of
    // every non-terminal pixel (f32 decode vs f64 → loose relative gate).
    let checked = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N, v = (j + 0.5) / N;
        const dec = latentSliceChart.decode([u, v], view);
        const gpu = after[j * N + i]!;
        if (dec.kind !== 'ok') continue;
        if ((gpu.sample_descriptor & 0x7) === 3) continue;   // f32 boundary flip
        expect(Math.abs(gpu.E_0 - stateEnergy(dec.state)))
          .toBeLessThanOrEqual(1e-3 * Math.max(1, Math.abs(stateEnergy(dec.state))));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(N * N / 2);   // the gate actually bound

    // Restore the seeded default for any suite sharing the device.
    ctx.device.queue.writeBuffer(bufs.slice, 0, packSliceUniforms(DEFAULT_SLICE));
  }, 240_000);

  it('uploaded ICs: the GPU integrates exactly what the CPU chart decoded (lz_e)', async () => {
    if (!hasWebGPU()) {
      console.warn('skipping: WebGPU unavailable');
      return;
    }
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs,
      { simulate: linked(), render: RENDER });
    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();

    const chart = getChart('lz_e');
    expect(chart.affineSlice?.(view) ?? null).toBeNull();   // uploaded path

    const samples = buildUploadedICs(
      (u, v) => {
        const out = chart.decode([u, v], view);
        return out.kind === 'ok'
          ? { terminal: 0, m: out.state.m, r: out.state.r, p: out.state.p }
          : { terminal: out.terminal.kind === 'COLLISION_T0' ? 2 : 1,
              m: [1 / 3, 1 / 3, 1 / 3],
              r: [[0, 0], [0, 0], [0, 0]], p: [[0, 0], [0, 0], [0, 0]] } as UploadedICSample;
      },
      { uv_centre: tile.uv_centre, uv_half: tile.uv_half }, N,
      [{ du: 0, dv: 0 }]);
    ctx.device.queue.writeBuffer(bufs.uploaded, 0, packUploadedICs(samples));

    dispatchLayer0(ctx, bufs, pl, {
      uniforms,
      tile: { ...tile, flags: TILE_REQUEST_FLAGS.DECODE_UPLOADED },
    }, target);
    const gpu = await readbackSimResults(ctx, bufs);

    let okChecked = 0, terminalChecked = 0;
    for (let idx = 0; idx < N * N; idx++) {
      const s = samples[idx]!;
      const r = gpu[idx]!;
      if (s.terminal !== 0) {
        // write_terminal maps 1 → DEGENERATE (3), 2 → COLLISION (1).
        expect(r.sample_descriptor & 0x7).toBe(s.terminal === 2 ? 1 : 3);
        terminalChecked++;
        continue;
      }
      const eCpu = stateEnergy({ m: s.m, r: s.r, p: s.p, t: 0 });
      expect(Math.abs(r.E_0 - eCpu))
        .toBeLessThanOrEqual(1e-3 * Math.max(1, Math.abs(eCpu)));
      okChecked++;
    }
    expect(okChecked + terminalChecked).toBe(N * N);
    expect(okChecked).toBeGreaterThan(0);   // the slice isn't all-degenerate
  }, 240_000);
});
