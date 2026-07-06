import type { Chart, ChartDecodeOut, ChartView } from '../types.js';
import { FLAGS_INVARIANT } from '../flags.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { constructMomentaForLzK } from '../momentum_construction.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor, makeTerminal } from '@/decode/pipeline.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import { DegenerateReason } from '@/decode/types.js';
import type { Vec2, Vec3, Triple } from '@/math/types.js';

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

export const lzEChart: Chart = {
  id: 'lz_e',
  kind: 'invariant',
  flags: FLAGS_INVARIANT,

  decode(uv, view) {
    return decodeLzChart(uv, view);
  },

  inverseEncode(ic) {
    // L_z and E recover directly from the IC, but mapping them to a
    // pixel needs the chart's (Kmax, γ) — inverseEncode takes no view,
    // so return a hint, not a guess.
    const Lz = angularMomentum(ic.r, ic.p);
    const E  = totalEnergy(ic.m, ic.r, ic.p);
    return {
      kind: 'projected',
      pixel: { s: 0.5 + 0.5 * Math.sign(Lz), t: 0.5 },
      reason: `lz_e inverse needs chart params (Lz=${Lz.toPrecision(6)}, E=${E.toPrecision(6)})`,
    };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
