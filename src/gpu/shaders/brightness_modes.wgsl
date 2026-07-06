// Brightness node functions (M7). Return L in [0, 1].

// @export
fn brightness_time_to_event(t_end: f32, T_horizon: f32) -> f32 {
  return clamp(1.0 - t_end / T_horizon, 0.0, 1.0);
}

// @export
fn brightness_diffusion(diffusion: f32) -> f32 {
  if (diffusion < 0.0) { return 0.5; }              // M6 sentinel: no data
  let D0 = 0.05;     let Dmax = 1.0;
  return clamp(log(1.0 + diffusion / D0) / log(1.0 + Dmax / D0), 0.0, 1.0);
}

// @export
fn brightness_bc_proximity(n: vec3<f32>) -> f32 {
  let b1 = vec3<f32>(1.0, 0.0, 0.0);
  let b2 = vec3<f32>(-0.5,  0.866025, 0.0);
  let b3 = vec3<f32>(-0.5, -0.866025, 0.0);
  let prox = max(max(dot(n, b1), dot(n, b2)), dot(n, b3));
  return clamp(0.5 * (1.0 - prox), 0.0, 1.0);
}

// @export
fn brightness_energy_drift(drift: f32) -> f32 {
  // Map [1e-7, 1e-2] log → [1, 0]: low drift = bright, high = dark.
  let lo = log(1e-7); let hi = log(1e-2);
  let t = (log(max(drift, 1e-30)) - lo) / (hi - lo);
  return 1.0 - clamp(t, 0.0, 1.0);
}
