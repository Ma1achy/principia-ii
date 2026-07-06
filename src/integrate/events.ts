import type { TrajState, TerminalLabel, Vec2, Vec3 } from './types.js';
import { dot2, scale2, norm2 } from '@/math/vec.js';
import { minPairSeparation } from './forces.js';

/** Three-gate escape detector with persistence counter (spec §4.2). */
export interface EscapeState {
  counters: [number, number, number];   // one per body candidate
}

export function makeEscapeState(): EscapeState {
  return { counters: [0, 0, 0] };
}

export function tickEscapeGates(
  s: TrajState, st: EscapeState, REsc: number, kEsc: number,
): { fired: boolean; body?: 0 | 1 | 2 } {
  for (const k of [0, 1, 2] as const) {
    const [i, j] = otherPair(k);
    const lambda = outerJacobi(s.r, s.m, k);
    const vLambda = outerJacobiVel(s.r, s.p, s.m, k);
    const muOut = s.m[k] * (s.m[i] + s.m[j]);

    const distGate    = norm2(lambda) > REsc;
    const outwardGate = dot2(lambda, vLambda) > 0;

    // E_out = ||p_out||² / (2 μ_out) - G m_k (m_i + m_j) / ||λ||
    const pOut = scale2(vLambda, muOut);
    const Eout = (pOut[0]*pOut[0] + pOut[1]*pOut[1])/(2*muOut)
               - (s.m[k]*(s.m[i]+s.m[j])) / norm2(lambda);
    const energyGate = Eout > 0;

    const allOn = distGate && outwardGate && energyGate;
    st.counters[k] = allOn
      ? Math.min(st.counters[k] + 1, kEsc)
      : Math.max(st.counters[k] - 1, 0);
    if (st.counters[k] >= kEsc) return { fired: true, body: k };
  }
  return { fired: false };
}

/** Collision check: any pair below r_coll. */
export function collisionCheck(
  s: TrajState, rColl: number,
): TerminalLabel | null {
  const { d, pair } = minPairSeparation(s.r);
  if (d < rColl) return { kind: 'COLLISION', pair, t: s.t };
  return null;
}

/* ----- helpers ----- */

function otherPair(k: 0 | 1 | 2): [0|1|2, 0|1|2] {
  return k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
}

function outerJacobi(
  r: TrajState['r'], m: Vec3, k: 0 | 1 | 2,
): Vec2 {
  const [i, j] = otherPair(k);
  const Mij = m[i] + m[j];
  const cx = (m[i]*r[i][0] + m[j]*r[j][0]) / Mij;
  const cy = (m[i]*r[i][1] + m[j]*r[j][1]) / Mij;
  return [r[k][0] - cx, r[k][1] - cy];
}

function outerJacobiVel(
  r: TrajState['r'], p: TrajState['p'], m: Vec3, k: 0 | 1 | 2,
): Vec2 {
  // v_λ = v_k - (m_i v_i + m_j v_j) / (m_i + m_j)
  // with v_l = p_l / m_l
  const [i, j] = otherPair(k);
  const Mij = m[i] + m[j];
  const vk: Vec2 = [p[k][0]/m[k], p[k][1]/m[k]];
  const cx = (p[i][0] + p[j][0]) / Mij;
  const cy = (p[i][1] + p[j][1]) / Mij;
  return [vk[0] - cx, vk[1] - cy];
}
