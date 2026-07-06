import type { ViewState } from '@/interact/view_state.js';
import { partitionBuffer } from './partition.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

/**
 * Static-frame export at the resolution stored in `ViewState`. Produces
 * a flat `SimResult[W × H]` buffer (or a list of sub-buffers when the
 * resolution exceeds the GPU's `maxStorageBufferBindingSize`).
 *
 * For M12 we ship the orchestration; the actual GPU dispatch reuses M3's
 * compute pipeline configured to dispatch one chunk per call.
 */
export interface StaticFrameExport {
  width:       number;
  height:      number;
  bytesPerSample: number;
  buffers:     ArrayBuffer[];          // sub-buffer payloads
  planned:     ReturnType<typeof partitionBuffer>;
}

export interface DispatchChunkFn {
  (rowStart: number, rowCount: number, view: ViewState): Promise<ArrayBuffer>;
}

export async function exportStaticFrame(
  view: ViewState,
  resolution: [number, number],
  dispatch: DispatchChunkFn,
  maxBindingSize: number,
  M = 8,
): Promise<StaticFrameExport> {
  const [W, H] = resolution;
  const stride = sizeOfSimResult(M);
  const plans = partitionBuffer(W, H, stride, maxBindingSize);

  const bufs: ArrayBuffer[] = [];
  for (const p of plans) {
    bufs.push(await dispatch(p.rowStart, p.rowCount, view));
  }
  return { width: W, height: H, bytesPerSample: stride, buffers: bufs, planned: plans };
}
