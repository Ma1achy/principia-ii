import type { GpuContext } from './init.js';
import type { ReducePipeline } from './reduce_pipeline.js';

/** G10: optional per-pass timestamp writes (from GpuTimer), keyed to the
 *  two reduction passes. Absent entries mean "don't time that pass". */
export interface ReduceTimestamps {
  reduce?:         GPUComputePassTimestampWrites | undefined;
  reduce_spreads?: GPUComputePassTimestampWrites | undefined;
}

/**
 * Encode the two-pass reduction (means, then G7 spreads + ensemble
 * agreement — pass ordering makes the means visible to the second pass)
 * and copy the result into the readback buffer.
 */
export function dispatchReduce(
  ctx: GpuContext, rp: ReducePipeline, timing?: ReduceTimestamps,
): GPUCommandBuffer {
  const enc = ctx.device.createCommandEncoder({ label: 'reduce' });
  const writes = [timing?.reduce, timing?.reduce_spreads];
  for (const [i, pipeline] of [rp.pipeline, rp.spreads].entries()) {
    const tw = writes[i];
    const pass = enc.beginComputePass(tw ? { timestampWrites: tw } : {});
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
