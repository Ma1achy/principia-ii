import type { GpuContext } from '@/gpu/init.js';
import type { TileBuffers } from '@/gpu/buffers.js';

/**
 * Build the render pipeline plus its bind groups. `RenderParams` lives
 * alone in group(3) so palette swaps and overlay toggles only rewrite the
 * 64-byte params buffer and rebind group 3 — groups 0, 1, 2 stay constant
 * across mode changes.
 *
 * M7 owns its own bind-group layouts (unlike the M3 render pass, which
 * shares the compute layouts): group 1 binds the sim buffers as
 * read-only-storage, matching the shader's `var<storage, read>`.
 */
export interface RenderGraph {
  pipeline:       GPURenderPipeline;
  bgTile:         GPUBindGroup;   // group 0: SimUniforms + TileRequest
  bgStorage:      GPUBindGroup;   // group 1: SimResult[] + ICDescriptor[]
  bgEmpty:        GPUBindGroup;   // group 2: reserved for M5 reduction (empty,
                                  // but WebGPU still requires it set at draw)
  bgRenderParams: GPUBindGroup;   // group 3: RenderParams uniform
  paramsBuffer:   GPUBuffer;
}

export async function buildRenderGraph(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<RenderGraph> {
  const { device, format } = ctx;

  // group 0 (uniforms / tile)
  const groupTileLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
    ],
  });
  // group 1 (storage)
  const groupStorageLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' } },
    ],
  });
  // group 2 (reduction storage — unused for static shading, reserved for M5+)
  const groupEmptyLayout = device.createBindGroupLayout({ entries: [] });
  const groupParamsLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
    ],
  });

  const layout = device.createPipelineLayout({
    bindGroupLayouts: [
      groupTileLayout, groupStorageLayout, groupEmptyLayout, groupParamsLayout,
    ],
  });

  const module = device.createShaderModule({ code });
  const pipeline = device.createRenderPipeline({
    layout,
    vertex:   { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bgTile = device.createBindGroup({
    layout: groupTileLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
    ],
  });
  const bgStorage = device.createBindGroup({
    layout: groupStorageLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.simResults } },
      { binding: 1, resource: { buffer: bufs.icDesc } },
    ],
  });
  const bgEmpty = device.createBindGroup({ layout: groupEmptyLayout, entries: [] });
  const bgRenderParams = device.createBindGroup({
    layout: groupParamsLayout,
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });

  return { pipeline, bgTile, bgStorage, bgEmpty, bgRenderParams, paramsBuffer };
}
