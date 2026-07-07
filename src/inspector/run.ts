import type { TrajState, TerminalLabel } from '@/math/types.js';
import type { InspectorResult, RK45Opts } from './types.js';
import { RK45_DEFAULTS } from './types.js';
import { tryStep } from './adaptive.js';
import { inspectorWithShadow } from './shadow.js';
import { diagnosticsAt } from './diagnostics.js';
import { collisionCheck, makeEscapeState, tickEscapeGates } from '@/integrate/events.js';
import { wordToString } from '@/metrics/free_group.js';
import { metricsTick, makeMetrics, DEFAULT_BRANCH_CUTS } from '@/metrics/observe_extended.js';

/**
 * Run the inspector's adaptive RK45 from `s0` to `T_horizon`. Returns
 * a fully-populated `InspectorResult`.
 */
export function runInspector(
  s0: TrajState, opts: Partial<RK45Opts> = {},
): InspectorResult {
  const o: RK45Opts = { ...RK45_DEFAULTS, ...opts };

  const t0 = performance.now();
  let s = s0, h = o.hInit;

  const tArr: number[] = [s.t];
  const rArr: TrajState['r'][] = [s.r];
  const pArr: TrajState['p'][] = [s.p];
  const nArr: { x: number; y: number; z: number }[] = [];
  const energyArr: number[] = [];
  const lzArr: number[] = [];

  const escState = makeEscapeState();
  const metrics = makeMetrics();
  let outcome: InspectorResult['outcome'] = 'timeout';
  let dMin = Infinity;
  let deltaEMax = 0;
  let nSteps = 0, nReject = 0;
  let terminal: TerminalLabel = { kind: 'NONE' };

  // Initial diagnostics.
  const d0 = diagnosticsAt(s);
  energyArr.push(d0.E);
  lzArr.push(d0.Lz);
  nArr.push(d0.n);

  while (s.t < o.THorizon) {
    // Wall-clock budget (hover-streamline): stop and return the partial
    // trajectory. Reported as 'timeout' — an early cutoff, not a failure.
    if (o.budgetMs !== undefined && performance.now() - t0 > o.budgetMs) break;
    // Clamp the final step to the horizon so bounded runs end at exactly
    // T_horizon (the fixed-step match integrator overshoots by < dtMacro;
    // keeping the adaptive side exact preserves sub-millisecond t_end
    // agreement).
    const hTry = Math.min(h, o.THorizon - s.t);
    const r = tryStep(s, hTry, o);
    if (!r.accepted) {
      nReject++;
      // The h_min abort lives HERE, in the reject branch: a step that was
      // rejected at h <= hMin would be retried at hMin forever otherwise.
      if (hTry <= o.hMin) {
        terminal = { kind: 'SIM_FAILED', reason: 'h_min reached', t: s.t };
        outcome = 'failed';
        break;
      }
      h = r.hNext;
      continue;
    }
    h = r.hNext;
    s = r.s;
    nSteps++;

    if (o.fullTrace) {
      tArr.push(s.t); rArr.push(s.r); pArr.push(s.p);
    }

    const d = diagnosticsAt(s);
    energyArr.push(d.E); lzArr.push(d.Lz); nArr.push(d.n);
    deltaEMax = Math.max(deltaEMax, Math.abs(d.E - energyArr[0]!));

    // Metrics tick (free-group word, arc length, phase).
    metricsTick(metrics, s, false, DEFAULT_BRANCH_CUTS);

    // Update d_min and check terminal events.
    const sep = Math.min(
      Math.hypot(s.r[1][0]-s.r[0][0], s.r[1][1]-s.r[0][1]),
      Math.hypot(s.r[2][0]-s.r[0][0], s.r[2][1]-s.r[0][1]),
      Math.hypot(s.r[2][0]-s.r[1][0], s.r[2][1]-s.r[1][1]),
    );
    if (sep < dMin) dMin = sep;

    const coll = collisionCheck(s, o.rColl);
    if (coll) { terminal = coll; outcome = 'collision'; break; }
    const esc = tickEscapeGates(s, escState, o.REsc, o.kEsc);
    if (esc.fired) { terminal = { kind: 'ESCAPE', body: esc.body!, t: s.t };
                     outcome = 'escape'; break; }
  }

  if (terminal.kind === 'NONE' && s.t >= o.THorizon) outcome = 'bounded';

  // FTLE via a Benettin shadow trajectory (ADR-0003: full phase-space seed).
  // Only meaningful for BOUNDED orbits (spec §4.3.3, research tier): an
  // escape/collision/failed outcome has no finite-time Lyapunov exponent, and
  // — critically — the shadow integrator has no event termination, so running
  // it through a collision would grind to the horizon at the singularity.
  // Gating on `bounded` keeps it both correct and bounded-cost.
  const shadow = outcome === 'bounded'
    ? inspectorWithShadow(s0, o)
    : { lambda: 0, valid: false };

  return {
    t: tArr, r: rArr, p: pArr,
    nShape: nArr,
    energy: energyArr, lz: lzArr,
    outcome, tEnd: s.t, dMin, deltaEMax,
    ftle: shadow.valid ? shadow.lambda : 0,
    freeGroupWord: wordToString(metrics.word),
    ic: { m: s0.m, r: s0.r, p: s0.p },
    nSteps, nReject,
    cpuMs: performance.now() - t0,
  };
}
