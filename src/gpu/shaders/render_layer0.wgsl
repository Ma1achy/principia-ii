// Layer-0 fragment shader with debug render modes (G17).
// mode 0 (Outcome) reproduces the original M3 colouring exactly.
//
// This module compiles standalone (it is NOT concatenated with simulate.wgsl),
// so the SimUniforms / SimResult structs are repeated here in full — they must
// stay byte-identical to simulate.wgsl and src/gpu/structs.ts.
//
// NB: `results` is declared read_write (not read) because the shared
// bind-group layout binds it as type 'storage' for both the compute and
// fragment stages, and WebGPU requires the shader's access mode to match the
// layout's buffer type.

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

// Three-place rule: this struct + packDebugUniform (src/debug/debug_modes.ts)
// + the 16-byte pin in test/unit/debug/debug_modes.test.ts change together.
struct DebugUniform {
  mode:             f32,   // DebugMode (see src/debug/debug_modes.ts)
  heat_scale:       f32,   // drift heatmaps: t = clamp(value / heat_scale, 0, 1)
  checkpoint_count: u32,   // for checkpoint-completeness
  _pad:             f32,
};

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(2) var<uniform> dbg      : DebugUniform;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  // One big triangle covering the screen.
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vid], 0.0, 1.0);
}

// --- descriptor bit decode (mirror of src/debug/descriptor_bits.ts / M6) ---
fn outcome_class(d: u32) -> u32 { return d & 0x7u; }
fn detail_bits(d: u32) -> u32 { return (d >> 3u) & 0x3u; }
fn suspect_energy(d: u32) -> bool { return ((d >> 5u) & 1u) == 1u; }
fn suspect_lz(d: u32) -> bool { return ((d >> 6u) & 1u) == 1u; }
fn ftle_valid(d: u32) -> bool { return ((d >> 7u) & 1u) == 1u; }
fn word_truncated(d: u32) -> bool { return ((d >> 8u) & 1u) == 1u; }
fn word_uncertain(d: u32) -> bool { return ((d >> 9u) & 1u) == 1u; }
fn encounter_count(d: u32) -> u32 { return (d >> 10u) & 0x3fu; }
fn substep_log2(d: u32) -> u32 { return (d >> 16u) & 0x7fu; }
fn benettin_count(d: u32) -> u32 { return (d >> 23u) & 0x7fu; }
fn dominant_pair(d: u32) -> u32 { return (d >> 30u) & 0x3u; }

// Simple blue→red heat ramp for t in [0,1].
fn heat(t: f32) -> vec3<f32> {
  let c = clamp(t, 0.0, 1.0);
  return vec3<f32>(c, 0.4 * (1.0 - abs(2.0 * c - 1.0)), 1.0 - c);
}

fn colour_outcome(cls: u32) -> vec3<f32> {
  if (cls == 0u) { return vec3<f32>(0.7, 0.7, 0.2); }      // bounded / not-yet-classified
  else if (cls == 1u) { return vec3<f32>(0.9, 0.1, 0.1); } // collision
  else if (cls == 2u) { return vec3<f32>(0.1, 0.4, 0.9); } // escape
  else if (cls == 3u) { return vec3<f32>(0.5, 0.5, 0.5); } // degenerate
  else { return vec3<f32>(1.0, 0.9, 0.0); }                // timeout / max_substeps
}

// Distinct hues for a small categorical code (e.g. detail bits 0..3).
fn colour_category(k: u32) -> vec3<f32> {
  let h = f32(k) * 0.61803398875;          // golden-ratio hue stepping
  let frac = h - floor(h);
  return heat(frac);
}

@fragment
fn fs_main(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  // For Layer 0 the tile fills the viewport. Map fragment.xy to sample idx.
  let tile_pix = 32.0;                  // arbitrary, matches our test render
  let sx = u32(floor(frag.x / tile_pix));
  let sy = u32(floor(frag.y / tile_pix));
  let idx = clamp(sy * N + sx, 0u, N * N - 1u);
  var r = results[idx];
  let d = r.sample_descriptor;
  let cls = outcome_class(d);

  var rgb: vec3<f32>;
  let mode = u32(dbg.mode + 0.5);
  switch mode {
    case 0u: { rgb = colour_outcome(cls); }                       // Outcome (M3 default)
    case 1u: { rgb = colour_category(detail_bits(d)); }           // Detail bits (3..4)
    case 2u: {                                                     // FtleValid (bit 7)
      rgb = select(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.2, 0.9, 0.3), ftle_valid(d));
    }
    case 3u: {                                                     // Suspect: bit 5 OR bit 6
      let suspect = suspect_energy(d) || suspect_lz(d);
      rgb = select(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.9, 0.2, 0.2), suspect);
    }
    case 4u: {                                                     // EnergyDriftHeat
      rgb = heat(clamp(r.delta_E_max_abs / dbg.heat_scale, 0.0, 1.0));
    }
    case 5u: {                                                     // CheckpointCompleteness
      // fraction of non-zero checkpoints / M (dbg.checkpoint_count = M).
      var written = 0u;
      for (var m = 0u; m < dbg.checkpoint_count; m = m + 1u) {
        let c = r.n_checkpoints[m];
        if (any(c != vec4<f32>(0.0))) { written = written + 1u; }
      }
      let frac = f32(written) / max(f32(dbg.checkpoint_count), 1.0);
      rgb = heat(clamp(frac, 0.0, 1.0));
    }
    default: { rgb = colour_outcome(cls); }
  }
  return vec4<f32>(rgb, 1.0);
}
