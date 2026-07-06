// One workgroup reduces one tile. Each lane in a 64-thread workgroup
// stride-loads through the N² SimResults and accumulates partials in
// shared memory; lane 0 writes the final TileReduction at the end.
//
// This module compiles standalone (it is NOT concatenated with simulate.wgsl),
// so SimUniforms / TileRequest / SimResult are repeated here in full — they
// must stay byte-identical to simulate.wgsl and src/gpu/structs.ts.
//
// The TileReduction struct below is EXACTLY the text emitted by
// wgslTileReductionStruct(8) in src/gpu/structs.ts (ADR 0006). The golden
// test diffs the two; edit the TILE_REDUCTION_FIELDS table, never this text.

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

struct TileRequest {
  z: i32, tx: i32, ty: i32, level: i32,
  uv_centre: vec2<f32>,
  uv_half:   vec2<f32>,
  flags:     u32,
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

// TileID is 3 × i32 with NO trailing pad: level packs at byte 12 and the
// checkpoint array lands naturally 16-aligned at byte 16, keeping the whole
// struct at the ADR-0006 pinned 272 bytes (M=8). A _pad here would push the
// struct to 288 and break the alignment pin (D5.1).
struct TileID  { z: i32, tx: i32, ty: i32 };
struct TileReduction {
  id:    TileID,
  level: i32,
  mean_n_checkpoints: array<vec4<f32>, 8>,
  mean_arc_length_n: f32,
  mean_t_end: f32,
  mean_d_min: f32,
  mean_ftle: f32,
  mean_energy_drift: f32,
  mean_diffusion: f32,
  spread_n: f32,
  spread_arc_length_n: f32,
  spread_t_end: f32,
  spread_d_min: f32,
  spread_ftle: f32,
  spread_energy_drift: f32,
  spread_diffusion: f32,
  outcome_impurity: f32,
  dominant_outcome: u32,
  suspect_fraction: f32,
  suspect_lz_fraction: f32,
  energy_drift_worst: f32,
  lz_drift_worst: f32,
  mean_word_length: f32,
  spread_word_length: f32,
  word_agreement: f32,
  dominant_word_hash: u32,
  ensemble_outcome_agreement: f32,
  ensemble_count: i32,
  mean_orbit_count: f32,
  retrograde_fraction: f32,
  coherence_score: f32,
  priority_score: f32,
  sample_count: i32,
  status_flags: u32,
};

// Schema version (must equal TILE_REDUCTION_SCHEMA_VERSION in structs.ts).
// Written into status_flags bits 6-7; decodeTileReduction strips + asserts it.
const TILE_REDUCTION_SCHEMA_VERSION: u32 = 1u;

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req : TileRequest;
@group(1) @binding(0) var<storage, read>       results : array<SimResult>;
@group(2) @binding(0) var<storage, read_write> out     : TileReduction;

const LANES: u32 = 64u;
var<workgroup> shared_arc:       array<f32, 64>;
var<workgroup> shared_t_end:     array<f32, 64>;
var<workgroup> shared_d_min:     array<f32, 64>;
var<workgroup> shared_drift:     array<f32, 64>;
var<workgroup> shared_diff:      array<f32, 64>;
var<workgroup> shared_diff_n:    array<f32, 64>;
var<workgroup> shared_class_hist: array<atomic<u32>, 5>;
var<workgroup> shared_suspect_e: array<atomic<u32>, 1>;
var<workgroup> shared_suspect_l: array<atomic<u32>, 1>;
var<workgroup> shared_drift_max: array<atomic<u32>, 1>;
var<workgroup> shared_lz_max:    array<atomic<u32>, 1>;

fn parallel_sum(arr: ptr<workgroup, array<f32, 64>>, lane: u32) -> f32 {
  for (var s: u32 = 32u; s > 0u; s = s >> 1u) {
    if (lane < s) {
      (*arr)[lane] = (*arr)[lane] + (*arr)[lane + s];
    }
    workgroupBarrier();
  }
  return (*arr)[0];
}

@compute @workgroup_size(64, 1, 1)
fn reduce(@builtin(local_invocation_id) lid : vec3<u32>) {
  let lane = lid.x;
  let total = uniforms.samples_per_axis * uniforms.samples_per_axis;

  if (lane == 0u) {
    for (var i = 0u; i < 5u; i = i + 1u) { atomicStore(&shared_class_hist[i], 0u); }
    atomicStore(&shared_suspect_e[0], 0u);
    atomicStore(&shared_suspect_l[0], 0u);
    atomicStore(&shared_drift_max[0], 0u);
    atomicStore(&shared_lz_max[0],    0u);
  }
  workgroupBarrier();

  // Stride loop: per-lane accumulators.
  var arc: f32 = 0.0;
  var t_end_sum: f32 = 0.0;
  var d_min_sum: f32 = 0.0;
  var drift_sum: f32 = 0.0;
  var diff_sum:  f32 = 0.0;
  var diff_count: f32 = 0.0;

  var i = lane;
  loop {
    if (i >= total) { break; }
    let r = results[i];
    arc       = arc       + r.arc_length_n;
    t_end_sum = t_end_sum + r.t_end;
    d_min_sum = d_min_sum + r.d_min;
    drift_sum = drift_sum + r.energy_drift;
    if (r.diffusion >= 0.0) {       // sentinel guard
      diff_sum   = diff_sum + r.diffusion;
      diff_count = diff_count + 1.0;
    }

    let cls = r.sample_descriptor & 0x7u;
    if (cls < 5u) {
      atomicAdd(&shared_class_hist[cls], 1u);
    }
    let suspectE = (r.sample_descriptor >> 5u) & 1u;
    let suspectL = (r.sample_descriptor >> 6u) & 1u;
    if (suspectE == 1u) { atomicAdd(&shared_suspect_e[0], 1u); }
    if (suspectL == 1u) { atomicAdd(&shared_suspect_l[0], 1u); }

    // Drift maxima via atomicMax with f32 bit pattern (positive only).
    atomicMax(&shared_drift_max[0], bitcast<u32>(r.delta_E_max_abs));
    atomicMax(&shared_lz_max[0],    bitcast<u32>(r.delta_Lz_max_abs));

    i = i + LANES;
  }
  shared_arc[lane]    = arc;
  shared_t_end[lane]  = t_end_sum;
  shared_d_min[lane]  = d_min_sum;
  shared_drift[lane]  = drift_sum;
  shared_diff[lane]   = diff_sum;
  shared_diff_n[lane] = diff_count;
  workgroupBarrier();

  let sumArc   = parallel_sum(&shared_arc,    lane);
  let sumTend  = parallel_sum(&shared_t_end,  lane);
  let sumDmin  = parallel_sum(&shared_d_min,  lane);
  let sumDrift = parallel_sum(&shared_drift,  lane);
  let sumDiff  = parallel_sum(&shared_diff,   lane);
  let sumDiffN = parallel_sum(&shared_diff_n, lane);

  if (lane == 0u) {
    let n = f32(total);
    out.id = TileID(tile_req.z, tile_req.tx, tile_req.ty);
    out.level = tile_req.level;

    // Checkpoint means are an M6 second pass; zero them so re-used output
    // buffers never leak a previous tile's data.
    for (var m = 0u; m < 8u; m = m + 1u) {
      out.mean_n_checkpoints[m] = vec4<f32>(0.0);
    }

    out.mean_arc_length_n = sumArc   / n;
    out.mean_t_end        = sumTend  / n;
    out.mean_d_min        = sumDmin  / n;
    out.mean_ftle         = 0.0;        // M6 (FTLE lane not yet meaningful)
    out.mean_energy_drift = sumDrift / n;
    if (sumDiffN > 0.0) {
      out.mean_diffusion = sumDiff / sumDiffN;
    } else {
      out.mean_diffusion = -1.0;        // sentinel: no valid diffusion samples
    }

    // Class histogram → outcome impurity and dominant.
    var hist: array<u32, 5>;
    var dom: u32 = 0u; var domN: u32 = 0u; var sumN: u32 = 0u;
    for (var c = 0u; c < 5u; c = c + 1u) {
      hist[c] = atomicLoad(&shared_class_hist[c]);
      sumN = sumN + hist[c];
      if (hist[c] > domN) { domN = hist[c]; dom = c; }
    }
    out.dominant_outcome  = dom;
    out.outcome_impurity  = 1.0 - f32(domN) / max(1.0, f32(sumN));
    out.suspect_fraction  = f32(atomicLoad(&shared_suspect_e[0])) / n;
    out.suspect_lz_fraction = f32(atomicLoad(&shared_suspect_l[0])) / n;
    out.energy_drift_worst = bitcast<f32>(atomicLoad(&shared_drift_max[0]));
    out.lz_drift_worst     = bitcast<f32>(atomicLoad(&shared_lz_max[0]));
    out.sample_count       = i32(total);

    // Coherence score is computed CPU-side after readback so the same
    // formula governs the scheduler decisions; the GPU writes the
    // dominant spread terms below and zero-pads the rest.
    out.spread_n              = 0.0;       // M6 fills this
    out.spread_arc_length_n   = 0.0;
    out.spread_t_end          = 0.0;
    out.spread_d_min          = 0.0;
    out.spread_ftle           = 0.0;
    out.spread_energy_drift   = 0.0;
    out.spread_diffusion      = 0.0;

    // Free-group / ensemble / trajectory fields are M6 producers.
    out.mean_word_length   = 0.0;
    out.spread_word_length = 0.0;
    out.word_agreement     = 0.0;
    out.dominant_word_hash = 0u;
    out.ensemble_outcome_agreement = 1.0;   // no ensemble ⇒ perfect agreement
    out.ensemble_count     = 0;
    out.mean_orbit_count   = 0.0;
    out.retrograde_fraction = 0.0;

    out.coherence_score = 0.0;     // CPU patches after readback
    out.priority_score  = 0.0;
    // Bits 0-5 are TILE_STATUS flags (none set in M5); bits 6-7 carry the
    // schema version the CPU decoder asserts.
    out.status_flags    = TILE_REDUCTION_SCHEMA_VERSION << 6u;
  }
}
