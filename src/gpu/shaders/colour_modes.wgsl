// One function per colour mode (M7). Returns linear sRGB.

// @import { PI, linear_rgb_to_oklab, oklab_to_linear_rgb } from "./render_helpers.wgsl"

// (colour_event_class moved into render_graph.wgsl as the palette-driven
// `event_colour`, reading the group(3) EventPalette uniform — the fixed
// colours here collapsed collision pairs and diverged from the historical
// classifier on `main`.)

// Free-group word colouring (spec §free_group "render-by-word"): reduced
// words are categorical — hash the packed symbols into a hue (nearby pixels
// with the same word render identically; different words jump hue), and let
// the word LENGTH set lightness (long words = deep scattering = bright).
// @export
fn colour_free_group_word(word: vec4<u32>, chroma: f32) -> vec3<f32> {
  let len = (word.w >> 26u) & 0x3fu;
  if (len == 0u) { return vec3<f32>(0.02, 0.02, 0.025); }   // empty word
  var h: u32 = word.x;
  h = h ^ (word.y * 2654435761u);
  h = h ^ (word.z * 2246822519u);
  h = h ^ ((word.w & 0x03ffffffu) * 3266489917u);
  h = h ^ (h >> 15u);
  let hue = 2.0 * PI * (f32(h & 0xfffu) / 4096.0);
  let L = 0.35 + 0.45 * min(f32(len) / 32.0, 1.0);
  return oklab_to_linear_rgb(vec3<f32>(L, chroma * cos(hue), chroma * sin(hue)));
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
