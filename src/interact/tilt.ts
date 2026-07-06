import type { ViewState } from './view_state.js';
import type { Vec8 } from '@/math/types.js';
import {
  add8, scale8, sub8, dot8, normalize8, unitE8,
} from '@/math/vec.js';

const EPS_DEGEN = 1e-6;

/**
 * Tilt formula: q' = cos(τ) · q_base + sin(τ) · ê_k.
 *
 * Important: q_base is the chart-defined initial basis vector, not the
 * currently tilted one. Tilt replaces, doesn't accumulate. Re-issuing a
 * slider value at the same angle returns the same vector regardless of
 * prior tilt history.
 *
 * The formula is Givens-style only when q_base ⊥ e_k (true at depth 0
 * since `q1 = e_h`, `q2 = e_v`); after `reorthonormalise` the result is
 * exactly orthonormal anyway.
 */
export function applyTilt(qBase: Vec8, target: number, tau: number): Vec8 {
  const e = unitE8(target);
  return add8(scale8(qBase, Math.cos(tau)), scale8(e, Math.sin(tau)));
}

/**
 * Gram–Schmidt re-orthonormalisation, anchored on q1. Always run
 * (it's a no-op when the tilts are independent dimensions, ~10 FLOPs).
 *
 * Degenerate case: if both sliders target the same dimension at similar
 * angles, q2_perp shrinks to ~0; we substitute the first available
 * orthogonal latent direction.
 */
export function reorthonormalise(q1Tilt: Vec8, q2Tilt: Vec8): [Vec8, Vec8] {
  const q1n = normalize8(q1Tilt);
  const q2perp = sub8(q2Tilt, scale8(q1n, dot8(q2Tilt, q1n)));
  const norm = Math.hypot(...q2perp);
  if (norm < EPS_DEGEN) {
    return [q1n, fallbackOrthogonal(q1n)];
  }
  return [q1n, scale8(q2perp, 1 / norm)];
}

function fallbackOrthogonal(q1n: Vec8): Vec8 {
  // Pick the latent axis least aligned with q1n.
  let best = 0, bestDot = Infinity;
  for (let k = 0; k < 8; k++) {
    const d = Math.abs(dot8(q1n, unitE8(k)));
    if (d < bestDot) { bestDot = d; best = k; }
  }
  const e = unitE8(best);
  const perp = sub8(e, scale8(q1n, dot8(e, q1n)));
  return normalize8(perp);
}

/**
 * Update the tilt parameters of a `ViewState`. The chart-defined initial
 * basis vectors are inferred from `hAxis` and `vAxis`.
 */
export function setTilts(v: ViewState, opts: {
  tilt1?: number; tilt1Target?: number;
  tilt2?: number; tilt2Target?: number;
}): ViewState {
  const tilt1 = opts.tilt1 ?? v.tilt1;
  const tilt2 = opts.tilt2 ?? v.tilt2;
  const t1Target = opts.tilt1Target ?? v.tilt1Target;
  const t2Target = opts.tilt2Target ?? v.tilt2Target;

  const q1Base = unitE8(v.hAxis);
  const q2Base = unitE8(v.vAxis);
  const q1Raw  = applyTilt(q1Base, t1Target, tilt1);
  const q2Raw  = applyTilt(q2Base, t2Target, tilt2);
  const [q1, q2] = reorthonormalise(q1Raw, q2Raw);

  return { ...v,
    tilt1, tilt2,
    tilt1Target: t1Target, tilt2Target: t2Target,
    q1, q2,
  };
}
