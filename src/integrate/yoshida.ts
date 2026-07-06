import type { TrajState } from './types.js';
import type { SubstepParams } from './types.js';
import { kdkMacroStep } from './kdk.js';

/**
 * Yoshida 4th-order composition: three KDK steps with weights w1, w2, w3.
 * The middle step has a negative weight (steps backward) — this is required
 * for explicit symplectic methods of order > 2.
 */
const W4_1 = 1 / (2 - Math.cbrt(2));
const W4_2 = -Math.cbrt(2) / (2 - Math.cbrt(2));
const W4_3 = W4_1;

export function yoshida4MacroStep(
  s: TrajState, dtMacro: number, sp: SubstepParams,
): { state: TrajState; nSub: number; maxSub: number } {
  const a = kdkMacroStep(s,            W4_1 * dtMacro, sp);
  const b = kdkMacroStep(a.state,      W4_2 * dtMacro, sp);
  const c = kdkMacroStep(b.state,      W4_3 * dtMacro, sp);
  return {
    state: c.state,
    nSub: a.nSub + b.nSub + c.nSub,
    maxSub: Math.max(a.maxSub, b.maxSub, c.maxSub),
  };
}

/**
 * Yoshida 6th-order: seven KDK steps with palindromic weights from the
 * standard Solution A. Literals are written at exact float64 precision
 * (the published 20-digit values round to these doubles).
 */
const W6 = [
   0.7845136104775573,
   0.23557321335935813,
  -1.177679984178871,
   1.3151863206839112,
  -1.177679984178871,
   0.23557321335935813,
   0.7845136104775573,
];

export function yoshida6MacroStep(
  s: TrajState, dtMacro: number, sp: SubstepParams,
): { state: TrajState; nSub: number; maxSub: number } {
  let cur = s, total = 0, peak = 0;
  for (const w of W6) {
    const r = kdkMacroStep(cur, w * dtMacro, sp);
    cur = r.state;
    total += r.nSub;
    peak = Math.max(peak, r.maxSub);
  }
  return { state: cur, nSub: total, maxSub: peak };
}
