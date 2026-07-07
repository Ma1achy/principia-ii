import type { GpuContext } from './init.js';
import type { ReducePipeline } from './reduce_pipeline.js';

/**
 * Encode the two-pass reduction (means, then G7 spreads + ensemble
 * agreement — pass ordering makes the means visible to the second pass)
 * and copy the result into the readback buffer.
 */
export function dispatchReduce(
  ctx: GpuContext, rp: ReducePipeline,
): GPUCommandBuffer {
  const enc = ctx.device.createCommandEncoder({ label: 'reduce' });
  for (const pipeline of [rp.pipeline, rp.spreads]) {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, rp.bgCommon);
    pass.setBindGroup(1, rp.bgInput);
    pass.setBindGroup(2, rp.bgOutput);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
  }
  enc.copyBufferToBuffer(
    rp.outputBuf, 0, rp.readbackBuf, 0, rp.outputBuf.size,
  );
  return enc.finish();
}
