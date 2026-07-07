import type { Triple, Vec2, Vec3 } from '@/math/types.js';

/**
 * UploadedIC packing (chart-decode fix). One artifact with the WGSL struct
 * in simulate.wgsl (g0b7) and the pin test in
 * test/unit/gpu/uploaded_ics.test.ts.
 *
 * Charts whose (u, v) → IC map is NOT affine in latent space (lz_e, lz_k,
 * shape_sphere, mass_simplex, burrau_euclid) are decoded per sample on the
 * CPU and uploaded; the shader just reads (m, r, p) — the literal
 * chart-agnostic contract from the architecture skill.
 *
 * Layout — 4 vec4<f32> lanes per sample (stride 64, storage array):
 *
 *   f32[ 0.. 3]  m_t    m1, m2, m3, terminal (0 none, 1 degenerate,
 *                                             2 collision_t0)
 *   f32[ 4.. 7]  r01    r0.x, r0.y, r1.x, r1.y
 *   f32[ 8..11]  r2p0   r2.x, r2.y, p0.x, p0.y
 *   f32[12..15]  p12    p1.x, p1.y, p2.x, p2.y
 */
export const UPLOADED_IC_SIZE = 64;

export function sizeOfUploadedICs(N: number, EMax = 1): number {
  return UPLOADED_IC_SIZE * N * N * Math.max(1, EMax);
}

export interface UploadedICSample {
  /** 0 = decoded OK, 1 = DEGENERATE(reason), 2 = COLLISION_T0. Matches
   *  ICOut.terminal in decode.wgsl. */
  terminal: 0 | 1 | 2;
  m: Vec3;
  r: Triple<Vec2>;
  p: Triple<Vec2>;
}

export function packUploadedICs(samples: readonly UploadedICSample[]): ArrayBuffer {
  const buf = new ArrayBuffer(UPLOADED_IC_SIZE * samples.length);
  const f = new Float32Array(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const o = i * 16;
    f[o]      = s.m[0];    f[o + 1]  = s.m[1];
    f[o + 2]  = s.m[2];    f[o + 3]  = s.terminal;
    f[o + 4]  = s.r[0][0]; f[o + 5]  = s.r[0][1];
    f[o + 6]  = s.r[1][0]; f[o + 7]  = s.r[1][1];
    f[o + 8]  = s.r[2][0]; f[o + 9]  = s.r[2][1];
    f[o + 10] = s.p[0][0]; f[o + 11] = s.p[0][1];
    f[o + 12] = s.p[1][0]; f[o + 13] = s.p[1][1];
    f[o + 14] = s.p[2][0]; f[o + 15] = s.p[2][1];
  }
  return buf;
}

/**
 * Decode every sample of a tile dispatch, in the shader's own order and at
 * the shader's own sample points:
 *
 *   idx = z·N² + gy·N + gx
 *   t   = (g + 0.5) / N + offsets[z] / N        (G7 ensemble jitter)
 *   uv  = uv_centre + uv_half · (2t − 1)
 *
 * `offsets` must be the same jitterOffsets(patternId, E) table the
 * dispatcher packs into EnsembleOffsets, so the CPU decodes exactly the
 * points the GPU would have sampled.
 */
export function buildUploadedICs(
  decodeAt: (u: number, v: number) => UploadedICSample,
  tile: { uv_centre: readonly [number, number]; uv_half: readonly [number, number] },
  N: number,
  offsets: readonly { du: number; dv: number }[],
): UploadedICSample[] {
  const E = Math.max(1, offsets.length);
  const out: UploadedICSample[] = new Array<UploadedICSample>(N * N * E);
  for (let z = 0; z < E; z++) {
    const off = offsets[z] ?? { du: 0, dv: 0 };
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const tu = (gx + 0.5) / N + off.du / N;
        const tv = (gy + 0.5) / N + off.dv / N;
        const u = tile.uv_centre[0] + tile.uv_half[0] * (2 * tu - 1);
        const v = tile.uv_centre[1] + tile.uv_half[1] * (2 * tv - 1);
        out[z * N * N + gy * N + gx] = decodeAt(u, v);
      }
    }
  }
  return out;
}
