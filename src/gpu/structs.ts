/**
 * GPU struct layouts. Sizes computed under WGSL alignment rules:
 *   - vec4<f32> aligns to 16 bytes
 *   - f32 / u32 align to 4 bytes
 *   - structs round up to the largest member's alignment
 *
 * These values appear in the spec at §6.6 and are pinned by the
 * integration test in `layer0_struct_alignment.test.ts`.
 */
export const M_DEFAULT = 8;

export function sizeOfSimResult(M: number = M_DEFAULT): number {
  // M float4 checkpoints (each 16B)
  // 1 uint4 free-group word (16B)
  // 11 floats: arc_length, t_end, d_min, ftle, energy_drift, diffusion,
  //   delta_E_max_abs, Lz_drift, delta_Lz_max_abs, E_0, Lz_0  (44B)
  // 2 uint32: sample_descriptor, trajectory_stats  (8B)
  // Padded to 16B alignment.
  const raw = 16*M + 16 + 44 + 8;
  return Math.ceil(raw / 16) * 16;
}

export function sizeOfICDescriptor(): number {
  // 12 floats × 4 bytes = 48, padded to 64.
  return 64;
}

export function sizeOfTileReduction(M: number = M_DEFAULT): number {
  // See spec §6.6 for the field-by-field count: 268 → 272.
  const raw =
      4*4                 // TileID id (3*i32) + level
    + 16*M                // mean_n_checkpoints[M]
    + 6*4                 // 6 means
    + 7*4                 // 7 spreads
    + 4*4                 // 4 classification fields
    + 2*4                 // 2 invariant drift
    + 4*4                 // 4 free-group fields
    + 2*4                 // 2 ensemble
    + 2*4                 // 2 trajectory_stats reductions
    + 2*4;                // 2 composite scores
  return Math.ceil(raw / 16) * 16;
}

/**
 * SimUniforms (frame-level). Bound at group(0) binding(0).
 * Field order matches the WGSL struct.
 */
export interface SimUniforms {
  m:               readonly [number, number, number];   // valid only for fixed-mass charts
  M_total:         number;
  G:               number;
  dt_macro:        number;
  N_max:           number;
  r_sub:           number;
  gamma_sub:       number;
  T_horizon:       number;
  r_coll:          number;
  R_esc:           number;
  k_esc:           number;
  eps_E:           number;
  eps_L:           number;
  r_close:         number;
  quality_tier:    number;
  checkpoint_count:number;
  samples_per_axis:number;
  // M3 chart hyperparameters, read by decode.wgsl (promoted per-chart in M10).
  mu_max:          number;
  alpha_min:       number;
  q_max:           number;
}

export function packSimUniforms(u: SimUniforms): ArrayBuffer {
  // 96-byte buffer. m[3] is laid out as vec3<f32> + 4 bytes pad; the three
  // M3 chart hyperparameters occupy f32[19..21] (offsets 76, 80, 84).
  const buf = new ArrayBuffer(96);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = u.m[0]; f32[1] = u.m[1]; f32[2] = u.m[2]; f32[3] = u.M_total;
  f32[4] = u.G;          f32[5] = u.dt_macro;
  u32[6] = u.N_max >>> 0;
  f32[7] = u.r_sub;
  f32[8] = u.gamma_sub;  f32[9] = u.T_horizon;
  f32[10] = u.r_coll;    f32[11] = u.R_esc;
  u32[12] = u.k_esc >>> 0;
  f32[13] = u.eps_E;     f32[14] = u.eps_L;
  f32[15] = u.r_close;
  u32[16] = u.quality_tier >>> 0;
  u32[17] = u.checkpoint_count >>> 0;
  u32[18] = u.samples_per_axis >>> 0;
  f32[19] = u.mu_max;
  f32[20] = u.alpha_min;
  f32[21] = u.q_max;
  return buf;
}

/**
 * TileRequest: per-tile dispatch parameters. Bound at group(0) binding(1).
 *
 * Tile-local precision (spec §6.4):
 *   uv_centre, uv_half are computed in f64 on the CPU and downcast to f32.
 *   At depth 0, half = 0.5 and centre = 0.5; the formula u(t) = c + h(2t-1)
 *   reproduces the global UV exactly.
 */
export interface TileRequest {
  z:           number;
  tx:          number;
  ty:          number;
  level:       number;
  uv_centre:   readonly [number, number];
  uv_half:     readonly [number, number];
  flags:       number;
}

export function packTileRequest(t: TileRequest): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  i32[0] = t.z; i32[1] = t.tx; i32[2] = t.ty; i32[3] = t.level;
  f32[4] = t.uv_centre[0]; f32[5] = t.uv_centre[1];
  f32[6] = t.uv_half[0];   f32[7] = t.uv_half[1];
  i32[8] = t.flags >>> 0;
  return buf;
}
