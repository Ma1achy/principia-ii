# M1 — CPU reference integrator (single trajectory, f64)

## Goal

A self-contained, pure-TypeScript integrator that produces the ground truth
every later GPU result is checked against. Includes KDK leapfrog with
adaptive substepping, optional Yoshida-4 / Yoshida-6 compositions, COM
projection, energy and L_z monitoring, collision and three-gate escape
detection.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/golden/burrau
```

The Burrau 3-4-5 rest start integrates to `T = 80` with relative energy drift
below `1e-7`, and the body identity that escapes matches the reference.

## File tree

```
principia/
  src/
    integrate/
      forces.ts
      com.ts
      kdk.ts
      yoshida.ts
      events.ts
      run.ts
      observe.ts
      types.ts
      index.ts
  test/
    unit/integrate/
      forces.test.ts
      com.test.ts
      kdk.test.ts
      yoshida.test.ts
      events.test.ts
    golden/
      burrau.test.ts
      burrau_345_reference.json
```

## `src/integrate/types.ts`

```ts
import type { TerminalLabel, TrajState, Triple, Vec2, Vec3 } from '@/math/types.js';

export type Force = Triple<Vec2>;

export interface SubstepParams {
  rSub:     number;     // distance scale for substepping trigger
  gammaSub: number;     // exponent
  NMax:     number;     // hard cap
}

export interface RunParams {
  dtMacro:   number;
  THorizon:  number;
  substep:   SubstepParams;
  rColl:     number;
  REsc:      number;
  kEsc:      number;
  integrator: 'kdk' | 'yoshida4' | 'yoshida6';
}

export interface RunResult {
  finalState:  TrajState;
  terminal:    TerminalLabel;
  diagnostics: Diagnostics;
  trace?:      TrajState[];        // optional checkpointed trace
}

export interface Diagnostics {
  E0:          number;
  Lz0:         number;
  energyDrift: number;             // |E(t_end) - E_0| / (|E_0| + ε)
  energyDriftAbsMax: number;       // max_t |E(t) - E_0|
  lzDrift:     number;
  lzDriftAbsMax: number;
  rMin:        number;
  rMinPair:    0 | 1 | 2;
  tEnd:        number;
  totalSubsteps: number;
  maxSubstepCount: number;
  encounters:  number;
}

export type { TerminalLabel, TrajState, Vec2, Vec3, Triple, Force };
```

## `src/integrate/forces.ts`

```ts
import type { Triple, Vec2, Vec3, Force } from './types.js';
import { G } from '@/math/constants.js';
import { v2 } from '@/math/vec.js';

/**
 * Pairwise gravitational force on each body. F_i = Σ_{j≠i} G m_i m_j (r_j - r_i)/|r_j-r_i|^3.
 *
 * Allocates one fresh array; the integrator's hot loop should reuse buffers
 * via the in-place variant below in production. For clarity, this version
 * is allocation-free in the inner numeric work.
 */
export function forces(m: Vec3, r: Triple<Vec2>): Force {
  let f0x = 0, f0y = 0, f1x = 0, f1y = 0, f2x = 0, f2y = 0;

  // pair (0, 1)
  {
    const dx = r[1][0] - r[0][0], dy = r[1][1] - r[0][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[0] * m[1] / r3;
    f0x += f * dx; f0y += f * dy;
    f1x -= f * dx; f1y -= f * dy;
  }
  // pair (0, 2)
  {
    const dx = r[2][0] - r[0][0], dy = r[2][1] - r[0][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[0] * m[2] / r3;
    f0x += f * dx; f0y += f * dy;
    f2x -= f * dx; f2y -= f * dy;
  }
  // pair (1, 2)
  {
    const dx = r[2][0] - r[1][0], dy = r[2][1] - r[1][1];
    const r2 = dx*dx + dy*dy;
    const r3 = r2 * Math.sqrt(r2);
    const f = G * m[1] * m[2] / r3;
    f1x += f * dx; f1y += f * dy;
    f2x -= f * dx; f2y -= f * dy;
  }
  return [v2(f0x, f0y), v2(f1x, f1y), v2(f2x, f2y)];
}

/** Minimum pair separation, with the index of the achieving pair. Pair codes:
 *  0 = (0,1), 1 = (0,2), 2 = (1,2). */
export function minPairSeparation(r: Triple<Vec2>): { d: number; pair: 0 | 1 | 2 } {
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  if (d01 <= d02 && d01 <= d12) return { d: d01, pair: 0 };
  if (d02 <= d12)               return { d: d02, pair: 1 };
  return { d: d12, pair: 2 };
}

/**
 * Total energy E = K + U. K = Σ |p|²/(2m). U = -G Σ_{i<j} m_i m_j / |r_i-r_j|.
 */
export function totalEnergy(m: Vec3, r: Triple<Vec2>, p: Triple<Vec2>): number {
  const K = (p[0][0]*p[0][0] + p[0][1]*p[0][1]) / (2*m[0])
          + (p[1][0]*p[1][0] + p[1][1]*p[1][1]) / (2*m[1])
          + (p[2][0]*p[2][0] + p[2][1]*p[2][1]) / (2*m[2]);
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  const U = - G*(m[0]*m[1]/d01 + m[0]*m[2]/d02 + m[1]*m[2]/d12);
  return K + U;
}

/** Angular momentum L_z = Σ m_i (x_i v_{y,i} - y_i v_{x,i})
 *                      = Σ (x_i p_{y,i} - y_i p_{x,i}). */
export function angularMomentum(r: Triple<Vec2>, p: Triple<Vec2>): number {
  return r[0][0]*p[0][1] - r[0][1]*p[0][0]
       + r[1][0]*p[1][1] - r[1][1]*p[1][0]
       + r[2][0]*p[2][1] - r[2][1]*p[2][0];
}
```

## `src/integrate/com.ts`

```ts
import type { TrajState, Triple, Vec2, Vec3 } from './types.js';

/**
 * Project to the COM frame: subtract the centre-of-mass position and the
 * total-momentum drift. The atlas already produces a COM-consistent
 * initial state; this is housekeeping that keeps f32 / f64 round-off from
 * reintroducing the redundant modes.
 *
 * Mathematically idempotent; numerically idempotent to within rounding.
 */
export function projectCOM(s: TrajState): TrajState {
  const m = s.m;
  const M = m[0] + m[1] + m[2];

  const Rx = (m[0]*s.r[0][0] + m[1]*s.r[1][0] + m[2]*s.r[2][0]) / M;
  const Ry = (m[0]*s.r[0][1] + m[1]*s.r[1][1] + m[2]*s.r[2][1]) / M;
  const Px = s.p[0][0] + s.p[1][0] + s.p[2][0];
  const Py = s.p[0][1] + s.p[1][1] + s.p[2][1];

  const r: Triple<Vec2> = [
    [s.r[0][0] - Rx, s.r[0][1] - Ry],
    [s.r[1][0] - Rx, s.r[1][1] - Ry],
    [s.r[2][0] - Rx, s.r[2][1] - Ry],
  ];
  const p: Triple<Vec2> = [
    [s.p[0][0] - Px * m[0]/M, s.p[0][1] - Py * m[0]/M],
    [s.p[1][0] - Px * m[1]/M, s.p[1][1] - Py * m[1]/M],
    [s.p[2][0] - Px * m[2]/M, s.p[2][1] - Py * m[2]/M],
  ];
  return { r, p, m, t: s.t };
}
```

## `src/integrate/kdk.ts`

```ts
import type { TrajState, Triple, Vec2, Vec3, Force } from './types.js';
import type { SubstepParams } from './types.js';
import { forces, minPairSeparation } from './forces.js';
import { projectCOM } from './com.js';

/**
 * Compute the substep count for the next macro step using the spec's
 * adaptive rule:
 *     N_sub = clamp(⌈ (r_sub / r_min)^γ ⌉, 1, N_max).
 */
export function substepCount(rMin: number, p: SubstepParams): number {
  const raw = Math.ceil(Math.pow(p.rSub / Math.max(rMin, 1e-30), p.gammaSub));
  return Math.min(p.NMax, Math.max(1, raw));
}

/**
 * One macro KDK step with adaptive substepping. COM projection runs once
 * per macro step (after the final half-kick), not per substep.
 *
 * Returns the new state plus telemetry for diagnostics.
 */
export function kdkMacroStep(
  s: TrajState, dtMacro: number, substepP: SubstepParams,
): { state: TrajState; nSub: number } {
  const rMin = minPairSeparation(s.r).d;
  const nSub = substepCount(rMin, substepP);
  const dt   = dtMacro / nSub;

  // Mutable copies for the substep loop. We deliberately keep this
  // monomorphic and allocation-light.
  const r0 = s.r[0][0], r1 = s.r[0][1];
  const r2 = s.r[1][0], r3 = s.r[1][1];
  const r4 = s.r[2][0], r5 = s.r[2][1];
  let R: [number,number,number,number,number,number] = [r0,r1,r2,r3,r4,r5];
  let P: [number,number,number,number,number,number] = [
    s.p[0][0], s.p[0][1], s.p[1][0], s.p[1][1], s.p[2][0], s.p[2][1],
  ];

  for (let sub = 0; sub < nSub; sub++) {
    let F = forcesFromFlat(s.m, R);
    P = kickFlat(P, F, dt / 2);
    R = driftFlat(R, P, s.m, dt);
    F = forcesFromFlat(s.m, R);
    P = kickFlat(P, F, dt / 2);
  }

  const newState: TrajState = {
    r: [[R[0], R[1]], [R[2], R[3]], [R[4], R[5]]],
    p: [[P[0], P[1]], [P[2], P[3]], [P[4], P[5]]],
    m: s.m, t: s.t + dtMacro,
  };
  return { state: projectCOM(newState), nSub };
}

/* --------- monomorphic helpers, kept private --------- */

type Flat6 = [number, number, number, number, number, number];

function forcesFromFlat(m: Vec3, R: Flat6): Flat6 {
  // Reuse the regular forces() to avoid duplicating the math.
  const r: Triple<Vec2> = [[R[0],R[1]], [R[2],R[3]], [R[4],R[5]]];
  const F = forces(m, r);
  return [F[0][0], F[0][1], F[1][0], F[1][1], F[2][0], F[2][1]];
}

function kickFlat(P: Flat6, F: Flat6, h: number): Flat6 {
  return [
    P[0] + h*F[0], P[1] + h*F[1],
    P[2] + h*F[2], P[3] + h*F[3],
    P[4] + h*F[4], P[5] + h*F[5],
  ];
}

function driftFlat(R: Flat6, P: Flat6, m: Vec3, h: number): Flat6 {
  return [
    R[0] + h*P[0]/m[0], R[1] + h*P[1]/m[0],
    R[2] + h*P[2]/m[1], R[3] + h*P[3]/m[1],
    R[4] + h*P[4]/m[2], R[5] + h*P[5]/m[2],
  ];
}
```

## `src/integrate/yoshida.ts`

```ts
import type { TrajState, Vec3 } from './types.js';
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
): { state: TrajState; nSub: number } {
  const a = kdkMacroStep(s,            W4_1 * dtMacro, sp);
  const b = kdkMacroStep(a.state,      W4_2 * dtMacro, sp);
  const c = kdkMacroStep(b.state,      W4_3 * dtMacro, sp);
  return { state: c.state, nSub: a.nSub + b.nSub + c.nSub };
}

/**
 * Yoshida 6th-order: seven KDK steps with palindromic weights from the
 * standard Solution A.
 */
const W6 = [
   0.78451361047755726382,
   0.23557321335935813368,
  -1.17767998417887100695,
   1.31518632068391121888,
  -1.17767998417887100695,
   0.23557321335935813368,
   0.78451361047755726382,
];

export function yoshida6MacroStep(
  s: TrajState, dtMacro: number, sp: SubstepParams,
): { state: TrajState; nSub: number } {
  let cur = s, total = 0;
  for (const w of W6) {
    const r = kdkMacroStep(cur, w * dtMacro, sp);
    cur = r.state;
    total += r.nSub;
  }
  return { state: cur, nSub: total };
}
```

## `src/integrate/events.ts`

```ts
import type { TrajState, TerminalLabel, Vec2, Vec3 } from './types.js';
import { dot2, scale2, sub2, add2, norm2 } from '@/math/vec.js';
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
```

## `src/integrate/observe.ts`

```ts
import type { TrajState } from './types.js';
import { totalEnergy, angularMomentum, minPairSeparation } from './forces.js';
import { EPS_ENERGY_FLOOR, EPS_LZ_FLOOR } from '@/math/constants.js';

/** Running diagnostics that update once per macro step. */
export class Observer {
  E0: number;
  Lz0: number;
  energyDriftAbsMax = 0;
  lzDriftAbsMax = 0;
  rMin: number;
  rMinPair: 0 | 1 | 2;
  totalSubsteps = 0;
  maxSubstepCount = 0;
  encounters = 0;

  constructor(s: TrajState) {
    this.E0  = totalEnergy(s.m, s.r, s.p);
    this.Lz0 = angularMomentum(s.r, s.p);
    const m = minPairSeparation(s.r);
    this.rMin = m.d;
    this.rMinPair = m.pair;
  }

  observe(s: TrajState, nSub: number, rCloseEncounter = 0.01) {
    const E  = totalEnergy(s.m, s.r, s.p);
    const Lz = angularMomentum(s.r, s.p);
    this.energyDriftAbsMax = Math.max(this.energyDriftAbsMax, Math.abs(E  - this.E0));
    this.lzDriftAbsMax     = Math.max(this.lzDriftAbsMax,     Math.abs(Lz - this.Lz0));
    const m = minPairSeparation(s.r);
    if (m.d < this.rMin) { this.rMin = m.d; this.rMinPair = m.pair; }
    if (m.d < rCloseEncounter) this.encounters++;
    this.totalSubsteps   += nSub;
    this.maxSubstepCount  = Math.max(this.maxSubstepCount, nSub);
  }

  finalDiagnostics(sFinal: TrajState) {
    const E  = totalEnergy(sFinal.m, sFinal.r, sFinal.p);
    const Lz = angularMomentum(sFinal.r, sFinal.p);
    const energyDrift = Math.abs(E  - this.E0)  / (Math.abs(this.E0)  + EPS_ENERGY_FLOOR);
    const lzDrift     = Math.abs(Lz - this.Lz0) / (Math.abs(this.Lz0) + EPS_LZ_FLOOR);
    return {
      E0: this.E0, Lz0: this.Lz0,
      energyDrift, lzDrift,
      energyDriftAbsMax: this.energyDriftAbsMax,
      lzDriftAbsMax: this.lzDriftAbsMax,
      rMin: this.rMin, rMinPair: this.rMinPair,
      tEnd: sFinal.t,
      totalSubsteps: this.totalSubsteps,
      maxSubstepCount: this.maxSubstepCount,
      encounters: this.encounters,
    };
  }
}
```

## `src/integrate/run.ts`

```ts
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
    let stepRes: { state: TrajState; nSub: number };
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
    obs.observe(s, stepRes.nSub);

    // MAX_SUBSTEPS persistence: declare terminal after a full macro step at the cap.
    if (stepRes.nSub >= params.substep.NMax) {
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
    if (!Number.isFinite(s.r[i][0]) || !Number.isFinite(s.r[i][1])) return false;
    if (!Number.isFinite(s.p[i][0]) || !Number.isFinite(s.p[i][1])) return false;
  }
  return true;
}
```

## `src/integrate/index.ts`

```ts
export * from './types.js';
export * from './forces.js';
export * from './com.js';
export * from './kdk.js';
export * from './yoshida.js';
export * from './events.js';
export * from './observe.js';
export * from './run.js';
```

## Tests

### `test/unit/integrate/forces.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { forces, totalEnergy, angularMomentum, minPairSeparation } from '@/integrate/forces.js';

describe('forces', () => {
  it('Newton third law: total force vanishes', () => {
    const m: [number,number,number] = [0.3, 0.3, 0.4];
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0], [1,0], [0.5, Math.sqrt(3)/2]];
    const F = forces(m, r);
    const sum = [F[0][0]+F[1][0]+F[2][0], F[0][1]+F[1][1]+F[2][1]];
    expect(sum[0]).toBeCloseTo(0, 14);
    expect(sum[1]).toBeCloseTo(0, 14);
  });

  it('points along the line between attracting bodies', () => {
    const m: [number,number,number] = [1/3, 1/3, 1/3];
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0], [1,0], [10,10]];                  // body 2 is far away
    const F = forces(m, r);
    // F_0 points along +x (toward body 1, plus tiny pull toward 2)
    expect(F[0][0]).toBeGreaterThan(0);
    expect(Math.abs(F[0][1])).toBeLessThan(F[0][0]);
  });
});

describe('totalEnergy', () => {
  it('rest start: E = U (negative)', () => {
    const m: [number,number,number] = [0.3, 0.3, 0.4];
    const r: [[number,number],[number,number],[number,number]] = [[0,0],[1,0],[0,1]];
    const p: [[number,number],[number,number],[number,number]] = [[0,0],[0,0],[0,0]];
    const E = totalEnergy(m, r, p);
    expect(E).toBeLessThan(0);
  });
});

describe('angularMomentum', () => {
  it('vanishes at rest start', () => {
    const m: [number,number,number] = [1/3, 1/3, 1/3];
    const r: [[number,number],[number,number],[number,number]] = [[0,0],[1,0],[0,1]];
    const p: [[number,number],[number,number],[number,number]] = [[0,0],[0,0],[0,0]];
    expect(angularMomentum(r, p)).toBe(0);
  });
});

describe('minPairSeparation', () => {
  it('reports the closest pair', () => {
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0],[10,0],[0.1,0]];
    const m = minPairSeparation(r);
    expect(m.pair).toBe(1);                 // (0, 2) in 0-indexed pair coding
    expect(m.d).toBeCloseTo(0.1, 12);
  });
});
```

### `test/unit/integrate/com.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { projectCOM } from '@/integrate/com.js';

describe('projectCOM', () => {
  it('removes COM offset and total momentum', () => {
    const s = {
      r: [[1,0],[2,1],[3,2]] as const,
      p: [[1,1],[1,1],[1,1]] as const,        // total p = (3,3) ≠ 0
      m: [0.3, 0.3, 0.4] as const, t: 0,
    };
    const out = projectCOM(s);
    const Rx = 0.3*out.r[0][0] + 0.3*out.r[1][0] + 0.4*out.r[2][0];
    const Ry = 0.3*out.r[0][1] + 0.3*out.r[1][1] + 0.4*out.r[2][1];
    const Px = out.p[0][0] + out.p[1][0] + out.p[2][0];
    const Py = out.p[0][1] + out.p[1][1] + out.p[2][1];
    expect(Rx).toBeCloseTo(0, 14);
    expect(Ry).toBeCloseTo(0, 14);
    expect(Px).toBeCloseTo(0, 14);
    expect(Py).toBeCloseTo(0, 14);
  });

  it('is idempotent', () => {
    const s = {
      r: [[1,0],[2,1],[3,2]] as const,
      p: [[1,1],[1,1],[1,1]] as const,
      m: [0.3, 0.3, 0.4] as const, t: 0,
    };
    const a = projectCOM(s);
    const b = projectCOM(a);
    for (let i = 0; i < 3; i++) {
      expect(b.r[i][0]).toBeCloseTo(a.r[i][0], 14);
      expect(b.r[i][1]).toBeCloseTo(a.r[i][1], 14);
      expect(b.p[i][0]).toBeCloseTo(a.p[i][0], 14);
      expect(b.p[i][1]).toBeCloseTo(a.p[i][1], 14);
    }
  });
});
```

### `test/unit/integrate/kdk.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { kdkMacroStep, substepCount } from '@/integrate/kdk.js';
import { totalEnergy } from '@/integrate/forces.js';
import { N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT } from '@/math/constants.js';

const sp = { rSub: R_SUB_DEFAULT, gammaSub: GAMMA_SUB_DEFAULT, NMax: N_MAX_DEFAULT };

describe('substepCount', () => {
  it('clamps to 1 at large r_min', () => {
    expect(substepCount(10, sp)).toBe(1);
  });
  it('saturates at N_max for very small r_min', () => {
    expect(substepCount(1e-6, sp)).toBe(N_MAX_DEFAULT);
  });
});

describe('kdkMacroStep', () => {
  it('two-body Kepler holds energy to better than 1e-8 over T = 100', () => {
    // Equal-mass binary on a circular orbit, third body at infinity-ish
    const m = [0.5, 0.5, 1e-12] as const;
    const r0 = 1, v0 = Math.sqrt(0.25 / 1);    // |v| for circular: G m_total / r
    const s = {
      r: [[ r0/2, 0], [-r0/2, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    const E0 = totalEnergy(m, s.r, s.p);
    let cur = s as any;
    const dt = 1e-2, T = 100;
    for (let t = 0; t < T; t += dt) {
      cur = kdkMacroStep(cur, dt, sp).state;
    }
    const E = totalEnergy(m, cur.r, cur.p);
    expect(Math.abs(E - E0) / Math.abs(E0)).toBeLessThan(1e-8);
  });
});
```

### `test/unit/integrate/yoshida.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { yoshida4MacroStep, yoshida6MacroStep } from '@/integrate/yoshida.js';
import { kdkMacroStep } from '@/integrate/kdk.js';
import { totalEnergy } from '@/integrate/forces.js';

const sp = { rSub: 0.05, gammaSub: 1.5, NMax: 64 };

const equalMassRing = () => ({
  m: [1/3, 1/3, 1/3] as const,
  r: [[1, 0], [-0.5, Math.sqrt(3)/2], [-0.5, -Math.sqrt(3)/2]] as const,
  p: [[0, 0], [0, 0], [0, 0]] as const,
  t: 0,
});

describe('Yoshida 4 / 6', () => {
  it('Y4 has lower long-horizon energy drift than KDK', () => {
    const s0 = equalMassRing();
    const E0 = totalEnergy(s0.m, s0.r, s0.p);
    let kdk = s0 as any, y4 = s0 as any;
    const dt = 1e-2, T = 5;
    for (let t = 0; t < T; t += dt) {
      kdk = kdkMacroStep(kdk, dt, sp).state;
      y4  = yoshida4MacroStep(y4, dt, sp).state;
    }
    const driftKdk = Math.abs(totalEnergy(kdk.m, kdk.r, kdk.p) - E0);
    const driftY4  = Math.abs(totalEnergy(y4.m,  y4.r,  y4.p)  - E0);
    expect(driftY4).toBeLessThan(driftKdk);
  });

  it('Y6 has lower drift than Y4 at the same step size on smooth orbits', () => {
    // Pick an orbit that doesn't go anywhere near collision so substepping
    // doesn't kick in and confuse the comparison.
    const s0 = {
      m: [0.5, 0.5, 1e-12] as const,
      r: [[1, 0], [-1, 0], [50, 0]] as const,
      p: [[0, 0.3], [0, -0.3], [0, 0]] as const,
      t: 0,
    };
    const E0 = totalEnergy(s0.m, s0.r, s0.p);
    let y4 = s0 as any, y6 = s0 as any;
    const dt = 1e-2, T = 50;
    for (let t = 0; t < T; t += dt) {
      y4 = yoshida4MacroStep(y4, dt, sp).state;
      y6 = yoshida6MacroStep(y6, dt, sp).state;
    }
    const dy4 = Math.abs(totalEnergy(y4.m, y4.r, y4.p) - E0);
    const dy6 = Math.abs(totalEnergy(y6.m, y6.r, y6.p) - E0);
    expect(dy6).toBeLessThan(dy4);
  });
});
```

### `test/unit/integrate/events.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tickEscapeGates, makeEscapeState, collisionCheck } from '@/integrate/events.js';

describe('collisionCheck', () => {
  it('fires at small r_min', () => {
    const s = {
      m: [1/3, 1/3, 1/3] as const,
      r: [[0, 0], [1e-5, 0], [10, 10]] as const,
      p: [[0,0],[0,0],[0,0]] as const, t: 0.4,
    };
    const term = collisionCheck(s, 1e-4);
    expect(term?.kind).toBe('COLLISION');
    if (term?.kind === 'COLLISION') {
      expect(term.pair).toBe(0);
      expect(term.t).toBe(0.4);
    }
  });

  it('does not fire when bodies are well separated', () => {
    const s = {
      m: [1/3,1/3,1/3] as const,
      r: [[0,0],[1,0],[0,1]] as const, p: [[0,0],[0,0],[0,0]] as const, t: 0,
    };
    expect(collisionCheck(s, 1e-4)).toBeNull();
  });
});

describe('escape persistence', () => {
  it('requires k_esc consecutive on-frames before declaring escape', () => {
    // Body 2 receding outward fast; bodies 0,1 nearby.
    const m = [1/3,1/3,1/3] as const;
    let s = {
      r: [[0,0],[0.5,0],[20,0]] as const,
      p: [[0,0],[0,0],[5,0]] as const,
      m, t: 0,
    };
    const st = makeEscapeState();
    // Single tick should not fire.
    expect(tickEscapeGates(s, st, 10, 8).fired).toBe(false);
    // Eight ticks at the same configuration should.
    let last = false;
    for (let i = 0; i < 8; i++) {
      last = tickEscapeGates(s, st, 10, 8).fired;
    }
    expect(last).toBe(true);
  });

  it('decay: a single off-frame walks the counter back', () => {
    const m = [1/3,1/3,1/3] as const;
    const sFar = {
      r: [[0,0],[0.5,0],[20,0]] as const,
      p: [[0,0],[0,0],[5,0]] as const,
      m, t: 0,
    };
    const sNear = {
      r: [[0,0],[0.5,0],[0.1,0]] as const,            // body 2 came back close
      p: [[0,0],[0,0],[0,0]] as const,
      m, t: 0,
    };
    const st = makeEscapeState();
    for (let i = 0; i < 5; i++) tickEscapeGates(sFar, st, 10, 8);
    expect(st.counters[2]).toBe(5);
    tickEscapeGates(sNear, st, 10, 8);
    expect(st.counters[2]).toBe(4);
  });
});
```

### Burrau golden test

The 3-4-5 Burrau rest start is well-studied. The published reference outcome
is that body 1 (the lightest, opposite the longest leg) escapes after a
sequence of close encounters around `t ≈ 60`, leaving bodies 0 and 2 in a
binary. We pin a shorter-horizon golden file with the position of each body
at fixed checkpoint times so failures localise quickly.

Generate the reference file once with a high-precision integrator (Yoshida 6
at `dt = 1e-4`), then commit it.

#### `test/golden/burrau_345_reference.json`

```json
{
  "ic": {
    "m": [0.41666666666666669, 0.33333333333333331, 0.25],
    "r_classical": [[0, 0], [0.8, 0], [0, 0.6]],
    "comment": "Burrau classical 1-indexed: body 1 at right angle (mass=c/Σ), body 2 at (a/c, 0) (mass=b/Σ), body 3 at (0, b/c) (mass=a/Σ). For (a,b,c)=(3,4,5): m=(5/12, 4/12, 3/12). Re-indexed to 0-indexed for our pipeline."
  },
  "params": {
    "integrator": "yoshida6",
    "dt": 1e-4,
    "rColl": 1e-4,
    "REsc": 10,
    "kEsc": 8,
    "THorizon": 80,
    "rSub": 0.05,
    "gammaSub": 1.5,
    "NMax": 256
  },
  "checkpoints": [
    { "t": 10, "r0": [-0.34, -0.16], "r1": [0.45, -0.10], "r2": [-0.05,  0.51] },
    { "t": 20, "r0": [-0.17, -0.31], "r1": [0.30,  0.05], "r2": [-0.11,  0.45] },
    { "t": 40, "r0": [-0.08, -0.42], "r1": [0.04,  0.46], "r2": [ 0.10,  0.04] },
    { "t": 60, "r0": [-0.01, -0.55], "r1": [0.15, -0.18], "r2": [-0.13,  1.05] }
  ],
  "expected_terminal": { "kind": "ESCAPE", "body": 1 },
  "energy_drift_max": 1e-7,
  "tolerance_position": 0.02
}
```

Notes on the reference file: the checkpoint positions are illustrative
shapes (the actual numbers should be regenerated against your own
high-precision run when you first land M1). The point of committing the
file is that any future change to the integrator that shifts these positions
beyond `tolerance_position` is caught immediately.

#### `test/golden/burrau.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from '@/integrate/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(path.join(here, 'burrau_345_reference.json'),
                                    'utf-8'));

describe('Burrau 3-4-5 golden', () => {
  it('reproduces the published outcome to within tolerance', () => {
    const m = REF.ic.m as [number, number, number];
    const r = REF.ic.r_classical as [[number,number],[number,number],[number,number]];
    const s0 = { m, r, p: [[0,0],[0,0],[0,0]] as const, t: 0 };

    const result = run(s0 as any, {
      integrator: REF.params.integrator,
      dtMacro: REF.params.dt,
      THorizon: REF.params.THorizon,
      rColl: REF.params.rColl,
      REsc: REF.params.REsc,
      kEsc: REF.params.kEsc,
      substep: { rSub: REF.params.rSub,
                 gammaSub: REF.params.gammaSub,
                 NMax: REF.params.NMax },
    }, { checkpoints: 200 });

    // 1. Energy drift bound
    expect(result.diagnostics.energyDrift)
      .toBeLessThan(REF.energy_drift_max);

    // 2. Terminal class agreement
    expect(result.terminal.kind).toBe(REF.expected_terminal.kind);
    if (result.terminal.kind === 'ESCAPE') {
      expect(result.terminal.body).toBe(REF.expected_terminal.body);
    }

    // 3. Checkpoint position agreement (linear interp from the trace)
    const trace = result.trace!;
    for (const cp of REF.checkpoints) {
      const interp = interpolateAtT(trace, cp.t);
      if (!interp) continue;       // checkpoint past terminal — skip
      for (const k of [0, 1, 2] as const) {
        const dx = interp.r[k][0] - cp[`r${k}`][0];
        const dy = interp.r[k][1] - cp[`r${k}`][1];
        expect(Math.hypot(dx, dy)).toBeLessThan(REF.tolerance_position);
      }
    }
  });
});

function interpolateAtT(trace: any[], t: number) {
  for (let i = 0; i < trace.length - 1; i++) {
    if (trace[i].t <= t && trace[i+1].t >= t) {
      const a = trace[i], b = trace[i+1];
      const u = (t - a.t) / (b.t - a.t);
      return {
        r: [
          [a.r[0][0]*(1-u) + b.r[0][0]*u, a.r[0][1]*(1-u) + b.r[0][1]*u],
          [a.r[1][0]*(1-u) + b.r[1][0]*u, a.r[1][1]*(1-u) + b.r[1][1]*u],
          [a.r[2][0]*(1-u) + b.r[2][0]*u, a.r[2][1]*(1-u) + b.r[2][1]*u],
        ],
      };
    }
  }
  return null;
}
```

## Run it

```bash
npm test -- --run test/unit/integrate
npm test -- --run test/golden/burrau
```

## Acceptance check

`test/golden/burrau.test.ts` passes: energy drift is below `1e-7`, the
terminal label is `ESCAPE` for body 1, and all four checkpoint positions
agree with the reference to within 0.02 in dimensionless units.

## Notes for the implementer

- **Generating the reference file.** The committed positions in
  `burrau_345_reference.json` are placeholder targets. On first implementation,
  run Yoshida 6 at `dt = 1e-4` and capture the actual positions, then commit
  that as the reference. Subsequent changes that drift outside the tolerance
  become diff-visible.
- **Subseptcount parameter.** `NMax = 256` for the golden test rather than
  the spec default of 64. The Burrau encounters are tighter than typical and
  the goal here is to nail the reference, not to test the saturation cap.
  Production rendering uses 64.
- **Integrator family choice for the gate.** Use Yoshida 6 in the golden test
  even though the GPU pipeline runs KDK in Preview tier. The test is checking
  the reference, not the production speed/accuracy trade-off.
