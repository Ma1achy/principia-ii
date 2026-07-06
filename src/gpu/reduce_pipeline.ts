import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import { createTileBindGroups } from './buffers.js';
import { buildLayouts } from './layouts.js';
import { sizeOfTileReduction } from './structs.js';

/**
 * M5 reduce pipeline, G3-refactored: consumes the canonical layouts and
 * bind groups. The output buffer is the canonical bufs.reduction (one
 * home — the render pipeline binds the same buffer at group(2)); the
 * shader's group(1) input is declared `var<storage, read_write>` to match
 * the shared 'storage' layout (WebGPU requires the access modes to match).
 * Field names kept from M5 so dispatch/readback call sites don't churn.
 */
export interface ReducePipeline {
  pipeline:    GPUComputePipeline;
  bgCommon:    GPUBindGroup;         // group 0 (canonical frame group)
  bgInput:     GPUBindGroup;         // group 1 (canonical perTile group)
  bgOutput:    GPUBindGroup;         // group 2 (canonical reduction group)
  outputBuf:   GPUBuffer;            // = bufs.reduction
  readbackBuf: GPUBuffer;
}

export async function buildReducePipeline(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<ReducePipeline> {
  const { device } = ctx;
  const layouts = buildLayouts(device);

  const pipeline = device.createComputePipeline({
    label: 'principia.reduce',
    layout: layouts.pipelineReduce,
    compute: { module: device.createShaderModule({ code }), entryPoint: 'reduce' },
  });

  const readbackBuf = device.createBuffer({
    size: sizeOfTileReduction(bufs.M),
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const bgs = createTileBindGroups(ctx, layouts, bufs);
  return {
    pipeline,
    bgCommon: bgs.frame,
    bgInput: bgs.perTile,
    bgOutput: bgs.reduction,
    outputBuf: bufs.reduction,
    readbackBuf,
  };
}
