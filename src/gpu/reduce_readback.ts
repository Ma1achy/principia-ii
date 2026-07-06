import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { ReducePipeline } from './reduce_pipeline.js';
import { decodeTileReduction } from './structs.js';

/**
 * Per ADR 0006 this module contains no byte offsets. It maps the buffer and
 * hands the bytes to the table-generated `decodeTileReduction` in structs.ts,
 * which also performs the TILE_REDUCTION_SCHEMA_VERSION check (throwing on a
 * stale or mismatched payload).
 */
export async function readbackReduction(
  rp: ReducePipeline, M: number,
): Promise<TileReduction> {
  await rp.readbackBuf.mapAsync(GPUMapMode.READ);
  const ab = rp.readbackBuf.getMappedRange().slice(0);
  rp.readbackBuf.unmap();
  // Generated, table-derived decoder. Asserts TILE_REDUCTION_SCHEMA_VERSION;
  // throws if the GPU wrote a layout the CPU doesn't recognise.
  return decodeTileReduction(ab, M);
}
