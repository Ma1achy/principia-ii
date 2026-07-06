// @import { State } from "./integrate.wgsl"

// @export
struct EventOut {
  fired:   bool,
  kind:    u32,                 // 1=collision, 2=escape, 3=max_substeps, 4=sim_failed
  pair:    u32,                 // for collision
  body:    u32,                 // for escape
};

// @export
fn collision_check(r: array<vec2<f32>, 3>, r_coll: f32) -> EventOut {
  var out: EventOut;
  out.fired = false;
  let d01 = length(r[1] - r[0]);
  let d02 = length(r[2] - r[0]);
  let d12 = length(r[2] - r[1]);
  let dmin = min(d01, min(d02, d12));
  if (dmin < r_coll) {
    out.fired = true; out.kind = 1u;
    if (d01 == dmin) { out.pair = 0u; }
    else if (d02 == dmin) { out.pair = 1u; }
    else { out.pair = 2u; }
  }
  return out;
}

// @export
struct EscapeCounters {
  c0: u32, c1: u32, c2: u32,
};

// @export
fn escape_tick(
  s: State, st: ptr<function, EscapeCounters>,
  R_esc: f32, k_esc: u32,
) -> EventOut {
  var out: EventOut; out.fired = false;
  // body 0 candidate
  let l0 = s.r[0] - (s.m.y * s.r[1] + s.m.z * s.r[2]) / (s.m.y + s.m.z);
  let v0 = s.p[0] / s.m.x
         - (s.p[1] + s.p[2]) / (s.m.y + s.m.z);
  let mu0 = s.m.x * (s.m.y + s.m.z);
  let pOut0 = mu0 * v0;
  let E0 = dot(pOut0, pOut0)/(2.0*mu0)
         - (s.m.x*(s.m.y+s.m.z)) / length(l0);
  let on0 = length(l0) > R_esc && dot(l0, v0) > 0.0 && E0 > 0.0;
  (*st).c0 = select(max((*st).c0, 1u) - 1u, min((*st).c0 + 1u, k_esc), on0);
  if ((*st).c0 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 0u; return out; }

  // body 1
  let l1 = s.r[1] - (s.m.x * s.r[0] + s.m.z * s.r[2]) / (s.m.x + s.m.z);
  let v1 = s.p[1] / s.m.y
         - (s.p[0] + s.p[2]) / (s.m.x + s.m.z);
  let mu1 = s.m.y * (s.m.x + s.m.z);
  let pOut1 = mu1 * v1;
  let E1 = dot(pOut1, pOut1)/(2.0*mu1)
         - (s.m.y*(s.m.x+s.m.z)) / length(l1);
  let on1 = length(l1) > R_esc && dot(l1, v1) > 0.0 && E1 > 0.0;
  (*st).c1 = select(max((*st).c1, 1u) - 1u, min((*st).c1 + 1u, k_esc), on1);
  if ((*st).c1 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 1u; return out; }

  // body 2
  let l2 = s.r[2] - (s.m.x * s.r[0] + s.m.y * s.r[1]) / (s.m.x + s.m.y);
  let v2 = s.p[2] / s.m.z
         - (s.p[0] + s.p[1]) / (s.m.x + s.m.y);
  let mu2 = s.m.z * (s.m.x + s.m.y);
  let pOut2 = mu2 * v2;
  let E2 = dot(pOut2, pOut2)/(2.0*mu2)
         - (s.m.z*(s.m.x+s.m.y)) / length(l2);
  let on2 = length(l2) > R_esc && dot(l2, v2) > 0.0 && E2 > 0.0;
  (*st).c2 = select(max((*st).c2, 1u) - 1u, min((*st).c2 + 1u, k_esc), on2);
  if ((*st).c2 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 2u; return out; }

  return out;
}
