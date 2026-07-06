// Shared helpers used by colour, brightness, combiner, and CVD stages (M7).
//
// The render module is composed by concatenating, in order:
//   render_helpers.wgsl -> colour_modes.wgsl -> brightness_modes.wgsl
//   -> combiner.wgsl -> cvd.wgsl -> render_graph.wgsl
// It is NOT concatenated with helpers.wgsl (which owns its own PI), so PI
// is declared here for the render module.
const PI: f32 = 3.141592653589793;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let lo = 12.92 * c;
  let hi = 1.055 * pow(c, vec3<f32>(1.0/2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

// OKLAB matrices, written in the same row-major reading order as
// src/render/oklab.ts. The WGSL mat3x3 constructor is COLUMN-major, so
// these constants are mathematically the transpose of the TS matrices —
// they must be applied as `v * M` (row-vector product), never `M * v`.
const M1_TO_LMS = mat3x3<f32>(
   0.4122214708,  0.5363325363,  0.0514459826,
   0.2119034958,  0.6806995450,  0.1073959539,
   0.0883024619,  0.2817188376,  0.6299787005,
);
const M2_TO_LAB = mat3x3<f32>(
   0.2104542553,  0.7936177850, -0.0040720468,
   1.9779984951, -2.4285922050,  0.4505937099,
   0.0259040247,  0.7827717662, -0.8086757660,
);
const M2_INV = mat3x3<f32>(
   1.0,  0.3963377774,  0.2158037573,
   1.0, -0.1055613458, -0.0638541728,
   1.0, -0.0894841775, -1.2914855480,
);
const M1_INV = mat3x3<f32>(
   4.0767416613, -3.3077115904,  0.2309699287,
  -1.2684379960,  2.6097574002, -0.3413113422,
  -0.0041960865, -0.7034188370,  1.7076147024,
);

fn linear_rgb_to_oklab(c: vec3<f32>) -> vec3<f32> {
  let lms = c * M1_TO_LMS;
  // LMS is non-negative for in-gamut linear sRGB, but combiner lightness
  // replacement can push intermediates slightly out of gamut: use a
  // sign-safe cube root so negatives don't turn into NaN.
  let cb  = sign(lms) * pow(abs(lms), vec3<f32>(1.0/3.0));
  return cb * M2_TO_LAB;
}

fn oklab_to_linear_rgb(lab: vec3<f32>) -> vec3<f32> {
  let cb = lab * M2_INV;
  let lms = cb * cb * cb;
  return lms * M1_INV;
}
