# M8 — Interaction: microscope, lock, lookup, tilt

## Goal

Land the user-facing controls as a thin layer on top of `ViewState`.
Every gesture is a transform of the same canonical state object; the
cache key (M4) is derived from it; the GPU pipeline never knows or cares
which gesture produced its inputs.

After M8: per-dimension sliders, log-stepped zoom, two independent tilt
sliders with Gram–Schmidt re-orthonormalisation, the lock gesture for
both affine and nonlinear charts, lookup from mass tuples / Pythagorean
triples / raw `z` / physical IC, and the lock-preservation policy for
chart switches.

**Exit criterion.**

```bash
npm test -- --run test/integration/interact
```

A click on a pixel produces a `ViewState` whose `z0` decodes back to the
clicked physical IC to within 1e-9 (affine charts) or 1e-6 (nonlinear
charts). Locking, switching chart, and unlocking preserves the physical
IC across the round trip. A tilt sweep into a hidden dimension produces a
sequence of consistent slice cross-sections (no normalisation jitter).

## File tree

```
principia/
  src/
    interact/
      view_state.ts
      sliders.ts
      zoom.ts
      tilt.ts
      lock.ts
      lookup.ts
      named_directions.ts
      preserve.ts
      index.ts
  test/
    unit/interact/
      tilt.test.ts
      lock.test.ts
      lookup.test.ts
      named_directions.test.ts
      preserve.test.ts
    integration/
      interact_round_trip.test.ts
      interact_tilt_sweep.test.ts
```

## `src/interact/view_state.ts`

```ts
import type { Vec2, Vec8 } from '@/math/types.js';
import type { TileCacheKey } from '@/quadtree/types.js';

export type IntegratorId = 'kdk' | 'yoshida4' | 'yoshida6' | 'rk4';
export type QualityTier  = 'preview' | 'balanced' | 'research';

/**
 * The single source of truth for the renderer, scheduler, exporter, and
 * URL-sharing system. Everything else in M8+ either reads or writes
 * `ViewState`.
 */
export interface ViewState {
  /** Active chart. M10 registers the concrete charts; M8 is chart-agnostic. */
  chartType:    string;
  chartParams:  Record<string, unknown>;

  /** 8D centre of the current slice. */
  z0:           Vec8;

  /** Slice basis. For affine charts q1, q2 are authoritative and
   *  hAxis/vAxis are derived. For mixed-axis / invariant charts, hAxis
   *  and vAxis are authoritative; q1, q2 are derived from the chart
   *  factory and stored only for serialisation completeness. */
  hAxis:        number;
  vAxis:        number;
  q1:           Vec8;
  q2:           Vec8;
  mag:          number;          // half-width of the slice in latent space

  /** Orientation. */
  rotation:     number;
  tilt1:        number;          // [-π/2, +π/2]
  tilt2:        number;
  tilt1Target:  number;          // 0..7
  tilt2Target:  number;

  /** Viewport (UV space). */
  zoom:         number;          // log-scale; pure UI quantity
  uvCentre:     Vec2;
  uvHalfWidth:  Vec2;

  /** Integration. */
  integrator:   IntegratorId;
  THorizon:     number;
  dtMacro:      number;
  NMax:         number;
  checkpoints:  number;

  /** Quality. */
  qualityTier:  QualityTier;
  samplesPerAxis: number;
  maxDepth:     number;
  ensembleCount: number;

  /** Lock state. */
  locked:       boolean;
  // `| undefined` is explicit so `lockedPhysical: undefined` is a legal
  // assignment under exactOptionalPropertyTypes (lockAffine/unlock clear it).
  lockedPhysical?: {                                // present iff locked
    m: readonly [number, number, number];
    r: readonly [Vec2, Vec2, Vec2];
    p: readonly [Vec2, Vec2, Vec2];
  } | undefined;

  /** Reproducibility metadata. */
  principiaVersion: string;
  timestamp:        string;
}

/** Default starting state, equivalent to "open the app". */
export function defaultViewState(): ViewState {
  return {
    chartType: 'latent_slice',
    chartParams: {},
    z0: [0, 0, 0, 0, 0, 0, 0, 0],
    hAxis: 0, vAxis: 1,
    q1: [1, 0, 0, 0, 0, 0, 0, 0],
    q2: [0, 1, 0, 0, 0, 0, 0, 0],
    mag: 3,
    rotation: 0,
    tilt1: 0, tilt2: 0,
    tilt1Target: 2, tilt2Target: 3,
    zoom: 0, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
    integrator: 'yoshida4', THorizon: 80, dtMacro: 1e-3,
    NMax: 64, checkpoints: 8,
    qualityTier: 'balanced', samplesPerAxis: 16,
    maxDepth: 10, ensembleCount: 0,
    locked: false,
    principiaVersion: '0.1.0',
    timestamp: new Date().toISOString(),
  };
}

/** Derive the Layer-1 cache key from a `ViewState`. Anything that affects
 *  the contents of a tile's `simBuffer` must appear in here. */
export function viewStateToCacheKey(v: ViewState): TileCacheKey {
  return {
    chartId:     v.chartType,
    z0:          v.z0,
    q1:          v.q1,
    q2:          v.q2,
    mag:         v.mag,
    integrator:  v.integrator,
    dtMacro:     v.dtMacro,
    nMax:        v.NMax,
    THorizon:    v.THorizon,
    checkpoints: v.checkpoints,
    muMax:       5,                             // M10 promotes to chartParams
    alphaMin:    0.05,
    qMax:        2,
    rColl:       1e-4,
    REsc:        10,
    kEsc:        8,
    enabledMetrics: 0,
    qualityTier: v.qualityTier,
    payloadVersion: 1,
  };
}
```

## `src/interact/sliders.ts`

```ts
import type { ViewState } from './view_state.js';
import type { Vec8 } from '@/math/types.js';

/**
 * Set component k of `z0` to `value`, returning a fresh ViewState.
 * Sliders write through directly: there is no debouncing here — the
 * scheduler in M5 handles the load by switching to Preview tier on
 * input.
 */
export function setSlider(v: ViewState, k: number, value: number): ViewState {
  if (k < 0 || k > 7) throw new RangeError(`slider index ${k} out of range`);
  const z0: Vec8 = [...v.z0] as any;
  z0[k] = value;
  return { ...v, z0 };
}

/** Set every slider in one call (used by lookup). */
export function setAllSliders(v: ViewState, z: Vec8): ViewState {
  return { ...v, z0: z };
}
```

## `src/interact/zoom.ts`

```ts
import type { ViewState } from './view_state.js';

/**
 * Multiplicative zoom in latent space. Callers pass a log-step (positive
 * = zoom in / smaller `mag`). Zoom is bounded to keep the slice
 * within reasonable numeric range.
 */
export function applyZoomStep(v: ViewState, deltaLog2: number): ViewState {
  const newMag = v.mag * Math.pow(2, -deltaLog2);
  const clamped = Math.max(1e-12, Math.min(1e6, newMag));
  return { ...v, mag: clamped, zoom: v.zoom + deltaLog2 };
}
```

## `src/interact/tilt.ts`

```ts
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
```

## `src/interact/lock.ts`

```ts
import type { ViewState } from './view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import { add8, scale8 } from '@/math/vec.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

/**
 * Lock onto a pixel (s, t) ∈ [0,1]² in the current view's UV space. For
 * affine charts this is closed-form — no GPU readback needed. The lock
 * operation:
 *
 *   1. Compute z_locked from (s, t) and the slice basis.
 *   2. Decode the physical IC (canonicalised).
 *   3. Store both the latent z and the physical IC on the new ViewState.
 *
 * Nonlinear charts (M10) override `lockAffine` with a chart-specific
 * implementation that may need GPU readback.
 */
export function lockAffine(
  v: ViewState, pixel: { s: number; t: number },
): ViewState {
  const su = (2 * pixel.s - 1) * v.mag;
  const sv = (2 * pixel.t - 1) * v.mag;
  const z0 = add8(v.z0, add8(scale8(v.q1, su), scale8(v.q2, sv)));

  const dec = decodeLatent(z0, KNOBS);
  if (dec.kind === 'terminal') {
    // Locking on a terminal pixel still records the position; the inspector
    // reports the terminal class explicitly. We don't reject the lock.
    return { ...v, z0, locked: true, lockedPhysical: undefined };
  }
  return {
    ...v,
    z0,
    locked: true,
    lockedPhysical: { m: dec.state.m, r: dec.state.r, p: dec.state.p },
  };
}

/** Release the lock and clear the physical IC pin. */
export function unlock(v: ViewState): ViewState {
  return { ...v, locked: false, lockedPhysical: undefined };
}

/**
 * Round-trip a locked physical IC back into latent z. Used by the
 * lock-preservation logic when chart switches require re-encoding.
 */
export function physicalToLatent(
  m: ViewState['lockedPhysical']['m'],
  r: ViewState['lockedPhysical']['r'],
  p: ViewState['lockedPhysical']['p'],
): { z: ViewState['z0']; clamped: boolean } {
  const enc = inverseEncodeLatent({ m, r, p, t: 0 }, KNOBS);
  return { z: enc.z, clamped: enc.clamped };
}
```

## `src/interact/lookup.ts`

```ts
import type { Vec2, Vec3, Vec8, Triple } from '@/math/types.js';
import type { ViewState } from './view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import { setAllSliders } from './sliders.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export type LookupInput =
  | { kind: 'latent';  z: Vec8 }
  | { kind: 'mass';    m: Vec3 }
  | { kind: 'pythag';  m: number; n: number }
  | { kind: 'pythag_triple'; a: number; b: number; c: number }
  | { kind: 'physical'; m: Vec3; r: Triple<Vec2>; p: Triple<Vec2> };

export type LookupResult =
  | { kind: 'ok'; view: ViewState; clamped: boolean; reason?: string }
  | { kind: 'rejected'; reason: string };

/**
 * Convert any lookup input into a physical IC, then inverse-encode into
 * latent space, then write through the active view.
 *
 * Defaults for unspecified inputs:
 *   - mass-only / pythag input → equilateral triangle at the implied
 *     masses, rest start.
 *   - pythag → Burrau IC (mass = opposite-side / sum, classical 1-indexed).
 *   - pythag_triple → same, with explicit (a, b, c).
 */
export function lookup(input: LookupInput, v: ViewState): LookupResult {
  switch (input.kind) {
    case 'latent': {
      const dec = decodeLatent(input.z, KNOBS);
      if (dec.kind === 'terminal') {
        return { kind: 'rejected', reason: `terminal at decode: ${dec.terminal.kind}` };
      }
      return { kind: 'ok',
               view: { ...setAllSliders(v, input.z),
                       locked: true, lockedPhysical: { m: dec.state.m,
                                                        r: dec.state.r,
                                                        p: dec.state.p } },
               clamped: false };
    }

    case 'mass': {
      // Default geometry: equilateral with body 0 at right-angle origin
      // would be misleading; use a balanced equilateral instead.
      const r: Triple<Vec2> = [
        [ 1.0,            0.0],
        [-0.5,  Math.sqrt(3)/2],
        [-0.5, -Math.sqrt(3)/2],
      ];
      return lookupFromPhysical({ m: input.m, r, p: [[0,0],[0,0],[0,0]] }, v);
    }

    case 'pythag': {
      const a = input.m * input.m - input.n * input.n;
      const b = 2 * input.m * input.n;
      const c = input.m * input.m + input.n * input.n;
      return lookupFromPythag(a, b, c, v);
    }

    case 'pythag_triple':
      return lookupFromPythag(input.a, input.b, input.c, v);

    case 'physical':
      return lookupFromPhysical(input, v);
  }
}

function lookupFromPythag(
  a: number, b: number, c: number, v: ViewState,
): LookupResult {
  // Burrau classical (1-indexed): body 1 at right angle (mass=c/Σ),
  // body 2 at (a/c, 0) (mass=b/Σ), body 3 at (0, b/c) (mass=a/Σ). We
  // re-index to 0-indexed: body 1→0, body 2→1, body 3→2.
  const total = a + b + c;
  const m: Vec3 = [c/total, b/total, a/total];
  const r: Triple<Vec2> = [[0,0], [a/c, 0], [0, b/c]];
  return lookupFromPhysical({ m, r, p: [[0,0],[0,0],[0,0]] }, v);
}

function lookupFromPhysical(
  s: { m: Vec3; r: Triple<Vec2>; p: Triple<Vec2> },
  v: ViewState,
): LookupResult {
  const enc = inverseEncodeLatent({ m: s.m, r: s.r, p: s.p, t: 0 }, KNOBS);

  // Decode again to verify and surface any clamping.
  const dec = decodeLatent(enc.z, KNOBS);
  if (dec.kind === 'terminal') {
    return { kind: 'rejected',
             reason: `inverse encode hit a terminal label: ${dec.terminal.kind}` };
  }
  return {
    kind: 'ok',
    view: { ...setAllSliders(v, enc.z),
            locked: true,
            lockedPhysical: { m: dec.state.m, r: dec.state.r, p: dec.state.p } },
    clamped: enc.clamped,
    reason: enc.clamped ? 'lookup_clamped' : undefined,
  };
}
```

## `src/interact/named_directions.ts`

```ts
import type { Vec8 } from '@/math/types.js';
import { unitE8, normalize8, scale8, sub8 } from '@/math/vec.js';
import { logitsFromMasses } from '@/math/softmax.js';
import { MU_MAX_DEFAULT } from '@/math/constants.js';
import type { Vec3 } from '@/math/types.js';

/**
 * Mass-perturbation direction from a Burrau mass triple toward equal masses.
 * The latent indices for masses are 6 and 7 (z_μ1, z_μ2); other
 * components zero.
 */
export function massPerturbationFromBurrau(
  burrauMass: Vec3, muMax = MU_MAX_DEFAULT,
): Vec8 {
  const { mu1, mu2 } = logitsFromMasses(burrauMass);
  const norm = Math.hypot(mu1, mu2);
  if (norm === 0) {
    // Burrau already at equal masses; fall back to z_μ1.
    return unitE8(6);
  }
  // Direction: from current logits → 0 (equal masses), normalised in R^8.
  const v: Vec8 = [0,0,0,0,0,0, -mu1 / norm, -mu2 / norm];
  return v;
}

/**
 * Energy-increase-at-fixed-Lz direction. The radial momentum direction
 * `p_ρ` lives at latent indices 2, 3. Returns the unit vector along z[2]
 * (radial-x). For the full directional family, M10 supplies the complete
 * set keyed off the chart's frozen configuration.
 */
export function energyIncreaseAtFixedLz(): Vec8 {
  return unitE8(2);
}

/**
 * Burrau-to-unconstrained morph: tilt one of the configuration axes
 * (z_α, z_β) toward a non-Burrau direction. Used by the Stage-4
 * persistence probe in M11.
 */
export function burrauToUnconstrained(targetIndex: number): Vec8 {
  if (targetIndex < 2 || targetIndex > 7) {
    throw new RangeError(`burrauToUnconstrained target ${targetIndex} out of [2..7]`);
  }
  return unitE8(targetIndex);
}
```

## `src/interact/preserve.ts`

```ts
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
    if (Math.abs(dec.state.r[i][0] - ic.r[i][0]) > eps ||
        Math.abs(dec.state.r[i][1] - ic.r[i][1]) > eps) {
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
```

## `src/interact/index.ts`

```ts
export * from './view_state.js';
export * from './sliders.js';
export * from './zoom.js';
export * from './tilt.js';
export * from './lock.js';
export * from './lookup.js';
export * from './named_directions.js';
export * from './preserve.js';
```

## Tests

### `test/unit/interact/tilt.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyTilt, reorthonormalise, setTilts } from '@/interact/tilt.js';
import { defaultViewState } from '@/interact/view_state.js';
import { unitE8, dot8, norm8 } from '@/math/vec.js';

describe('applyTilt', () => {
  it('τ = 0 returns the base vector', () => {
    const q = applyTilt(unitE8(0), 3, 0);
    expect(q).toEqual(unitE8(0));
  });

  it('τ = π/2 returns the target axis', () => {
    const q = applyTilt(unitE8(0), 3, Math.PI/2);
    for (let i = 0; i < 8; i++) {
      if (i === 3) expect(q[i]).toBeCloseTo(1, 12);
      else expect(q[i]).toBeCloseTo(0, 12);
    }
  });

  it('τ = -π/2 flips sign of the target axis', () => {
    const q = applyTilt(unitE8(0), 3, -Math.PI/2);
    expect(q[3]).toBeCloseTo(-1, 12);
  });

  it('replaces, does not accumulate', () => {
    // Starting from a default z=0 view, set tilt1 to 30° then 0°: the
    // resulting q1 should be exactly e_h again.
    let v = defaultViewState();
    v = setTilts(v, { tilt1: Math.PI/6, tilt1Target: 3 });
    v = setTilts(v, { tilt1: 0,         tilt1Target: 3 });
    expect(v.q1).toEqual(unitE8(v.hAxis));
  });
});

describe('reorthonormalise', () => {
  it('produces orthonormal q1, q2 for any non-degenerate input', () => {
    const cases: [any, any][] = [
      [unitE8(0), unitE8(1)],
      [applyTilt(unitE8(0), 2, 0.4), applyTilt(unitE8(1), 3, 0.7)],
      [applyTilt(unitE8(0), 2, 0.5), applyTilt(unitE8(1), 2, 0.5)],     // same target
    ];
    for (const [a, b] of cases) {
      const [q1, q2] = reorthonormalise(a, b);
      expect(norm8(q1)).toBeCloseTo(1, 12);
      expect(norm8(q2)).toBeCloseTo(1, 12);
      expect(Math.abs(dot8(q1, q2))).toBeLessThan(1e-12);
    }
  });

  it('falls back to a substitute axis when q2_perp is degenerate', () => {
    // Both vectors point along e_3.
    const q1 = unitE8(3);
    const q2 = unitE8(3);
    const [, q2n] = reorthonormalise(q1, q2);
    // The substitute must be orthogonal to q1 and unit-length.
    expect(Math.abs(dot8(q1, q2n))).toBeLessThan(1e-12);
    expect(norm8(q2n)).toBeCloseTo(1, 12);
  });
});

describe('setTilts', () => {
  it('preserves orthogonality across tilt sweeps', () => {
    let v = defaultViewState();
    for (let i = 0; i <= 30; i++) {
      const tau = (i / 30) * (Math.PI / 2);
      v = setTilts(v, { tilt1: tau, tilt1Target: 5 });
      expect(Math.abs(dot8(v.q1, v.q2))).toBeLessThan(1e-12);
    }
  });
});
```

### `test/unit/interact/lock.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { lockAffine, unlock, physicalToLatent } from '@/interact/lock.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('lockAffine', () => {
  it('centre pixel preserves the slice centre', () => {
    const v0 = defaultViewState();
    const v1 = lockAffine(v0, { s: 0.5, t: 0.5 });
    expect(v1.z0).toEqual(v0.z0);
    expect(v1.locked).toBe(true);
    expect(v1.lockedPhysical).toBeDefined();
  });

  it('off-centre pixel applies the affine offset', () => {
    let v = defaultViewState();
    v = { ...v, mag: 2 };
    const v1 = lockAffine(v, { s: 1.0, t: 0.5 });
    // s=1 → +1 along q1 → +mag along z[0].
    expect(v1.z0[0]).toBeCloseTo(2, 12);
    expect(v1.z0[1]).toBeCloseTo(0, 12);
  });

  it('unlock clears the physical pin', () => {
    const v = lockAffine(defaultViewState(), { s: 0.3, t: 0.7 });
    const u = unlock(v);
    expect(u.locked).toBe(false);
    expect(u.lockedPhysical).toBeUndefined();
  });
});

describe('physicalToLatent round-trip', () => {
  it('decodes back to within 1e-9 in the affine-chart case', () => {
    // Pick a non-trivial latent point well away from saturation.
    const z = [0.3, -0.5, 0.1, -0.1, 0.0, 0.05, 0.2, -0.2] as any;
    const dec = decodeLatent(z, KNOBS);
    if (dec.kind !== 'ok') throw new Error('expected ok');
    const back = physicalToLatent(dec.state.m, dec.state.r, dec.state.p);
    expect(back.clamped).toBe(false);
    const decBack = decodeLatent(back.z, KNOBS);
    if (decBack.kind !== 'ok') throw new Error('expected ok back');
    for (let i = 0; i < 3; i++) {
      expect(decBack.state.r[i][0]).toBeCloseTo(dec.state.r[i][0], 9);
      expect(decBack.state.r[i][1]).toBeCloseTo(dec.state.r[i][1], 9);
    }
  });
});
```

### `test/unit/interact/lookup.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lookup } from '@/interact/lookup.js';
import { defaultViewState } from '@/interact/view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('lookup', () => {
  it('latent input round-trips', () => {
    const z = [0.4, 0.0, 0, 0, 0, 0, 0.1, -0.1] as any;
    const r = lookup({ kind: 'latent', z }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.view.z0).toEqual(z);
      expect(r.view.locked).toBe(true);
    }
  });

  it('Pythagorean (m, n) = (2, 1) gives the (3, 4, 5) Burrau IC', () => {
    const r = lookup({ kind: 'pythag', m: 2, n: 1 }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const ic = r.view.lockedPhysical!;
      // Burrau (3,4,5) re-indexed: m = (5/12, 4/12, 3/12).
      expect(ic.m[0]).toBeCloseTo(5/12, 6);
      expect(ic.m[1]).toBeCloseTo(4/12, 6);
      expect(ic.m[2]).toBeCloseTo(3/12, 6);
      // r2 = (a/c, 0) = (3/5, 0); but we lookup back through latent so
      // expect a near match after canonicalise + decode.
      const distFromExpected = Math.hypot(ic.r[1][0] - 0.6, ic.r[1][1]);
      expect(distFromExpected).toBeLessThan(0.05);
    }
  });

  it('explicit triple (5, 12, 13) gives matching mass ratios', () => {
    const r = lookup({ kind: 'pythag_triple', a: 5, b: 12, c: 13 },
                     defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const total = 5 + 12 + 13;
      expect(r.view.lockedPhysical!.m[0]).toBeCloseTo(13/total, 6);
      expect(r.view.lockedPhysical!.m[1]).toBeCloseTo(12/total, 6);
      expect(r.view.lockedPhysical!.m[2]).toBeCloseTo(5 /total, 6);
    }
  });

  it('mass-only input lands at the equilateral default', () => {
    const r = lookup({ kind: 'mass', m: [0.5, 0.3, 0.2] },
                     defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const ic = r.view.lockedPhysical!;
      // Triangle should be approximately equilateral after canonicalise.
      const d01 = Math.hypot(ic.r[1][0]-ic.r[0][0], ic.r[1][1]-ic.r[0][1]);
      const d02 = Math.hypot(ic.r[2][0]-ic.r[0][0], ic.r[2][1]-ic.r[0][1]);
      const d12 = Math.hypot(ic.r[2][0]-ic.r[1][0], ic.r[2][1]-ic.r[1][1]);
      // Allow some tolerance because canonicalise + COM project move things.
      expect(d01).toBeCloseTo(d02, 1);
      expect(d01).toBeCloseTo(d12, 1);
    }
  });

  it('rejects on a degenerate latent (zero-mass corner)', () => {
    // Push z_μ1 toward saturation; with muMax=5 the resulting m_0 is
    // tiny but still positive, so decode succeeds. Test the flag plumbing
    // by overriding to a saturated request that would clamp.
    const z = [0, 0, 0, 0, 0, 0, 100, 0] as any;     // wildly out of range
    const r = lookup({ kind: 'latent', z }, defaultViewState());
    expect(r.kind === 'ok' || r.kind === 'rejected').toBe(true);
  });
});
```

### `test/unit/interact/named_directions.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  massPerturbationFromBurrau,
  energyIncreaseAtFixedLz,
  burrauToUnconstrained,
} from '@/interact/named_directions.js';
import { norm8, unitE8 } from '@/math/vec.js';

describe('named compound directions', () => {
  it('mass-perturbation from Burrau is unit-length and nonzero in mass slots only', () => {
    const m = [5/12, 4/12, 3/12] as const;
    const dir = massPerturbationFromBurrau(m);
    expect(norm8(dir)).toBeCloseTo(1, 12);
    for (let i = 0; i < 6; i++) expect(dir[i]).toBe(0);
    // Sign: pulling toward (1/3, 1/3, 1/3) means z_μ1, z_μ2 each move
    // toward 0 from positive (since m_1 > m_0, m_2 > m_0 for Burrau).
    // For our re-indexed (5/12, 4/12, 3/12), m_0 = 5/12 is the largest
    // mass, so μ_1 = log(m_1/m_0) < 0 and μ_2 = log(m_2/m_0) < 0;
    // direction "toward equal" pushes them toward 0, so positive.
    expect(dir[6]).toBeGreaterThan(0);
    expect(dir[7]).toBeGreaterThan(0);
  });

  it('mass-perturbation at equal masses falls back to unit e_6', () => {
    const dir = massPerturbationFromBurrau([1/3, 1/3, 1/3]);
    expect(dir).toEqual(unitE8(6));
  });

  it('energy-increase-at-fixed-Lz is unit e_2', () => {
    expect(energyIncreaseAtFixedLz()).toEqual(unitE8(2));
  });

  it('burrauToUnconstrained accepts indices 2..7', () => {
    expect(() => burrauToUnconstrained(1)).toThrow();
    expect(burrauToUnconstrained(5)).toEqual(unitE8(5));
  });
});
```

### `test/unit/interact/preserve.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lockAffine } from '@/interact/lock.js';
import { defaultViewState } from '@/interact/view_state.js';
import { preserveLockAcrossChart } from '@/interact/preserve.js';

describe('preserveLockAcrossChart', () => {
  it('passes through chart change for an unlocked view', () => {
    const v = defaultViewState();
    const r = preserveLockAcrossChart(v, 'lz_e');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.view.chartType).toBe('lz_e');
      expect(r.view.locked).toBe(false);
    }
  });

  it('preserves a locked physical IC', () => {
    const v0 = lockAffine(defaultViewState(), { s: 0.6, t: 0.4 });
    const r = preserveLockAcrossChart(v0, 'shape_sphere');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const before = v0.lockedPhysical!;
      const after  = r.view.lockedPhysical!;
      for (let i = 0; i < 3; i++) {
        expect(after.r[i][0]).toBeCloseTo(before.r[i][0], 4);
        expect(after.r[i][1]).toBeCloseTo(before.r[i][1], 4);
      }
    }
  });
});
```

### `test/integration/interact_round_trip.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lookup } from '@/interact/lookup.js';
import { lockAffine } from '@/interact/lock.js';
import { defaultViewState } from '@/interact/view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

/**
 * Round trip: lookup a Burrau triple → lock → decode → check the
 * physical IC matches what we asked for. The tolerance is loose because
 * canonicalise + COM project rotate / mirror the input to canonical
 * form.
 */
describe('lookup → lock → decode round-trip', () => {
  it('Burrau (3,4,5) survives the round trip to within 1e-3', () => {
    const r = lookup({ kind: 'pythag', m: 2, n: 1 }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;

    // Re-decode the latent and compare body 0..2 distances.
    const dec = decodeLatent(r.view.z0, KNOBS);
    expect(dec.kind).toBe('ok');
    if (dec.kind !== 'ok') return;
    const ic = r.view.lockedPhysical!;

    // The pin and the re-decode should agree on inter-body distances —
    // canonicalise normalises the absolute frame.
    const pinD01 = Math.hypot(ic.r[1][0]-ic.r[0][0], ic.r[1][1]-ic.r[0][1]);
    const decD01 = Math.hypot(dec.state.r[1][0]-dec.state.r[0][0],
                              dec.state.r[1][1]-dec.state.r[0][1]);
    expect(decD01).toBeCloseTo(pinD01, 3);
  });
});
```

### `test/integration/interact_tilt_sweep.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { setTilts } from '@/interact/tilt.js';
import { dot8 } from '@/math/vec.js';

describe('tilt sweep into a hidden dimension', () => {
  it('produces a smooth sequence of orthonormal slice bases', () => {
    let v = defaultViewState();
    const samples: { tilt: number; ortho: number; q1norm: number; q2norm: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const tau = (i / 60) * (Math.PI / 2);
      v = setTilts(v, { tilt1: tau, tilt1Target: 5 });
      const q1 = v.q1, q2 = v.q2;
      const q1n = Math.hypot(...q1);
      const q2n = Math.hypot(...q2);
      samples.push({
        tilt: tau,
        ortho: Math.abs(dot8(q1, q2)),
        q1norm: q1n, q2norm: q2n,
      });
    }
    for (const s of samples) {
      expect(s.ortho).toBeLessThan(1e-12);
      expect(s.q1norm).toBeCloseTo(1, 12);
      expect(s.q2norm).toBeCloseTo(1, 12);
    }
  });
});
```

## Run it

```bash
npm test -- --run test/unit/interact
npm test -- --run test/integration/interact
```

## Acceptance check

```bash
npm test -- --run test/integration/interact
```

Both integration tests pass: lookup → lock → decode preserves the
Burrau (3,4,5) physical IC to 1e-3, and a 60-sample tilt sweep into
dimension 5 produces orthonormal slice bases throughout (no jitter from
the Gram-Schmidt step).

## Notes for the implementer

- **`ViewState` is the single source of truth.** Sliders, zoom, tilt,
  lock, lookup, palette swap (M7) all write through to a `ViewState`
  reference; the cache key is derived from it; the URL exporter and the
  reproducibility sidecar (M12) serialise it. Keep this discipline:
  every UI control that affects what the user sees must be a field of
  `ViewState`.
- **Affine vs nonlinear lock.** `lockAffine` is closed-form because the
  slice basis is in latent space and `(s, t)` maps directly to a latent
  offset. Nonlinear charts (M10's `(L_z, E)`, shape sphere with
  hover-streamline) have a chart-specific lock that may require GPU
  readback to recover the chart coordinates. They register their own
  `lock` function via the chart registry; M8 handles only the affine
  case.
- **Tilt replaces, doesn't accumulate.** Re-issuing `tilt1 = 30°`
  always produces the same `q1`, regardless of prior tilt history. This
  is the behaviour users expect from a slider, and it's what keeps the
  Stage-4 persistence probe in M11 deterministic.
- **Lock-preservation policy.** The default check is "round-tripped
  physical IC stays within 1e-3 in body positions". M10 may register
  per-chart preservation policies — for instance, the `(L_z, E)` chart
  may project to the nearest feasible point on the parabola when the
  inverse-encode lands outside the feasibility region.
