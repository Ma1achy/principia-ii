// One function per colour mode (M7). Returns linear sRGB.

// @import { PI, linear_rgb_to_oklab, oklab_to_linear_rgb } from "./render_helpers.wgsl"

// @export
fn colour_event_class(class_: u32, detail: u32) -> vec3<f32> {
  switch (class_) {
    case 0u: { return vec3<f32>(0.7, 0.7, 0.2); }    // bounded
    case 1u: { return vec3<f32>(0.9, 0.1, 0.1); }    // collision
    case 2u: {
      // Different escape body → different hue.
      switch (detail) {
        case 0u: { return vec3<f32>(0.10, 0.40, 0.90); }    // blue
        case 1u: { return vec3<f32>(0.10, 0.80, 0.20); }    // green
        default: { return vec3<f32>(0.90, 0.55, 0.10); }    // amber
      }
    }
    case 3u: { return vec3<f32>(0.5, 0.5, 0.5); }    // degenerate
    default: { return vec3<f32>(1.0, 0.9, 0.0); }    // timeout / max-substeps
  }
}

// @export
fn palette_seq(t: f32) -> vec3<f32> {
  // Inline 5-stop viridis sample. Production reads from a 1D texture.
  let stops = array<vec3<f32>, 5>(
    vec3<f32>(0.267, 0.005, 0.329),
    vec3<f32>(0.282, 0.140, 0.458),
    vec3<f32>(0.221, 0.402, 0.561),
    vec3<f32>(0.221, 0.700, 0.408),
    vec3<f32>(0.991, 0.906, 0.144),
  );
  let u = clamp(t, 0.0, 1.0);
  let f = u * 4.0;
  let i = u32(floor(f));
  let j = min(4u, i + 1u);
  let w = f - f32(i);
  return mix(stops[i], stops[j], w);
}

// @export
fn palette_div_symlog(x: f32, eps: f32) -> vec3<f32> {
  let absx = abs(x);
  // Linear inside |x| <= eps, logarithmic outside. NB WGSL select(f, t, cond)
  // returns t when cond is TRUE: the log branch is the true arm here.
  // ("signed" is a WGSL reserved word — hence "sym".)
  let sym = sign(x) *
            select(absx / eps, 1.0 + log(absx / eps), absx > eps);
  let t = clamp(0.5 + 0.5 * sym / 8.0, 0.0, 1.0);
  return palette_seq(t);
}

// VMF blend over the six shape-sphere landmark poles. `scheme` selects the
// hue table: 0 = full-OKLAB hues (shape_sphere_vmf), 1 = Okabe-Ito CB-safe
// hues (shape_sphere_okabe_ito, stability_x_hue). Mirrors src/render/vmf.ts
// (HUE_OKLAB / HUE_OKABE_ITO) — the two modes are NOT the same colouring.
// @export
const VMF_SCHEME_OKLAB:     u32 = 0u;
// @export
const VMF_SCHEME_OKABE_ITO: u32 = 1u;

// @export
fn vmf_blend6(n: vec3<f32>, kappa: f32, chroma: f32, L: f32, scheme: u32) -> vec3<f32> {
  let pole = array<vec3<f32>, 6>(
    vec3<f32>( 1.0, 0.0, 0.0), vec3<f32>(-1.0, 0.0, 0.0),
    vec3<f32>( 0.0, 1.0, 0.0), vec3<f32>( 0.0,-1.0, 0.0),
    vec3<f32>( 0.0, 0.0, 1.0), vec3<f32>( 0.0, 0.0,-1.0),
  );
  let hue_oklab = array<f32, 6>(
      0.0 * PI/180.0, 180.0 * PI/180.0,
    120.0 * PI/180.0, 300.0 * PI/180.0,
    240.0 * PI/180.0,  60.0 * PI/180.0,
  );
  let hue_okabe_ito = array<f32, 6>(
    250.0 * PI/180.0,  70.0 * PI/180.0,
     30.0 * PI/180.0, 210.0 * PI/180.0,
    170.0 * PI/180.0, 350.0 * PI/180.0,
  );
  var maxv: f32 = -1e30;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let kd = kappa * dot(n, pole[i]);
    if (kd > maxv) { maxv = kd; }
  }
  var aSum: f32 = 0.0; var bSum: f32 = 0.0; var Z: f32 = 0.0;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let kd = kappa * dot(n, pole[i]);
    let w  = exp(kd - maxv);
    let hue = select(hue_oklab[i], hue_okabe_ito[i], scheme == VMF_SCHEME_OKABE_ITO);
    Z = Z + w;
    aSum = aSum + w * cos(hue);
    bSum = bSum + w * sin(hue);
  }
  let a = chroma * aSum / Z;
  let b = chroma * bSum / Z;
  return oklab_to_linear_rgb(vec3<f32>(L, a, b));
}

// @export
// Stability × hue (the principal Principia mode).
fn stability_x_hue(
  n: vec3<f32>, diffusion: f32, kappa: f32, chroma: f32,
) -> vec3<f32> {
  // Hue from n (CB-safe Okabe-Ito base).
  let base = vmf_blend6(n, kappa, chroma, 0.7, VMF_SCHEME_OKABE_ITO);
  // Modulate L by proximity to binary collisions.
  let b1 = vec3<f32>(1.0, 0.0, 0.0);
  let b2 = vec3<f32>(-0.5,  0.866025, 0.0);
  let b3 = vec3<f32>(-0.5, -0.866025, 0.0);
  let prox = max(max(dot(n, b1), dot(n, b2)), dot(n, b3));
  let L = 0.25 + 0.55 * 0.5 * (1.0 - prox);
  // Replace L in OKLAB.
  let lab = linear_rgb_to_oklab(base);
  return oklab_to_linear_rgb(vec3<f32>(L, lab.y, lab.z));
}
