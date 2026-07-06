import type { GpuContext } from './init.js';
import type { ReducePipeline } from './reduce_pipeline.js';

/** Submit a reduction pass and copy the result into the readback buffer. */
export function dispatchReduce(
  ctx: GpuContext, rp: ReducePipeline,
): GPUCommandBuffer {
  const enc = ctx.device.createCommandEncoder({ label: 'reduce' });
  {
    const pass = enc.beginComputePass();
    pass.setPipeline(rp.pipeline);
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
