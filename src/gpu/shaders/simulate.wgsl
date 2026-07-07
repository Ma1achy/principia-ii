// @import { decode_full, ICOut, ChartUniforms }           from "./decode.wgsl"
// @import { decode_linear, LinearisedRef, TILE_REQ_DECODE_LINEAR } from "./decode_linear.wgsl"
// @import { State, integrator_macro_step }                       from "./integrate.wgsl"
// @import { collision_check, escape_tick, EscapeCounters } from "./events.wgsl"
// @import { total_energy, ang_mom, shape_sphere }         from "./observe.wgsl"
// @import { cross_z, EPS_BOLT, PI }                       from "./helpers.wgsl"
// @import { FreeWord, empty_word, free_group_tick }       from "./free_group.wgsl"
//
// Entry-owned structs: SimUniforms / TileRequest / SimResult / ICDescriptor
// are declared HERE and referenced by the imported units without an import
// (WGSL module-scope forward references). Moving them into a unit that
// simulate.wgsl imports would create an import cycle.

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

// G7: per-copy sub-pixel jitter offsets in pixel units, indexed by gid.z.
// TS twin: packEnsembleOffsets in src/gpu/ensemble.ts. Zero-filled buffer
// (the default) = every copy samples the pixel centre.
struct EnsembleOffsets {
  offsets: array<vec4<f32>, 16>,
};

// Affine (u,v) → z slice for latent-affine charts: z = z0 + su·q1 + sv·q2
// with su = (2u−1)·mag, sv = (2v−1)·mag. This is uniform DATA, not chart
// identity — the shader stays chart-agnostic. TS twin: packSliceUniforms
// in src/gpu/slice_uniforms.ts (pin: test/unit/gpu/slice_uniforms.test.ts).
struct SliceUniforms {
  z0a: vec4<f32>, z0b: vec4<f32>,
  q1a: vec4<f32>, q1b: vec4<f32>,
  q2a: vec4<f32>, q2b: vec4<f32>,
  mag_pad: vec4<f32>,               // x = mag
};

// CPU-decoded per-sample IC for charts that are not affine in latent
// space; the shader just reads (m, r, p). TS twin: packUploadedICs in
// src/gpu/uploaded_ics.ts (pin: test/unit/gpu/uploaded_ics.test.ts).
struct UploadedIC {
  m_t:  vec4<f32>,                  // m1, m2, m3, terminal (0/1/2)
  r01:  vec4<f32>,                  // r0.xy, r1.xy
  r2p0: vec4<f32>,                  // r2.xy, p0.xy
  p12:  vec4<f32>,                  // p1.xy, p2.xy
};

// TS twin: TILE_REQUEST_FLAGS.DECODE_UPLOADED in src/gpu/structs.ts
// (value pinned by test/unit/gpu/uploaded_ics.test.ts).
const TILE_REQ_DECODE_UPLOADED : u32 = 2u;

@group(0) @binding(0) var<uniform>      uniforms : SimUniforms;
@group(0) @binding(1) var<uniform>      tile_req : TileRequest;
@group(0) @binding(3) var<uniform>      chart    : ChartUniforms;   // G4
@group(0) @binding(4) var<uniform>      linearised : LinearisedRef; // G6
@group(0) @binding(5) var<uniform>      ensemble   : EnsembleOffsets; // G7
@group(0) @binding(6) var<uniform>      slice      : SliceUniforms;
@group(0) @binding(7) var<storage, read> uploaded  : array<UploadedIC>;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;
@group(1) @binding(1) var<storage, read_write> ics     : array<ICDescriptor>;

// Shape-sphere vector of a state (mass-weighted Jacobi → n on S²).
// Mirrors the checkpoint-capture math; hoisted so the per-step phase/arc
// tracking and the checkpoint branch share one definition.
fn shape_n_of(s: State) -> vec3<f32> {
  let M01 = s.m.x + s.m.y;
  let cx  = (s.m.x*s.r[0] + s.m.y*s.r[1]) / M01;
  let rho = s.r[1] - s.r[0];
  let lambda = s.r[2] - cx;
  let muRho    = (s.m.x * s.m.y) / M01;
  let muLambda = s.m.z * M01;
  return shape_sphere(rho * sqrt(muRho), lambda * sqrt(muLambda));
}

// Mass-weighted phase-space separation (ADR-0003 norm; TS twin:
// inspector/shadow.ts `sep`): Σ mᵢ|Δr|² + |Δp|²/mᵢ.
fn ftle_sep(a: State, b: State) -> f32 {
  var s2: f32 = 0.0;
  for (var i = 0u; i < 3u; i = i + 1u) {
    let dr = b.r[i] - a.r[i];
    let dp = b.p[i] - a.p[i];
    s2 += a.m[i] * dot(dr, dr) + dot(dp, dp) / a.m[i];
  }
  return sqrt(s2);
}

// Pull the shadow back to distance d0 along the current separation.
fn ftle_renorm(base: State, shadow: State, d: f32, d0: f32) -> State {
  var out = shadow;
  let sc = d0 / d;
  for (var i = 0u; i < 3u; i = i + 1u) {
    out.r[i] = base.r[i] + (shadow.r[i] - base.r[i]) * sc;
    out.p[i] = base.p[i] + (shadow.p[i] - base.p[i]) * sc;
  }
  return out;
}

// Least-squares slope ω over the checkpoints inside [t_lo, t_hi].
// Mirrors metrics/diffusion.ts fitOmega (≥3-sample gate; den > 0).
// Checkpoint m sits at t = (m+1)·dt_ckpt with θ̃ in the .w lane.
fn fit_omega(
  ckpts: array<vec4<f32>, 8>, m_count: u32, dt_ckpt: f32,
  t_lo: f32, t_hi: f32,
) -> vec2<f32> {                       // (omega, valid: 1/0)
  var n: f32 = 0.0; var tBar: f32 = 0.0; var yBar: f32 = 0.0;
  for (var m = 0u; m < m_count; m = m + 1u) {
    let t = f32(m + 1u) * dt_ckpt;
    if (t >= t_lo && t <= t_hi) { n += 1.0; tBar += t; yBar += ckpts[m].w; }
  }
  if (n < 3.0) { return vec2<f32>(0.0, 0.0); }
  tBar /= n; yBar /= n;
  var num: f32 = 0.0; var den: f32 = 0.0;
  for (var m = 0u; m < m_count; m = m + 1u) {
    let t = f32(m + 1u) * dt_ckpt;
    if (t >= t_lo && t <= t_hi) {
      let dt = t - tBar;
      num += dt * (ckpts[m].w - yBar);
      den += dt * dt;
    }
  }
  if (den == 0.0) { return vec2<f32>(0.0, 0.0); }
  return vec2<f32>(num / den, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = uniforms.samples_per_axis;
  if (gid.x >= N || gid.y >= N) { return; }
  // G7 ensemble: gid.z selects the copy — each writes its own N² slice of
  // the SimResult buffer and jitters its sample point within the pixel.
  let idx = gid.z * N * N + gid.y * N + gid.x;

  let t = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(N)
        + ensemble.offsets[gid.z].xy / f32(N);

  // Decode: linearised path at deep zoom (G6); CPU-uploaded ICs for
  // charts that are not affine in latent space; affine slice otherwise.
  var ic_out: ICOut;
  if ((tile_req.flags & TILE_REQ_DECODE_LINEAR) != 0u) {
    ic_out = decode_linear(t, linearised, uniforms.r_coll);
  } else if ((tile_req.flags & TILE_REQ_DECODE_UPLOADED) != 0u) {
    let up = uploaded[idx];
    ic_out.m = up.m_t.xyz;
    ic_out.terminal = u32(up.m_t.w);
    ic_out.r[0] = up.r01.xy;  ic_out.r[1] = up.r01.zw;  ic_out.r[2] = up.r2p0.xy;
    ic_out.p[0] = up.r2p0.zw; ic_out.p[1] = up.p12.xy;  ic_out.p[2] = up.p12.zw;
  } else {
    // Tile-local UV → global UV → 8D latent via the view's slice:
    // z = z0 + mag·((2u−1)·q1 + (2v−1)·q2), the exact CPU map in
    // chart_atlas/charts/latent_slice.ts.
    let uv = tile_req.uv_centre + tile_req.uv_half * (2.0 * t - 1.0);
    let su = (uv.x * 2.0 - 1.0) * slice.mag_pad.x;
    let sv = (uv.y * 2.0 - 1.0) * slice.mag_pad.x;
    let za = slice.z0a + su * slice.q1a + sv * slice.q2a;
    let zb = slice.z0b + su * slice.q1b + sv * slice.q2b;
    var z: array<f32, 8>;
    z[0] = za.x; z[1] = za.y; z[2] = za.z; z[3] = za.w;
    z[4] = zb.x; z[5] = zb.y; z[6] = zb.z; z[7] = zb.w;
    ic_out = decode_full(z, chart, uniforms.r_coll);
  }

  if (ic_out.terminal != 0u) {
    write_terminal(idx, ic_out);
    return;
  }

  var s: State;
  s.r = ic_out.r; s.p = ic_out.p; s.m = ic_out.m; s.t = 0.0;

  // Initial invariants.
  let E0  = total_energy(s);
  let Lz0 = ang_mom(s);

  // Shape-sphere trace state: n(t), unwrapped phase θ̃(t), arc length.
  // Unwrap per MACRO step (dt_macro is far below the shape period, so the
  // per-step phase delta stays well inside ±π). TS twins:
  // metrics/phase.ts (unwrap), metrics/arc.ts (geodesic arc).
  var prev_n = shape_n_of(s);
  var prev_phase = atan2(prev_n.y, prev_n.x);
  var theta_tilde: f32 = 0.0;
  var arc: f32 = 0.0;

  // Free-group word (spec §free_group). Branch cuts at the equal-mass BC
  // basepoints (TS twin: DEFAULT_BRANCH_CUTS in metrics/observe_extended.ts).
  // ADR-0004: off the equal-mass ε band the word is computed-but-untrusted
  // (WORD_UNCERTAIN, descriptor bit 9).
  let FG_B1 = vec3<f32>(1.0, 0.0, 0.0);
  let FG_B2 = vec3<f32>(-0.5, 0.8660254037844386, 0.0);
  var word = empty_word();
  let m_mean = (s.m.x + s.m.y + s.m.z) / 3.0;
  let word_uncertain = select(0u, 1u,
    abs(s.m.x - m_mean) > 1e-6 || abs(s.m.y - m_mean) > 1e-6
    || abs(s.m.z - m_mean) > 1e-6);

  // Benettin shadow trajectory for FTLE (research tier only — it doubles
  // the integration cost). f32 CONSTRAINT: the CPU reference seeds at
  // δ0 = 1e-8, but 1 + 1e-8 == 1 in f32 — the perturbation would vanish.
  // Seed at 1e-4 (well above f32 ε on O(1) coordinates) and renormalise
  // often so the separation never leaves the measurable band.
  let want_ftle = uniforms.quality_tier == 2u;
  let FTLE_DELTA0: f32 = 1e-4;
  let FTLE_RENORM_EVERY: u32 = 16u;
  var shadow: State = s;
  if (want_ftle) {
    let seed = FTLE_DELTA0 / sqrt(12.0);      // ADR-0003: full phase-space seed
    for (var i = 0u; i < 3u; i = i + 1u) {
      shadow.r[i] += vec2<f32>(seed, seed);
      shadow.p[i] += vec2<f32>(seed, seed);
    }
  }
  var ftle_S: f32 = 0.0;
  var renorms: u32 = 0u;
  var steps_since_renorm: u32 = 0u;

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
    let nsub = integrator_macro_step(&s, uniforms);
    totalSubsteps += nsub;
    maxSub = max(maxSub, nsub);

    // Benettin shadow: same integrator, same macro cadence; measure and
    // renormalise every FTLE_RENORM_EVERY steps in the mass-weighted norm.
    if (want_ftle) {
      let _ns = integrator_macro_step(&shadow, uniforms);
      steps_since_renorm += 1u;
      if (steps_since_renorm >= FTLE_RENORM_EVERY) {
        let d = ftle_sep(s, shadow);
        if (d > 0.0 && d < 1e30) {
          ftle_S += log(d / FTLE_DELTA0);
          shadow = ftle_renorm(s, shadow, d, FTLE_DELTA0);
          renorms += 1u;
        }
        steps_since_renorm = 0u;
      }
    }

    // Energy / Lz drift tracking.
    let E  = total_energy(s);
    let Lz = ang_mom(s);
    dE_max  = max(dE_max,  abs(E  - E0));
    dLz_max = max(dLz_max, abs(Lz - Lz0));

    let rmin = min(length(s.r[1]-s.r[0]),
              min(length(s.r[2]-s.r[0]), length(s.r[2]-s.r[1])));
    dmin = min(dmin, rmin);

    // Shape trace: phase unwrap + geodesic arc, every macro step. The
    // wrapped delta stays inside ±π because dt_macro ≪ the shape period.
    let n = shape_n_of(s);
    let ph = atan2(n.y, n.x);
    var dph = ph - prev_phase;
    if (dph >  PI) { dph -= 2.0 * PI; }
    if (dph < -PI) { dph += 2.0 * PI; }
    theta_tilde += dph;
    arc += acos(clamp(dot(prev_n, n), -1.0, 1.0));
    word = free_group_tick(word, prev_n, n, FG_B1, FG_B2);
    prev_n = n; prev_phase = ph;

    // Checkpoint capture: n(t_m) in .xyz, unwrapped phase θ̃(t_m) in .w
    // (the spec's SimResult contract; geometry readers must ignore .w).
    if (ck < M && s.t >= nextCkpt) {
      checkpoints[ck] = vec4<f32>(n, theta_tilde);
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

  // Frequency diffusion: two-window least-squares ω fit over the
  // checkpoint (t_m, θ̃_m) series (spec §freq_diffusion; TS twin
  // metrics/diffusion.ts). Only meaningful for a BOUNDED run with a full
  // checkpoint set — padded lanes would poison the fit — else sentinel -1.
  var diffusion: f32 = -1.0;
  if (terminal_kind == 0u && ck == M) {
    let T = uniforms.T_horizon;
    let w1 = fit_omega(checkpoints, M, dtCkpt, T * 0.25, T * 0.5);
    let w2 = fit_omega(checkpoints, M, dtCkpt, T * 0.5,  T * 0.75);
    if (w1.y > 0.5 && w2.y > 0.5) { diffusion = abs(w2.x - w1.x); }
  }

  // Benettin FTLE: λ = S / t over the renormalisation history. Valid only
  // for BOUNDED outcomes with at least one renormalisation (FTLE_VALID,
  // bit 7) — near a collision the separation explodes at the singularity
  // and λ measures the event, not the flow. Mirrors the CPU inspector's
  // bounded-only gate.
  var ftle: f32 = 0.0;
  var ftle_valid: u32 = 0u;
  if (want_ftle && terminal_kind == 0u && renorms > 0u && s.t > 0.0) {
    ftle = ftle_S / s.t;
    ftle_valid = 1u;
  }

  // Write SimResult. Word length rides in .w bits 26–31 (symbol slots
  // reach only bit 19 of .w — spec §free_group packing).
  var r: SimResult;
  r.n_checkpoints   = checkpoints;
  r.free_group_word = vec4<u32>(word.bits.x, word.bits.y, word.bits.z,
                                word.bits.w | (min(word.length, 58u) << 26u));
  r.arc_length_n    = arc;
  r.t_end           = s.t;
  r.d_min           = dmin;
  r.ftle            = ftle;
  r.diffusion       = diffusion;
  r.delta_E_max_abs = dE_max;
  r.energy_drift    = dE_max / max(abs(E0), uniforms.eps_E);
  r.delta_Lz_max_abs = dLz_max;
  r.Lz_drift         = dLz_max / max(abs(Lz0), uniforms.eps_L);
  r.E_0  = E0; r.Lz_0 = Lz0;
  r.sample_descriptor = (terminal_kind & 0x7u)
                       | ((terminal_detail & 0x3u) << 3u)
                       | (ftle_valid << 7u)
                       | (word.truncated << 8u)         // WORD_TRUNCATED
                       | (word_uncertain << 9u)         // WORD_UNCERTAIN (ADR-0004)
                       | (min(renorms, 127u) << 23u);
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
