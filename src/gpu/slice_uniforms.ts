import type { Vec8 } from '@/math/types.js';

/**
 * SliceUniforms packing (chart-decode fix). One artifact with the WGSL
 * struct in simulate.wgsl (g0b6) and the alignment pin test in
 * test/unit/gpu/slice_uniforms.test.ts — the three change together or the
 * shader silently decodes the wrong slice.
 *
 * Carries the affine (u, v) → z map for latent-affine charts:
 *
 *   su = (2u − 1) · mag,  sv = (2v − 1) · mag
 *   z  = z0 + su · q1 + sv · q2
 *
 * — the exact CPU map in chart_atlas/charts/latent_slice.ts. This is
 * uniform DATA, not chart identity: the shader applies the same affine
 * map whatever chart produced it, preserving the chart-agnostic contract.
 *
 * Layout — 7 vec4<f32> lanes, tight (offsets are index × 16):
 *
 *   f32[ 0.. 7]  z0a, z0b    slice centre z0[0..7]
 *   f32[ 8..15]  q1a, q1b    horizontal axis q1[0..7]
 *   f32[16..23]  q2a, q2b    vertical axis q2[0..7]
 *   f32[24..27]  mag_pad     mag, 0, 0, 0
 */
export const SLICE_UNIFORMS_SIZE = 112;

export interface SliceUniformsValue {
  z0:  Vec8;
  q1:  Vec8;
  q2:  Vec8;
  mag: number;
}

/**
 * The M3 bring-up slice (z0 = 0, q1 = e0, q2 = e1, mag = 3): u → z[0],
 * v → z[1] over ±3, bit-identical to the mapping simulate.wgsl hard-coded
 * before this fix. createTileBuffers seeds the g0b6 buffer with it so
 * every harness that never writes the slice keeps its M3 behaviour.
 */
export const DEFAULT_SLICE: SliceUniformsValue = {
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0],
  q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
};

export function packSliceUniforms(s: SliceUniformsValue): ArrayBuffer {
  const buf = new ArrayBuffer(SLICE_UNIFORMS_SIZE);
  const f = new Float32Array(buf);
  f.set(s.z0, 0);
  f.set(s.q1, 8);
  f.set(s.q2, 16);
  f[24] = s.mag;
  return buf;
}
