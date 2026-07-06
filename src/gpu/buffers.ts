import type { GpuContext } from './init.js';
import { sizeOfSimResult, sizeOfICDescriptor, sizeOfTileReduction } from './structs.js';
import type { PipelineLayouts } from './layouts.js';
import { CHART_UNIFORMS_SIZE } from './layouts.js';

export interface TileBuffers {
  uniforms:    GPUBuffer;
  tileReq:     GPUBuffer;
  simResults:  GPUBuffer;
  icDesc:      GPUBuffer;
  readback:    GPUBuffer;       // optional, M=8 size for one tile
  debug:       GPUBuffer;       // G17 DebugUniform (16B); zero-filled = mode 0 (M3 colouring)
  chart:       GPUBuffer;       // G4 ChartUniforms slot (64B); zero-filled until G4 packs it
  reduction:   GPUBuffer;       // G3: canonical TileReduction output (one home; M5 writes, render binds)
  N:           number;
  M:           number;
}

export function createTileBuffers(
  ctx: GpuContext, N: number, M: number,
): TileBuffers {
  const { device } = ctx;

  const uniforms   = device.createBuffer({
    size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const tileReq    = device.createBuffer({
    size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simResults = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const icDesc     = device.createBuffer({
    size: sizeOfICDescriptor() * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const readback   = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const debug      = device.createBuffer({
    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const chart      = device.createBuffer({
    size: CHART_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const reduction  = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  return {
    uniforms, tileReq, simResults, icDesc, readback,
    debug, chart, reduction, N, M,
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

/**
 * group(3) stays separate so palette / CVD-mode swaps rebind ONLY this
 * group (M7's 64-byte rebind contract) — never the per-tile or frame groups.
 */
export function createRenderParamsBindGroup(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, paramsBuffer: GPUBuffer,
): GPUBindGroup {
  return ctx.device.createBindGroup({
    label: 'principia.bg.renderParams',
    layout: layouts.render,
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });
}
