import type { TrajState, Triple, Vec2 } from '@/math/types.js';
import { forces } from '@/integrate/forces.js';

/**
 * Dormand–Prince 5(4) coefficients. We roll our own implementation
 * rather than using a generic ODE solver because we're running 18 state
 * variables (3 bodies × {r, p} × {x, y}) and want the inner loop to be
 * inlined and allocation-light.
 *
 * The c-nodes (1/5, 3/10, 4/5, 8/9) are omitted: the three-body RHS is
 * autonomous, so intermediate times never enter the stage evaluations.
 */
const A21 = 1/5;
const A31 = 3/40;       const A32 = 9/40;
const A41 = 44/45;      const A42 = -56/15;     const A43 = 32/9;
const A51 = 19372/6561; const A52 = -25360/2187;
                        const A53 = 64448/6561; const A54 = -212/729;
const A61 = 9017/3168;  const A62 = -355/33;
                        const A63 = 46732/5247; const A64 = 49/176;
                        const A65 = -5103/18656;
const A71 = 35/384;     const A72 = 0;
                        const A73 = 500/1113;   const A74 = 125/192;
                        const A75 = -2187/6784; const A76 = 11/84;

const E1 =     71/57600;
const E3 =    -71/16695;
const E4 =     71/1920;
const E5 = -17253/339200;
const E6 =     22/525;
const E7 =    - 1/40;

/**
 * Right-hand side of the equations of motion: dr/dt = p / m, dp/dt = F(r).
 */
function rhs(s: TrajState): { dr: Triple<Vec2>; dp: Triple<Vec2> } {
  const F = forces(s.m, s.r);
  const dr: Triple<Vec2> = [
    [s.p[0][0] / s.m[0], s.p[0][1] / s.m[0]],
    [s.p[1][0] / s.m[1], s.p[1][1] / s.m[1]],
    [s.p[2][0] / s.m[2], s.p[2][1] / s.m[2]],
  ];
  return { dr, dp: F };
}

function addScaled(
  s: TrajState, kSeq: number[][], coeffs: number[], h: number, tNew: number,
): TrajState {
  // Each kSeq[i] is a flat 12-array [dr0x, dr0y, dr1x, ..., dp2y].
  const acc = new Array<number>(12).fill(0);
  for (let i = 0; i < kSeq.length; i++) {
    const c = coeffs[i] ?? 0;
    if (c === 0) continue;
    for (let j = 0; j < 12; j++) acc[j]! += c * kSeq[i]![j]!;
  }
  // TrajState is readonly — t is set at construction, never mutated.
  return {
    m: s.m, t: tNew,
    r: [
      [s.r[0][0] + h*acc[0]!, s.r[0][1] + h*acc[1]!],
      [s.r[1][0] + h*acc[2]!, s.r[1][1] + h*acc[3]!],
      [s.r[2][0] + h*acc[4]!, s.r[2][1] + h*acc[5]!],
    ],
    p: [
      [s.p[0][0] + h*acc[6]!,  s.p[0][1] + h*acc[7]!],
      [s.p[1][0] + h*acc[8]!,  s.p[1][1] + h*acc[9]!],
      [s.p[2][0] + h*acc[10]!, s.p[2][1] + h*acc[11]!],
    ],
  };
}

function flat(d: { dr: Triple<Vec2>; dp: Triple<Vec2> }): number[] {
  return [
    d.dr[0][0], d.dr[0][1], d.dr[1][0], d.dr[1][1], d.dr[2][0], d.dr[2][1],
    d.dp[0][0], d.dp[0][1], d.dp[1][0], d.dp[1][1], d.dp[2][0], d.dp[2][1],
  ];
}

/**
 * One Dormand–Prince 5(4) step. Returns the 5th-order solution and the
 * absolute error estimate (RMS over the 12 state components).
 */
export function dopri5Step(
  s: TrajState, h: number,
): { s5: TrajState; errNorm: number } {
  const t = s.t;
  const k1 = flat(rhs(s));
  const k2 = flat(rhs(addScaled(s, [k1], [A21], h, t)));
  const k3 = flat(rhs(addScaled(s, [k1, k2], [A31, A32], h, t)));
  const k4 = flat(rhs(addScaled(s, [k1, k2, k3], [A41, A42, A43], h, t)));
  const k5 = flat(rhs(addScaled(s, [k1, k2, k3, k4], [A51, A52, A53, A54], h, t)));
  const k6 = flat(rhs(addScaled(s, [k1, k2, k3, k4, k5],
                                [A61, A62, A63, A64, A65], h, t)));
  // 5th order solution (the A7x row equals the b-weights; FSAL k7 = rhs(s5)).
  const s5 = addScaled(s, [k1, k2, k3, k4, k5, k6],
                       [A71, A72, A73, A74, A75, A76], h, t + h);
  // Error estimate (4th vs 5th).
  const k7 = flat(rhs(s5));
  let errSq = 0;
  for (let i = 0; i < 12; i++) {
    const e = E1*k1[i]! + E3*k3[i]! + E4*k4[i]! + E5*k5[i]! + E6*k6[i]! + E7*k7[i]!;
    const scale = h * e;
    errSq += scale * scale;
  }
  return { s5, errNorm: Math.sqrt(errSq / 12) };
}
