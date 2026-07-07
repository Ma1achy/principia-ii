import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { TILE_REQUEST_FLAGS } from '@/gpu/structs.js';
import { buildLinearised, applyLinearised } from '@/decode/linearised.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { totalEnergy } from '@/integrate/forces.js';
import { wgslLink } from '@/gpu/wgsl/link.js';
import type { TrajState } from '@/math/types.js';
import type { LatentZ } from '@/decode/types.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT,
  EPS_DEADBAND, DT_MACRO_DEFAULT,
  N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
} from '@/math/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shaderDir = path.join(here, '../../src/gpu/shaders');
const SOURCES = Object.fromEntries(
  ['helpers.wgsl', 'observe.wgsl', 'events.wgsl', 'integrate.wgsl',
   'decode.wgsl', 'decode_linear.wgsl', 'simulate.wgsl']
    .map((f) => [f, readFileSync(path.join(shaderDir, f), 'utf-8')]));
const SIMULATE = wgslLink({ entryPath: 'simulate.wgsl', sources: SOURCES }).module;
const RENDER = readFileSync(path.join(shaderDir, 'render_layer0.wgsl'), 'utf-8');

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

// A depth-10 tile (half = 2⁻¹¹): deep enough that linearisation error is
// far below f32 noise, shallow enough that the full f32 path still
// resolves samples — so the two GPU decodes must agree.
const CENTRE: readonly [number, number] = [0.31, 0.57];
const HALF = Math.pow(2, -11);

function decodeAtTileUV(uv: [number, number]): TrajState | null {
  const gu = CENTRE[0] + HALF * (2 * uv[0] - 1);
  const gv = CENTRE[1] + HALF * (2 * uv[1] - 1);
  // The M3 default slice mapping in simulate.wgsl: z = (2·uv − 1) · 3.
  const z: LatentZ = [(2 * gu - 1) * 3, (2 * gv - 1) * 3, 0, 0, 0, 0, 0, 0];
  const out = decodeLatent(z, KNOBS);
  return out.kind === 'ok' ? out.state : null;
}

describe.skipIf(!hasWebGPU())('linearised decode on the GPU (G6)', () => {
  it('flag-selected decode_linear agrees with decode_full and with the CPU twin', async () => {
    const ctx = await initGpu();
    const N = 16, M = 8;
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, { simulate: SIMULATE, render: RENDER });

    const uniforms = {
      G: 1,
      dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
      r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
      T_horizon: 0.05,                 // decode-side test: barely integrate
      r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
      eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
      quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
    };
    const tileBase = {
      z: 10, tx: 0, ty: 0, level: 0,
      uv_centre: [CENTRE[0], CENTRE[1]] as const,
      uv_half:   [HALF, HALF] as const,
    };

    const ref = buildLinearised(decodeAtTileUV);
    expect(ref).not.toBeNull();
    if (!ref) return;

    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }).createView();

    // Pass A: full nonlinear decode.
    dispatchLayer0(ctx, bufs, pl,
      { uniforms, tile: { ...tileBase, flags: 0 } }, target);
    const full = await readbackSimResults(ctx, bufs);

    // Pass B: linearised decode via the request flag.
    dispatchLayer0(ctx, bufs, pl, {
      uniforms,
      tile: { ...tileBase, flags: TILE_REQUEST_FLAGS.DECODE_LINEAR },
      linearised: ref,
    }, target);
    const lin = await readbackSimResults(ctx, bufs);

    let checked = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        const t: [number, number] = [(i + 0.5) / N, (j + 0.5) / N];
        const eFull = full[idx]!.E_0 as number;
        const eLin = lin[idx]!.E_0 as number;
        const cpu = applyLinearised(ref, t);
        const eCpu = totalEnergy(cpu.m, cpu.r, cpu.p);

        // decode_linear (f32) vs its CPU twin (f64): identical arithmetic,
        // so only f32 rounding separates them. Any LinearisedRef lane swap
        // produces O(1) garbage here.
        expect(Math.abs(eLin - eCpu), `E_0 lin-vs-cpu at (${i}, ${j})`)
          .toBeLessThan(1e-2);
        // decode_linear vs decode_full on the GPU: linearisation error at
        // depth 10 is ≪ f32 noise.
        expect(Math.abs(eLin - eFull), `E_0 lin-vs-full at (${i}, ${j})`)
          .toBeLessThan(1e-2);
        if (Math.abs(eCpu) > 0.1) checked++;
      }
    }
    // The comparison must not be vacuously zero-vs-zero.
    expect(checked).toBeGreaterThan(200);
  }, 240_000);

  it('dispatch refuses the flag without a reference (silent-zero guard)', async () => {
    const ctx = await initGpu();
    const N = 8, M = 8;
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, { simulate: SIMULATE, render: RENDER });
    const target = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();
    expect(() => dispatchLayer0(ctx, bufs, pl, {
      uniforms: {
        G: 1, dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
        r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT, T_horizon: 1,
        r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
        eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
        quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
      },
      tile: { z: 25, tx: 0, ty: 0, level: 0,
              uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5],
              flags: TILE_REQUEST_FLAGS.DECODE_LINEAR },
    }, target)).toThrow(/linearised reference/);
  }, 60_000);
});
