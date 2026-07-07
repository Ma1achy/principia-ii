import type { LinearisedReference } from '@/decode/linearised.js';

/**
 * LinearisedRef packing (G6). One artifact with the WGSL struct in
 * decode_linear.wgsl and the alignment pin test — the three change
 * together or the shader silently reads the wrong lanes.
 *
 * Layout — 16 vec4<f32> lanes, tight (every member is a vec4, so WGSL
 * offsets are index × 16 with no implicit padding):
 *
 *   f32[ 0.. 3]  r0r1        x0: r0.x, r0.y, r1.x, r1.y
 *   f32[ 4.. 7]  r2_pad      x0: r2.x, r2.y, 0, 0
 *   f32[ 8..11]  p0p1        x0: p0.x, p0.y, p1.x, p1.y
 *   f32[12..15]  p2_pad      x0: p2.x, p2.y, 0, 0
 *   f32[16..19]  m_h         m0, m1, m2, tile_half_u (metadata)
 *   f32[20..23]  half_v_pad  tile_half_v (metadata), 0, 0, 0
 *   f32[24..35]  Jr_b0..b2   per body: (drx/du, drx/dv, dry/du, dry/dv)
 *   f32[36..47]  Jp_b0..b2   per body: (dpx/du, dpx/dv, dpy/du, dpy/dv)
 *   f32[48..51]  Jm_01       (dm0/du, dm0/dv, dm1/du, dm1/dv)
 *   f32[52..55]  Jm_2        (dm2/du, dm2/dv, 0, 0)
 *   f32[56..63]  reserved
 *
 * The J lanes are derivatives in half-tile δ-units; decode_linear applies
 * them with δ = 2t − 1 and does not consume the half lanes (metadata only).
 */
export const LINEARISED_UNIFORMS_SIZE = 256;

export function packLinearisedUniforms(
  ref: LinearisedReference, tileHalfU: number, tileHalfV: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(LINEARISED_UNIFORMS_SIZE);
  const f = new Float32Array(buf);

  // x0 positions: r0/r1 share a vec4; r2 padded.
  f[0] = ref.x0.r[0][0]; f[1] = ref.x0.r[0][1];
  f[2] = ref.x0.r[1][0]; f[3] = ref.x0.r[1][1];
  f[4] = ref.x0.r[2][0]; f[5] = ref.x0.r[2][1];
  // x0 momenta.
  f[8]  = ref.x0.p[0][0]; f[9]  = ref.x0.p[0][1];
  f[10] = ref.x0.p[1][0]; f[11] = ref.x0.p[1][1];
  f[12] = ref.x0.p[2][0]; f[13] = ref.x0.p[2][1];
  // Masses + tile half-widths.
  f[16] = ref.x0.m[0]; f[17] = ref.x0.m[1]; f[18] = ref.x0.m[2];
  f[19] = tileHalfU;
  f[20] = tileHalfV;
  // Jacobians: per body, (dx/du, dx/dv, dy/du, dy/dv).
  for (let i = 0; i < 3; i++) {
    f[24 + i * 4 + 0] = ref.J_r[i]![0]![0]!;
    f[24 + i * 4 + 1] = ref.J_r[i]![0]![1]!;
    f[24 + i * 4 + 2] = ref.J_r[i]![1]![0]!;
    f[24 + i * 4 + 3] = ref.J_r[i]![1]![1]!;
    f[36 + i * 4 + 0] = ref.J_p[i]![0]![0]!;
    f[36 + i * 4 + 1] = ref.J_p[i]![0]![1]!;
    f[36 + i * 4 + 2] = ref.J_p[i]![1]![0]!;
    f[36 + i * 4 + 3] = ref.J_p[i]![1]![1]!;
  }
  f[48] = ref.J_m[0]![0]!; f[49] = ref.J_m[0]![1]!;
  f[50] = ref.J_m[1]![0]!; f[51] = ref.J_m[1]![1]!;
  f[52] = ref.J_m[2]![0]!; f[53] = ref.J_m[2]![1]!;
  // f[54..63] reserved, zero.
  return buf;
}
