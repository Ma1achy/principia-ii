import type { GpuContext } from '@/gpu/init.js';
import type { TileBuffers } from '@/gpu/buffers.js';
import {
  createTileBindGroups, createRenderParamsBindGroup, createTileWindowBuffer,
} from '@/gpu/buffers.js';
import { buildLayouts } from '@/gpu/layouts.js';
import { packEventPalette, EVENT_PALETTE_SIZE } from './params.js';
import { DEFAULT_RENDER_PARAMS } from './types.js';

/**
 * Build the render pipeline plus its bind groups. `RenderParams` lives
 * alone in group(3) so palette swaps and overlay toggles only rewrite the
 * 64-byte params buffer and rebind group 3 — groups 0, 1, 2 stay constant
 * across mode changes.
 *
 * G3-refactored: layouts come from the single buildLayouts authority, so
 * the bind groups here are the SAME canonical objects the simulate and
 * reduce pipelines use. Consequences of sharing:
 *   - group(1) is bound as 'storage' (read-write), so render_graph.wgsl
 *     declares `var<storage, read_write>` — WebGPU requires the shader's
 *     access mode to match the layout's buffer type (same rule that shaped
 *     render_layer0.wgsl in G17).
 *   - group(2) binds the real canonical TileReduction buffer instead of
 *     M7's empty-layout placeholder (the shader doesn't read it yet;
 *     tile-debug overlays will).
 * Field names kept from M7 (bgTile/bgStorage) so call sites don't churn.
 */
export interface RenderGraph {
  pipeline:       GPURenderPipeline;
  bgTile:         GPUBindGroup;   // group 0: canonical frame group
  bgStorage:      GPUBindGroup;   // group 1: canonical perTile group
  bgReduction:    GPUBindGroup;   // group 2: canonical reduction group
  bgRenderParams: GPUBindGroup;   // group 3: RenderParams + TileWindow + EventPalette
  paramsBuffer:   GPUBuffer;
  /** G8: per-draw screen rect + tile-UV window (defaults to the full
   *  window, so single-tile callers render exactly as before). */
  windowBuffer:   GPUBuffer;
  /** Customisable event-classification colours (render-only, group 3 b2). */
  eventPaletteBuffer: GPUBuffer;
}

export async function buildRenderGraph(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<RenderGraph> {
  const { device, format } = ctx;
  const layouts = buildLayouts(device);

  const module = device.createShaderModule({ code });
  const pipeline = device.createRenderPipeline({
    label: 'principia.render_graph',
    layout: layouts.pipelineRender,
    vertex:   { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const eventPaletteBuffer = device.createBuffer({
    label: 'principia.eventPalette',
    size: EVENT_PALETTE_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(eventPaletteBuffer, 0,
    packEventPalette(DEFAULT_RENDER_PARAMS));

  const windowBuffer = createTileWindowBuffer(ctx);
  const bgs = createTileBindGroups(ctx, layouts, bufs);
  const bgRenderParams = createRenderParamsBindGroup(
    ctx, layouts, paramsBuffer, windowBuffer, eventPaletteBuffer);

  return {
    pipeline,
    bgTile: bgs.frame,
    bgStorage: bgs.perTile,
    bgReduction: bgs.reduction,
    bgRenderParams,
    paramsBuffer,
    windowBuffer,
    eventPaletteBuffer,
  };
}
