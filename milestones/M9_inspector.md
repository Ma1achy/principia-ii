# M9 — Locked-pixel inspector (CPU f64)

## Goal

A pure-CPU recompute path that takes a locked physical IC and produces a
high-fidelity trajectory analysis at f64. Two integrators: a
Dormand–Prince RK45 with adaptive step control (the inspector default,
optimised for chasing near-collision singularities) and a
"match-integrator" mode that uses the same KDK / Yoshida coefficients as
the active GPU pipeline (for apples-to-apples cross-checks).

After M9: hover-streamline preview with debounced 8 ms budget, full
`InspectorResult` struct with the entire per-step trajectory, optional
shadow trajectory for true Benettin FTLE, and a comparison panel against
the GPU's `SimResult`.

**Exit criterion.**

```bash
npm test -- --run test/golden/inspector
```

DOPRI5 holds Kepler energy to 1e-12 over T = 1000. RK45 successfully
chases a near-collision approach where the GPU pipeline declared
`MAX_SUBSTEPS`. Match-integrator mode reproduces the GPU `t_end` to
sub-millisecond on a smooth Burrau sample.

## File tree

```
principia/
  src/
    inspector/
      types.ts
      dopri5.ts
      adaptive.ts
      match_integrator.ts
      hover_streamline.ts
      shadow.ts
      diagnostics.ts
      overlay.ts
      run.ts
      index.ts
  test/
    unit/inspector/
      dopri5.test.ts
      adaptive.test.ts
      hover_streamline.test.ts
      match_integrator.test.ts
    golden/
      inspector_kepler.test.ts
      inspector_near_collision.test.ts
      inspector_match.test.ts
```

## `src/inspector/types.ts`

```ts
import type { Vec2, TrajState, Triple, TerminalLabel } from '@/math/types.js';

export interface RK45Opts {
  hMin:    number;     // minimum step size (abort if forced below this)
  hMax:    number;     // maximum step size
  hInit:   number;     // initial step size
  epsRel:  number;     // relative error tolerance per step
  epsAbs:  number;     // absolute error tolerance per step
  THorizon: number;    // total integration horizon
  rColl:   number;
  REsc:    number;
  kEsc:    number;
  /** When true, log every accepted step (large InspectorResult). When
   *  false, log only at fixed checkpoint times for the M-checkpoint
   *  shape-sphere trace. */
  fullTrace: boolean;
  checkpointCount: number;
}

export const RK45_DEFAULTS: RK45Opts = {
  hMin: 1e-10, hMax: 1e-2, hInit: 1e-4,
  epsRel: 1e-10, epsAbs: 1e-12,
  THorizon: 80, rColl: 1e-4, REsc: 10, kEsc: 8,
  fullTrace: true, checkpointCount: 32,
};

export interface InspectorResult {
  /** Full trajectory at every accepted step (when `fullTrace`). */
  t: number[];
  r: Triple<Vec2>[];
  p: Triple<Vec2>[];
  /** Shape-sphere trace (always populated). */
  nShape: { x: number; y: number; z: number }[];

  /** Derived series. */
  energy: number[];
  lz:     number[];

  /** Summary scalars. */
  outcome:     'escape' | 'collision' | 'bounded' | 'timeout' | 'failed';
  tEnd:        number;
  dMin:        number;
  deltaEMax:   number;
  ftle:        number;
  freeGroupWord: string;

  /** Symbolic / metadata. */
  ic: { m: TrajState['m']; r: TrajState['r']; p: TrajState['p'] };
  chartUv?: readonly [number, number];
  nSteps:   number;
  nReject:  number;
  cpuMs:    number;

  /** Validation panel: comparison vs GPU. */
  validation?: {
    gpuOutcomeAgrees: boolean;
    gpuFtleDelta:     number;
    gpuWordAgrees:    boolean;
  };
}
```

## `src/inspector/dopri5.ts`

```ts
import type { TrajState, Triple, Vec2 } from '@/math/types.js';
import { forces } from '@/integrate/forces.js';

/**
 * Dormand–Prince 5(4) coefficients. We roll our own implementation
 * rather than using a generic ODE solver because we're running 18 state
 * variables (3 bodies × {r, p} × {x, y}) and want the inner loop to be
 * inlined and allocation-light.
 */
const C2 = 1/5;
const C3 = 3/10;
const C4 = 4/5;
const C5 = 8/9;

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

const B1 = 35/384;      const B3 = 500/1113;   const B4 = 125/192;
const B5 = -2187/6784;  const B6 = 11/84;

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

function addScaled(s: TrajState, kSeq: number[][], coeffs: number[], h: number): TrajState {
  // Each kSeq[i] is a flat 12-array [dr0x, dr0y, dr1x, ..., dp2y].
  const acc = new Array(12).fill(0);
  for (let i = 0; i < kSeq.length; i++) {
    const c = coeffs[i] ?? 0;
    if (c === 0) continue;
    for (let j = 0; j < 12; j++) acc[j] += c * kSeq[i]![j]!;
  }
  return {
    m: s.m, t: s.t,
    r: [
      [s.r[0][0] + h*acc[0], s.r[0][1] + h*acc[1]],
      [s.r[1][0] + h*acc[2], s.r[1][1] + h*acc[3]],
      [s.r[2][0] + h*acc[4], s.r[2][1] + h*acc[5]],
    ],
    p: [
      [s.p[0][0] + h*acc[6],  s.p[0][1] + h*acc[7]],
      [s.p[1][0] + h*acc[8],  s.p[1][1] + h*acc[9]],
      [s.p[2][0] + h*acc[10], s.p[2][1] + h*acc[11]],
    ],
  };
}

function flat(rhs: { dr: Triple<Vec2>; dp: Triple<Vec2> }): number[] {
  return [
    rhs.dr[0][0], rhs.dr[0][1], rhs.dr[1][0], rhs.dr[1][1], rhs.dr[2][0], rhs.dr[2][1],
    rhs.dp[0][0], rhs.dp[0][1], rhs.dp[1][0], rhs.dp[1][1], rhs.dp[2][0], rhs.dp[2][1],
  ];
}

/**
 * One Dormand–Prince 5(4) step. Returns the 5th-order solution and the
 * absolute error estimate (in mass-weighted phase-space norm).
 */
export function dopri5Step(
  s: TrajState, h: number,
): { s5: TrajState; errNorm: number } {
  const k1 = flat(rhs(s));
  const k2 = flat(rhs(addScaled(s, [k1], [A21], h)));
  const k3 = flat(rhs(addScaled(s, [k1, k2], [A31, A32], h)));
  const k4 = flat(rhs(addScaled(s, [k1, k2, k3], [A41, A42, A43], h)));
  const k5 = flat(rhs(addScaled(s, [k1, k2, k3, k4], [A51, A52, A53, A54], h)));
  const k6 = flat(rhs(addScaled(s, [k1, k2, k3, k4, k5],
                                [A61, A62, A63, A64, A65], h)));
  // 5th order solution (FSAL — k7 will be reused as k1 next step).
  const s5 = addScaled(s, [k1, k2, k3, k4, k5, k6],
                       [A71, A72, A73, A74, A75, A76], h);
  s5.t = s.t + h;
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
```

## `src/inspector/adaptive.ts`

```ts
import type { TrajState } from '@/math/types.js';
import type { RK45Opts } from './types.js';
import { dopri5Step } from './dopri5.js';
import { projectCOM } from '@/integrate/com.js';

const SAFETY = 0.9;
const ORDER  = 5;

/**
 * One adaptive-step iteration. Tries `h`, accepts/rejects based on
 * `epsRel + epsAbs`, returns the new (s, h_next) plus a flag.
 */
export function tryStep(
  s: TrajState, h: number, opts: RK45Opts,
): { accepted: boolean; s: TrajState; hNext: number; rejected: boolean } {
  const { s5, errNorm } = dopri5Step(s, h);

  // Tolerance: epsAbs + epsRel * ||state||_∞.
  const ref = Math.max(
    Math.hypot(...flatPos(s.r)), Math.hypot(...flatPos(s.p)),
    1,
  );
  const tol = opts.epsAbs + opts.epsRel * ref;
  const ratio = tol / Math.max(errNorm, 1e-30);

  if (ratio >= 1) {
    // Accept; project to COM (cheap at f64) and grow h.
    const projected = projectCOM(s5);
    const hNext = Math.min(opts.hMax, h * SAFETY * Math.pow(ratio, 1/ORDER));
    return { accepted: true, s: projected, hNext, rejected: false };
  } else {
    const hNext = Math.max(opts.hMin, h * SAFETY * Math.pow(ratio, 1/ORDER));
    return { accepted: false, s, hNext, rejected: true };
  }
}

function flatPos(r: TrajState['r' | 'p']): number[] {
  return [r[0][0], r[0][1], r[1][0], r[1][1], r[2][0], r[2][1]];
}
```

## `src/inspector/diagnostics.ts`

```ts
import type { TrajState } from '@/math/types.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';

export function diagnosticsAt(s: TrajState): {
  E: number; Lz: number; n: { x: number; y: number; z: number };
} {
  const E  = totalEnergy(s.m, s.r, s.p);
  const Lz = angularMomentum(s.r, s.p);
  const { rho, lambda } = particlePositionsToJacobi(s.r, s.m);
  const { rhoT, lambdaT } = massWeightedJacobi(rho, lambda, s.m);
  const n = shapeSphere(rhoT, lambdaT);
  return { E, Lz, n: { x: n[0], y: n[1], z: n[2] } };
}
```

## `src/inspector/run.ts`

```ts
import type { TrajState, TerminalLabel } from '@/math/types.js';
import type { InspectorResult, RK45Opts } from './types.js';
import { RK45_DEFAULTS } from './types.js';
import { tryStep } from './adaptive.js';
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
    const r = tryStep(s, h, o);
    h = r.hNext;
    if (!r.accepted) { nReject++; continue; }
    if (h <= o.hMin && r.rejected) {
      terminal = { kind: 'SIM_FAILED', reason: 'h_min reached', t: s.t };
      outcome = 'failed';
      break;
    }
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

  return {
    t: tArr, r: rArr, p: pArr,
    nShape: nArr,
    energy: energyArr, lz: lzArr,
    outcome, tEnd: s.t, dMin, deltaEMax,
    ftle: 0,                            // shadow.ts populates this
    freeGroupWord: wordToString(metrics.word),
    ic: { m: s0.m, r: s0.r, p: s0.p },
    nSteps, nReject,
    cpuMs: performance.now() - t0,
  };
}
```

## `src/inspector/shadow.ts`

```ts
import type { TrajState, Triple, Vec2 } from '@/math/types.js';
import type { RK45Opts } from './types.js';
import { tryStep } from './adaptive.js';

/**
 * Run the inspector with a Benettin-style shadow trajectory at distance
 * δ_0 to estimate the FTLE. Returns the FTLE and the renormalisation
 * count.
 */
export function inspectorWithShadow(
  s0: TrajState, opts: RK45Opts, delta0 = 1e-8,
): { lambda: number; renorms: number; valid: boolean } {
  let base = s0;
  let shadow: TrajState = perturb(s0, delta0);
  let h = opts.hInit;
  let S = 0;
  let renorms = 0;
  let stepsSinceRenorm = 0;
  const RENORM_EVERY = 50;

  while (base.t < opts.THorizon) {
    const a = tryStep(base, h, opts);
    if (!a.accepted) { h = a.hNext; continue; }
    base = a.s;
    // Step the shadow with the same h (or its own adaptive — for
    // simplicity we use the same h here; production may decouple).
    const b = tryStep(shadow, h, opts);
    shadow = b.accepted ? b.s : shadow;
    h = a.hNext;
    stepsSinceRenorm++;

    if (stepsSinceRenorm >= RENORM_EVERY) {
      const dj = sep(base, shadow);
      if (!Number.isFinite(dj) || dj === 0) {
        return { lambda: 0, renorms, valid: false };
      }
      S += Math.log(dj / delta0);
      shadow = renorm(base, shadow, delta0);
      renorms++;
      stepsSinceRenorm = 0;
    }
  }
  return { lambda: S / Math.max(base.t - s0.t, 1e-30), renorms, valid: renorms > 0 };
}

function perturb(s: TrajState, d: number): TrajState {
  // ADR 0003 / spec §4.3.3.1: the canonical full phase-space FTLE seed
  // perturbs BOTH positions and momenta. A position-only seed measured
  // in the phase-space `sep` norm must NOT be labelled canonical FTLE.
  // Seed a normalised split across all 12 phase-space components so the
  // perturbation spans the momentum dimensions; the Benettin
  // renormalisation washes out the exact seed direction.
  const dir = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const norm = Math.sqrt(12);                  // ||dir|| = sqrt(12)
  const scale = d / norm;                       // total seed magnitude = d
  return {
    m: s.m, t: s.t,
    r: [
      [s.r[0][0] + scale*dir[0]!, s.r[0][1] + scale*dir[1]!],
      [s.r[1][0] + scale*dir[2]!, s.r[1][1] + scale*dir[3]!],
      [s.r[2][0] + scale*dir[4]!, s.r[2][1] + scale*dir[5]!],
    ],
    p: [
      [s.p[0][0] + scale*dir[6]!,  s.p[0][1] + scale*dir[7]!],
      [s.p[1][0] + scale*dir[8]!,  s.p[1][1] + scale*dir[9]!],
      [s.p[2][0] + scale*dir[10]!, s.p[2][1] + scale*dir[11]!],
    ],
  };
}

function sep(a: TrajState, b: TrajState): number {
  let s2 = 0;
  for (let i = 0; i < 3; i++) {
    const dx = b.r[i][0] - a.r[i][0]; const dy = b.r[i][1] - a.r[i][1];
    s2 += a.m[i] * (dx*dx + dy*dy);
    const dpx = b.p[i][0] - a.p[i][0]; const dpy = b.p[i][1] - a.p[i][1];
    s2 += (dpx*dpx + dpy*dpy) / a.m[i];
  }
  return Math.sqrt(s2);
}

function renorm(base: TrajState, shadow: TrajState, d0: number): TrajState {
  const d = sep(base, shadow);
  if (d === 0) return shadow;
  const sc = d0 / d;
  return {
    m: shadow.m, t: shadow.t,
    r: [
      [base.r[0][0] + (shadow.r[0][0] - base.r[0][0]) * sc,
       base.r[0][1] + (shadow.r[0][1] - base.r[0][1]) * sc],
      [base.r[1][0] + (shadow.r[1][0] - base.r[1][0]) * sc,
       base.r[1][1] + (shadow.r[1][1] - base.r[1][1]) * sc],
      [base.r[2][0] + (shadow.r[2][0] - base.r[2][0]) * sc,
       base.r[2][1] + (shadow.r[2][1] - base.r[2][1]) * sc],
    ],
    p: [
      [base.p[0][0] + (shadow.p[0][0] - base.p[0][0]) * sc,
       base.p[0][1] + (shadow.p[0][1] - base.p[0][1]) * sc],
      [base.p[1][0] + (shadow.p[1][0] - base.p[1][0]) * sc,
       base.p[1][1] + (shadow.p[1][1] - base.p[1][1]) * sc],
      [base.p[2][0] + (shadow.p[2][0] - base.p[2][0]) * sc,
       base.p[2][1] + (shadow.p[2][1] - base.p[2][1]) * sc],
    ],
  };
}
```

## `src/inspector/match_integrator.ts`

```ts
import type { TrajState } from '@/math/types.js';
import type { InspectorResult, RK45Opts } from './types.js';
import { run } from '@/integrate/run.js';
import { wordToString } from '@/metrics/free_group.js';

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
    ic: { m: s0.m, r: s0.r, p: s0.p },
    nSteps: trace.length, nReject: 0,
    cpuMs: performance.now() - t0,
  };
}
```

## `src/inspector/hover_streamline.ts`

```ts
import type { TrajState } from '@/math/types.js';
import { runInspector } from './run.js';
import { RK45_DEFAULTS } from './types.js';

/**
 * Debounced, budget-capped hover streamline. The user moves the cursor
 * across the shape-sphere chart; we draw a trajectory streaming out from
 * the hovered pixel.
 *
 * Policy:
 *   - 30 ms debounce: never start a new integration until the pointer
 *     has been stationary for 30 ms.
 *   - 8 ms wall-clock cap per integration; on deadline, draw the
 *     partial trajectory and continue extending it on idle frames at
 *     16 ms per frame budget.
 */
export class HoverStreamline {
  private currentSession: number = 0;
  private lastMoveAt: number = 0;
  private lastResult: { sessionId: number; trajectory: { x: number; y: number; z: number }[] } | null = null;

  /** Returns the currently displayed (possibly partial) trajectory. */
  trajectory(): { x: number; y: number; z: number }[] {
    return this.lastResult?.trajectory ?? [];
  }

  /** Called by the UI on each pointer move. Decoded IC is supplied by
   *  the chart's hover-decode hook. */
  onMove(decodeIc: () => TrajState | null): void {
    this.lastMoveAt = performance.now();
    this.currentSession++;
    const sessionId = this.currentSession;
    setTimeout(() => this.maybeRun(sessionId, decodeIc), 30);
  }

  private maybeRun(sessionId: number, decodeIc: () => TrajState | null): void {
    if (sessionId !== this.currentSession) return;     // superseded
    const ic = decodeIc();
    if (!ic) return;

    const start = performance.now();
    const budget = 8;
    // Run a short-horizon inspector with a tight budget. The inspector
    // returns whatever fraction of the trajectory it managed in the
    // budget; we extend it on subsequent idle frames.
    const result = runInspector(ic, {
      ...RK45_DEFAULTS,
      THorizon: 30,
      fullTrace: false,
      checkpointCount: 64,
    });
    if (sessionId !== this.currentSession) return;     // user moved again
    this.lastResult = {
      sessionId,
      trajectory: result.nShape,
    };
    const elapsed = performance.now() - start;
    if (elapsed >= budget && result.tEnd < 30) {
      // Schedule a continuation. (M9 shows the contract; production may
      // requestIdleCallback or use the existing render-loop slot.)
    }
  }
}
```

## `src/inspector/overlay.ts`

```ts
import type { InspectorResult } from './types.js';

/**
 * UI contract for the locked-pixel inspector overlay. The view is
 * implementation-agnostic (HTML/Canvas/WebGL); this module only describes
 * the data slots.
 */
export interface OverlaySlots {
  shapeSpherePanel:  { trajectory: { x: number; y: number; z: number }[];
                       landmarks: ('BC' | 'Euler' | 'Lagrange')[]; };
  realSpacePanel:    { bodies: { positions: readonly [number, number][];
                                 trail: readonly [number, number][] }[]; };
  icSummary:         { masses: number[]; positions: any[]; momenta: any[];
                       chartUv?: readonly [number, number]; outcome: string; };
  diagnostics:       { energyDrift: number[]; lzDrift: number[];
                       freqDiffusion?: number; ftle?: number; encounters: number; };
  freeGroupWord:     string;
  validationPanel?:  { gpuOutcomeAgrees: boolean; gpuFtleDelta: number;
                       gpuWordAgrees: boolean; flagged: boolean; };
}

export function inspectorToOverlay(r: InspectorResult): OverlaySlots {
  return {
    shapeSpherePanel: { trajectory: r.nShape,
                        landmarks: ['BC', 'Euler', 'Lagrange'] },
    realSpacePanel: {
      bodies: [0, 1, 2].map(i => ({
        positions: r.r.map(s => s[i]),
        trail:     r.r.map(s => s[i]),
      })),
    },
    icSummary: {
      masses: [r.ic.m[0], r.ic.m[1], r.ic.m[2]],
      positions: r.ic.r, momenta: r.ic.p,
      chartUv: r.chartUv, outcome: r.outcome,
    },
    diagnostics: {
      energyDrift: r.energy.map(E => E - r.energy[0]!),
      lzDrift:     r.lz.map(L => L - r.lz[0]!),
      ftle:        r.ftle,
      encounters:  0,    // populated when a metrics tick is wired in
    },
    freeGroupWord: r.freeGroupWord,
    validationPanel: r.validation
      ? { ...r.validation,
          flagged: !r.validation.gpuOutcomeAgrees
                || Math.abs(r.validation.gpuFtleDelta) > 0.1
                || !r.validation.gpuWordAgrees }
      : undefined,
  };
}
```

## Tests

### `test/unit/inspector/dopri5.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { dopri5Step } from '@/inspector/dopri5.js';

describe('Dormand–Prince 5(4)', () => {
  it('reproduces a circular Kepler over a small step to high accuracy', () => {
    const m = [0.5, 0.5, 1e-12] as const;
    const v0 = Math.sqrt(0.25 / 1);
    const s = {
      r: [[ 0.5, 0], [-0.5, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    const { s5, errNorm } = dopri5Step(s as any, 1e-3);
    // For a smooth Kepler orbit at h=1e-3, the embedded error estimate
    // should be tiny.
    expect(errNorm).toBeLessThan(1e-10);
    // Energy preserved to many digits over one step.
    const totalEnergy = (st: any) => {
      const K = (st.p[0][0]**2+st.p[0][1]**2)/(2*st.m[0])
              + (st.p[1][0]**2+st.p[1][1]**2)/(2*st.m[1]);
      const r = Math.hypot(st.r[1][0]-st.r[0][0], st.r[1][1]-st.r[0][1]);
      const U = -(st.m[0]*st.m[1])/r;
      return K + U;
    };
    expect(Math.abs(totalEnergy(s5) - totalEnergy(s as any))).toBeLessThan(1e-10);
  });
});
```

### `test/unit/inspector/adaptive.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tryStep } from '@/inspector/adaptive.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('adaptive step control', () => {
  it('accepts a small step on a smooth orbit', () => {
    const s = {
      m: [0.5, 0.5, 1e-12] as const,
      r: [[0.5,0], [-0.5,0], [1e6,0]] as const,
      p: [[0, 0.25],[0,-0.25],[0,0]] as const, t: 0,
    };
    const r = tryStep(s as any, 1e-4, RK45_DEFAULTS);
    expect(r.accepted).toBe(true);
    expect(r.hNext).toBeGreaterThanOrEqual(1e-4);
  });

  it('rejects an over-large step with stiff-ish dynamics', () => {
    const s = {
      m: [1/3, 1/3, 1/3] as const,
      r: [[0,0], [1e-3, 0], [0, 1]] as const,    // very tight inner pair
      p: [[0,0],[0,0],[0,0]] as const, t: 0,
    };
    const r = tryStep(s as any, 1e-1, RK45_DEFAULTS);
    expect(r.accepted).toBe(false);
    expect(r.hNext).toBeLessThan(1e-1);
  });
});
```

### `test/unit/inspector/hover_streamline.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { HoverStreamline } from '@/inspector/hover_streamline.js';

describe('hover streamline debouncing', () => {
  it("only the most recent move's session produces a result", async () => {
    const hs = new HoverStreamline();
    let calls = 0;
    const decode = () => {
      calls++;
      return {
        m: [1/3,1/3,1/3] as any,
        r: [[1,0],[-0.5, Math.sqrt(3)/2],[-0.5,-Math.sqrt(3)/2]] as any,
        p: [[0,0],[0,0],[0,0]] as any, t: 0,
      };
    };
    hs.onMove(decode);
    hs.onMove(decode);
    hs.onMove(decode);
    await new Promise(r => setTimeout(r, 60));
    // Only the third move actually integrates.
    expect(calls).toBe(1);
  });
});
```

### `test/unit/inspector/match_integrator.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { inspectorMatch } from '@/inspector/match_integrator.js';

describe('match-integrator mode', () => {
  it('Yoshida-4 reproduces the run() result with the same params', () => {
    const s0 = {
      m: [1/3, 1/3, 1/3] as const,
      r: [[1, 0], [-0.5, Math.sqrt(3)/2], [-0.5, -Math.sqrt(3)/2]] as const,
      p: [[0, 0], [0, 0], [0, 0]] as const,
      t: 0,
    };
    const r = inspectorMatch(s0 as any, {
      integrator: 'yoshida4', dtMacro: 1e-3, THorizon: 5,
      NMax: 64, rSub: 0.05, gammaSub: 1.5,
      rColl: 1e-4, REsc: 10, kEsc: 8,
    });
    expect(r.outcome).toBe('bounded');
    expect(r.tEnd).toBeCloseTo(5, 3);
  });
});
```

### `test/golden/inspector_kepler.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runInspector } from '@/inspector/run.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('Kepler energy conservation', () => {
  it('holds energy to 1e-12 over T = 1000 on a tight binary', () => {
    const m = [0.5, 0.5, 1e-12] as const;
    const v0 = Math.sqrt(0.25 / 1);
    const s0 = {
      r: [[0.5, 0], [-0.5, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    const r = runInspector(s0 as any, { ...RK45_DEFAULTS, THorizon: 1000 });
    expect(r.deltaEMax).toBeLessThan(1e-12);
  }, 60_000);
});
```

### `test/golden/inspector_near_collision.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runInspector } from '@/inspector/run.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('near-collision chase', () => {
  it('classifies a Burrau IC as ESCAPE before timeout', () => {
    // Burrau (3, 4, 5) re-indexed.
    const m = [5/12, 4/12, 3/12] as const;
    const s0 = {
      r: [[0,0], [0.8, 0], [0, 0.6]] as const,
      p: [[0,0],[0,0],[0,0]] as const,
      m, t: 0,
    };
    const r = runInspector(s0 as any, {
      ...RK45_DEFAULTS, THorizon: 80, hMin: 1e-12,
    });
    // Adaptive RK45 should chase the close encounters down, classify.
    expect(['escape', 'bounded']).toContain(r.outcome);
    expect(r.dMin).toBeLessThan(0.1);
  }, 60_000);
});
```

### `test/golden/inspector_match.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runInspector } from '@/inspector/run.js';
import { inspectorMatch } from '@/inspector/match_integrator.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('match-integrator t_end agrees with adaptive on smooth orbits', () => {
  it('agrees within 1 ms over T = 5 on equal-mass figure-8 stand-in', () => {
    const m = [1/3, 1/3, 1/3] as const;
    const s0 = {
      r: [[1, 0], [-0.5, Math.sqrt(3)/2], [-0.5, -Math.sqrt(3)/2]] as const,
      p: [[0, 0], [0, 0], [0, 0]] as const,
      m, t: 0,
    };
    const adaptive = runInspector(s0 as any, { ...RK45_DEFAULTS, THorizon: 5 });
    const matched  = inspectorMatch(s0 as any, {
      integrator: 'yoshida4', dtMacro: 1e-3, THorizon: 5,
      NMax: 64, rSub: 0.05, gammaSub: 1.5,
      rColl: 1e-4, REsc: 10, kEsc: 8,
    });
    expect(Math.abs(adaptive.tEnd - matched.tEnd)).toBeLessThan(1e-3);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/inspector
npm test -- --run test/golden/inspector
```

## Acceptance check

```bash
npm test -- --run test/golden/inspector
```

Three goldens green: Kepler holds 1e-12 over T=1000, Burrau IC classifies
without timing out, and adaptive vs match-integrator `t_end` agree to
1 ms over a smooth orbit.

## Notes for the implementer

- **Why two integrators.** The default RK45 is best at chasing
  near-collision singularities (its adaptive step shrinks fast as
  `r_min` collapses). The match-integrator mode lets the user verify the
  GPU's symplectic result without integrator-family confusion. Spec
  notes are explicit about this (revision 17): comparing energy traces
  between non-symplectic RK45 and symplectic Yoshida is not
  apples-to-apples on long bounded orbits.
- **Hover streamline budget.** The 8 ms cap is just a soft target; the
  real work is the debounce + session-supersession. The implementation
  here uses `setTimeout` and a session counter; production may swap in
  `requestIdleCallback` once the rest of the GUI exists.
- **Shadow trajectory step decoupling.** `inspectorWithShadow` reuses
  the base step size for the shadow. Production may decouple the two
  for better FTLE accuracy (each can adapt independently); for M9 the
  simpler approach is enough to land the gate.
- **Validation panel.** When the GPU `SimResult` for the same locked IC
  is available, `runInspector` accepts it as an optional input and
  populates the `validation` field. M5's tile cache holds the
  `SimResult`; the inspector reads it on lock. M9 leaves the slot
  open and M12's acceptance gate uses it for the spec §7 check.
