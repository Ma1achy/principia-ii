precision highp float;
varying vec2 vUV;
uniform float uHorizon;
uniform float uDtMacro;
uniform float uRColl;
uniform float uREsc;
uniform int uMaxSteps;
uniform int uRenderMode;
uniform vec4 uTile;
uniform vec3 uZ0_012;
uniform vec3 uZ0_345;
uniform vec4 uZ0_6789;
uniform vec3 uQ1_012;
uniform vec3 uQ1_345;
uniform vec4 uQ1_6789;
uniform vec3 uQ2_012;
uniform vec3 uQ2_345;
uniform vec4 uQ2_6789;
const float PI = 3.14159265359;
const float G = 1.0;
const float ALPHA_MIN = 0.05;
const float MU_MAX = 5.0;
const float Q_MAX = 2.0;
const float K_ESC = 4.0;
const float D0 = 0.01;
const float D_MAX = 0.1;
float sigmoid(float x) { return 1.0 / (1.0 + exp(-x)); }
vec3 softmax(vec3 logits) {
  float maxv = max(max(logits.x, logits.y), logits.z);
  vec3 e = exp(logits - maxv);
  return e / (e.x + e.y + e.z);
}
void decodeIC(out vec2 r0, out vec2 r1, out vec2 r2, out vec2 p0, out vec2 p1, out vec2 p2,
              out vec3 m, out float valid,
              float z0, float z1, float z2, float z3, float z4, float z5, float z6, float z7, float z8, float z9) {
  float mu1 = MU_MAX * (2.0 * sigmoid(z8) - 1.0);
  float mu2 = MU_MAX * (2.0 * sigmoid(z9) - 1.0);
  m = softmax(vec3(0.0, mu1, mu2));
  float M01 = m.x + m.y;
  if (M01 < 1e-6) { valid = 0.0; return; }
  float alpha = ALPHA_MIN + (PI/2.0 - 2.0*ALPHA_MIN) * sigmoid(z1);
  float beta  = PI * sigmoid(z0);
  float muRho    = m.x * m.y / M01;
  float muLambda = m.z * M01;
  vec2 rhoTilde    = vec2(cos(alpha), 0.0);
  vec2 lambdaTilde = vec2(sin(alpha) * cos(beta), sin(alpha) * sin(beta));
  vec2 rho    = rhoTilde / sqrt(muRho);
  vec2 lambda = lambdaTilde / sqrt(muLambda);
  vec2 r01 = -m.z * lambda;
  r2 = M01 * lambda;
  r0 = r01 - (m.y / M01) * rho;
  r1 = r01 + (m.x / M01) * rho;
  vec2 pRho    = Q_MAX * (2.0 * vec2(sigmoid(z4), sigmoid(z5)) - 1.0);
  vec2 pLambda = Q_MAX * (2.0 * vec2(sigmoid(z6), sigmoid(z7)) - 1.0);
  p0 = -pRho - (m.x / M01) * pLambda;
  p1 =  pRho - (m.y / M01) * pLambda;
  p2 =  pLambda;
  valid = 1.0;
}
float checkCollisionT0(vec2 r0, vec2 r1, vec2 r2) {
  float d01 = length(r0 - r1);
  float d02 = length(r0 - r2);
  float d12 = length(r1 - r2);
  float minD = min(min(d01, d02), d12);
  return (minD < uRColl) ? 1.0 : 0.0;
}
float check_escape(float k, vec2 r0, vec2 r1, vec2 r2, vec2 p0, vec2 p1, vec2 p2, vec3 m, float r_esc) {
  float M12, mu_out, E_out, outward, dist;
  vec2 lambda, v_lambda;
  if (k < 0.5) {
    M12 = m.y + m.z; if (M12 < 1e-6) return 0.0;
    vec2 r12 = (m.y * r1 + m.z * r2) / M12;
    lambda = r0 - r12;
    vec2 v0 = p0 / m.x;
    vec2 v12 = (m.y * (p1 / m.y) + m.z * (p2 / m.z)) / M12;
    v_lambda = v0 - v12;
    mu_out = m.x * M12;
    E_out = dot(v_lambda, v_lambda) * mu_out / 2.0 - G * m.x * M12 / (length(lambda) + 1e-10);
    outward = dot(lambda, v_lambda);
    dist = length(lambda);
  } else if (k < 1.5) {
    M12 = m.x + m.z; if (M12 < 1e-6) return 0.0;
    vec2 r12 = (m.x * r0 + m.z * r2) / M12;
    lambda = r1 - r12;
    vec2 v1 = p1 / m.y;
    vec2 v12 = (m.x * (p0 / m.x) + m.z * (p2 / m.z)) / M12;
    v_lambda = v1 - v12;
    mu_out = m.y * M12;
    E_out = dot(v_lambda, v_lambda) * mu_out / 2.0 - G * m.y * M12 / (length(lambda) + 1e-10);
    outward = dot(lambda, v_lambda);
    dist = length(lambda);
  } else {
    M12 = m.x + m.y; if (M12 < 1e-6) return 0.0;
    vec2 r12 = (m.x * r0 + m.y * r1) / M12;
    lambda = r2 - r12;
    vec2 v2 = p2 / m.z;
    vec2 v12 = (m.x * (p0 / m.x) + m.y * (p1 / m.y)) / M12;
    v_lambda = v2 - v12;
    mu_out = m.z * M12;
    E_out = dot(v_lambda, v_lambda) * mu_out / 2.0 - G * m.z * M12 / (length(lambda) + 1e-10);
    outward = dot(lambda, v_lambda);
    dist = length(lambda);
  }
  return (dist > r_esc && outward > 0.0 && E_out > 0.0) ? 1.0 : 0.0;
}
vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  if (h < 60.0) rgb = vec3(c, x, 0.0);
  else if (h < 120.0) rgb = vec3(x, c, 0.0);
  else if (h < 180.0) rgb = vec3(0.0, c, x);
  else if (h < 240.0) rgb = vec3(0.0, x, c);
  else if (h < 300.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + m;
}
vec3 shape_n(vec2 rho, vec2 lambda, vec3 m) {
  float M01 = m.x + m.y;
  float muRho = m.x * m.y / M01;
  float muLambda = m.z * M01;
  vec2 rho_t = rho * sqrt(muRho);
  vec2 lambda_t = lambda * sqrt(muLambda);
  float norm = dot(rho_t, rho_t) + dot(lambda_t, lambda_t);
  if (norm < 1e-10) return vec3(0.0, 0.0, 1.0);
  float nx = 2.0 * dot(rho_t, lambda_t) / norm;
  float ny = 2.0 * (rho_t.x * lambda_t.y - rho_t.y * lambda_t.x) / norm;
  float nz = (dot(rho_t, rho_t) - dot(lambda_t, lambda_t)) / norm;
  return vec3(nx, ny, nz);
}
float shape_theta(vec2 rho, vec2 lambda, vec3 m) {
  vec3 n = shape_n(rho, lambda, m);
  return atan(n.y, n.x);
}
float angDiff(float a, float b) {
  float d = a - b;
  return atan(sin(d), cos(d));
}
void main() {
  vec2 uv = uTile.xy + vUV * uTile.zw;
  float u = uv.x;
  float v = uv.y;
  float z0 = uZ0_012.x + (2.0*u - 1.0)*uQ1_012.x + (2.0*v - 1.0)*uQ2_012.x;
  float z1 = uZ0_012.y + (2.0*u - 1.0)*uQ1_012.y + (2.0*v - 1.0)*uQ2_012.y;
  float z2 = uZ0_012.z + (2.0*u - 1.0)*uQ1_012.z + (2.0*v - 1.0)*uQ2_012.z;
  float z3 = uZ0_345.x + (2.0*u - 1.0)*uQ1_345.x + (2.0*v - 1.0)*uQ2_345.x;
  float z4 = uZ0_345.y + (2.0*u - 1.0)*uQ1_345.y + (2.0*v - 1.0)*uQ2_345.y;
  float z5 = uZ0_345.z + (2.0*u - 1.0)*uQ1_345.z + (2.0*v - 1.0)*uQ2_345.z;
  float z6 = uZ0_6789.x + (2.0*u - 1.0)*uQ1_6789.x + (2.0*v - 1.0)*uQ2_6789.x;
  float z7 = uZ0_6789.y + (2.0*u - 1.0)*uQ1_6789.y + (2.0*v - 1.0)*uQ2_6789.y;
  float z8 = uZ0_6789.z + (2.0*u - 1.0)*uQ1_6789.z + (2.0*v - 1.0)*uQ2_6789.z;
  float z9 = uZ0_6789.w + (2.0*u - 1.0)*uQ1_6789.w + (2.0*v - 1.0)*uQ2_6789.w;
  vec2 r0, r1, r2, p0, p1, p2;
  vec3 m;
  float valid = 0.0;
  decodeIC(r0, r1, r2, p0, p1, p2, m, valid, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9);
  if (valid < 0.5) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
  if (checkCollisionT0(r0, r1, r2) > 0.5) { gl_FragColor = vec4(1.0, 0.6, 0.0, 1.0); return; }
  vec2 cr0 = r0, cr1 = r1, cr2 = r2;
  vec2 cp0 = p0, cp1 = p1, cp2 = p2;
  float ct = 0.0;
  float c_esc0 = 0.0, c_esc1 = 0.0, c_esc2 = 0.0;
  float collision = 0.0;
  float collPair = 0.0;
  float theta_w1a = 0.0, theta_w1b = 0.0, theta_w2a = 0.0, theta_w2b = 0.0;
  float t_w1a = 0.0,     t_w1b = 0.0,     t_w2a = 0.0,     t_w2b = 0.0;
  float sampled_w1a = 0.0, sampled_w1b = 0.0, sampled_w2a = 0.0, sampled_w2b = 0.0;
  bool wantDiff = (uRenderMode == 1 || uRenderMode == 3);
  for (int step = 0; step < 20000; step++) {
    if (step >= uMaxSteps || ct >= uHorizon) break;
    float minD = min(min(length(cr0-cr1), length(cr0-cr2)), length(cr1-cr2));
    float nSubF = clamp(pow(0.05 / (minD + 1e-10), 1.5), 1.0, 32.0);
    int nSub = int(nSubF);
    if (nSub < 1) nSub = 1;
    if (nSub > 32) nSub = 32;
    float dt = uDtMacro / nSubF;
    for (int s = 0; s < 32; s++) {
      if (s >= nSub) break;
      vec2 f0 = vec2(0.0), f1 = vec2(0.0), f2 = vec2(0.0);
      vec2 dr = cr1 - cr0; float d = length(dr);
      if (d > 1e-10) { float fmag = G * m.x * m.y / (d*d*d); f0 += fmag * dr; f1 -= fmag * dr; }
      dr = cr2 - cr0; d = length(dr);
      if (d > 1e-10) { float fmag = G * m.x * m.z / (d*d*d); f0 += fmag * dr; f2 -= fmag * dr; }
      dr = cr2 - cr1; d = length(dr);
      if (d > 1e-10) { float fmag = G * m.y * m.z / (d*d*d); f1 += fmag * dr; f2 -= fmag * dr; }
      cp0 += f0 * dt * 0.5; cp1 += f1 * dt * 0.5; cp2 += f2 * dt * 0.5;
      cr0 += cp0 / m.x * dt; cr1 += cp1 / m.y * dt; cr2 += cp2 / m.z * dt;
      f0 = vec2(0.0); f1 = vec2(0.0); f2 = vec2(0.0);
      dr = cr1 - cr0; d = length(dr);
      if (d > 1e-10) { float fmag = G * m.x * m.y / (d*d*d); f0 += fmag * dr; f1 -= fmag * dr; }
      dr = cr2 - cr0; d = length(dr);
      if (d > 1e-10) { float fmag = G * m.x * m.z / (d*d*d); f0 += fmag * dr; f2 -= fmag * dr; }
      dr = cr2 - cr1; d = length(dr);
      if (d > 1e-10) { float fmag = G * m.y * m.z / (d*d*d); f1 += fmag * dr; f2 -= fmag * dr; }
      cp0 += f0 * dt * 0.5; cp1 += f1 * dt * 0.5; cp2 += f2 * dt * 0.5;
    }
    ct += float(nSub) * dt;
    minD = min(min(length(cr0-cr1), length(cr0-cr2)), length(cr1-cr2));
    if (minD < uRColl) {
      collision = 1.0;
      float d01 = length(cr0 - cr1);
      float d02 = length(cr0 - cr2);
      float d12 = length(cr1 - cr2);
      if (d01 <= d02 && d01 <= d12) collPair = 1.0;
      else if (d02 <= d12) collPair = 2.0;
      else collPair = 3.0;
      break;
    }
    if (uRenderMode == 0) {
      float e0 = check_escape(0.0, cr0, cr1, cr2, cp0, cp1, cp2, m, uREsc);
      float e1 = check_escape(1.0, cr0, cr1, cr2, cp0, cp1, cp2, m, uREsc);
      float e2 = check_escape(2.0, cr0, cr1, cr2, cp0, cp1, cp2, m, uREsc);
      c_esc0 = (e0 > 0.5) ? (c_esc0 + 1.0) : 0.0;
      c_esc1 = (e1 > 0.5) ? (c_esc1 + 1.0) : 0.0;
      c_esc2 = (e2 > 0.5) ? (c_esc2 + 1.0) : 0.0;
      if (c_esc0 >= K_ESC) { gl_FragColor = vec4(0.8, 0.8, 0.0, 1.0); return; }
      if (c_esc1 >= K_ESC) { gl_FragColor = vec4(0.8, 0.0, 0.8, 1.0); return; }
      if (c_esc2 >= K_ESC) { gl_FragColor = vec4(0.0, 0.8, 0.8, 1.0); return; }
    }
    if (wantDiff) {
      float frac = ct / uHorizon;
      vec2 rho = cr1 - cr0;
      vec2 com01 = (m.x * cr0 + m.y * cr1) / (m.x + m.y);
      vec2 lambda = cr2 - com01;
      if (frac > 0.25 && sampled_w1a < 0.5) { theta_w1a = shape_theta(rho, lambda, m); t_w1a = ct; sampled_w1a = 1.0; }
      if (frac > 0.375 && sampled_w1b < 0.5) { theta_w1b = shape_theta(rho, lambda, m); t_w1b = ct; sampled_w1b = 1.0; }
      if (frac > 0.5 && sampled_w2a < 0.5) { theta_w2a = shape_theta(rho, lambda, m); t_w2a = ct; sampled_w2a = 1.0; }
      if (frac > 0.625 && sampled_w2b < 0.5) { theta_w2b = shape_theta(rho, lambda, m); t_w2b = ct; sampled_w2b = 1.0; }
    }
  }
  if (uRenderMode == 0) {
    if (collision > 0.5) {
      float b = pow(max(0.0, 1.0 - ct / uHorizon), 0.4);
      if (collPair < 1.5) gl_FragColor = vec4(b, 0.0, 0.0, 1.0);
      else if (collPair < 2.5) gl_FragColor = vec4(0.0, b, 0.0, 1.0);
      else gl_FragColor = vec4(0.0, 0.0, b, 1.0);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
    return;
  }
  vec2 rhoF = cr1 - cr0;
  vec2 com01F = (m.x * cr0 + m.y * cr1) / (m.x + m.y);
  vec2 lambdaF = cr2 - com01F;
  vec3 nF = shape_n(rhoF, lambdaF, m);
  float theta = atan(nF.y, nF.x);
  float diff = 0.0;
  if (sampled_w1b > 0.5 && sampled_w2b > 0.5 && sampled_w1a > 0.5 && sampled_w2a > 0.5) {
    float dt1 = max(1e-6, t_w1b - t_w1a);
    float dt2 = max(1e-6, t_w2b - t_w2a);
    float omega1 = angDiff(theta_w1b, theta_w1a) / dt1;
    float omega2 = angDiff(theta_w2b, theta_w2a) / dt2;
    float D = abs(omega2 - omega1);
    diff = clamp(log(1.0 + D / D0) / log(1.0 + D_MAX / D0), 0.0, 1.0);
  }
  float stability = diff;
  if (uRenderMode == 4) {
    vec3 rgb = 0.5 + 0.5 * clamp(nF, vec3(-1.0), vec3(1.0));
    gl_FragColor = vec4(rgb, 1.0);
    return;
  }
  if (uRenderMode == 3) {
    float b = mix(0.95, 0.05, stability);
    gl_FragColor = vec4(vec3(b), 1.0);
    return;
  }
  float hue = mod((theta + PI) / (2.0 * PI) * 360.0, 360.0);
  float sat = 1.0;
  float light = (uRenderMode == 1) ? mix(0.65, 0.22, stability) : 0.5;
  gl_FragColor = vec4(hsl2rgb(hue, sat, light), 1.0);
}
