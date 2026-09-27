// M7 render graph: colour node -> brightness node -> combiner -> post (CVD).
//
// This file is the ENTRY of the render module (linked by wgslLink, G1). It
// compiles standalone from the compute module, so the shared structs are
// repeated here in full — they must stay byte-identical to simulate.wgsl
// and src/gpu/structs.ts.

// @import { PI, linear_to_srgb }                       from "./render_helpers.wgsl"
// @import { palette_seq, palette_div_symlog, vmf_blend6, stability_x_hue, colour_free_group_word, VMF_SCHEME_OKLAB, VMF_SCHEME_OKABE_ITO } from "./colour_modes.wgsl"
// @import { brightness_time_to_event, brightness_diffusion, brightness_bc_proximity, brightness_energy_drift, brightness_ftle } from "./brightness_modes.wgsl"
// @import { combine_replace_lightness, combine_modulate_lightness, combine_multiply_rgb } from "./combiner.wgsl"
// @import { apply_cvd }                                from "./cvd.wgsl"
//
// Entry-owned structs: SimUniforms / TileRequest / SimResult / ICDescriptor /
// RenderParams live here; imported units reference nothing from this file.

// G4: slimmed to frame-constant quantities (integration setup + event
// thresholds). Chart hyperparameters live in ChartUniforms at g0b3.
struct SimUniforms {
  G:                f32,
  dt_macro:         f32,
  N_max:            u32,
  r_sub:            f32,
  gamma_sub:        f32,
  T_horizon:        f32,
  r_coll:           f32,
  R_esc:            f32,
  k_esc:            u32,
  eps_E:            f32,
  eps_L:            f32,
  r_close:          f32,
  quality_tier:     u32,
  checkpoint_count: u32,
  samples_per_axis: u32,
  integrator:       u32,   // INTEGRATOR_INDEX: 0 kdk, 1 yoshida4, 2 yoshida6, 3 rk4
};

struct TileRequest {
  z: i32, tx: i32, ty: i32, level: i32,
  uv_centre: vec2<f32>,
  uv_half:   vec2<f32>,
  flags:     u32,
  ensemble_e:        u32,   // G7: 0/1 = single, 2..16 = jittered copies
  sample_pattern_id: u32,   // G7: 0 none, 1 stratified, 2 Halton(2,3)
};

struct SimResult {
  n_checkpoints: array<vec4<f32>, 8>,
  free_group_word: vec4<u32>,
  arc_length_n:    f32,
  t_end:           f32,
  d_min:           f32,
  ftle:            f32,
  energy_drift:    f32,
  diffusion:       f32,
  delta_E_max_abs: f32,
  Lz_drift:        f32,
  delta_Lz_max_abs:f32,
  E_0:             f32,
  Lz_0:            f32,
  sample_descriptor: u32,
  trajectory_stats:  u32,
};

struct ICDescriptor {
  m1: f32, m2: f32, m3: f32, q_mass: f32,
  rho1_mag: f32, rho2_mag: f32, rho_ratio: f32, rho_angle: f32,
  K_0: f32, V_0: f32, virial_ratio: f32, r_min_pair_0: f32,
};

// Three-place rule: this struct + packRenderParams (src/render/params.ts)
// + the byte pin in render_graph_palette_swap.test.ts change together.
struct RenderParams {
  colour_mode_id:    u32,
  brightness_mode_id:u32,
  combiner_id:       u32,
  cvd_id:            u32,
  palette_id:        u32,
  physics_overlay:   u32,
  overlay_strength:  f32,
  vmf_kappa:         f32,
  vmf_chroma:        f32,
  vmf_lightness:     f32,
  palette_range_min: f32,
  palette_range_max: f32,
  playback_tau:      f32,
  wall_clock:        f32,
  debug_mode:        i32,   // -1 = off; else DebugMode 0..5 (recolour path)
  debug_heat_scale:  f32,   // drift heatmaps: t = value / debug_heat_scale
};

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req : TileRequest;
// G3: read_write (not read) — the canonical shared perTile layout binds
// these as type 'storage', and WebGPU requires the shader's access mode to
// match the layout's buffer type (same rule as render_layer0.wgsl / G17).
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;
@group(1) @binding(1) var<storage, read_write> ics     : array<ICDescriptor>;
@group(3) @binding(0) var<uniform>      rparams : RenderParams;

// G8: per-draw tile window. `rect` is the screen rectangle in [0,1]²
// screen-UV (y down, like canvas pixels); `uv` is the tile-local UV
// window sampled across it ((0,0,1,1) = the whole tile; an ancestor
// fallback passes the descendant's subrect). Drawn as a 6-vertex quad.
struct TileWindow {
  rect: vec4<f32>,   // x0, y0, x1, y1 in screen UV (y down)
  uv:   vec4<f32>,   // u0, v0, u1, v1 in tile-local UV
};
@group(3) @binding(1) var<uniform> window : TileWindow;

// Event-classification colours (linear sRGB), user-customisable. Entry order
// mirrors EVENT_CLASS_KEYS: bounded, collision 0-1/0-2/1-2, escape body
// 0/1/2, degenerate, timeout; slot 9 reserved. Three-place rule: this struct
// + packEventPalette (src/render/params.ts) + the pin in
// event_palette.test.ts change together.
struct EventPalette {
  entries: array<vec4<f32>, 10>,
};
@group(3) @binding(2) var<uniform> event_palette : EventPalette;

// Palette lookup keyed off the sample_descriptor's class + detail bits.
// Collision pairs and escape bodies get DISTINCT colours (the pair/body is
// already in the detail bits; the old fixed palette collapsed all collisions
// to one red).
fn event_colour(cls: u32, detail: u32) -> vec3<f32> {
  var idx: u32;
  switch (cls) {
    case 0u: { idx = 0u; }                        // bounded
    case 1u: { idx = 1u + min(detail, 2u); }      // collision pair 0-1/0-2/1-2
    case 2u: { idx = 4u + min(detail, 2u); }      // escape body 0/1/2
    case 3u: { idx = 7u; }                        // degenerate
    default: { idx = 8u; }                        // timeout / max-substeps
  }
  return event_palette.entries[idx].rgb;
}

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0)       uv:  vec2<f32>,   // tile-local UV (v down)
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));
  let c = corners[vid];
  let p = mix(window.rect.xy, window.rect.zw, c);   // screen UV, y down
  var out: VSOut;
  out.pos = vec4<f32>(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  out.uv  = mix(window.uv.xy, window.uv.zw, c);
  return out;
}

// --- Debug recolour path (mirror of render_layer0.wgsl's diagnostic modes).
// Active when rparams.debug_mode >= 0; recolours the SAME SimResult buffer so
// a diagnostic toggle is a group-3 rebind, never a recompute. Kept OUT of the
// 24-mode colour switch so the production modes stay byte-identical.
fn dbg_heat(t: f32) -> vec3<f32> {
  let c = clamp(t, 0.0, 1.0);
  return vec3<f32>(c, 0.4 * (1.0 - abs(2.0 * c - 1.0)), 1.0 - c);
}
fn dbg_outcome(cls: u32) -> vec3<f32> {
  if (cls == 0u) { return vec3<f32>(0.7, 0.7, 0.2); }
  else if (cls == 1u) { return vec3<f32>(0.9, 0.1, 0.1); }
  else if (cls == 2u) { return vec3<f32>(0.1, 0.4, 0.9); }
  else if (cls == 3u) { return vec3<f32>(0.5, 0.5, 0.5); }
  else { return vec3<f32>(1.0, 0.9, 0.0); }
}
fn dbg_category(k: u32) -> vec3<f32> {
  let h = f32(k) * 0.61803398875;
  return dbg_heat(h - floor(h));
}
fn debug_colour(r: SimResult, mode: i32, heat_scale: f32) -> vec3<f32> {
  let d = r.sample_descriptor;
  let cls = d & 0x7u;
  switch (mode) {
    case 0:  { return dbg_outcome(cls); }                                   // Outcome
    case 1:  { return dbg_category((d >> 3u) & 0x3u); }                     // Detail bits
    case 2:  { return select(vec3<f32>(0.3), vec3<f32>(0.2, 0.9, 0.3),      // FTLE_VALID (bit 7)
                              ((d >> 7u) & 1u) == 1u); }
    case 3:  { return select(vec3<f32>(0.3), vec3<f32>(0.9, 0.2, 0.2),      // Suspect (bit 5|6)
                              (((d >> 5u) & 1u) | ((d >> 6u) & 1u)) == 1u); }
    case 4:  { return dbg_heat(r.delta_E_max_abs / max(heat_scale, 1e-30)); } // Energy-drift heat
    default: {                                                              // Checkpoint completeness
      var written = 0u;
      for (var m = 0u; m < 8u; m = m + 1u) {
        if (any(r.n_checkpoints[m] != vec4<f32>(0.0))) { written = written + 1u; }
      }
      return dbg_heat(f32(written) / 8.0);
    }
  }
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  let sx = u32(clamp(floor(uv.x * f32(N)), 0.0, f32(N - 1u)));
  let sy = u32(clamp(floor(uv.y * f32(N)), 0.0, f32(N - 1u)));
  let idx = clamp(sy * N + sx, 0u, N*N - 1u);

  let r  = results[idx];
  let ic = ics[idx];
  let cls    = r.sample_descriptor & 0x7u;
  let detail = (r.sample_descriptor >> 3u) & 0x3u;

  // Debug recolour pre-empts the production pipeline (CVD still applies so the
  // diagnostic stays colour-vision-legible).
  if (rparams.debug_mode >= 0) {
    let dc = debug_colour(r, rparams.debug_mode, rparams.debug_heat_scale);
    return vec4<f32>(linear_to_srgb(apply_cvd(dc, rparams.cvd_id)), 1.0);
  }

  // 1. Colour node.
  var rgb: vec3<f32>;
  let n_last = r.n_checkpoints[7].xyz;     // M=8

  switch (rparams.colour_mode_id) {
    case 0u:  { rgb = event_colour(cls, detail); }
    case 1u:  { rgb = palette_div_symlog(ic.K_0 + ic.V_0, 1e-3); }
    case 2u:  { rgb = palette_div_symlog(r.Lz_0,           1e-3); }
    case 3u:  { rgb = palette_seq(ic.K_0 / 4.0); }
    case 4u:  { rgb = palette_seq(-ic.V_0 / 4.0); }
    case 5u:  { rgb = palette_div_symlog(ic.virial_ratio - 1.0, 0.1); }
    case 6u:  { rgb = palette_div_symlog(log(ic.m1 / ic.m2), 0.5); }
    case 7u:  { rgb = palette_div_symlog(log(ic.m1 / ic.m3), 0.5); }
    case 8u:  { rgb = palette_seq(ic.q_mass * 3.0); }
    case 9u:  { rgb = palette_seq(clamp(ic.rho1_mag, 0.0, 1.0)); }
    case 10u: { rgb = palette_seq(clamp(ic.rho2_mag, 0.0, 1.0)); }
    case 11u: { rgb = palette_div_symlog(log(ic.rho_ratio), 1.0); }
    case 12u: { rgb = palette_seq((ic.rho_angle + PI) / (2.0 * PI)); }
    case 13u: { rgb = palette_seq(clamp(ic.r_min_pair_0 * 2.0, 0.0, 1.0)); }
    case 14u: { rgb = palette_seq(clamp(r.t_end / uniforms.T_horizon, 0.0, 1.0)); }
    case 15u: { rgb = palette_seq(f32((r.sample_descriptor >> 10u) & 0x3fu) / 64.0); }
    case 16u: { rgb = palette_seq(clamp(r.d_min, 0.0, 1.0)); }
    case 17u: { rgb = palette_seq(clamp(log(r.delta_E_max_abs + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 18u: { rgb = palette_seq(clamp(log(r.energy_drift + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 19u: { rgb = palette_seq(clamp(log(r.delta_Lz_max_abs + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 20u: { rgb = palette_seq(clamp(log(r.Lz_drift + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 21u: { rgb = vmf_blend6(n_last, rparams.vmf_kappa, rparams.vmf_chroma, rparams.vmf_lightness, VMF_SCHEME_OKLAB); }
    case 22u: { rgb = vmf_blend6(n_last, rparams.vmf_kappa, rparams.vmf_chroma, rparams.vmf_lightness, VMF_SCHEME_OKABE_ITO); }
    case 23u: { rgb = stability_x_hue(n_last, r.diffusion, rparams.vmf_kappa, rparams.vmf_chroma); }
    case 25u: { rgb = colour_free_group_word(r.free_group_word, rparams.vmf_chroma); }
    // 24 "none": constant mid-grey — the brightness node carries everything
    // (colour none + replace-lightness combiner = a pure greyscale map).
    default:  { rgb = vec3<f32>(0.5, 0.5, 0.5); }
  }

  // 2. Brightness node.
  // FTLE validity: pass -1 when the sample's FTLE_VALID bit (7) is clear so
  // brightness_ftle renders neutral instead of treating "not computed" as 0.
  let ftle_v = select(-1.0, r.ftle, ((r.sample_descriptor >> 7u) & 1u) == 1u);
  var L: f32 = 1.0;
  switch (rparams.brightness_mode_id) {
    case 0u: { L = 1.0; }                     // "none": colour carries everything
    case 1u: { L = brightness_time_to_event(r.t_end, uniforms.T_horizon); }
    case 2u: { L = brightness_diffusion(r.diffusion); }
    case 3u: { L = brightness_bc_proximity(n_last); }
    case 4u: { L = brightness_energy_drift(r.energy_drift); }
    default: { L = brightness_ftle(ftle_v); }
  }

  // 3. Combiner.
  var combined: vec3<f32>;
  switch (rparams.combiner_id) {
    case 0u: { combined = combine_replace_lightness(rgb, L); }
    case 1u: { combined = combine_modulate_lightness(rgb, L); }
    default: { combined = combine_multiply_rgb(rgb, L); }
  }

  // 4. Postprocess: CVD then sRGB encode.
  let post = apply_cvd(combined, rparams.cvd_id);
  return vec4<f32>(linear_to_srgb(post), 1.0);
}
