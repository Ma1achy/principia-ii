// Numeric constants and shared helpers.
const PI: f32 = 3.141592653589793;
const EPS_BOLT: f32 = 1e-30;

fn sigmoid(z: f32) -> f32 {
  if (z >= 0.0) {
    return 1.0 / (1.0 + exp(-z));
  } else {
    let e = exp(z);
    return e / (1.0 + e);
  }
}

fn clamp01(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn rotJ(v: vec2<f32>) -> vec2<f32> { return vec2<f32>(-v.y, v.x); }

fn cross_z(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Mass softmax: σ(0, μ_max·tanh(z1), μ_max·tanh(z2)).
fn mass_softmax(z1: f32, z2: f32, mu_max: f32) -> vec3<f32> {
  let mu1 = mu_max * tanh(z1);
  let mu2 = mu_max * tanh(z2);
  let m   = max(0.0, max(mu1, mu2));
  let e0 = exp(   - m);
  let e1 = exp(mu1 - m);
  let e2 = exp(mu2 - m);
  let Z  = e0 + e1 + e2;
  return vec3<f32>(e0 / Z, e1 / Z, e2 / Z);
}
