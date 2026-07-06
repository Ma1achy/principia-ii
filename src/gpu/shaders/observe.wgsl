// @import { State } from "./integrate.wgsl"
// @import { cross_z } from "./helpers.wgsl"

// @export
fn total_energy(s: State) -> f32 {
  let K = dot(s.p[0], s.p[0]) / (2.0 * s.m.x)
        + dot(s.p[1], s.p[1]) / (2.0 * s.m.y)
        + dot(s.p[2], s.p[2]) / (2.0 * s.m.z);
  let U = -(s.m.x * s.m.y) / length(s.r[1] - s.r[0])
        - (s.m.x * s.m.z) / length(s.r[2] - s.r[0])
        - (s.m.y * s.m.z) / length(s.r[2] - s.r[1]);
  return K + U;
}

// @export
fn ang_mom(s: State) -> f32 {
  return s.r[0].x * s.p[0].y - s.r[0].y * s.p[0].x
       + s.r[1].x * s.p[1].y - s.r[1].y * s.p[1].x
       + s.r[2].x * s.p[2].y - s.r[2].y * s.p[2].x;
}

// @export
// Corrected shape-sphere coordinate (spec §4.3.1, post-revisions).
// simulate.wgsl imports THIS copy; metrics.wgsl carries a deliberate
// standalone duplicate for the M6 WGSL check.
fn shape_sphere(rho_t: vec2<f32>, lambda_t: vec2<f32>) -> vec3<f32> {
  let rho_sq    = dot(rho_t,    rho_t);
  let lambda_sq = dot(lambda_t, lambda_t);
  let I = rho_sq + lambda_sq;
  return vec3<f32>(
    (lambda_sq - rho_sq) / I,
    -2.0 * dot(rho_t, lambda_t) / I,
     2.0 * cross_z(rho_t, lambda_t) / I,
  );
}
