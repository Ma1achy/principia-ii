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
  // For M3 we hard-code mu_max, alpha_min, q_max: they live with the chart in M10.
  // Rough values for the latent chart at M3:
  mu_max:           f32,           // = 5
  alpha_min:        f32,           // = 0.05
  q_max:            f32,           // = 2
};

struct TileRequest {
  z: i32, tx: i32, ty: i32, level: i32,
  uv_centre: vec2<f32>,
  uv_half:   vec2<f32>,
  flags:     u32,
};

struct SimResult {
  // Layout matches src/gpu/structs.ts. M = 8 here.
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

@group(0) @binding(0) var<uniform>      uniforms : SimUniforms;
@group(0) @binding(1) var<uniform>      tile_req : TileRequest;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;
@group(1) @binding(1) var<storage, read_write> ics     : array<ICDescriptor>;

@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = uniforms.samples_per_axis;
  if (gid.x >= N || gid.y >= N) { return; }
  let idx = gid.y * N + gid.x;

  // Tile-local UV → latent z (M3: latent chart, both axes are z[0] and z[1]).
  let t = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(N);
  let uv = tile_req.uv_centre + tile_req.uv_half * (2.0 * t - 1.0);
  // Map UV → 8D latent. For M3 we use a default slice: u → z[0], v → z[1].
  var z: array<f32, 8>;
  z[0] = (uv.x * 2.0 - 1.0) * 3.0;     // ±3 latent range
  z[1] = (uv.y * 2.0 - 1.0) * 3.0;
  z[2] = 0.0; z[3] = 0.0; z[4] = 0.0; z[5] = 0.0;       // rest start
  z[6] = 0.0; z[7] = 0.0;                               // equal masses

  // Decode.
  let ic_out = decode_full(z, uniforms);

  if (ic_out.terminal != 0u) {
    write_terminal(idx, ic_out);
    return;
  }

  var s: State;
  s.r = ic_out.r; s.p = ic_out.p; s.m = ic_out.m; s.t = 0.0;

  // Initial invariants.
  let E0  = total_energy(s);
  let Lz0 = ang_mom(s);

  // Integration loop with checkpointing.
  var checkpoints: array<vec4<f32>, 8>;
  let M = uniforms.checkpoint_count;
  let dtCkpt = uniforms.T_horizon / f32(M);
  var nextCkpt: f32 = dtCkpt;
  var ck: u32 = 0u;

  var dE_max: f32 = 0.0; var dLz_max: f32 = 0.0;
  var dmin: f32 = 1e9;   var totalSubsteps: u32 = 0u;
  var maxSub: u32 = 0u;
  var escapeState = EscapeCounters(0u, 0u, 0u);

  var terminal_kind: u32 = 0u;
  var terminal_detail: u32 = 0u;
  var max_substeps_runs: u32 = 0u;

  loop {
    if (s.t >= uniforms.T_horizon) { break; }
    let nsub = kdk_macro_step(&s, uniforms);
    totalSubsteps += nsub;
    maxSub = max(maxSub, nsub);

    // Energy / Lz drift tracking.
    let E  = total_energy(s);
    let Lz = ang_mom(s);
    dE_max  = max(dE_max,  abs(E  - E0));
    dLz_max = max(dLz_max, abs(Lz - Lz0));

    let rmin = min(length(s.r[1]-s.r[0]),
              min(length(s.r[2]-s.r[0]), length(s.r[2]-s.r[1])));
    dmin = min(dmin, rmin);

    // Checkpoint capture (corrected shape-sphere coordinate).
    if (ck < M && s.t >= nextCkpt) {
      // Rebuild the canonical-frame Jacobi vectors for the shape sphere.
      let M01 = s.m.x + s.m.y;
      let cx  = (s.m.x*s.r[0] + s.m.y*s.r[1]) / M01;
      let rho = s.r[1] - s.r[0];
      let lambda = s.r[2] - cx;
      let muRho    = (s.m.x * s.m.y) / M01;
      let muLambda = s.m.z * M01;
      let rho_t    = rho    * sqrt(muRho);
      let lambda_t = lambda * sqrt(muLambda);
      let n = shape_sphere(rho_t, lambda_t);
      // .w = unwrapped phase placeholder for M6; M3 leaves it 0.
      checkpoints[ck] = vec4<f32>(n, 0.0);
      ck += 1u;
      nextCkpt += dtCkpt;
    }

    if (nsub >= uniforms.N_max) { max_substeps_runs += 1u; }
    else                         { max_substeps_runs = 0u; }
    if (max_substeps_runs >= 1u) {
      // Substep budget exhausted / stall → TIMEOUT (Outcome=4), not DEGENERATE.
      terminal_kind = 4u; break;
    }

    let coll = collision_check(s.r, uniforms.r_coll);
    if (coll.fired) { terminal_kind = 1u; terminal_detail = coll.pair; break; }

    let esc = escape_tick(s, &escapeState, uniforms.R_esc, uniforms.k_esc);
    if (esc.fired) { terminal_kind = 2u; terminal_detail = esc.body; break; }
  }

  // Fill any remaining checkpoints with the last-known n (so downstream
  // readers don't see uninitialised lanes).
  for (var k = ck; k < M; k = k + 1u) {
    checkpoints[k] = checkpoints[max(ck, 1u) - 1u];
  }

  // Write SimResult.
  var r: SimResult;
  r.n_checkpoints   = checkpoints;
  r.free_group_word = vec4<u32>(0u, 0u, 0u, 0u);     // M6
  r.arc_length_n    = 0.0;                            // M6
  r.t_end           = s.t;
  r.d_min           = dmin;
  r.ftle            = 0.0;                            // M6 / Research tier
  r.diffusion       = -1.0;                           // M6
  r.delta_E_max_abs = dE_max;
  r.energy_drift    = dE_max / max(abs(E0), uniforms.eps_E);
  r.delta_Lz_max_abs = dLz_max;
  r.Lz_drift         = dLz_max / max(abs(Lz0), uniforms.eps_L);
  r.E_0  = E0; r.Lz_0 = Lz0;
  r.sample_descriptor = (terminal_kind & 0x7u)
                       | ((terminal_detail & 0x3u) << 3u);
  r.trajectory_stats  = 0u;
  results[idx] = r;

  // Write IC descriptor.
  var d: ICDescriptor;
  d.m1 = ic_out.m.x; d.m2 = ic_out.m.y; d.m3 = ic_out.m.z;
  d.q_mass = min(ic_out.m.x, min(ic_out.m.y, ic_out.m.z));
  let M01_d = ic_out.m.x + ic_out.m.y;
  let cx_d  = (ic_out.m.x*ic_out.r[0] + ic_out.m.y*ic_out.r[1]) / M01_d;
  let rho_d    = ic_out.r[1] - ic_out.r[0];
  let lambda_d = ic_out.r[2] - cx_d;
  d.rho1_mag = length(rho_d);
  d.rho2_mag = length(lambda_d);
  d.rho_ratio = d.rho2_mag / max(d.rho1_mag, EPS_BOLT);
  d.rho_angle = atan2(cross_z(rho_d, lambda_d), dot(rho_d, lambda_d));
  let K0d = dot(ic_out.p[0], ic_out.p[0]) / (2.0*ic_out.m.x)
          + dot(ic_out.p[1], ic_out.p[1]) / (2.0*ic_out.m.y)
          + dot(ic_out.p[2], ic_out.p[2]) / (2.0*ic_out.m.z);
  d.K_0 = K0d;
  d.V_0 = E0 - K0d;
  d.virial_ratio = 2.0 * d.K_0 / max(EPS_BOLT, abs(d.V_0));
  d.r_min_pair_0 = min(length(ic_out.r[1]-ic_out.r[0]),
                  min(length(ic_out.r[2]-ic_out.r[0]),
                      length(ic_out.r[2]-ic_out.r[1])));
  ics[idx] = d;
}

fn write_terminal(idx: u32, ic: ICOut) {
  var r: SimResult;
  r.t_end = 0.0;
  r.d_min = 0.0;
  r.diffusion = -1.0;
  // Map the decode terminal (1 = degenerate, 2 = collision_t0) to the Outcome
  // enum class (BOUNDED=0, COLLISION=1, ESCAPE=2, DEGENERATE=3, TIMEOUT=4).
  var cls: u32 = 3u;                      // default DEGENERATE
  if (ic.terminal == 2u) { cls = 1u; }   // COLLISION_T0 → COLLISION class
  r.sample_descriptor = (cls & 0x7u);
  results[idx] = r;
  // (descriptor still written for visualisation purposes.)
}
