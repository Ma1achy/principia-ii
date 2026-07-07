import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { run } from '@/integrate/run.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT,
  EPS_DEADBAND, DT_MACRO_DEFAULT,
  N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
} from '@/math/constants.js';
import { wgslLink } from '@/gpu/wgsl/link.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shaderDir = path.join(here, '../../src/gpu/shaders');
const RENDER = readFileSync(path.join(shaderDir, 'render_layer0.wgsl'), 'utf-8');
const SIM_SOURCES = Object.fromEntries(
  ['helpers.wgsl', 'observe.wgsl', 'events.wgsl', 'integrate.wgsl',
   'decode.wgsl', 'decode_linear.wgsl', 'simulate.wgsl']
    .map((f) => [f, readFileSync(path.join(shaderDir, f), 'utf-8')]));

// G1: linked by wgslLink (replaces the M3 stub concatShaders()).
function concatShaders(): string {
  return wgslLink({ entryPath: 'simulate.wgsl', sources: SIM_SOURCES }).module;
}

function classOf(d: number): number { return d & 0x7; }

function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

describe('Layer 0 GPU vs CPU', () => {
  it('classifies a 16x16 sample within the chaos-calibrated agreement gate', async () => {
    if (!hasWebGPU()) {
      console.warn('skipping: WebGPU unavailable');
      return;
    }
    const ctx = await initGpu();
    const N = 16, M = 8;
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, {
      simulate: concatShaders(),
      render: RENDER,
    });

    const uniforms = {
      G: 1,
      dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
      r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
      T_horizon: 50,                   // shorter horizon for the test
      r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
      eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
      quality_tier: 1, checkpoint_count: M,
      samples_per_axis: N, integrator: 0,
    };
    // G4: chart hyperparameters ride in ChartUniforms (defaults = the M3
    // latent-slice values, so the CPU reference knobs below still match).
    const tile = {
      z: 0, tx: 0, ty: 0, level: 0,
      uv_centre: [0.5, 0.5] as const,
      uv_half:   [0.5, 0.5] as const,
      flags: 0,
    };

    const fakeView = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }).createView();

    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, fakeView);

    const gpuResults = await readbackSimResults(ctx, bufs);

    // CPU reference for each sample.
    const params = {
      integrator: 'kdk' as const,
      dtMacro: uniforms.dt_macro, THorizon: uniforms.T_horizon,
      rColl: uniforms.r_coll, REsc: uniforms.R_esc, kEsc: uniforms.k_esc,
      substep: { rSub: uniforms.r_sub, gammaSub: uniforms.gamma_sub,
                 NMax: uniforms.N_max },
    };
    const knobs = {
      muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
      rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
    };

    const cpuClassOf = (z: readonly number[]): number => {
      const dec = decodeLatent(z as any, knobs);
      if (dec.kind === 'terminal') {
        return dec.terminal.kind === 'COLLISION_T0' ? 1 :
               dec.terminal.kind === 'DEGENERATE'   ? 3 : 0;
      }
      const r = run(dec.state, params, {});
      return r.terminal.kind === 'COLLISION' ? 1 :
             r.terminal.kind === 'ESCAPE'    ? 2 :
             r.terminal.kind === 'BOUNDED'   ? 0 :
             r.terminal.kind === 'DEGENERATE'? 3 : 4;
    };

    // Chaos-calibrated gate (see M3 notes + docs/build-decisions-ledger.md
    // D3.2). This latent slice is dominated by rest-start collapse orbits with
    // fractal basin boundaries; f32-vs-f64 legitimately flips boundary pixels,
    // so exact per-pixel agreement is unattainable in principle. Instead:
    // classify each pixel twice on the CPU (at z and at z + 1e-4, the
    // f32-error scale) — the self-flip count measures the slice's intrinsic
    // chaos. Gates: (1) the GPU may disagree with the CPU at most 1.5× as
    // often as the CPU disagrees with itself; (2) per-class histogram totals
    // agree within 15%. A real shader bug (wrong force, layout mismatch)
    // blows through both; measured values: gpuDisagree 95 vs cpuSelfFlip 81,
    // histDelta 10/256.
    const NUDGE = 1e-4;
    let rawAgree = 0, cpuSelfFlip = 0;
    const gpuHist = new Map<number, number>(), cpuHist = new Map<number, number>();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        const u = (i + 0.5) / N, v = (j + 0.5) / N;
        const z0 = (u*2 - 1) * 3, z1 = (v*2 - 1) * 3;
        const cpuClass  = cpuClassOf([z0, z1, 0, 0, 0, 0, 0, 0]);
        const cpuClassP = cpuClassOf([z0 + NUDGE, z1 + NUDGE, 0, 0, 0, 0, 0, 0]);
        const gpuClass = classOf(gpuResults[idx]!.sample_descriptor);
        gpuHist.set(gpuClass, (gpuHist.get(gpuClass) ?? 0) + 1);
        cpuHist.set(cpuClass, (cpuHist.get(cpuClass) ?? 0) + 1);
        if (gpuClass === cpuClass) rawAgree++;
        if (cpuClass !== cpuClassP) cpuSelfFlip++;
      }
    }

    const gpuDisagree = N*N - rawAgree;
    let histDelta = 0;
    for (const c of [0, 1, 2, 3, 4]) {
      histDelta += Math.abs((gpuHist.get(c) ?? 0) - (cpuHist.get(c) ?? 0));
    }

    expect(gpuDisagree).toBeLessThanOrEqual(Math.max(6, Math.ceil(cpuSelfFlip * 1.5)));
    expect(histDelta).toBeLessThanOrEqual(Math.round(N * N * 0.15));
  }, 240_000);
});
