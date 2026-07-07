/**
 * ChartUniforms — per-chart decoder hyperparameters (G4). Bound at
 * group(0) binding(3), the slot G3 reserved (binding 2 is G17's
 * DebugUniform). 64 bytes (= CHART_UNIFORMS_SIZE in layouts.ts).
 *
 * Slot map (all f32 lanes; the WGSL struct uses THREE SCALARS for the
 * target masses, NOT a vec3 — a vec3<f32> would align to 16 and land at
 * offset 48, silently skipping the lane this packer writes at 40):
 *   f32[0]  mu_max          f32[1]  alpha_min      f32[2]  q_max
 *   f32[3]  R_tilde         f32[4]  Kmax           f32[5]  gamma_K
 *   f32[6]  alpha_freeze    f32[7]  beta_freeze    f32[8]  pole_buffer
 *   f32[9]  nu_burrau       f32[10] m1_target      f32[11] m2_target
 *   f32[12] m3_target       f32[13..15] reserved
 *
 * Charts that need extra knobs pack into the reserved tail (and bump the
 * chart's cache payload so stale tiles invalidate).
 */

export interface ChartUniforms {
  mu_max:       number;
  alpha_min:    number;
  q_max:        number;
  R_tilde:      number;
  Kmax:         number;
  gamma_K:      number;
  alpha_freeze: number;
  beta_freeze:  number;
  pole_buffer:  number;
  nu_burrau:    number;
  m_target:     readonly [number, number, number];
}

export const CHART_UNIFORMS_DEFAULTS: ChartUniforms = {
  mu_max:       5,
  alpha_min:    0.05,
  q_max:        2,
  R_tilde:      1,
  Kmax:         2,
  gamma_K:      2,
  alpha_freeze: Math.PI / 4,
  beta_freeze:  Math.PI / 2,
  pole_buffer:  0.05,
  nu_burrau:    0.5,
  m_target:     [1 / 3, 1 / 3, 1 / 3],
};

export function packChartUniforms(c: ChartUniforms): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  f32[0] = c.mu_max;
  f32[1] = c.alpha_min;
  f32[2] = c.q_max;
  f32[3] = c.R_tilde;
  f32[4] = c.Kmax;
  f32[5] = c.gamma_K;
  f32[6] = c.alpha_freeze;
  f32[7] = c.beta_freeze;
  f32[8] = c.pole_buffer;
  f32[9] = c.nu_burrau;
  f32[10] = c.m_target[0];
  f32[11] = c.m_target[1];
  f32[12] = c.m_target[2];
  // f32[13..15] reserved
  return buf;
}

export function unpackChartUniforms(buf: ArrayBuffer): ChartUniforms {
  const f = new Float32Array(buf);
  return {
    mu_max: f[0]!, alpha_min: f[1]!,
    q_max: f[2]!, R_tilde: f[3]!,
    Kmax: f[4]!, gamma_K: f[5]!,
    alpha_freeze: f[6]!, beta_freeze: f[7]!,
    pole_buffer: f[8]!, nu_burrau: f[9]!,
    m_target: [f[10]!, f[11]!, f[12]!],
  };
}
