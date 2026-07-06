// Shape-sphere coordinate, phase unwrap, and free-group bookkeeping in
// the GPU integrator. Compose with helpers.wgsl (for PI) and simulate.wgsl
// from M3 — this module is function definitions only, no entry point.
//
// The TS copies live in src/metrics/{shape_sphere,phase,free_group}.ts —
// change both sides in the same commit.

fn shape_sphere(rho_t: vec2<f32>, lambda_t: vec2<f32>) -> vec3<f32> {
  let rho_sq    = dot(rho_t,    rho_t);
  let lambda_sq = dot(lambda_t, lambda_t);
  let I = rho_sq + lambda_sq;
  if (I == 0.0) { return vec3<f32>(0.0, 0.0, 1.0); }
  return vec3<f32>(
    (lambda_sq - rho_sq) / I,
    -2.0 * dot(rho_t, lambda_t) / I,
     2.0 * (rho_t.x * lambda_t.y - rho_t.y * lambda_t.x) / I,
  );
}

fn phase_from_n(n: vec3<f32>) -> f32 {
  return atan2(n.y, n.x);
}

fn unwrap_phase(prev: f32, cur: f32, theta_tilde: f32) -> f32 {
  var d = cur - prev;
  if (d >  PI) { d = d - 2.0*PI; }
  if (d < -PI) { d = d + 2.0*PI; }
  return theta_tilde + d;
}

// Free-group word append with on-the-fly cancellation.
struct FreeWord {
  bits:   vec4<u32>,
  length: u32,
  truncated: u32,
};

fn append_symbol(word: FreeWord, sym: u32) -> FreeWord {
  var w = word;
  if (w.length >= 58u) { w.truncated = 1u; return w; }
  // Free reduction: aA, Aa, bB, Bb cancel.
  if (w.length > 0u) {
    let prev_slot = w.length - 1u;
    let lane = prev_slot >> 4u;
    let off  = (prev_slot & 0xfu) * 2u;
    var prev_bits: u32;
    switch (lane) {
      case 0u: { prev_bits = (w.bits.x >> off) & 0x3u; }
      case 1u: { prev_bits = (w.bits.y >> off) & 0x3u; }
      case 2u: { prev_bits = (w.bits.z >> off) & 0x3u; }
      default: { prev_bits = (w.bits.w >> off) & 0x3u; }
    }
    let cancels =
      (prev_bits == 0u && sym == 1u) ||
      (prev_bits == 1u && sym == 0u) ||
      (prev_bits == 2u && sym == 3u) ||
      (prev_bits == 3u && sym == 2u);
    if (cancels) {
      let mask = ~(0x3u << off);
      switch (lane) {
        case 0u: { w.bits.x = w.bits.x & mask; }
        case 1u: { w.bits.y = w.bits.y & mask; }
        case 2u: { w.bits.z = w.bits.z & mask; }
        default: { w.bits.w = w.bits.w & mask; }
      }
      w.length = w.length - 1u;
      return w;
    }
  }
  let lane = w.length >> 4u;
  let off  = (w.length & 0xfu) * 2u;
  switch (lane) {
    case 0u: { w.bits.x = w.bits.x | ((sym & 0x3u) << off); }
    case 1u: { w.bits.y = w.bits.y | ((sym & 0x3u) << off); }
    case 2u: { w.bits.z = w.bits.z | ((sym & 0x3u) << off); }
    default: { w.bits.w = w.bits.w | ((sym & 0x3u) << off); }
  }
  w.length = w.length + 1u;
  return w;
}

fn signed_plane(n: vec3<f32>, b: vec3<f32>, e: vec3<f32>) -> f32 {
  let cr = vec3<f32>(b.y*e.z - b.z*e.y, b.z*e.x - b.x*e.z, b.x*e.y - b.y*e.x);
  return dot(n, cr);
}

fn pick_endpoint(b: vec3<f32>) -> vec3<f32> {
  let north = vec3<f32>(0.0, 0.0, 1.0);
  let south = vec3<f32>(0.0, 0.0, -1.0);
  let cr = cross(b, north);
  let sin_v = length(cr);
  if (sin_v < 0.1) { return south; }
  return north;
}

fn free_group_tick(
  w: FreeWord, prev_n: vec3<f32>, cur_n: vec3<f32>,
  b1: vec3<f32>, b2: vec3<f32>,
) -> FreeWord {
  var word = w;

  let e1 = pick_endpoint(b1);
  let dp1 = signed_plane(prev_n, b1, e1);
  let dc1 = signed_plane(cur_n,  b1, e1);
  if (dp1 != 0.0 && dc1 != 0.0 && sign(dp1) != sign(dc1)) {
    let sym1 = select(1u, 0u, dp1 > 0.0);
    word = append_symbol(word, sym1);
  }

  let e2 = pick_endpoint(b2);
  let dp2 = signed_plane(prev_n, b2, e2);
  let dc2 = signed_plane(cur_n,  b2, e2);
  if (dp2 != 0.0 && dc2 != 0.0 && sign(dp2) != sign(dc2)) {
    let sym2 = select(3u, 2u, dp2 > 0.0);
    word = append_symbol(word, sym2);
  }
  return word;
}
