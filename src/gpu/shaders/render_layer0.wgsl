// Minimal Layer-0 fragment shader: full-screen triangle, colour by outcome.
//
// This module compiles standalone (it is NOT concatenated with simulate.wgsl),
// so the SimUniforms / SimResult structs are repeated here in full — they must
// stay byte-identical to simulate.wgsl and src/gpu/structs.ts.
//
// NB: `results` is declared read_write (not read) because the shared
// bind-group layout binds it as type 'storage' for both the compute and
// fragment stages, and WebGPU requires the shader's access mode to match the
// layout's buffer type.

struct SimUniforms {
  m:                vec3<f32>,
  M_total:          f32,
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
  mu_max:           f32,
  alpha_min:        f32,
  q_max:            f32,
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

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  // One big triangle covering the screen.
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vid], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  // For Layer 0 the tile fills the viewport. Map fragment.xy to sample idx.
  // Assume we're rendering to a square canvas of side N * tile_pix; in M3
  // we use one tile = canvas, and the fragment-to-sample mapping is just
  // floor(fragment.xy / tile_pix).
  let tile_pix = 32.0;                  // arbitrary, matches our test render
  let sx = u32(floor(frag.x / tile_pix));
  let sy = u32(floor(frag.y / tile_pix));
  let idx = clamp(sy * N + sx, 0u, N*N - 1u);
  let r = results[idx];
  let cls = r.sample_descriptor & 0x7u;

  var rgb: vec3<f32>;
  if (cls == 0u) { rgb = vec3<f32>(0.7, 0.7, 0.2); }      // bounded / not-yet-classified
  else if (cls == 1u) { rgb = vec3<f32>(0.9, 0.1, 0.1); } // collision
  else if (cls == 2u) { rgb = vec3<f32>(0.1, 0.4, 0.9); } // escape
  else if (cls == 3u) { rgb = vec3<f32>(0.5, 0.5, 0.5); } // degenerate
  else                { rgb = vec3<f32>(1.0, 0.9, 0.0); } // timeout / max_substeps
  return vec4<f32>(rgb, 1.0);
}
