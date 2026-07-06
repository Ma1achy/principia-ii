import type { TrajState, Triple, Vec2, TerminalLabel } from '@/math/types.js';
import type { DecodeKnobs, DecodeResult, ICDescriptor, LatentZ } from './types.js';
import { DegenerateReason } from './types.js';
import { decodeMassSoftmax } from './mass.js';
import { decodeConfigCanonical } from './configuration.js';
import { decodeFreeJacobiMomenta } from './momentum_free.js';
import {
  jacobiToParticlePositions, jacobiToParticleMomenta,
} from './jacobi_particle.js';
import { canonicalise } from './canonicalise.js';
import { totalEnergy, minPairSeparation } from '@/integrate/forces.js';
import { EPS_BOLT } from '@/math/constants.js';

/**
 * Full decode pipeline for the 8D latent chart. Returns a labelled output
 * for every input — never throws, never returns NaN.
 */
export function decodeLatent(
  z: LatentZ, knobs: DecodeKnobs,
): DecodeResult {
  const m = decodeMassSoftmax(z[6], z[7], knobs.muMax);

  // No-holes guard: tiny M_{01} blocks the Jacobi reconstruction.
  if (m[0] + m[1] < 1e-10) {
    return makeTerminal({ kind: 'DEGENERATE', reason: DegenerateReason.M01_TINY }, m);
  }

  const cfg = decodeConfigCanonical(z[0], z[1], knobs.alphaMin, knobs.RTilde);

  // Unweight the mass-weighted Jacobi vectors.
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rho:    Vec2 = [cfg.rhoTilde[0]    / Math.sqrt(muRho),
                        cfg.rhoTilde[1]    / Math.sqrt(muRho)];
  const lambda: Vec2 = [cfg.lambdaTilde[0] / Math.sqrt(muLambda),
                        cfg.lambdaTilde[1] / Math.sqrt(muLambda)];

  const r: Triple<Vec2> = jacobiToParticlePositions(rho, lambda, m);

  const jm = decodeFreeJacobiMomenta(
    [z[2], z[3], z[4], z[5]], knobs.qMax,
  );
  const p: Triple<Vec2> = jacobiToParticleMomenta(jm, m);

  // Canonicalise (mostly a no-op, but absorbs round-off).
  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: knobs.deltaLambda, rColl: knobs.rColl });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

function makeTerminal(
  terminal: TerminalLabel, m: TrajState['m'],
): DecodeResult {
  // For terminal-at-decode states we still emit a descriptor so render
  // modes that read mass/colour can do something sensible. Position fields
  // are zero.
  const dummy: TrajState = {
    r: [[0,0],[0,0],[0,0]], p: [[0,0],[0,0],[0,0]], m, t: 0,
  };
  return { kind: 'terminal', terminal, descriptor: makeDescriptor(dummy) };
}

function makeDescriptor(s: TrajState): ICDescriptor {
  const m = s.m;
  const M = m[0] + m[1] + m[2];
  const qMass = Math.min(m[0], m[1], m[2]) / M;

  // Inner Jacobi |ρ| and outer |λ| from the actual r values.
  const M01 = m[0] + m[1];
  const cx  = (m[0]*s.r[0][0] + m[1]*s.r[1][0]) / M01;
  const cy  = (m[0]*s.r[0][1] + m[1]*s.r[1][1]) / M01;
  const rhoVec    = [s.r[1][0] - s.r[0][0], s.r[1][1] - s.r[0][1]] as const;
  const lambdaVec = [s.r[2][0] - cx,        s.r[2][1] - cy       ] as const;
  const rho1Mag   = Math.hypot(...rhoVec);
  const rho2Mag   = Math.hypot(...lambdaVec);

  const rhoAngle = Math.atan2(
    rhoVec[0]*lambdaVec[1] - rhoVec[1]*lambdaVec[0],
    rhoVec[0]*lambdaVec[0] + rhoVec[1]*lambdaVec[1],
  );

  const K0 = (s.p[0][0]*s.p[0][0] + s.p[0][1]*s.p[0][1]) / (2*m[0])
           + (s.p[1][0]*s.p[1][0] + s.p[1][1]*s.p[1][1]) / (2*m[1])
           + (s.p[2][0]*s.p[2][0] + s.p[2][1]*s.p[2][1]) / (2*m[2]);
  const V0 = totalEnergy(s.m, s.r, s.p) - K0;

  return {
    m, qMass,
    rho1Mag, rho2Mag,
    rhoRatio: rho1Mag === 0 ? Infinity : rho2Mag / rho1Mag,
    rhoAngle,
    K0, V0,
    virial: 2 * K0 / Math.max(EPS_BOLT, Math.abs(V0)),
    rMinPair0: minPairSeparation(s.r).d,
  };
}
