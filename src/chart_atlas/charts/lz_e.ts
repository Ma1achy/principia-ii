import type { Chart, ChartDecodeOut, ChartView, EncodeResult } from '../types.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { FLAGS_INVARIANT } from '../flags.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { constructMomentaForLzK } from '../momentum_construction.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor, makeTerminal } from '@/decode/pipeline.js';
import { angularMomentum } from '@/integrate/forces.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import { DegenerateReason } from '@/decode/types.js';
import type { Vec2, Vec3, Triple, TrajState } from '@/math/types.js';

/**
 * Shared (L_z, K*) decode for the invariant charts. With the
 * configuration frozen at (α, β), E = U(r) + K*, so the (L_z, E) chart's
 * energy axis measured relative to U is numerically identical to the
 * (L_z, K) chart's kinetic axis: one decode serves both, warped as
 * K* = Kmax · v^γ, L_z = (2u − 1) · √(2 I K*).
 */
export function decodeLzChart([u, v]: Vec2, view: ChartView): ChartDecodeOut {
  const Kmax   = (view.chartParams['Kmax']   as number | undefined) ?? 2;
  const gammaK = (view.chartParams['gammaK'] as number | undefined) ?? 2;
  const m: Vec3 = view.m ?? [1 / 3, 1 / 3, 1 / 3];

  // Configuration: frozen at caller-supplied (α, β) via chartParams
  // (M11's Burrau ternary plot supplies them per pixel); default to
  // α = π/4, β = π/2 as a reasonable centre.
  const alpha = (view.chartParams['alpha'] as number | undefined) ?? Math.PI / 4;
  const beta  = (view.chartParams['beta']  as number | undefined) ?? Math.PI / 2;
  const r = realiseFrozenConfig(alpha, beta, m);

  // Invariant-domain warp. I = 1 at the R̃ = 1 gauge (see
  // frozen_configuration.ts).
  const I = 1;
  const K = Kmax * Math.pow(v, gammaK);
  const Lmax = Math.sqrt(2 * I * K);
  const Lz = (2 * u - 1) * Lmax;

  const mc = constructMomentaForLzK(m, r, Lz, K, I);
  if (mc.kind !== 'ok') {
    // ADR 0007: distinguish the two invariant-momentum failures.
    const reason = mc.kind === 'infeasible'
      ? DegenerateReason.INFEASIBLE_ENERGY          // 15: K* < K_min
      : DegenerateReason.MOMENTUM_SEEDS_EXHAUSTED;  // 16: all seeds failed
    return makeTerminal({ kind: 'DEGENERATE', reason }, m);
  }
  const p: Triple<Vec2> = [
    [mc.v[0][0] * m[0], mc.v[0][1] * m[0]],
    [mc.v[1][0] * m[1], mc.v[1][1] * m[1]],
    [mc.v[2][0] * m[2], mc.v[2][1] * m[2]],
  ];

  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

/**
 * Shared closed-form inverse for the invariant charts (G5). Both charts
 * pixel-map through K — the (L_z, E) energy axis is E = U + K* at the
 * frozen geometry — so one inverse serves lz_e and lz_k, exactly like the
 * shared decode:
 *
 *   K  = Σ |p_i|² / 2m_i          L_z = Σ (r_i × p_i)_z
 *   v  = (K / Kmax)^(1/γ)         L_max = √(2 I K)
 *   u  = (L_z + L_max) / (2 L_max)
 *
 * I is the COM-frame moment of inertia of the ACTUAL IC (Σ m_i |r_i|²) —
 * decode outputs sit at the R̃ = 1 gauge where I = 1, but a foreign IC
 * arriving through an M8 chart switch need not.
 */
export function inverseLzChart(
  ic: TrajState, view?: ChartView,
): EncodeResult {
  const Kmax   = (view?.chartParams['Kmax']   as number | undefined) ?? 2;
  const gammaK = (view?.chartParams['gammaK'] as number | undefined) ?? 2;

  const Lz = angularMomentum(ic.r, ic.p);
  let K = 0, I = 0;
  for (let i = 0; i < 3; i++) {
    K += (ic.p[i]![0] ** 2 + ic.p[i]![1] ** 2) / (2 * ic.m[i]!);
    I += ic.m[i]! * (ic.r[i]![0] ** 2 + ic.r[i]![1] ** 2);
  }

  if (K <= 0) {
    // Rest start: L_z = 0 is mandated and the u axis is degenerate.
    return { kind: 'exact', pixel: { s: 0.5, t: 0 } };
  }

  if (K > Kmax) {
    const Lmax = Math.sqrt(2 * I * Kmax);
    const u = clamp01((Lz + Lmax) / (2 * Lmax));
    return {
      kind: 'projected', pixel: { s: u, t: 1 },
      reason: `K = ${K.toPrecision(6)} > Kmax = ${Kmax}`, clamped: true,
    };
  }

  const v = Math.pow(K / Kmax, 1 / gammaK);
  const Lmax = Math.sqrt(2 * I * K);

  if (Math.abs(Lz) > Lmax * (1 + 1e-9)) {
    // Outside the feasibility parabola at this K — project to the rim.
    return {
      kind: 'projected', pixel: { s: Lz > 0 ? 1 : 0, t: v },
      reason: `|Lz| = ${Math.abs(Lz).toPrecision(6)} > L_max = ${Lmax.toPrecision(6)}`,
      clamped: true,
    };
  }

  const u = clamp01((Lz + Lmax) / (2 * Lmax));
  return { kind: 'exact', pixel: { s: u, t: v } };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export const lzEChart: Chart = {
  id: 'lz_e',
  kind: 'invariant',
  flags: FLAGS_INVARIANT,

  decode(uv, view) {
    return decodeLzChart(uv, view);
  },

  inverseEncode(ic, view) {
    return inverseLzChart(ic, view);
  },

  chartUniforms(view) {
    return {
      ...CHART_UNIFORMS_DEFAULTS,
      Kmax:         (view.chartParams['Kmax']   as number | undefined) ?? 2,
      gamma_K:      (view.chartParams['gammaK'] as number | undefined) ?? 2,
      alpha_freeze: (view.chartParams['alpha']  as number | undefined) ?? Math.PI / 4,
      beta_freeze:  (view.chartParams['beta']   as number | undefined) ?? Math.PI / 2,
    };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
