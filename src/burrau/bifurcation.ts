import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_INVARIANT, FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Triple, Vec2, Vec3 } from '@/math/types.js';

/**
 * (θ, K) bifurcation strip: horizontal axis is the acute angle, vertical
 * is kinetic energy. Mass triple = Burrau natural for the current θ.
 */
export function makeThetaKStrip(opts: {
  Kmax?: number; gammaK?: number;
  thetaMin?: number; thetaMax?: number;
}): Chart {
  const Kmax     = opts.Kmax     ?? 2;
  const gammaK   = opts.gammaK   ?? 2;
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;

  return {
    id: 'mixed_axis', kind: 'mixed', flags: FLAGS_INVARIANT,
    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m } = burrauTriangle(nu);
      const K = Kmax * Math.pow(v, gammaK);
      // Exact K needs the reduced-mass factor (Jacobi K = |p_ρ|²/(2μ_ρ)).
      const muRho = (m[0] * m[1]) / (m[0] + m[1]);
      const p: Triple<Vec2> = jacobiToParticleMomenta(
        { pRho: [Math.sqrt(2 * K * muRho), 0], pLambda: [0, 0] }, m,
      );
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: makeDescriptor(c.state) };
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },
    inverseEncode() { return { kind: 'projected', reason: 'strip inverse not unique' }; },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return { kind: 'reject', reason: 'uv out of range' };
      return { kind: 'pass' };
    },
  };
}

/**
 * (θ, δm) bifurcation strip: horizontal is acute angle, vertical
 * interpolates the mass triple from Burrau natural to a target (defaults
 * to equal masses).
 */
export function makeThetaDeltaMStrip(opts: {
  thetaMin?: number; thetaMax?: number;
  mTarget?: Vec3;
}): Chart {
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;
  const mTarget  = opts.mTarget  ?? [1 / 3, 1 / 3, 1 / 3];

  return {
    id: 'mixed_axis', kind: 'mixed', flags: FLAGS_MASS_VARYING,
    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m: mNatural } = burrauTriangle(nu);
      const mInterp: Vec3 = [
        (1 - v) * mNatural[0] + v * mTarget[0],
        (1 - v) * mNatural[1] + v * mTarget[1],
        (1 - v) * mNatural[2] + v * mTarget[2],
      ];
      const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
      const c = canonicalise({ r, p, m: mInterp, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: makeDescriptor(c.state) };
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },
    inverseEncode() {
      return { kind: 'projected', reason: 'δm inverse needs interpolation factor' };
    },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return { kind: 'reject', reason: 'uv out of range' };
      return { kind: 'pass' };
    },
  };
}
