import type { ViewState } from './view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export type PreserveResult =
  | { kind: 'ok'; view: ViewState; projected: boolean }
  | { kind: 'rejected'; reason: string };

/**
 * Preserve the locked physical IC across a chart change.
 *
 *   1. If unlocked, just swap the chart and clear lock state.
 *   2. Decode the locked physical IC (already stored in lockedPhysical).
 *   3. Inverse-encode into the latent chart of the new view.
 *   4. If clamped, surface that as `projected: true`. The caller
 *      decides whether to show a warning toast.
 *   5. If clamping changes the physical IC qualitatively, refuse.
 */
export function preserveLockAcrossChart(
  v: ViewState, newChartType: string,
): PreserveResult {
  if (!v.locked || !v.lockedPhysical) {
    return { kind: 'ok',
             view: { ...v, chartType: newChartType, locked: false },
             projected: false };
  }
  const ic = v.lockedPhysical;
  const enc = inverseEncodeLatent({ m: ic.m, r: ic.r, p: ic.p, t: 0 }, KNOBS);
  const dec = decodeLatent(enc.z, KNOBS);
  if (dec.kind === 'terminal') {
    return { kind: 'rejected',
             reason: `preserve→decode emitted ${dec.terminal.kind}` };
  }

  // Qualitative-mismatch heuristic: if the round-tripped physical IC's
  // outcome class would change (mass closest swap, body order switch,
  // etc.), refuse. For M8 we use a simple positional tolerance test;
  // M10 charts can override.
  const eps = 1e-3;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dec.state.r[i]![0] - ic.r[i]![0]) > eps ||
        Math.abs(dec.state.r[i]![1] - ic.r[i]![1]) > eps) {
      return { kind: 'rejected',
               reason: `preserve→decode IC differs by ${eps}+ in body ${i}` };
    }
  }
  return {
    kind: 'ok',
    view: { ...v,
      chartType: newChartType,
      z0: enc.z,
      lockedPhysical: { m: dec.state.m, r: dec.state.r, p: dec.state.p },
    },
    projected: enc.clamped,
  };
}
