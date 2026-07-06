// CVD simulation (M7 post stage). Operates on LINEAR sRGB — applying these
// matrices after gamma encode looks visibly wrong (too dark).
//
// Matrix literals are written in the same row-major reading order as
// src/render/cvd.ts; the WGSL mat3x3 constructor is column-major, so they
// are applied as `rgb * M` (row-vector product), matching render_helpers.

// @export
fn apply_cvd(rgb: vec3<f32>, mode: u32) -> vec3<f32> {
  switch (mode) {
    case 1u: {       // protan
      return rgb * mat3x3<f32>(
        0.567, 0.433, 0.0,
        0.558, 0.442, 0.0,
        0.0,   0.242, 0.758,
      );
    }
    case 2u: {       // deutan
      return rgb * mat3x3<f32>(
        0.625, 0.375, 0.0,
        0.700, 0.300, 0.0,
        0.0,   0.300, 0.700,
      );
    }
    case 3u: {       // tritan
      return rgb * mat3x3<f32>(
        0.950, 0.050, 0.0,
        0.0,   0.433, 0.567,
        0.0,   0.475, 0.525,
      );
    }
    case 4u: {       // achrom
      let g = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
      return vec3<f32>(g, g, g);
    }
    default: { return rgb; }
  }
}
