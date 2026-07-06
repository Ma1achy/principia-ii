import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_INVARIANT } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

/**
 * Acute-angle × kinetic-energy chart: θ ∈ (0, π/4], K ∈ [0, K_max].
 * `flags.forbids_energy_normalisation = true` because the chart sets K
 * deterministically.
 */
export function makeAcuteAngleKChart(opts: {
  thetaMin?: number;
  thetaMax?: number;
  Kmax?: number;
  gammaK?: number;
}): Chart {
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;
  const Kmax     = opts.Kmax     ?? 2;
  const gammaK   = opts.gammaK   ?? 2;

  return {
    id: 'mixed_axis',     // M10's mixed-axis category; could promote to its own
    kind: 'mixed',
    flags: FLAGS_INVARIANT,

    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m } = burrauTriangle(nu);
      const K = Kmax * Math.pow(v, gammaK);
      // v drives kinetic energy via a radial-momentum seed along ρ̃.
      // Jacobi kinetic energy is |p_ρ|²/(2 μ_ρ), so hitting K exactly
      // needs the reduced-mass factor: |p_ρ| = √(2 K μ_ρ).
      const muRho = (m[0] * m[1]) / (m[0] + m[1]);
      const pRho:    Vec2 = [Math.sqrt(2 * K * muRho), 0];
      const pLambda: Vec2 = [0, 0];
      const p: Triple<Vec2> = jacobiToParticleMomenta({ pRho, pLambda }, m);
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) {
        return { kind: 'terminal', terminal: c.terminal,
                 descriptor: makeDescriptor(c.state) };
      }
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    inverseEncode() {
      return { kind: 'projected', reason: 'acute-angle chart inverse not unique' };
    },

    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      return { kind: 'pass' };
    },
  };
}
