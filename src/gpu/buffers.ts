import type { GpuContext } from './init.js';
import { sizeOfSimResult, sizeOfICDescriptor, sizeOfTileReduction } from './structs.js';
import type { PipelineLayouts } from './layouts.js';
import { CHART_UNIFORMS_SIZE, TILE_WINDOW_SIZE } from './layouts.js';
import { LINEARISED_UNIFORMS_SIZE } from './linearised_uniforms.js';
import { ENSEMBLE_OFFSETS_SIZE } from './ensemble.js';
import { SLICE_UNIFORMS_SIZE, DEFAULT_SLICE, packSliceUniforms } from './slice_uniforms.js';
import { sizeOfUploadedICs } from './uploaded_ics.js';

export interface TileBuffers {
  uniforms:    GPUBuffer;
  tileReq:     GPUBuffer;
  simResults:  GPUBuffer;
  icDesc:      GPUBuffer;
  readback:    GPUBuffer;       // optional, M=8 size for one tile
  debug:       GPUBuffer;       // G17 DebugUniform (16B); zero-filled = mode 0 (M3 colouring)
  chart:       GPUBuffer;       // G4 ChartUniforms slot (64B); zero-filled until G4 packs it
  linearised:  GPUBuffer;       // G6 LinearisedRef (256B); zero-filled — only read when the flag is set
  ensemble:    GPUBuffer;       // G7 EnsembleOffsets (256B); zero-filled = no jitter
  slice:       GPUBuffer;       // SliceUniforms (112B); seeded with DEFAULT_SLICE (= the M3 mapping)
  uploaded:    GPUBuffer;       // UploadedIC[] (64B × N² × EMax); only read when DECODE_UPLOADED is set
  reduction:   GPUBuffer;       // G3: canonical TileReduction output (one home; M5 writes, render binds)
  N:           number;
  M:           number;
  /** G7: ensemble capacity the per-tile buffers were sized for (≥ 1). */
  EMax:        number;
}

export function createTileBuffers(
  ctx: GpuContext, N: number, M: number, EMax = 1,
): TileBuffers {
  const { device } = ctx;
  const copies = Math.max(1, EMax);

  const uniforms   = device.createBuffer({
    size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });   // G4: slimmed SimUniforms

  const tileReq    = device.createBuffer({
    size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simResults = device.createBuffer({
    size: sizeOfSimResult(M) * N * N * copies,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const icDesc     = device.createBuffer({
    size: sizeOfICDescriptor() * N * N * copies,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const readback   = device.createBuffer({
    size: sizeOfSimResult(M) * N * N * copies,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const debug      = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const chart      = device.createBuffer({
    size: CHART_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const linearised = device.createBuffer({
    size: LINEARISED_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const ensemble   = device.createBuffer({
    size: ENSEMBLE_OFFSETS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Seeded with the default slice so every harness/test that never writes
  // it keeps the M3 bring-up mapping (u → z[0], v → z[1], ±3) bit-exactly.
  const slice      = device.createBuffer({
    size: SLICE_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(slice, 0, packSliceUniforms(DEFAULT_SLICE));

  const uploaded   = device.createBuffer({
    size: sizeOfUploadedICs(N, copies),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const reduction  = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  return {
    uniforms, tileReq, simResults, icDesc, readback,
    debug, chart, linearised, ensemble, slice, uploaded,
    reduction, N, M, EMax: copies,
  };
}

/**
 * The canonical bind groups (G3). One set per TileBuffers, allocated
 * against the canonical layouts, valid in EVERY pipeline whose layout
 * includes the corresponding group — that's the G3 contract.
 */
export interface TileBindGroups {
  /** group(0) — frame-level uniforms (SimUniforms, TileRequest, Debug, Chart). */
  frame:     GPUBindGroup;
  /** group(1) — per-tile storage (SimResult[], ICDescriptor[]). */
  perTile:   GPUBindGroup;
  /** group(2) — per-tile reduction output (TileReduction). */
  reduction: GPUBindGroup;
}

// One canonical set per TileBuffers: every builder (simulate, reduce,
// render) hands back the SAME bind-group objects, not equivalent copies.
// (WebGPU only requires layout identity, but object identity makes the
// sharing contract testable and avoids redundant allocations.)
const bindGroupCache = new WeakMap<TileBuffers, TileBindGroups>();

export function createTileBindGroups(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, bufs: TileBuffers,
): TileBindGroups {
  const hit = bindGroupCache.get(bufs);
  if (hit) return hit;
  const frame = ctx.device.createBindGroup({
    label: 'principia.bg.frame',
    layout: layouts.frame,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
      { binding: 2, resource: { buffer: bufs.debug } },     // G17
      { binding: 3, resource: { buffer: bufs.chart } },     // G4 slot
      { binding: 4, resource: { buffer: bufs.linearised } },// G6 slot
      { binding: 5, resource: { buffer: bufs.ensemble } },  // G7 slot
      { binding: 6, resource: { buffer: bufs.slice } },     // slice map
      { binding: 7, resource: { buffer: bufs.uploaded } },  // uploaded ICs
    ],
  });
  const perTile = ctx.device.createBindGroup({
    label: 'principia.bg.perTile',
    layout: layouts.perTile,
    entries: [
      { binding: 0, resource: { buffer: bufs.simResults } },
      { binding: 1, resource: { buffer: bufs.icDesc } },
    ],
  });
  const reduction = ctx.device.createBindGroup({
    label: 'principia.bg.reduction',
    layout: layouts.reduction,
    entries: [
      { binding: 0, resource: { buffer: bufs.reduction } },
    ],
  });
  const bgs: TileBindGroups = { frame, perTile, reduction };
  bindGroupCache.set(bufs, bgs);
  return bgs;
}

/** Pack a G8 TileWindow: screen rect (y down, [0,1]²) + tile-UV window. */
export function packTileWindow(
  rect: readonly [number, number, number, number],
  uv:   readonly [number, number, number, number] = [0, 0, 1, 1],
): ArrayBuffer {
  const buf = new ArrayBuffer(TILE_WINDOW_SIZE);
  new Float32Array(buf).set([...rect, ...uv]);
  return buf;
}

/** A TileWindow uniform buffer initialised to the full window (whole
 *  screen, whole tile) — single-tile callers render unchanged. */
export function createTileWindowBuffer(ctx: { device: GPUDevice }): GPUBuffer {
  const buf = ctx.device.createBuffer({
    label: 'principia.tileWindow',
    size: TILE_WINDOW_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.device.queue.writeBuffer(buf, 0, packTileWindow([0, 0, 1, 1]));
  return buf;
}

/**
 * group(3) stays separate so palette / CVD-mode swaps rebind ONLY this
 * group (M7's 64-byte rebind contract) — never the per-tile or frame groups.
 * G8 adds the TileWindow at binding 1 (per-draw screen rect + UV window).
 */
export function createRenderParamsBindGroup(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, paramsBuffer: GPUBuffer,
  windowBuffer: GPUBuffer,
): GPUBindGroup {
  return ctx.device.createBindGroup({
    label: 'principia.bg.renderParams',
    layout: layouts.render,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: windowBuffer } },
    ],
  });
}
