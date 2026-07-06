import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import { sizeOfTileReduction } from './structs.js';

export interface ReducePipeline {
  pipeline:    GPUComputePipeline;
  bgCommon:    GPUBindGroup;
  bgInput:     GPUBindGroup;
  bgOutput:    GPUBindGroup;
  outputBuf:   GPUBuffer;
  readbackBuf: GPUBuffer;
}

export async function buildReducePipeline(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<ReducePipeline> {
  const { device } = ctx;

  const groupCommon = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
    ],
  });
  const groupInput = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' } },
    ],
  });
  const groupOutput = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' } },
    ],
  });

  const layout = device.createPipelineLayout({
    bindGroupLayouts: [groupCommon, groupInput, groupOutput],
  });
  const pipeline = device.createComputePipeline({
    layout,
    compute: { module: device.createShaderModule({ code }), entryPoint: 'reduce' },
  });

  const M = bufs.M;
  const outputBuf = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readbackBuf = device.createBuffer({
    size: sizeOfTileReduction(M),
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const bgCommon = device.createBindGroup({
    layout: groupCommon,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
    ],
  });
  const bgInput = device.createBindGroup({
    layout: groupInput,
    entries: [{ binding: 0, resource: { buffer: bufs.simResults } }],
  });
  const bgOutput = device.createBindGroup({
    layout: groupOutput,
    entries: [{ binding: 0, resource: { buffer: outputBuf } }],
  });

  return { pipeline, bgCommon, bgInput, bgOutput, outputBuf, readbackBuf };
}
