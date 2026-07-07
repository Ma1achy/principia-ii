// Free-group word bookkeeping (spec §free_group): π₁(S² ∖ 3 punctures) ≅
// F₂ = ⟨a, b⟩, symbols appended when the shape-sphere path crosses a branch
// cut, with on-the-fly free reduction. 2 bits per symbol (a=00, A=01, b=10,
// B=11), 58 usable slots across the uint4 lanes, length in .w bits 26–31
// (symbol slots reach only bit 19 of .w, so the length field never collides).
//
// This is the CANONICAL linkable copy (imported by simulate.wgsl).
// metrics.wgsl carries a deliberate duplicate for the standalone M6 WGSL
// check; the TS reference is src/metrics/free_group.ts — change all three
// in the same commit.

// @export
struct FreeWord {
  bits:   vec4<u32>,
  length: u32,
  truncated: u32,
};

// @export
fn empty_word() -> FreeWord {
  return FreeWord(vec4<u32>(0u, 0u, 0u, 0u), 0u, 0u);
}

// @export
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

fn fg_signed_plane(n: vec3<f32>, b: vec3<f32>, e: vec3<f32>) -> f32 {
  let cr = vec3<f32>(b.y*e.z - b.z*e.y, b.z*e.x - b.x*e.z, b.x*e.y - b.y*e.x);
  return dot(n, cr);
}

fn fg_pick_endpoint(b: vec3<f32>) -> vec3<f32> {
  let north = vec3<f32>(0.0, 0.0, 1.0);
  let south = vec3<f32>(0.0, 0.0, -1.0);
  let cr = cross(b, north);
  let sin_v = length(cr);
  if (sin_v < 0.1) { return south; }
  return north;
}

// @export
fn free_group_tick(
  w: FreeWord, prev_n: vec3<f32>, cur_n: vec3<f32>,
  b1: vec3<f32>, b2: vec3<f32>,
) -> FreeWord {
  var word = w;

  let e1 = fg_pick_endpoint(b1);
  let dp1 = fg_signed_plane(prev_n, b1, e1);
  let dc1 = fg_signed_plane(cur_n,  b1, e1);
  if (dp1 != 0.0 && dc1 != 0.0 && sign(dp1) != sign(dc1)) {
    let sym1 = select(1u, 0u, dp1 > 0.0);
    word = append_symbol(word, sym1);
  }

  let e2 = fg_pick_endpoint(b2);
  let dp2 = fg_signed_plane(prev_n, b2, e2);
  let dc2 = fg_signed_plane(cur_n,  b2, e2);
  if (dp2 != 0.0 && dc2 != 0.0 && sign(dp2) != sign(dc2)) {
    let sym2 = select(3u, 2u, dp2 > 0.0);
    word = append_symbol(word, sym2);
  }
  return word;
}
