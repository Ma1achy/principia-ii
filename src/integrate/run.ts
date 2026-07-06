import type { TrajState, TerminalLabel } from './types.js';
import type { RunParams, RunResult, Diagnostics } from './types.js';
import { kdkMacroStep } from './kdk.js';
import { yoshida4MacroStep, yoshida6MacroStep } from './yoshida.js';
import { collisionCheck, makeEscapeState, tickEscapeGates } from './events.js';
import { Observer } from './observe.js';

/**
 * Integrate `s0` forward to `T_horizon` (or until a terminal event fires).
 * Returns the final state, the terminal label, and a full diagnostics record.
 *
 * If `params.checkpoints > 0`, returns a checkpointed trace as well.
 */
export function run(
  s0: TrajState, params: RunParams, opts: { checkpoints?: number } = {},
): RunResult {
  const stepFn =
    params.integrator === 'kdk'      ? kdkMacroStep      :
    params.integrator === 'yoshida4' ? yoshida4MacroStep :
                                       yoshida6MacroStep;

  const obs = new Observer(s0);
  const escapeState = makeEscapeState();

  const trace: TrajState[] = opts.checkpoints ? [s0] : [];
  const checkpointDt =
    opts.checkpoints ? params.THorizon / opts.checkpoints : Infinity;
  let nextCheckpoint = checkpointDt;

  let s: TrajState = s0;
  let terminal: TerminalLabel = { kind: 'NONE' };
  let saturatedSubsteps = 0;

  while (s.t < params.THorizon) {
    let stepRes: { state: TrajState; nSub: number; maxSub: number };
    try {
      stepRes = stepFn(s, params.dtMacro, params.substep);
    } catch (e) {
      terminal = { kind: 'SIM_FAILED',
                   reason: (e as Error).message ?? 'unknown',
                   t: s.t };
      break;
    }

    // NaN / Inf detection on the new state.
    if (!isFiniteState(stepRes.state)) {
      terminal = { kind: 'SIM_FAILED', reason: 'NaN or Inf in state', t: s.t };
      break;
    }

    s = stepRes.state;
    obs.observe(s, stepRes.nSub, stepRes.maxSub);

    // MAX_SUBSTEPS: a constituent KDK step hit the substep cap — the encounter
    // is finer than the integrator can resolve at this dt. Keyed off maxSub (the
    // peak per-KDK count), never the summed nSub, so a Yoshida composition whose
    // parts each stay under the cap is not spuriously terminated.
    if (stepRes.maxSub >= params.substep.NMax) {
      saturatedSubsteps++;
      if (saturatedSubsteps >= 1) {
        terminal = { kind: 'MAX_SUBSTEPS', t: s.t };
        break;
      }
    } else {
      saturatedSubsteps = 0;
    }

    // Collision and escape checks.
    const coll = collisionCheck(s, params.rColl);
    if (coll) { terminal = coll; break; }
    const esc = tickEscapeGates(s, escapeState, params.REsc, params.kEsc);
    if (esc.fired) { terminal = { kind: 'ESCAPE', body: esc.body!, t: s.t }; break; }

    if (opts.checkpoints && s.t >= nextCheckpoint) {
      trace.push(s);
      nextCheckpoint += checkpointDt;
    }
  }

  if (terminal.kind === 'NONE') {
    terminal = s.t >= params.THorizon
      ? { kind: 'BOUNDED', T: params.THorizon }
      : { kind: 'TIMEOUT', T: params.THorizon };
  }

  return {
    finalState: s,
    terminal,
    diagnostics: obs.finalDiagnostics(s) as Diagnostics,
    trace: opts.checkpoints ? trace : undefined,
  };
}

function isFiniteState(s: TrajState): boolean {
  for (let i = 0; i < 3; i++) {
    const ri = s.r[i]!, pi = s.p[i]!;
    if (!Number.isFinite(ri[0]) || !Number.isFinite(ri[1])) return false;
    if (!Number.isFinite(pi[0]) || !Number.isFinite(pi[1])) return false;
  }
  return true;
}
