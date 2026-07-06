struct ConfigDecoded {
  rho:    vec2<f32>,
  lambda: vec2<f32>,
  m:      vec3<f32>,
  alpha:  f32,
  beta:   f32,
};

fn decode_latent(z: array<f32, 8>, knobs: SimUniforms) -> ConfigDecoded {
  let m  = mass_softmax(z[6], z[7], knobs.mu_max);
  let M01 = m.x + m.y;

  let alpha = knobs.alpha_min
            + (PI/2.0 - 2.0*knobs.alpha_min) * sigmoid(z[0]);
  let beta  = PI * sigmoid(z[1]);

  let rho_t    = vec2<f32>(cos(alpha), 0.0);
  let lambda_t = vec2<f32>(sin(alpha) * cos(beta),
                           sin(alpha) * sin(beta));

  let muRho    = (m.x * m.y) / max(M01, EPS_BOLT);
  let muLambda = m.z * M01;
  let rho    = rho_t    / sqrt(max(muRho,    EPS_BOLT));
  let lambda = lambda_t / sqrt(max(muLambda, EPS_BOLT));

  var out: ConfigDecoded;
  out.rho = rho; out.lambda = lambda; out.m = m;
  out.alpha = alpha; out.beta = beta;
  return out;
}

struct ICOut {
  r: array<vec2<f32>, 3>,
  p: array<vec2<f32>, 3>,
  m: vec3<f32>,
  terminal: u32,                  // 0 = none, 1 = degenerate, 2 = collision_t0
};

fn jacobi_to_particle(
  rho: vec2<f32>, lambda: vec2<f32>, m: vec3<f32>,
) -> array<vec2<f32>, 3> {
  let M01 = m.x + m.y;
  let r01 = -m.z * lambda;
  let r2  =  M01 * lambda;
  let r0  = r01 - (m.y / M01) * rho;
  let r1  = r01 + (m.x / M01) * rho;
  return array<vec2<f32>, 3>(r0, r1, r2);
}

fn jacobi_momenta_to_particle(
  pRho: vec2<f32>, pLambda: vec2<f32>, m: vec3<f32>,
) -> array<vec2<f32>, 3> {
  let M01 = m.x + m.y;
  let p0  = -pRho - (m.x / M01) * pLambda;
  let p1  =  pRho - (m.y / M01) * pLambda;
  let p2  = pLambda;
  return array<vec2<f32>, 3>(p0, p1, p2);
}

fn decode_full(z: array<f32, 8>, knobs: SimUniforms) -> ICOut {
  var out: ICOut;
  let cfg = decode_latent(z, knobs);
  out.m = cfg.m;
  out.r = jacobi_to_particle(cfg.rho, cfg.lambda, cfg.m);

  // Free Jacobi momenta.
  let qx = knobs.q_max * (2.0 * sigmoid(z[2]) - 1.0);
  let qy = knobs.q_max * (2.0 * sigmoid(z[3]) - 1.0);
  let qX = knobs.q_max * (2.0 * sigmoid(z[4]) - 1.0);
  let qY = knobs.q_max * (2.0 * sigmoid(z[5]) - 1.0);
  out.p = jacobi_momenta_to_particle(
    vec2<f32>(qx, qy), vec2<f32>(qX, qY), cfg.m);

  // No-holes guard.
  let d01 = length(out.r[1] - out.r[0]);
  let d02 = length(out.r[2] - out.r[0]);
  let d12 = length(out.r[2] - out.r[1]);
  let dmin = min(d01, min(d02, d12));
  if (dmin < knobs.r_coll) { out.terminal = 2u; }
  else                     { out.terminal = 0u; }
  return out;
}
