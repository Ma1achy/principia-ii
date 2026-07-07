import type { TrajState, TerminalLabel, Triple, Vec2, Vec3 } from './types.js';
import type { RunResult, Diagnostics } from './types.js';
import { forces, totalEnergy } from './forces.js';
import { collisionCheck, makeEscapeState, tickEscapeGates } from './events.js';
import { projectCOM } from './com.js';
import { Observer } from './observe.js';
import { G } from '@/math/constants.js';

/**
 * Close-encounter regularization (G19) via algorithmic (LogH) time
 * transformation — Mikkola & Tanikawa (1999) / Preto & Tremaine (1999).
 *
 * Instead of switching the closest pair into explicit Levi-Civita
 * coordinates, the whole system is integrated in a fictitious time s with
 * the time transformations dt = ds/(T+B) on drifts and dt = ds/W on kicks
 * (W = -U > 0 the positive potential, B = W₀ - T₀ = -E the binding
 * energy, a constant of the exact flow). The asymmetric pair of
 * transformations makes the leapfrog EXACT on the two-body (Kepler)
 * limit — the collision singularity costs O(1) steps instead of
 * saturating a substep budget — while remaining a symmetric,
 * time-transformed symplectic map that composes with the landed Yoshida
 * coefficients to 4th/6th order.
 *
 * CPU-reference / inspector-tier capability only: nothing in the GPU
 * pipeline or the existing run() path is touched (acceptance: the M1
 * figure-8 golden passes untouched, regularization off = no change).
 */

export interface RegularizedParams {
  /** Fictitious-time step (dt ≈ hFict/W in smooth regions). */
  hFict: number;
  THorizon: number;
  /** Collision threshold; 0 disables the check (integrate through). */
  rColl: number;
  REsc: number;
  kEsc: number;
  /** Composition order over the 2nd-order LogH map. Default 6. */
  order?: 2 | 4 | 6;
  /** Hard cap on composed steps (encounter-storm backstop). Default 5e6. */
  maxSteps?: number;
}

/** Yoshida solution-A weights (same constants as yoshida.ts, over the
 *  LogH base map instead of the KDK macro step). */
const W4_1 = 1 / (2 - Math.cbrt(2));
const W4 = [W4_1, -Math.cbrt(2) / (2 - Math.cbrt(2)), W4_1];
const W6 = [
   0.7845136104775573,
   0.23557321335935813,
  -1.177679984178871,
   1.3151863206839112,
  -1.177679984178871,
  0.23557321335935813,
  0.7845136104775573,
];

type Flat6 = [number, number, number, number, number, number];

/** Positive potential W = G Σ_{i<j} m_i m_j / r_ij. */
function potentialW(m: Vec3, R: Flat6): number {
  const d01 = Math.hypot(R[2] - R[0], R[3] - R[1]);
  const d02 = Math.hypot(R[4] - R[0], R[5] - R[1]);
  const d12 = Math.hypot(R[4] - R[2], R[5] - R[3]);
  return G * (m[0] * m[1] / d01 + m[0] * m[2] / d02 + m[1] * m[2] / d12);
}

/** Kinetic energy T = Σ |p|²/(2m). */
function kineticT(m: Vec3, P: Flat6): number {
  return (P[0] * P[0] + P[1] * P[1]) / (2 * m[0])
       + (P[2] * P[2] + P[3] * P[3]) / (2 * m[1])
       + (P[4] * P[4] + P[5] * P[5]) / (2 * m[2]);
}

interface LoghState {
  R: Flat6;
  P: Flat6;
  t: number;
}

/**
 * One 2nd-order LogH step (drift–kick–drift) of fictitious size h.
 * Physical time advances only in the drifts (dt = δs/(T+B)); the kick
 * uses dt = δs/W(R). B is the constant binding energy of the run.
 */
function loghDKD(s: LoghState, m: Vec3, B: number, h: number): LoghState {
  let { R, P, t } = s;

  // Half drift.
  let dt = (h / 2) / (kineticT(m, P) + B);
  R = [
    R[0] + dt * P[0] / m[0], R[1] + dt * P[1] / m[0],
    R[2] + dt * P[2] / m[1], R[3] + dt * P[3] / m[1],
    R[4] + dt * P[4] / m[2], R[5] + dt * P[5] / m[2],
  ];
  t += dt;

  // Full kick (time does not advance).
  const r: Triple<Vec2> = [[R[0], R[1]], [R[2], R[3]], [R[4], R[5]]];
  const F = forces(m, r);
  const dtK = h / potentialW(m, R);
  P = [
    P[0] + dtK * F[0][0], P[1] + dtK * F[0][1],
    P[2] + dtK * F[1][0], P[3] + dtK * F[1][1],
    P[4] + dtK * F[2][0], P[5] + dtK * F[2][1],
  ];

  // Half drift.
  dt = (h / 2) / (kineticT(m, P) + B);
  R = [
    R[0] + dt * P[0] / m[0], R[1] + dt * P[1] / m[0],
    R[2] + dt * P[2] / m[1], R[3] + dt * P[3] / m[1],
    R[4] + dt * P[4] / m[2], R[5] + dt * P[5] / m[2],
  ];
  t += dt;

  return { R, P, t };
}

/** One composed LogH macro step (order 2, 4, or 6). */
function loghComposedStep(
  s: LoghState, m: Vec3, B: number, h: number, order: 2 | 4 | 6,
): LoghState {
  if (order === 2) return loghDKD(s, m, B, h);
  const weights = order === 4 ? W4 : W6;
  let cur = s;
  for (const w of weights) cur = loghDKD(cur, m, B, w * h);
  return cur;
}

function toTrajState(s: LoghState, m: Vec3): TrajState {
  return {
    r: [[s.R[0], s.R[1]], [s.R[2], s.R[3]], [s.R[4], s.R[5]]],
    p: [[s.P[0], s.P[1]], [s.P[2], s.P[3]], [s.P[4], s.P[5]]],
    m, t: s.t,
  };
}

function fromTrajState(s: TrajState): LoghState {
  return {
    R: [s.r[0][0], s.r[0][1], s.r[1][0], s.r[1][1], s.r[2][0], s.r[2][1]],
    P: [s.p[0][0], s.p[0][1], s.p[1][0], s.p[1][1], s.p[2][0], s.p[2][1]],
    t: s.t,
  };
}

/**
 * Integrate `s0` to THorizon (or a terminal event) with LogH
 * regularization. Mirrors run()'s result contract (same RunResult /
 * Diagnostics / TerminalLabel shapes, checkpointed trace on request) so
 * goldens and the inspector can consume it interchangeably.
 */
export function runRegularized(
  s0: TrajState, params: RegularizedParams, opts: { checkpoints?: number } = {},
): RunResult {
  const order = params.order ?? 6;
  const maxSteps = params.maxSteps ?? 5_000_000;
  const m = s0.m;

  // The binding energy of the run — a constant of the exact flow.
  const flat0 = fromTrajState(s0);
  const B = potentialW(m, flat0.R) - kineticT(m, flat0.P);

  const obs = new Observer(s0);
  const escapeState = makeEscapeState();

  const trace: TrajState[] = opts.checkpoints ? [s0] : [];
  const checkpointDt =
    opts.checkpoints ? params.THorizon / opts.checkpoints : Infinity;
  let nextCheckpoint = s0.t + checkpointDt;

  let cur = flat0;
  let terminal: TerminalLabel = { kind: 'NONE' };
  let steps = 0;

  while (cur.t < params.THorizon) {
    if (steps >= maxSteps) {
      terminal = { kind: 'TIMEOUT', T: params.THorizon };
      break;
    }
    cur = loghComposedStep(cur, m, B, params.hFict, order);
    steps++;

    let s = toTrajState(cur, m);
    if (!isFiniteState(s)) {
      terminal = { kind: 'SIM_FAILED', reason: 'NaN or Inf in state', t: cur.t };
      break;
    }
    s = projectCOM(s);
    cur = fromTrajState(s);

    obs.observe(s, 1, 1);

    if (params.rColl > 0) {
      const coll = collisionCheck(s, params.rColl);
      if (coll) { terminal = coll; break; }
    }
    const esc = tickEscapeGates(s, escapeState, params.REsc, params.kEsc);
    if (esc.fired) { terminal = { kind: 'ESCAPE', body: esc.body!, t: s.t }; break; }

    if (opts.checkpoints && s.t >= nextCheckpoint) {
      trace.push(s);
      nextCheckpoint += checkpointDt;
    }
  }

  const finalState = toTrajState(cur, m);
  if (terminal.kind === 'NONE') {
    terminal = finalState.t >= params.THorizon
      ? { kind: 'BOUNDED', T: params.THorizon }
      : { kind: 'TIMEOUT', T: params.THorizon };
  }

  return {
    finalState,
    terminal,
    diagnostics: obs.finalDiagnostics(finalState) as Diagnostics,
    trace: opts.checkpoints ? trace : undefined,
  };
}

/** Exported for tests: the constant binding energy the run uses. */
export function bindingEnergy(s: TrajState): number {
  const f = fromTrajState(s);
  return potentialW(s.m, f.R) - kineticT(s.m, f.P);
}

/** Physical-time energy of a state (convenience re-export shape). */
export function stateEnergy(s: TrajState): number {
  return totalEnergy(s.m, s.r, s.p);
}

function isFiniteState(s: TrajState): boolean {
  for (let i = 0; i < 3; i++) {
    const ri = s.r[i]!, pi = s.p[i]!;
    if (!Number.isFinite(ri[0]) || !Number.isFinite(ri[1])) return false;
    if (!Number.isFinite(pi[0]) || !Number.isFinite(pi[1])) return false;
  }
  return true;
}
