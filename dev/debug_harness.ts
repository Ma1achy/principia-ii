/**
 * Standalone dev harness (G17). Boots the M3 pipeline against a live canvas,
 * renders the grid, and wires the debug toolbox (mode switch, sample inspector,
 * struct dump, NaN scan, frame capture). No app shell, no frame loop — just
 * M3 + G17. Served by Vite: `npm run dev:debug`.
 */
import { initGpu, type GpuContext } from '@/gpu/init.js';
import { createTileBuffers, type TileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0, type DispatchView } from '@/gpu/dispatch_layer0.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { packDebugUniform, DebugMode, DEBUG_MODES, debugModeLabel } from '@/debug/debug_modes.js';
import { pickSample, type InspectRow } from '@/debug/inspector.js';
import { dumpStructLayouts } from '@/debug/struct_dump.js';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { captureFrame, serializeFrame, deserializeFrame } from '@/debug/frame_capture.js';
import { Logger, consoleSink, type LogRecord } from '@/debug/logger.js';

// Linked shader modules (G1 wgslLink; replaces the M3 hand concat).
import { SIMULATE_MODULE, RENDER_LAYER0_MODULE } from './shader_modules.js';

const N = 16;
const M = 8;
const TILE_PIX = 32;

const logPane = document.getElementById('log') as HTMLPreElement;
const paneSink = (rec: LogRecord): void => {
  consoleSink(rec);
  logPane.textContent += `${rec.msg}\n`;
  logPane.scrollTop = logPane.scrollHeight;
};
const log = new Logger({ sink: paneSink });

const DEFAULT_UNIFORMS: SimUniforms = {
  m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
  mu_max: 5, alpha_min: 0.05, q_max: 2,
};
const DEFAULT_TILE: TileRequest = {
  z: 0, tx: 0, ty: 0, level: 0,
  uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
};

function loadShaders(): { simulate: string; render: string } {
  return { simulate: SIMULATE_MODULE, render: RENDER_LAYER0_MODULE };
}

async function readbackToArrayBuffer(ctx: GpuContext, bufs: TileBuffers): Promise<ArrayBuffer> {
  const enc = ctx.device.createCommandEncoder();
  enc.copyBufferToBuffer(bufs.simResults, 0, bufs.readback, 0, bufs.simResults.size);
  ctx.device.queue.submit([enc.finish()]);
  await bufs.readback.mapAsync(GPUMapMode.READ);
  const ab = bufs.readback.getMappedRange().slice(0);
  bufs.readback.unmap();
  return ab;
}

function renderInspectorTable(rows: readonly InspectRow[]): void {
  const table = document.getElementById('inspector') as HTMLTableElement;
  table.innerHTML = '';
  for (const row of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = row.field;
    tr.insertCell().textContent = row.value;
  }
}

function downloadJson(name: string, json: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface ControlHandlers {
  onMode: (m: DebugMode) => void;
  onHeat: (h: number) => void;
  onPick: (x: number, y: number) => Promise<void>;
  onDump: () => void;
  onScan: () => Promise<void>;
  onCapture: () => void;
}

function buildControls(h: ControlHandlers): void {
  const modeBox = document.getElementById('mode-buttons')!;
  for (const info of DEBUG_MODES) {
    const btn = document.createElement('button');
    btn.textContent = info.label;
    const [r, g, b] = info.swatch;
    btn.style.borderLeft = `6px solid rgb(${r * 255},${g * 255},${b * 255})`;
    btn.addEventListener('click', () => h.onMode(info.mode));
    modeBox.append(btn);
  }
  const px = document.getElementById('px') as HTMLInputElement;
  const py = document.getElementById('py') as HTMLInputElement;
  document.getElementById('heat')!.addEventListener('change', (e) =>
    h.onHeat(Number((e.target as HTMLInputElement).value)));
  document.getElementById('pick')!.addEventListener('click', () =>
    void h.onPick(Number(px.value), Number(py.value)));
  document.getElementById('dump')!.addEventListener('click', h.onDump);
  document.getElementById('scan')!.addEventListener('click', () => void h.onScan());
  document.getElementById('capture')!.addEventListener('click', h.onCapture);
  document.getElementById('grid')!.addEventListener('click', (e) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / TILE_PIX);
    const y = Math.floor((e.clientY - rect.top) / TILE_PIX);
    px.value = String(x); py.value = String(y);
    void h.onPick(x, y);
  });
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
  const gpuCtx = canvas.getContext('webgpu')!;
  gpuCtx.configure({ device: ctx.device, format: ctx.format, alphaMode: 'opaque' });

  const bufs = createTileBuffers(ctx, N, M);
  const pl = await buildPipelines(ctx, bufs, loadShaders());

  let mode: DebugMode = DebugMode.Outcome;
  let heatScale = 1e-3;

  function frame(): void {
    // bufs.debug is the G17 DebugUniform at group(0) binding(2); zero = mode 0.
    ctx.device.queue.writeBuffer(bufs.debug, 0, packDebugUniform(mode, heatScale, M));
    const view: DispatchView = { uniforms: DEFAULT_UNIFORMS, tile: DEFAULT_TILE };
    dispatchLayer0(ctx, bufs, pl, view, gpuCtx.getCurrentTexture().createView());
    log.info(`dispatched mode=${debugModeLabel(mode)}`);
  }
  frame();

  buildControls({
    onMode: (m) => { mode = m; frame(); },
    onHeat: (h) => { heatScale = h; frame(); },
    onPick: async (x, y) => {
      const ins = await pickSample(ctx, bufs, N, x, y);
      renderInspectorTable(ins.rows);
      log.info(`picked sample (${x},${y}) #${ins.sample}`);
    },
    onDump: () => dumpStructLayouts(M, (s) => log.info(s)),
    onScan: async () => {
      const ab = await readbackToArrayBuffer(ctx, bufs);
      const hits = scanNonFinite(ab, N, M);
      log.warn(`non-finite samples: ${JSON.stringify(nonFiniteSamples(hits))}`);
    },
    onCapture: () => {
      const json = serializeFrame(captureFrame(N, M, DEFAULT_UNIFORMS, DEFAULT_TILE, 'dev capture'));
      void deserializeFrame(json);   // validate round-trip before download
      downloadJson('frame.json', json);
      log.info('captured frame.json');
    },
  });
}

void main().catch((e: unknown) => log.error('harness failed', e));
