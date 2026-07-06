import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import { createTileBindGroups } from './buffers.js';
import { buildLayouts } from './layouts.js';

/**
 * M3 pipelines, G3-refactored: layouts come from the single buildLayouts
 * authority (memoised per device), and the bind groups are the canonical
 * shared set — the same objects rebind cleanly into the reduce and render
 * pipelines. Field names kept from M3 (bindGroupCommon = frame,
 * bindGroupSim = perTile) so dispatch call sites don't churn.
 */
export interface Pipelines {
  simulate:    GPUComputePipeline;
  render:      GPURenderPipeline;
  bindGroupCommon: GPUBindGroup;     // group 0 (canonical frame group)
  bindGroupSim:    GPUBindGroup;     // group 1 (canonical perTile group)
}

export async function buildPipelines(
  ctx: GpuContext, bufs: TileBuffers,
  shaders: { simulate: string; render: string },
): Promise<Pipelines> {
  const { device, format } = ctx;
  const layouts = buildLayouts(device);

  const simulate = device.createComputePipeline({
    label: 'principia.simulate',
    layout: layouts.pipelineSimulate,
    compute: {
      module: device.createShaderModule({ code: shaders.simulate }),
      entryPoint: 'simulate',
    },
  });

  // render_layer0 shares the simulate pipeline layout: it binds only the
  // frame group (uniforms + G17 debug) and the perTile storage.
  const renderModule = device.createShaderModule({ code: shaders.render });
  const render = device.createRenderPipeline({
    label: 'principia.render_layer0',
    layout: layouts.pipelineSimulate,
    vertex:   { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const bgs = createTileBindGroups(ctx, layouts, bufs);
  return {
    simulate, render,
    bindGroupCommon: bgs.frame,
    bindGroupSim: bgs.perTile,
  };
}
