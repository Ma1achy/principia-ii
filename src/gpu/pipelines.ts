import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';

export interface Pipelines {
  simulate:    GPUComputePipeline;
  render:      GPURenderPipeline;
  bindGroupCommon: GPUBindGroup;     // group 0 (uniforms + tileReq)
  bindGroupSim:    GPUBindGroup;     // group 1 (results + ic descriptor)
}

export async function buildPipelines(
  ctx: GpuContext, bufs: TileBuffers,
  shaders: { simulate: string; render: string },
): Promise<Pipelines> {
  const { device, format } = ctx;

  const groupCommonLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility:
        GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
      // G17 DebugUniform. The render shader statically uses it, so it must be
      // in the explicit pipeline layout; a zero-filled buffer reads mode = 0
      // (Outcome), which is byte-for-byte the M3 colouring.
      { binding: 2, visibility:
        GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
    ],
  });

  const groupSimLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'storage' } },
      { binding: 1, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'storage' } },
    ],
  });

  const layout = device.createPipelineLayout({
    bindGroupLayouts: [groupCommonLayout, groupSimLayout],
  });

  const simulate = device.createComputePipeline({
    layout,
    compute: {
      module: device.createShaderModule({ code: shaders.simulate }),
      entryPoint: 'simulate',
    },
  });

  const renderModule = device.createShaderModule({ code: shaders.render });
  const render = device.createRenderPipeline({
    layout,
    vertex:   { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const bindGroupCommon = device.createBindGroup({
    layout: groupCommonLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
      { binding: 2, resource: { buffer: bufs.debug } },
    ],
  });

  const bindGroupSim = device.createBindGroup({
    layout: groupSimLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.simResults } },
      { binding: 1, resource: { buffer: bufs.icDesc } },
    ],
  });

  return { simulate, render, bindGroupCommon, bindGroupSim };
}
