// @import { ICOut } from "./decode.wgsl"
//
// G6: linearised decode for deep zoom (spec §6.5). The CPU evaluates the
// full decoder at f64 at the tile centre and ships x0 + the tile-local
// Jacobian in a LinearisedRef uniform (g0b4); this unit reconstructs
// per-sample ICs as x(t) = x0 + J · (2t − 1). The TS packer twin is
// src/gpu/linearised_uniforms.ts — one artifact: this struct, the packer,
// and the alignment pin test change together.

// TileRequest.flags bit selecting this path. TS twin:
// TILE_REQUEST_FLAGS.DECODE_LINEAR in src/gpu/structs.ts (pinned by
// test/unit/gpu/linearised_uniforms.test.ts).
// @export
const TILE_REQ_DECODE_LINEAR : u32 = 1u;

// 16 vec4 lanes = 256 bytes. J lanes are derivatives in half-tile
// δ-units (δ = 2t − 1 reaches the tile edges at ±1; the chart half-width
// scaling is already inside the CPU-side Jacobian), so decode_linear
// never reads the half lanes — they ride along as diagnostics metadata.
// @export
struct LinearisedRef {
  r0r1:       vec4<f32>,   // x0: r0.x, r0.y, r1.x, r1.y
  r2_pad:     vec4<f32>,   // x0: r2.x, r2.y, 0, 0
  p0p1:       vec4<f32>,   // x0: p0.x, p0.y, p1.x, p1.y
  p2_pad:     vec4<f32>,   // x0: p2.x, p2.y, 0, 0
  m_h:        vec4<f32>,   // m0, m1, m2, tile_half_u (metadata)
  half_v_pad: vec4<f32>,   // tile_half_v (metadata), 0, 0, 0
  Jr_b0:      vec4<f32>,   // (dr0x/du, dr0x/dv, dr0y/du, dr0y/dv)
  Jr_b1:      vec4<f32>,
  Jr_b2:      vec4<f32>,
  Jp_b0:      vec4<f32>,
  Jp_b1:      vec4<f32>,
  Jp_b2:      vec4<f32>,
  Jm_01:      vec4<f32>,   // (dm0/du, dm0/dv, dm1/du, dm1/dv)
  Jm_2:       vec4<f32>,   // (dm2/du, dm2/dv, 0, 0)
  reserved0:  vec4<f32>,
  reserved1:  vec4<f32>,
};

// @export
fn decode_linear(t: vec2<f32>, lin: LinearisedRef, r_coll: f32) -> ICOut {
  let du = 2.0 * t.x - 1.0;
  let dv = 2.0 * t.y - 1.0;
  var out: ICOut;

  out.r = array<vec2<f32>, 3>(
    vec2<f32>(lin.r0r1.x   + lin.Jr_b0.x * du + lin.Jr_b0.y * dv,
              lin.r0r1.y   + lin.Jr_b0.z * du + lin.Jr_b0.w * dv),
    vec2<f32>(lin.r0r1.z   + lin.Jr_b1.x * du + lin.Jr_b1.y * dv,
              lin.r0r1.w   + lin.Jr_b1.z * du + lin.Jr_b1.w * dv),
    vec2<f32>(lin.r2_pad.x + lin.Jr_b2.x * du + lin.Jr_b2.y * dv,
              lin.r2_pad.y + lin.Jr_b2.z * du + lin.Jr_b2.w * dv),
  );
  out.p = array<vec2<f32>, 3>(
    vec2<f32>(lin.p0p1.x   + lin.Jp_b0.x * du + lin.Jp_b0.y * dv,
              lin.p0p1.y   + lin.Jp_b0.z * du + lin.Jp_b0.w * dv),
    vec2<f32>(lin.p0p1.z   + lin.Jp_b1.x * du + lin.Jp_b1.y * dv,
              lin.p0p1.w   + lin.Jp_b1.z * du + lin.Jp_b1.w * dv),
    vec2<f32>(lin.p2_pad.x + lin.Jp_b2.x * du + lin.Jp_b2.y * dv,
              lin.p2_pad.y + lin.Jp_b2.z * du + lin.Jp_b2.w * dv),
  );
  out.m = vec3<f32>(
    lin.m_h.x + lin.Jm_01.x * du + lin.Jm_01.y * dv,
    lin.m_h.y + lin.Jm_01.z * du + lin.Jm_01.w * dv,
    lin.m_h.z + lin.Jm_2.x  * du + lin.Jm_2.y  * dv,
  );

  // Same no-holes guard as decode_full — the decode pipeline is total on
  // this path too.
  let d01 = length(out.r[1] - out.r[0]);
  let d02 = length(out.r[2] - out.r[0]);
  let d12 = length(out.r[2] - out.r[1]);
  let dmin = min(d01, min(d02, d12));
  if (dmin < r_coll) { out.terminal = 2u; }
  else               { out.terminal = 0u; }
  return out;
}
