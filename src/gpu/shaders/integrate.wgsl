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

fn pairwise_force(g: f32, m: vec3<f32>, r: array<vec2<f32>, 3>) -> array<vec2<f32>, 3> {
  var F: array<vec2<f32>, 3>;
  F[0] = vec2<f32>(0.0, 0.0);
  F[1] = vec2<f32>(0.0, 0.0);
  F[2] = vec2<f32>(0.0, 0.0);

  let d01 = r[1] - r[0]; let r01 = length(d01); let f01 = g * m.x*m.y / (r01*r01*r01);
  F[0] += f01 * d01; F[1] -= f01 * d01;

  let d02 = r[2] - r[0]; let r02 = length(d02); let f02 = g * m.x*m.z / (r02*r02*r02);
  F[0] += f02 * d02; F[2] -= f02 * d02;

  let d12 = r[2] - r[1]; let r12 = length(d12); let f12 = g * m.y*m.z / (r12*r12*r12);
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

// One adaptive-substepped KDK (velocity-Verlet) leap over dt_step. No COM
// projection and no time bookkeeping — the macro-step composition below owns
// both (spec: COM projection after every COMPLETE macro step, i.e. after all
// Yoshida stages, not between them). dt_step may be NEGATIVE: Yoshida's
// middle stages step backward, which is required for explicit symplectic
// methods of order > 2 — not a bug.
fn kdk_leap(s: ptr<function, State>, knobs: SimUniforms, dt_step: f32) -> u32 {
  let rmin = min_pair_sep((*s).r);
  let nsub = substep_count(rmin, knobs);
  let dt   = dt_step / f32(nsub);

  for (var i = 0u; i < nsub; i = i + 1u) {
    var F = pairwise_force(knobs.G, (*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);

    (*s).r[0] += (*s).p[0] * (dt / (*s).m.x);
    (*s).r[1] += (*s).p[1] * (dt / (*s).m.y);
    (*s).r[2] += (*s).p[2] * (dt / (*s).m.z);

    F = pairwise_force(knobs.G, (*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);
  }
  return nsub;
}

// One classical RK4 step of size dt on (r, p). NOT symplectic — validation
// reference only (spec §sim); selecting it in production trades secular
// energy behaviour for local order.
fn rk4_step(s: ptr<function, State>, knobs: SimUniforms, dt: f32) {
  let m = (*s).m;
  let r0 = (*s).r; let p0 = (*s).p;

  let k1p = pairwise_force(knobs.G, m, r0);
  var k1r: array<vec2<f32>, 3>;
  k1r[0] = p0[0]/m.x; k1r[1] = p0[1]/m.y; k1r[2] = p0[2]/m.z;

  var r2: array<vec2<f32>, 3>;
  r2[0] = r0[0] + k1r[0]*(dt*0.5); r2[1] = r0[1] + k1r[1]*(dt*0.5); r2[2] = r0[2] + k1r[2]*(dt*0.5);
  let k2p = pairwise_force(knobs.G, m, r2);
  var k2r: array<vec2<f32>, 3>;
  k2r[0] = (p0[0] + k1p[0]*(dt*0.5))/m.x;
  k2r[1] = (p0[1] + k1p[1]*(dt*0.5))/m.y;
  k2r[2] = (p0[2] + k1p[2]*(dt*0.5))/m.z;

  var r3: array<vec2<f32>, 3>;
  r3[0] = r0[0] + k2r[0]*(dt*0.5); r3[1] = r0[1] + k2r[1]*(dt*0.5); r3[2] = r0[2] + k2r[2]*(dt*0.5);
  let k3p = pairwise_force(knobs.G, m, r3);
  var k3r: array<vec2<f32>, 3>;
  k3r[0] = (p0[0] + k2p[0]*(dt*0.5))/m.x;
  k3r[1] = (p0[1] + k2p[1]*(dt*0.5))/m.y;
  k3r[2] = (p0[2] + k2p[2]*(dt*0.5))/m.z;

  var r4: array<vec2<f32>, 3>;
  r4[0] = r0[0] + k3r[0]*dt; r4[1] = r0[1] + k3r[1]*dt; r4[2] = r0[2] + k3r[2]*dt;
  let k4p = pairwise_force(knobs.G, m, r4);
  var k4r: array<vec2<f32>, 3>;
  k4r[0] = (p0[0] + k3p[0]*dt)/m.x;
  k4r[1] = (p0[1] + k3p[1]*dt)/m.y;
  k4r[2] = (p0[2] + k3p[2]*dt)/m.z;

  let w = dt / 6.0;
  for (var i = 0u; i < 3u; i = i + 1u) {
    (*s).r[i] = r0[i] + w * (k1r[i] + 2.0*k2r[i] + 2.0*k3r[i] + k4r[i]);
    (*s).p[i] = p0[i] + w * (k1p[i] + 2.0*k2p[i] + 2.0*k3p[i] + k4p[i]);
  }
}

// Yoshida composition weights. Values mirror src/integrate/yoshida.ts (the
// CPU reference) at full f32 precision; the negative middle weights are
// REQUIRED, not a bug (principia-numerics).
const Y4_W1: f32 = 1.3512071919596578;   //  1 / (2 − 2^{1/3})
const Y4_W2: f32 = -1.7024143839193153;  // −2^{1/3} / (2 − 2^{1/3})
const Y6_W1: f32 = 0.7845136104775573;
const Y6_W2: f32 = 0.23557321335935813;
const Y6_W3: f32 = -1.177679984178871;
const Y6_W4: f32 = 1.3151863206839112;

// Integrator ids — mirror INTEGRATOR_INDEX in src/gpu/structs.ts.
const INTEG_KDK: u32      = 0u;
const INTEG_YOSHIDA4: u32 = 1u;
const INTEG_YOSHIDA6: u32 = 2u;
const INTEG_RK4: u32      = 3u;

// @export
// One macro step of the SELECTED integrator (knobs.integrator), with
// adaptive substepping inside each composition stage — mirroring the CPU
// yoshida4MacroStep/yoshida6MacroStep structure, which substeps each
// weighted stage independently. COM projection runs ONCE, after the
// complete macro step (mandatory; spec §com_projection). Returns the peak
// substep count for telemetry.
fn integrator_macro_step(s: ptr<function, State>, knobs: SimUniforms) -> u32 {
  var peak: u32 = 0u;
  switch (knobs.integrator) {
    case 1u: {   // Yoshida 4: three weighted KDK stages (w1, w2, w1)
      peak = max(peak, kdk_leap(s, knobs, Y4_W1 * knobs.dt_macro));
      peak = max(peak, kdk_leap(s, knobs, Y4_W2 * knobs.dt_macro));
      peak = max(peak, kdk_leap(s, knobs, Y4_W1 * knobs.dt_macro));
    }
    case 2u: {   // Yoshida 6: seven weighted KDK stages (palindromic)
      let w = array<f32, 7>(Y6_W1, Y6_W2, Y6_W3, Y6_W4, Y6_W3, Y6_W2, Y6_W1);
      for (var k = 0u; k < 7u; k = k + 1u) {
        peak = max(peak, kdk_leap(s, knobs, w[k] * knobs.dt_macro));
      }
    }
    case 3u: {   // RK4 (validation): fixed substeps of the adaptive count
      let nsub = substep_count(min_pair_sep((*s).r), knobs);
      let dt = knobs.dt_macro / f32(nsub);
      for (var i = 0u; i < nsub; i = i + 1u) { rk4_step(s, knobs, dt); }
      peak = nsub;
    }
    default: {   // KDK leapfrog (2nd order, preview default)
      peak = kdk_leap(s, knobs, knobs.dt_macro);
    }
  }
  (*s).t += knobs.dt_macro;
  project_com(s);
  return peak;
}
