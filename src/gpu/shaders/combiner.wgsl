// @import { linear_rgb_to_oklab, oklab_to_linear_rgb } from "./render_helpers.wgsl"

// Combiner node (M7): colour RGB × brightness L → RGB, in OKLAB where the
// mode is lightness-correct.

// @export
fn combine_replace_lightness(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  let lab = linear_rgb_to_oklab(rgb);
  return oklab_to_linear_rgb(vec3<f32>(clamp(L, 0.0, 1.0), lab.y, lab.z));
}

// @export
fn combine_modulate_lightness(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  let lab = linear_rgb_to_oklab(rgb);
  return oklab_to_linear_rgb(vec3<f32>(lab.x * clamp(L, 0.0, 1.0),
                                       lab.y, lab.z));
}

// @export
fn combine_multiply_rgb(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  return rgb * clamp(L, 0.0, 1.0);
}
