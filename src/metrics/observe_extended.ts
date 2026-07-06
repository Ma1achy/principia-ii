import type { TrajState } from '@/math/types.js';
import type { MetricsAccumulator } from './types.js';
import { shapeSphere, massWeightedJacobi } from './shape_sphere.js';
import { phaseFromN, unwrapPhase } from './phase.js';
import { geodesic } from './arc.js';
import { freeGroupTick, emptyWord } from './free_group.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';

export interface BranchCutCfg {
  b1: readonly [number, number, number];
  b2: readonly [number, number, number];
}

/** Default equal-mass branch-cut basepoints (spec §4.3.4). */
export const DEFAULT_BRANCH_CUTS: BranchCutCfg = {
  b1: [1, 0, 0],
  b2: [-0.5, Math.sqrt(3)/2, 0],
};

/** Equal-mass band half-width ε_m (ADR 0004). Masses are "equal" when every
 *  pairwise difference is within this tolerance of the equal-mass triple. */
export const EQUAL_MASS_EPS = 1e-6;

/**
 * Whether a mass triple sits inside the equal-mass ε band (ADR 0004). Outside
 * the band the free-group word is computed-but-untrusted and the descriptor's
 * `WORD_UNCERTAIN` bit must be set so it never gates refinement or science.
 */
export function massesAreEqual(
  m: readonly [number, number, number], eps = EQUAL_MASS_EPS,
): boolean {
  const mean = (m[0] + m[1] + m[2]) / 3;
  return Math.abs(m[0] - mean) <= eps
      && Math.abs(m[1] - mean) <= eps
      && Math.abs(m[2] - mean) <= eps;
}

export function makeMetrics(): MetricsAccumulator {
  return {
    arcLengthN: 0, checkpoints: [],
    prevN: null, prevTheta: null, thetaTilde: 0,
    word: emptyWord(), wordUncertain: false,
    ftleEstimate: 0, ftleValid: false,
    encounters: 0,
    closeEncounterPair: { count: 0, pair: 0 },
    netWindingThetaTilde: 0,
  };
}

/**
 * Update accumulator from a fresh state. Call once per macro step.
 *
 * Returns whether a checkpoint was emitted (caller is responsible for
 * scheduling checkpoint times, but we tag the resulting Checkpoint with
 * the current `t` so the diffusion fit sees the right times).
 */
export function metricsTick(
  acc: MetricsAccumulator,
  s: TrajState,
  emitCheckpoint: boolean,
  branchCuts: BranchCutCfg = DEFAULT_BRANCH_CUTS,
): void {
  // ADR 0004: off the equal-mass band the word is untrusted (WORD_UNCERTAIN).
  if (!massesAreEqual(s.m)) acc.wordUncertain = true;

  // Mass-weighted Jacobi.
  const { rho, lambda } = particlePositionsToJacobi(s.r, s.m);
  const { rhoT, lambdaT } = massWeightedJacobi(rho, lambda, s.m);
  const n = shapeSphere(rhoT, lambdaT);
  const theta = phaseFromN(n);

  // Arc length increment.
  if (acc.prevN) {
    acc.arcLengthN += geodesic(acc.prevN, n);
  }

  // Phase unwrap.
  if (acc.prevTheta !== null) {
    acc.thetaTilde = unwrapPhase(acc.prevTheta, theta, acc.thetaTilde);
  }
  acc.netWindingThetaTilde = acc.thetaTilde;

  // Free-group word (only if we have a prev to compare to).
  if (acc.prevN) {
    acc.word = freeGroupTick(
      acc.word, acc.prevN, n,
      branchCuts.b1 as any, branchCuts.b2 as any,
    );
  }

  if (emitCheckpoint) {
    acc.checkpoints.push({ n, thetaTilde: acc.thetaTilde, t: s.t });
  }

  acc.prevN = n;
  acc.prevTheta = theta;
}
