/**
 * M7 dev harness. Runs the M3 compute pipeline ONCE to fill the
 * SimResult/ICDescriptor buffers, then never touches the compute side
 * again: every control change re-packs the 64-byte RenderParams uniform,
 * rebinds group 3, and re-encodes one render pass. Groups 0/1/2 and the
 * sim storage buffers are never rewritten — the render-only contract by
 * eye. Served by Vite: `npm run dev:render`.
 */
import { initGpu, type GpuContext } from '@/gpu/init.js';
import { createTileBuffers, type TileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { packSimUniforms, packTileRequest } from '@/gpu/structs.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { buildRenderGraph, type RenderGraph } from '@/render/pipeline.js';
import { packRenderParams } from '@/render/params.js';
import {
  DEFAULT_RENDER_PARAMS,
  type RenderParams, type ColourMode, type BrightnessMode,
  type CombinerMode, type CvdMode, type PaletteId,
} from '@/render/types.js';
import { COLOUR_SOURCES, BRIGHTNESS_SOURCES } from '@/render/mode_registry.js';

// Linked shader modules (G1 wgslLink; replaces the M3/M7 hand concat orders).
import {
  SIMULATE_MODULE, RENDER_LAYER0_MODULE, RENDER_GRAPH_MODULE,
} from '@/gpu/shaders/modules.js';

// ?n=32 renders a higher-resolution grid (canvas = 32·N px); default 16.
const N = Math.max(8, Math.min(64,
  Number(new URLSearchParams(location.search).get('n') ?? 16) || 16));
const M = 8;
const TILE_PIX = 32;

const RENDER_MODULE = RENDER_GRAPH_MODULE;

const logPane = document.getElementById('log') as HTMLPreElement;
function log(msg: string): void {
  console.log(msg);
  logPane.textContent += `${msg}\n`;
  logPane.scrollTop = logPane.scrollHeight;
}

const DEFAULT_UNIFORMS: SimUniforms = {
  G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
};
const DEFAULT_TILE: TileRequest = {
  z: 0, tx: 0, ty: 0, level: 0,
  uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
};

const COLOUR_MODES = Object.keys(COLOUR_SOURCES) as ColourMode[];
const BRIGHTNESS_MODES = Object.keys(BRIGHTNESS_SOURCES) as BrightnessMode[];
const COMBINERS: CombinerMode[] = ['replace_lightness', 'modulate_lightness', 'multiply_rgb'];
const CVDS: CvdMode[] = ['none', 'protan', 'deutan', 'tritan', 'achrom'];
const PALETTES: PaletteId[] = ['viridis', 'cividis', 'plasma', 'magma', 'inferno',
                               'twilight', 'cool_warm', 'principia', 'cubehelix'];

const params: RenderParams = { ...DEFAULT_RENDER_PARAMS };

function encodeRenderPass(
  ctx: GpuContext, graph: RenderGraph, target: GPUTextureView,
): void {
  const enc = ctx.device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    label: 'm7-render-graph',
    colorAttachments: [{
      view: target,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }],
  });
  pass.setPipeline(graph.pipeline);
  pass.setBindGroup(0, graph.bgTile);
  pass.setBindGroup(1, graph.bgStorage);
  pass.setBindGroup(2, graph.bgReduction);   // canonical reduction group (G3)
  pass.setBindGroup(3, graph.bgRenderParams);
  pass.draw(6, 1);   // G8: windowed quad
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('grid') as HTMLCanvasElement;
  canvas.width = N * TILE_PIX;
  canvas.height = N * TILE_PIX;

  if (!('gpu' in navigator)) {
    document.body.append(Object.assign(document.createElement('p'), {
      textContent: 'WebGPU unavailable in this browser.',
    }));
    return;
  }

  const ctx = await initGpu(canvas);
  ctx.device.addEventListener('uncapturederror', (e) => {
    console.error(`WebGPU uncaptured error: ${(e as GPUUncapturedErrorEvent).error.message}`);
  });
  const gpuCtx = canvas.getContext('webgpu')!;
  gpuCtx.configure({ device: ctx.device, format: ctx.format, alphaMode: 'opaque' });

  const bufs = createTileBuffers(ctx, N, M);

  // --- Compute ONCE (M3 pipeline), then leave the sim buffers alone. ---
  const pl = await buildPipelines(ctx, bufs, {
    simulate: SIMULATE_MODULE,
    render: RENDER_LAYER0_MODULE,
  });
  ctx.device.queue.writeBuffer(bufs.uniforms, 0, packSimUniforms(DEFAULT_UNIFORMS));
  ctx.device.queue.writeBuffer(bufs.tileReq, 0, packTileRequest(DEFAULT_TILE));
  {
    const enc = ctx.device.createCommandEncoder();
    const pass = enc.beginComputePass({ label: 'simulate-once' });
    pass.setPipeline(pl.simulate);
    pass.setBindGroup(0, pl.bindGroupCommon);
    pass.setBindGroup(1, pl.bindGroupSim);
    pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8), 1);
    pass.end();
    ctx.device.queue.submit([enc.finish()]);
  }
  await ctx.device.queue.onSubmittedWorkDone();
  log(`computed ${N}x${N} tile once; sim buffers are now frozen`);

  // --- M7 render graph: the only thing that runs from here on. ---
  const graph = await buildRenderGraph(ctx, bufs, RENDER_MODULE);
  log('render graph built (4 bind groups; RenderParams alone in group 3)');

  function repaint(): void {
    ctx.device.queue.writeBuffer(graph.paramsBuffer, 0, packRenderParams(params));
    encodeRenderPass(ctx, graph, gpuCtx.getCurrentTexture().createView());
    log(`repaint: colour=${params.colourMode} bright=${params.brightnessMode} ` +
        `comb=${params.combinerMode} cvd=${params.cvdMode} pal=${params.palette} ` +
        `(64B uniform write only)`);
  }

  // Offscreen validation hook for the Playwright check: renders with the
  // given overrides into an rgba8unorm texture and returns the centre pixel
  // of each tile (N*N*4 bytes) — canvas presentation is glitchy headless.
  (window as unknown as Record<string, unknown>)['__m7RenderPixels'] =
    async (overrides: Partial<RenderParams>): Promise<number[]> => {
      Object.assign(params, overrides);
      ctx.device.queue.writeBuffer(graph.paramsBuffer, 0, packRenderParams(params));
      // Must match the pipeline's colour-target format (bgra8unorm on mac);
      // a mismatched attachment fails validation and leaves the buffer zero.
      const tex = ctx.device.createTexture({
        size: [canvas.width, canvas.height],
        format: ctx.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      encodeRenderPass(ctx, graph, tex.createView());
      const bytesPerRow = canvas.width * 4;           // 2048, 256-aligned
      const buf = ctx.device.createBuffer({
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = ctx.device.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: tex }, { buffer: buf, bytesPerRow },
        [canvas.width, canvas.height]);
      ctx.device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const all = new Uint8Array(buf.getMappedRange());
      const out: number[] = [];
      for (let ty = 0; ty < N; ty++) {
        for (let tx = 0; tx < N; tx++) {
          const px = tx * TILE_PIX + TILE_PIX / 2;
          const py = ty * TILE_PIX + TILE_PIX / 2;
          const o = py * bytesPerRow + px * 4;
          out.push(all[o]!, all[o + 1]!, all[o + 2]!, all[o + 3]!);
        }
      }
      buf.unmap(); buf.destroy(); tex.destroy();
      return out;
    };

  // Full-frame variant: renders offscreen and paints into a 2D canvas
  // (#shot) — the known workaround for the headless presentation glitch,
  // so Playwright screenshots show real render-graph output.
  (window as unknown as Record<string, unknown>)['__m7Paint2D'] =
    async (overrides: Partial<RenderParams>): Promise<void> => {
      Object.assign(params, overrides);
      ctx.device.queue.writeBuffer(graph.paramsBuffer, 0, packRenderParams(params));
      const tex = ctx.device.createTexture({
        size: [canvas.width, canvas.height],
        format: ctx.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      encodeRenderPass(ctx, graph, tex.createView());
      const bytesPerRow = canvas.width * 4;
      const buf = ctx.device.createBuffer({
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = ctx.device.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: tex }, { buffer: buf, bytesPerRow },
        [canvas.width, canvas.height]);
      ctx.device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const img = new ImageData(canvas.width, canvas.height);
      const bgra = ctx.format.startsWith('bgra');
      for (let i = 0; i < src.length; i += 4) {
        img.data[i]     = src[bgra ? i + 2 : i]!;
        img.data[i + 1] = src[i + 1]!;
        img.data[i + 2] = src[bgra ? i : i + 2]!;
        img.data[i + 3] = 255;
      }
      buf.unmap(); buf.destroy(); tex.destroy();
      let shot = document.getElementById('shot') as HTMLCanvasElement | null;
      if (!shot) {
        shot = document.createElement('canvas');
        shot.id = 'shot';
        shot.width = canvas.width; shot.height = canvas.height;
        document.body.append(shot);
      }
      shot.getContext('2d')!.putImageData(img, 0, 0);
    };

  function wireSelect<T extends string>(
    id: string, values: readonly T[], initial: T, set: (v: T) => void,
  ): void {
    const sel = document.getElementById(id) as HTMLSelectElement;
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (v === initial) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => { set(sel.value as T); repaint(); });
  }
  wireSelect('colour', COLOUR_MODES, params.colourMode, (v) => { params.colourMode = v; });
  wireSelect('brightness', BRIGHTNESS_MODES, params.brightnessMode, (v) => { params.brightnessMode = v; });
  wireSelect('combiner', COMBINERS, params.combinerMode, (v) => { params.combinerMode = v; });
  wireSelect('cvd', CVDS, params.cvdMode, (v) => { params.cvdMode = v; });
  wireSelect('palette', PALETTES, params.palette, (v) => { params.palette = v; });
  for (const [id, set] of [
    ['kappa', (x: number) => { params.vmfKappa = x; }],
    ['chroma', (x: number) => { params.vmfChroma = x; }],
    ['lightness', (x: number) => { params.vmfLightness = x; }],
  ] as const) {
    document.getElementById(id)!.addEventListener('input', (e) => {
      set(Number((e.target as HTMLInputElement).value)); repaint();
    });
  }

  repaint();
  (window as unknown as Record<string, unknown>)['__m7Ready'] = true;
}

void main().catch((e: unknown) => log(`harness failed: ${String(e)}`));
