/**
 * GPU struct layouts. Sizes computed under WGSL alignment rules:
 *   - vec4<f32> aligns to 16 bytes
 *   - f32 / u32 align to 4 bytes
 *   - structs round up to the largest member's alignment
 *
 * These values appear in the spec at §6.6 and are pinned by the
 * integration test in `layer0_struct_alignment.test.ts`.
 */
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { TileID } from '@/quadtree/types.js';

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
 *
 * G4 slimmed this to quantities constant across every chart in a frame —
 * integration setup + event thresholds. The M3 stopgaps (m/M_total and
 * the chart hyperparameters mu_max/alpha_min/q_max) are gone: masses come
 * from the decoder per pixel, and chart knobs live in ChartUniforms at
 * group(0) binding(3) (chart_uniforms.ts).
 */
export interface SimUniforms {
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
}

export function packSimUniforms(u: SimUniforms): ArrayBuffer {
  // 64-byte buffer: 15 scalar lanes (60 B) + one trailing pad lane.
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0]  = u.G;          f32[1]  = u.dt_macro;
  u32[2]  = u.N_max >>> 0;
  f32[3]  = u.r_sub;
  f32[4]  = u.gamma_sub;  f32[5]  = u.T_horizon;
  f32[6]  = u.r_coll;     f32[7]  = u.R_esc;
  u32[8]  = u.k_esc >>> 0;
  f32[9]  = u.eps_E;      f32[10] = u.eps_L;
  f32[11] = u.r_close;
  u32[12] = u.quality_tier >>> 0;
  u32[13] = u.checkpoint_count >>> 0;
  u32[14] = u.samples_per_axis >>> 0;
  // f32[15] trailing pad
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
  /** G7 ensemble copies: 0/1 = single dispatch, 2..16 = E jittered
   *  copies along the dispatch z axis. Optional — packs as 0. */
  ensemble_e?: number;
  /** G7 jitter pattern: 0 = none, 1 = stratified, 2 = Halton(2,3). */
  sample_pattern_id?: number;
}

/**
 * TileRequest.flags bit assignments — dispatch-side REQUEST flags, a
 * separate namespace from the TileReduction STATUS flags in
 * quadtree/reduction_types.ts. WGSL twin: TILE_REQ_DECODE_LINEAR in
 * decode_linear.wgsl (value pinned by test/unit/gpu/linearised_uniforms).
 */
export const TILE_REQUEST_FLAGS = {
  /** G6: decode samples via the linearised path (LinearisedRef at g0b4). */
  DECODE_LINEAR: 1 << 0,
  /** Chart-decode fix: read CPU-decoded per-sample ICs from the UploadedIC
   *  storage buffer at g0b7 (charts not affine in latent space). WGSL twin:
   *  TILE_REQ_DECODE_UPLOADED in simulate.wgsl (value pinned by
   *  test/unit/gpu/uploaded_ics). */
  DECODE_UPLOADED: 1 << 1,
} as const;

export function packTileRequest(t: TileRequest): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  i32[0] = t.z; i32[1] = t.tx; i32[2] = t.ty; i32[3] = t.level;
  f32[4] = t.uv_centre[0]; f32[5] = t.uv_centre[1];
  f32[6] = t.uv_half[0];   f32[7] = t.uv_half[1];
  i32[8] = t.flags >>> 0;
  i32[9]  = (t.ensemble_e ?? 0) >>> 0;          // G7
  i32[10] = (t.sample_pattern_id ?? 0) >>> 0;   // G7
  return buf;
}

// ── TileReduction single-source field table (ADR 0006, M5) ────────────────

/**
 * Bump whenever TILE_REDUCTION_FIELDS changes (order, type, insertion,
 * removal). reduce.wgsl writes this into the version slot; the decoder
 * asserts it. Hand-bumped integer, per ADR 0006 (a content hash can replace
 * it later without changing the contract).
 */
export const TILE_REDUCTION_SCHEMA_VERSION = 1;

/**
 * The single declarative layout of the per-tile `TileReduction` body fields
 * (everything *after* id+level+mean_n_checkpoints[M]). One entry per
 * f32/u32/i32 lane, in WGSL field order. The WGSL struct emitter, the TS
 * decoder, and the `reduction_types.ts` interface are all derived from /
 * pinned to this table — there is no second hand-maintained copy of these
 * offsets (ADR 0006).
 *
 * Head layout (pinned by the golden and sizeOfTileReduction = 272 @ M=8):
 * TileID id = 3 × i32 (12 B, NO trailing pad), level: i32 at byte 12, then
 * mean_n_checkpoints: array<vec4<f32>, M> naturally 16-aligned at byte 16.
 * Scalar lanes start at lane 4 + M*4.
 *
 * The version slot reuses the `status_flags` reserved bits 6-7 (TILE_STATUS
 * occupies bits 0-5); reduce.wgsl ORs TILE_REDUCTION_SCHEMA_VERSION into those
 * two bits, and decodeTileReduction strips + checks them. Two bits hold
 * versions 0-3; widen to a dedicated `schema_version` slot (kept at constant
 * 272-byte size, enforced by the alignment pin) before version 4.
 */
export const TILE_REDUCTION_FIELDS = [
  { name: 'mean_arc_length_n',          type: 'f32' },
  { name: 'mean_t_end',                 type: 'f32' },
  { name: 'mean_d_min',                 type: 'f32' },
  { name: 'mean_ftle',                  type: 'f32' },
  { name: 'mean_energy_drift',          type: 'f32' },
  { name: 'mean_diffusion',             type: 'f32' },
  { name: 'spread_n',                   type: 'f32' },
  { name: 'spread_arc_length_n',        type: 'f32' },
  { name: 'spread_t_end',               type: 'f32' },
  { name: 'spread_d_min',               type: 'f32' },
  { name: 'spread_ftle',                type: 'f32' },
  { name: 'spread_energy_drift',        type: 'f32' },
  { name: 'spread_diffusion',           type: 'f32' },
  { name: 'outcome_impurity',           type: 'f32' },
  { name: 'dominant_outcome',           type: 'u32' },
  { name: 'suspect_fraction',           type: 'f32' },
  { name: 'suspect_lz_fraction',        type: 'f32' },
  { name: 'energy_drift_worst',         type: 'f32' },
  { name: 'lz_drift_worst',             type: 'f32' },
  { name: 'mean_word_length',           type: 'f32' },
  { name: 'spread_word_length',         type: 'f32' },
  { name: 'word_agreement',             type: 'f32' },
  { name: 'dominant_word_hash',         type: 'u32' },
  { name: 'ensemble_outcome_agreement', type: 'f32' },
  { name: 'ensemble_count',             type: 'i32' },
  { name: 'mean_orbit_count',           type: 'f32' },
  { name: 'retrograde_fraction',        type: 'f32' },
  { name: 'coherence_score',            type: 'f32' },
  { name: 'priority_score',             type: 'f32' },
  { name: 'sample_count',               type: 'i32' },
  { name: 'status_flags',               type: 'u32' },
] as const;

export type TileReductionFieldName = (typeof TILE_REDUCTION_FIELDS)[number]['name'];

/** status_flags bits 6-7 carry the schema version (TILE_STATUS owns bits 0-5). */
const SCHEMA_VERSION_SHIFT = 6;
const SCHEMA_VERSION_MASK = 0x3 << SCHEMA_VERSION_SHIFT;   // bits 6-7

/**
 * Emit the WGSL `TileReduction` struct body from the table (the head — id,
 * level, mean_n_checkpoints[M] — is fixed). reduce.wgsl is diffed against this
 * in the golden test so a WGSL edit cannot bypass the table.
 */
export function wgslTileReductionStruct(M: number = M_DEFAULT): string {
  const head =
    `struct TileReduction {\n` +
    `  id:    TileID,\n` +
    `  level: i32,\n` +
    `  mean_n_checkpoints: array<vec4<f32>, ${M}>,\n`;
  const body = TILE_REDUCTION_FIELDS
    .map((f) => `  ${f.name}: ${f.type === 'i32' ? 'i32' : f.type === 'u32' ? 'u32' : 'f32'},`)
    .join('\n');
  return head + body + `\n};`;
}

/**
 * Decode a mapped `TileReduction` buffer. Derived from TILE_REDUCTION_FIELDS:
 * lanes are assigned in table order starting at `base = 4 + M*4` (skipping the
 * 12-byte TileID + 4-byte level head plus M vec4 checkpoints). Throws on
 * schema mismatch.
 */
export function decodeTileReduction(ab: ArrayBuffer, M: number = M_DEFAULT): TileReduction {
  const f32 = new Float32Array(ab);
  const i32 = new Int32Array(ab);
  const u32 = new Uint32Array(ab);

  const id: TileID = { z: i32[0]!, tx: i32[1]!, ty: i32[2]! };
  const level = i32[3]!;

  const ck: { x: number; y: number; z: number; w: number }[] = [];
  for (let m = 0; m < M; m++) {
    const o = 4 + m * 4;     // 16B head (id 3×i32 + level), checkpoints 16-aligned
    ck.push({ x: f32[o]!, y: f32[o + 1]!, z: f32[o + 2]!, w: f32[o + 3]! });
  }

  const base = 4 + M * 4;
  const out = { id, level, mean_n_checkpoints: ck } as Record<string, unknown>;
  TILE_REDUCTION_FIELDS.forEach((field, i) => {
    const lane = base + i;
    out[field.name] =
      field.type === 'u32' ? u32[lane]!
      : field.type === 'i32' ? i32[lane]!
      : f32[lane]!;
  });

  const version = ((out.status_flags as number) & SCHEMA_VERSION_MASK) >>> SCHEMA_VERSION_SHIFT;
  if (version !== TILE_REDUCTION_SCHEMA_VERSION) {
    throw new Error(
      `TileReduction schema mismatch: buffer v${version}, ` +
      `decoder v${TILE_REDUCTION_SCHEMA_VERSION}`,
    );
  }
  // Strip the version bits so consumers see the real status flags.
  out.status_flags = (out.status_flags as number) & ~SCHEMA_VERSION_MASK;

  return out as unknown as TileReduction;
}
