import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import type { Pipelines }   from './pipelines.js';
import type { SimUniforms, TileRequest } from './structs.js';
import { packSimUniforms, packTileRequest, TILE_REQUEST_FLAGS } from './structs.js';
import type { ChartUniforms } from './chart_uniforms.js';
import { packChartUniforms, CHART_UNIFORMS_DEFAULTS } from './chart_uniforms.js';
import type { LinearisedReference } from '@/decode/linearised.js';
import { packLinearisedUniforms } from './linearised_uniforms.js';

export interface DispatchView {
  uniforms: SimUniforms;
  tile:     TileRequest;
  /** Per-chart decoder knobs (G4). Defaults to CHART_UNIFORMS_DEFAULTS
   *  (the latent-slice values), preserving pre-G4 behaviour. */
  chart?:   ChartUniforms;
  /** G6: linearised decode reference. REQUIRED when tile.flags carries
   *  TILE_REQUEST_FLAGS.DECODE_LINEAR — a zero LinearisedRef would decode
   *  every sample to the origin with zero masses, silently. */
  linearised?: LinearisedReference;
}

/**
 * Run one compute pass + one render pass over the visible tile. For M3 the
 * tile fills the viewport.
 *
 * ADR-0005 dispatch contract: M3's single-tile pass is the degenerate case of
 * the chunked dispatch scheme (one chunk, one submit, nothing to abandon).
 * M4 implements the real multi-tile loop — centre-out queue, per-chunk
 * submit, stale-viewGeneration abandonment — under that contract.
 */
export function dispatchLayer0(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines,
  view: DispatchView, target: GPUTextureView,
): void {
  const { device } = ctx;

  device.queue.writeBuffer(bufs.uniforms, 0, packSimUniforms(view.uniforms));
  device.queue.writeBuffer(bufs.tileReq,  0, packTileRequest(view.tile));
  device.queue.writeBuffer(bufs.chart,    0,
    packChartUniforms(view.chart ?? CHART_UNIFORMS_DEFAULTS));

  if ((view.tile.flags & TILE_REQUEST_FLAGS.DECODE_LINEAR) !== 0) {
    if (!view.linearised) {
      throw new Error(
        'dispatchLayer0: DECODE_LINEAR flag set without a linearised reference');
    }
    device.queue.writeBuffer(bufs.linearised, 0, packLinearisedUniforms(
      view.linearised, view.tile.uv_half[0], view.tile.uv_half[1]));
  }

  const enc = device.createCommandEncoder();
  {
    const pass = enc.beginComputePass({ label: 'simulate' });
    pass.setPipeline(pl.simulate);
    pass.setBindGroup(0, pl.bindGroupCommon);
    pass.setBindGroup(1, pl.bindGroupSim);
    const N = view.uniforms.samples_per_axis;
    pass.dispatchWorkgroups(Math.ceil(N/8), Math.ceil(N/8), 1);
    pass.end();
  }
  {
    const pass = enc.beginRenderPass({
      label: 'render',
      colorAttachments: [{
        view: target,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(pl.render);
    pass.setBindGroup(0, pl.bindGroupCommon);
    pass.setBindGroup(1, pl.bindGroupSim);
    pass.draw(3, 1);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}
