import type { JitterOffset } from '@/quadtree/ensemble_jitter.js';

/**
 * EnsembleOffsets packing (G7). The WGSL twin lives in simulate.wgsl:
 * `struct EnsembleOffsets { offsets: array<vec4<f32>, 16> }` bound at
 * group(0) binding(5). Each vec4 carries (du, dv, 0, 0) in pixel units;
 * the shader indexes by gid.z (the ensemble copy) and jitters its sample
 * point by offsets[z].xy / N. A zero-filled buffer (the default) means
 * every copy samples the pixel centre — behaviour-identical to E = 1.
 */
export const ENSEMBLE_OFFSETS_SIZE = 256;   // 16 × vec4<f32>

export function packEnsembleOffsets(offsets: readonly JitterOffset[]): ArrayBuffer {
  const buf = new ArrayBuffer(ENSEMBLE_OFFSETS_SIZE);
  const f = new Float32Array(buf);
  for (let i = 0; i < offsets.length && i < 16; i++) {
    f[i * 4]     = offsets[i]!.du;
    f[i * 4 + 1] = offsets[i]!.dv;
  }
  return buf;
}
