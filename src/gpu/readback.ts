import type { TileBuffers } from './buffers.js';
import type { GpuContext } from './init.js';
import { sizeOfSimResult } from './structs.js';

/**
 * Copy the SimResult buffer to a CPU-mappable buffer and decode it into a
 * plain JS array. Used by tests; production rendering keeps everything on
 * the GPU.
 */
export async function readbackSimResults(
  ctx: GpuContext, bufs: TileBuffers,
): Promise<DecodedSimResult[]> {
  const { device } = ctx;
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(
    bufs.simResults, 0, bufs.readback, 0, bufs.simResults.size,
  );
  device.queue.submit([enc.finish()]);

  await bufs.readback.mapAsync(GPUMapMode.READ);
  const ab = bufs.readback.getMappedRange().slice(0);
  bufs.readback.unmap();
  return decodeBuffer(ab, bufs.N, bufs.M);
}

export interface DecodedSimResult {
  n_checkpoints:   readonly { x: number; y: number; z: number; w: number }[];
  free_group_word: readonly [number, number, number, number];
  arc_length_n:    number;
  t_end:           number;
  d_min:           number;
  ftle:            number;
  energy_drift:    number;
  diffusion:       number;
  delta_E_max_abs: number;
  Lz_drift:        number;
  delta_Lz_max_abs:number;
  E_0:             number;
  Lz_0:            number;
  sample_descriptor: number;
  trajectory_stats:  number;
}

/** Decode an N×N tile buffer (square-grid convenience over
 *  `decodeSimResults`). */
export function decodeBuffer(ab: ArrayBuffer, N: number, M: number): DecodedSimResult[] {
  return decodeSimResults(ab, N * N, M);
}

/**
 * Decode `count` consecutive SimResults from a flat buffer. The ONE
 * layout decoder — M12's export formats reuse it rather than carrying a
 * second copy of the field offsets (same single-source rule as
 * TILE_REDUCTION_FIELDS).
 */
export function decodeSimResults(
  ab: ArrayBuffer, count: number, M: number,
): DecodedSimResult[] {
  const stride = sizeOfSimResult(M);
  const out: DecodedSimResult[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const off = i * stride;
    const f32 = new Float32Array(ab, off, stride / 4);
    const u32 = new Uint32Array(ab, off, stride / 4);

    const ck: { x: number; y: number; z: number; w: number }[] = [];
    for (let m = 0; m < M; m++) {
      const o = m * 4;
      ck.push({ x: f32[o]!, y: f32[o+1]!, z: f32[o+2]!, w: f32[o+3]! });
    }
    const base = M * 4;
    out[i] = {
      n_checkpoints: ck,
      free_group_word: [u32[base]!, u32[base+1]!, u32[base+2]!, u32[base+3]!],
      arc_length_n:    f32[base + 4]!,
      t_end:           f32[base + 5]!,
      d_min:           f32[base + 6]!,
      ftle:            f32[base + 7]!,
      energy_drift:    f32[base + 8]!,
      diffusion:       f32[base + 9]!,
      delta_E_max_abs: f32[base + 10]!,
      Lz_drift:        f32[base + 11]!,
      delta_Lz_max_abs:f32[base + 12]!,
      E_0:             f32[base + 13]!,
      Lz_0:            f32[base + 14]!,
      sample_descriptor: u32[base + 15]!,
      trajectory_stats:  u32[base + 16]!,
    };
  }
  return out;
}
