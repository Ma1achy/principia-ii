// @import { EPS_BOLT } from "./helpers.wgsl"
// SimUniforms is entry-owned (declared in simulate.wgsl) and referenced here
// without an import directive — WGSL module-scope forward references make
// this legal in the linked module, and it keeps the unit graph acyclic.

// @export
struct State {
  r: array<vec2<f32>, 3>,
  p: array<vec2<f32>, 3>,
  m: vec3<f32>,
  t: f32,
};

fn pairwise_force(m: vec3<f32>, r: array<vec2<f32>, 3>) -> array<vec2<f32>, 3> {
  var F: array<vec2<f32>, 3>;
  F[0] = vec2<f32>(0.0, 0.0);
  F[1] = vec2<f32>(0.0, 0.0);
  F[2] = vec2<f32>(0.0, 0.0);

  let d01 = r[1] - r[0]; let r01 = length(d01); let f01 = m.x*m.y / (r01*r01*r01);
  F[0] += f01 * d01; F[1] -= f01 * d01;

  let d02 = r[2] - r[0]; let r02 = length(d02); let f02 = m.x*m.z / (r02*r02*r02);
  F[0] += f02 * d02; F[2] -= f02 * d02;

  let d12 = r[2] - r[1]; let r12 = length(d12); let f12 = m.y*m.z / (r12*r12*r12);
  F[1] += f12 * d12; F[2] -= f12 * d12;
  return F;
}

fn min_pair_sep(r: array<vec2<f32>, 3>) -> f32 {
  return min(length(r[1] - r[0]),
        min(length(r[2] - r[0]),
            length(r[2] - r[1])));
}

fn project_com(s: ptr<function, State>) {
  let m = (*s).m; let M = m.x + m.y + m.z;
  let R = (m.x*(*s).r[0] + m.y*(*s).r[1] + m.z*(*s).r[2]) / M;
  let P = (*s).p[0] + (*s).p[1] + (*s).p[2];
  (*s).r[0] -= R; (*s).r[1] -= R; (*s).r[2] -= R;
  (*s).p[0] -= P * (m.x/M);
  (*s).p[1] -= P * (m.y/M);
  (*s).p[2] -= P * (m.z/M);
}

fn substep_count(rmin: f32, knobs: SimUniforms) -> u32 {
  let raw = u32(ceil(pow(knobs.r_sub / max(rmin, EPS_BOLT), knobs.gamma_sub)));
  return clamp(raw, 1u, knobs.N_max);
}

// @export
// One macro KDK step with adaptive substepping. Returns the substep count
// for telemetry.
fn kdk_macro_step(s: ptr<function, State>, knobs: SimUniforms) -> u32 {
  let rmin = min_pair_sep((*s).r);
  let nsub = substep_count(rmin, knobs);
  let dt   = knobs.dt_macro / f32(nsub);

  for (var i = 0u; i < nsub; i = i + 1u) {
    var F = pairwise_force((*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);

    (*s).r[0] += (*s).p[0] * (dt / (*s).m.x);
    (*s).r[1] += (*s).p[1] * (dt / (*s).m.y);
    (*s).r[2] += (*s).p[2] * (dt / (*s).m.z);

    F = pairwise_force((*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);
  }

  (*s).t += knobs.dt_macro;
  project_com(s);
  return nsub;
}
