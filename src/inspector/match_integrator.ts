import type { TrajState } from '@/math/types.js';
import type { InspectorResult } from './types.js';
import { run } from '@/integrate/run.js';

/**
 * Match-integrator mode: re-run the active GPU pipeline's symplectic
 * integrator at f64 on the CPU. Useful for apples-to-apples energy and
 * `t_end` comparisons against the GPU.
 *
 * Caller passes the same `integrator`, `dtMacro`, and `THorizon` the
 * GPU pipeline used. We don't expose adaptive settings here because the
 * point is to reproduce the GPU's behaviour exactly.
 */
export function inspectorMatch(
  s0: TrajState,
  params: {
    integrator: 'kdk' | 'yoshida4' | 'yoshida6';
    dtMacro: number; THorizon: number;
    NMax: number; rSub: number; gammaSub: number;
    rColl: number; REsc: number; kEsc: number;
  },
): InspectorResult {
  const t0 = performance.now();
  const result = run(s0, {
    integrator: params.integrator,
    dtMacro: params.dtMacro,
    THorizon: params.THorizon,
    rColl: params.rColl,
    REsc:  params.REsc,
    kEsc:  params.kEsc,
    substep: { rSub: params.rSub, gammaSub: params.gammaSub, NMax: params.NMax },
  }, { checkpoints: 200 });

  const trace = result.trace ?? [];
  return {
    t: trace.map(s => s.t),
    r: trace.map(s => s.r),
    p: trace.map(s => s.p),
    nShape: [],
    energy: [], lz: [],
    outcome:
      result.terminal.kind === 'COLLISION' ? 'collision' :
      result.terminal.kind === 'ESCAPE'    ? 'escape'    :
      result.terminal.kind === 'BOUNDED'   ? 'bounded'   :
      result.terminal.kind === 'SIM_FAILED'? 'failed'    : 'timeout',
    tEnd: result.diagnostics.tEnd,
    dMin: result.diagnostics.rMin,
    deltaEMax: result.diagnostics.energyDriftAbsMax,
    ftle: 0,
    freeGroupWord: '',
    diffusion: -1,   // the match integrator skips derived metrics
    ic: { m: s0.m, r: s0.r, p: s0.p },
    nSteps: trace.length, nReject: 0,
    cpuMs: performance.now() - t0,
  };
}
