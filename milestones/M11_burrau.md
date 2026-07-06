# M11 — Burrau family progression

## Goal

The Burrau–Pythagorean family as a layered traversal of the IC manifold,
each stage adding one degree of freedom. The progression rides on top of
M10's chart machinery: every Burrau view is a `Chart` configured with
specific frozen parameters, no Burrau-specific integrator or renderer.

After M11: discrete primitive triples at rest (Stage 1a), continuous `ν`
sweep (Stage 1b), continuous masses at fixed shape (Stage 2a), continuous
`(L_z, E)` at fixed shape and masses (Stage 2b), combined mass + momentum
sweeps (Stage 3), and the Stage 4 persistence probe — locking on a
fractal Burrau boundary and tilting one basis vector into a non-Burrau
direction.

**Exit criterion.**

```bash
npm test -- --run test/golden/burrau_family_345 test/golden/burrau_persistence_probe
```

The canonical (3, 4, 5) IC (spec eq. `burrau_positions`) emerges exactly
from the chart pipeline (ν → decode), and its f64 reference
classification is pinned: a converged, tolerance-robust sub-`r_coll`
encounter (COLLISION at t ≈ 4.905) via the adaptive inspector — the
Szebehely–Peters t ≈ 60 escape lives below `r_coll` and waits on G19
regularization (see D11.1: M1's golden fixture was the legs-swapped
variant and is kept as an integrator regression). The first four
primitive triples produce distinct geometries. Stage 4 persistence probe
runs cleanly: lock + tilt sweep produces a smooth `coherence_score`
trace.

**Deliverable:** internal — tests only (no visible artifact until a later GPU/UI milestone); the Burrau–Pythagorean family expressed entirely as configured M10 charts (triples, ν/mass/momentum sweeps, persistence probe), with the canonical (3,4,5) IC reproduced exactly through the chart pipeline and its f64 classification pinned.

## File tree

```
principia/
  src/
    chart_atlas/charts/
      burrau_euclid.ts        # EDIT: ν→triangle now imports burrauTriangle
    burrau/
      euclid.ts
      triples.ts
      acute_angle.ts
      mass_chart.ts
      bifurcation.ts
      hypothesis_probe.ts
      stages.ts
      index.ts
  test/
    unit/burrau/
      euclid.test.ts
      triples.test.ts
      acute_angle.test.ts
      stages.test.ts
    golden/
      burrau.test.ts          # EDIT: relabelled legs-swapped variant (D11.1)
      burrau_family_345.test.ts
      burrau_persistence_probe.test.ts
```

## `src/burrau/euclid.ts`

```ts
import type { Vec2, Vec3, Triple } from '@/math/types.js';

/**
 * Continuous Euclid parametrisation. For real m > n > 0 the formulae
 *   a = m² - n²,  b = 2 m n,  c = m² + n²
 * give a Pythagorean-style triple with a² + b² = c² for any m, n.
 *
 * The single ratio ν = n / m ∈ (0, 1) determines the triangle shape;
 * `m` itself sets the absolute scale (irrelevant after the I = 1 gauge).
 */
export function euclidSides(m: number, n: number): { a: number; b: number; c: number } {
  return { a: m * m - n * n, b: 2 * m * n, c: m * m + n * n };
}

/** Normalised by m² so a, b, c depend only on ν. */
export function normalisedSides(nu: number): { a: number; b: number; c: number } {
  return { a: 1 - nu * nu, b: 2 * nu, c: 1 + nu * nu };
}

/** Acute angle as a function of ν. θ(ν) = arctan((1 - ν²) / (2 ν)). */
export function acuteAngle(nu: number): number {
  return Math.atan2(1 - nu * nu, 2 * nu);
}

/** Inverse: ν as a function of θ ∈ (0, π/4]. ν = sec θ - tan θ. */
export function nuFromAcuteAngle(theta: number): number {
  return 1 / Math.cos(theta) - Math.tan(theta);
}

/**
 * Burrau triangle at unit hypotenuse, per the canonical spec
 * (eq. burrau_positions): right angle at the origin with mass c/Σ, the
 * a/c leg along +x holding mass b/Σ, the b/c leg along +y holding mass
 * a/Σ — each mass equal to its OPPOSITE side (classical Burrau rule,
 * matching Szebehely & Peters' coordinates). Re-indexed to 0-based:
 *
 *   body 1 → 0  (right angle, mass = c / Σ)
 *   body 2 → 1  (at (a/c, 0),  mass = b / Σ)
 *   body 3 → 2  (at (0, b/c),  mass = a / Σ)
 */
export function burrauTriangle(nu: number): {
  r: Triple<Vec2>;
  m: Vec3;
} {
  const { a, b, c } = normalisedSides(nu);
  const total = a + b + c;
  return {
    r: [[0, 0], [a / c, 0], [0, b / c]],
    m: [c / total, b / total, a / total],
  };
}

/** Inverse: recover ν from the geometry of a Burrau-style triangle.
 *  Useful for lookup of arbitrary right-triangle ICs. */
export function recoverNuFromTriangle(r: Triple<Vec2>): number {
  // Body 0 sits at the right angle; legs are a/c (to body 1) and b/c
  // (to body 2). Recover the ratio a/b = (1-ν²)/(2ν).
  const a = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);    // (a/c)
  const b = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);    // (b/c)
  // 2ν (a/b) = 1 - ν²  →  ν² + 2(a/b)ν - 1 = 0  →  ν = -a/b + √((a/b)² + 1)
  if (b === 0) return 0;
  const k = a / b;
  return -k + Math.sqrt(k * k + 1);
}
```

`src/chart_atlas/charts/burrau_euclid.ts` (M10) is edited to import
`burrauTriangle` instead of repeating the ν → triangle formulae — one
source for the canonical map (D11.4).

## `src/burrau/triples.ts`

```ts
/** Iterator over primitive Pythagorean triples up to m_max. */
export function* primitiveTriples(maxM: number): Generator<{
  m: number; n: number; nu: number; a: number; b: number; c: number;
}> {
  for (let m = 2; m <= maxM; m++) {
    for (let n = 1; n < m; n++) {
      if (gcd(m, n) === 1 && (m - n) % 2 === 1) {
        yield {
          m, n, nu: n / m,
          a: m * m - n * n, b: 2 * m * n, c: m * m + n * n,
        };
      }
    }
  }
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** Find the primitive triple closest to a given ν (used to mark the
 *  nearest landmark on the continuous Euclid display). */
export function nearestPrimitiveTriple(
  nu: number, maxM = 32,
): { m: number; n: number; nu: number; distance: number } {
  let best = { m: 2, n: 1, nu: 0.5, distance: Infinity };
  for (const t of primitiveTriples(maxM)) {
    const d = Math.abs(t.nu - nu);
    if (d < best.distance) best = { m: t.m, n: t.n, nu: t.nu, distance: d };
  }
  return best;
}
```

## `src/burrau/acute_angle.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_INVARIANT } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

/**
 * Acute-angle × kinetic-energy chart: θ ∈ (0, π/4], K ∈ [0, K_max].
 * `flags.forbids_energy_normalisation = true` because the chart sets K
 * deterministically.
 */
export function makeAcuteAngleKChart(opts: {
  thetaMin?: number;
  thetaMax?: number;
  Kmax?: number;
  gammaK?: number;
}): Chart {
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;
  const Kmax     = opts.Kmax     ?? 2;
  const gammaK   = opts.gammaK   ?? 2;

  return {
    id: 'mixed_axis',     // M10's mixed-axis category; could promote to its own
    kind: 'mixed',
    flags: FLAGS_INVARIANT,

    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m } = burrauTriangle(nu);
      const K = Kmax * Math.pow(v, gammaK);
      // v drives kinetic energy via a radial-momentum seed along ρ̃.
      // Jacobi kinetic energy is |p_ρ|²/(2 μ_ρ), so hitting K exactly
      // needs the reduced-mass factor: |p_ρ| = √(2 K μ_ρ).
      const muRho = (m[0] * m[1]) / (m[0] + m[1]);
      const pRho:    Vec2 = [Math.sqrt(2 * K * muRho), 0];
      const pLambda: Vec2 = [0, 0];
      const p: Triple<Vec2> = jacobiToParticleMomenta({ pRho, pLambda }, m);
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) {
        return { kind: 'terminal', terminal: c.terminal,
                 descriptor: makeDescriptor(c.state) };
      }
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    inverseEncode() {
      return { kind: 'projected', reason: 'acute-angle chart inverse not unique' };
    },

    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      return { kind: 'pass' };
    },
  };
}
```

Descriptors come from `@/decode/pipeline.js` (D10.1) — no per-chart
copies. `{ pRho, pLambda }` IS a `JacobiMomenta`; no cast.

## `src/burrau/mass_chart.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { decodeMassSimplex } from '@/decode/mass.js';
import { burrauTriangle } from './euclid.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Triple, Vec2 } from '@/math/types.js';

const EPS_MASS = 1e-4;

/**
 * Burrau ternary mass chart: shape fixed at ν = ν₀, mass triple swept
 * across the open simplex.
 *
 * The Burrau "natural" mass triple for ν₀ is
 *   m_Burrau = (c, b, a) / (a + b + c)  (re-indexed)
 * which appears as a marker overlay (M11 ships the marker, M7/M10's
 * physics_overlay flag activates it).
 */
export function makeBurrauMassChart(nu0: number): Chart {
  return {
    id: 'mass_simplex',
    kind: 'mass_simplex',
    flags: FLAGS_MASS_VARYING,

    decode([u, v]) {
      const m = decodeMassSimplex(u, v, EPS_MASS);
      const { r } = burrauTriangle(nu0);     // shape only; masses overridden
      const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) {
        return { kind: 'terminal', terminal: c.terminal,
                 descriptor: makeDescriptor(c.state) };
      }
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    inverseEncode() {
      return { kind: 'projected', reason: 'burrau mass chart needs ν' };
    },

    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      // Same criterion as M10's mass_simplex (D10.5): the bilinear map is
      // total on [0,1]²; saturation means a RAW component under ε_m.
      const rawMin = Math.min((1 - u) * (1 - v), u, (1 - u) * v);
      if (rawMin < EPS_MASS) {
        return { kind: 'project', pixel: { s: u, t: v },
                 reason: 'inside the simplex interior buffer' };
      }
      return { kind: 'pass' };
    },
  };
}
```

## `src/burrau/bifurcation.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_INVARIANT, FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Triple, Vec2, Vec3 } from '@/math/types.js';

/**
 * (θ, K) bifurcation strip: horizontal axis is the acute angle, vertical
 * is kinetic energy. Mass triple = Burrau natural for the current θ.
 */
export function makeThetaKStrip(opts: {
  Kmax?: number; gammaK?: number;
  thetaMin?: number; thetaMax?: number;
}): Chart {
  const Kmax     = opts.Kmax     ?? 2;
  const gammaK   = opts.gammaK   ?? 2;
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;

  return {
    id: 'mixed_axis', kind: 'mixed', flags: FLAGS_INVARIANT,
    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m } = burrauTriangle(nu);
      const K = Kmax * Math.pow(v, gammaK);
      // Exact K needs the reduced-mass factor (Jacobi K = |p_ρ|²/(2μ_ρ)).
      const muRho = (m[0] * m[1]) / (m[0] + m[1]);
      const p: Triple<Vec2> = jacobiToParticleMomenta(
        { pRho: [Math.sqrt(2 * K * muRho), 0], pLambda: [0, 0] }, m,
      );
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: makeDescriptor(c.state) };
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },
    inverseEncode() { return { kind: 'projected', reason: 'strip inverse not unique' }; },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return { kind: 'reject', reason: 'uv out of range' };
      return { kind: 'pass' };
    },
  };
}

/**
 * (θ, δm) bifurcation strip: horizontal is acute angle, vertical
 * interpolates the mass triple from Burrau natural to a target (defaults
 * to equal masses).
 */
export function makeThetaDeltaMStrip(opts: {
  thetaMin?: number; thetaMax?: number;
  mTarget?: Vec3;
}): Chart {
  const thetaMin = opts.thetaMin ?? 0.05;
  const thetaMax = opts.thetaMax ?? Math.PI / 4;
  const mTarget  = opts.mTarget  ?? [1 / 3, 1 / 3, 1 / 3];

  return {
    id: 'mixed_axis', kind: 'mixed', flags: FLAGS_MASS_VARYING,
    decode([u, v]) {
      const theta = thetaMin + (thetaMax - thetaMin) * u;
      const nu = nuFromAcuteAngle(theta);
      const { r, m: mNatural } = burrauTriangle(nu);
      const mInterp: Vec3 = [
        (1 - v) * mNatural[0] + v * mTarget[0],
        (1 - v) * mNatural[1] + v * mTarget[1],
        (1 - v) * mNatural[2] + v * mTarget[2],
      ];
      const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
      const c = canonicalise({ r, p, m: mInterp, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: makeDescriptor(c.state) };
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },
    inverseEncode() {
      return { kind: 'projected', reason: 'δm inverse needs interpolation factor' };
    },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return { kind: 'reject', reason: 'uv out of range' };
      return { kind: 'pass' };
    },
  };
}
```

## `src/burrau/hypothesis_probe.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';
import { lockAffine } from '@/interact/lock.js';
import { setTilts } from '@/interact/tilt.js';

export interface PersistenceTracePoint {
  tau:               number;
  outcomeImpurity:   number;     // from TileReduction
  coherenceScore:    number;
  freeGroupWord:     string | null;
}

export type PersistenceVerdict = 'persists' | 'deforms' | 'dissolves';

export interface PersistenceResult {
  trace:   PersistenceTracePoint[];
  verdict: PersistenceVerdict;
}

/**
 * Classify a persistence trace per spec 2.5. A live basin boundary keeps
 * the locked pixel mixed (outcome_impurity stays high). If impurity
 * collapses toward 0 the boundary has dissolved; if it stays high but the
 * free-group word changes, the boundary persisted but deformed; otherwise
 * it persisted intact. Threshold matches the tile split criterion
 * (tau_imp) so "boundary" here means what the renderer means.
 */
export function classifyPersistence(
  trace: PersistenceTracePoint[],
  tauImp = 0.15,
): PersistenceVerdict {
  if (trace.length === 0) return 'dissolves';
  const endImpurity = trace[trace.length - 1]!.outcomeImpurity;
  if (endImpurity < tauImp) return 'dissolves';
  const w0 = trace[0]!.freeGroupWord;
  const wEnd = trace[trace.length - 1]!.freeGroupWord;
  return w0 !== wEnd ? 'deforms' : 'persists';
}

/**
 * Stage-4 persistence probe: lock at a Burrau basin boundary, then
 * sweep tilt₁ from 0 to π/2 along a chosen latent dimension. Returns
 * the per-tilt summary so the caller can plot persistence.
 *
 * Caller supplies a `tileSummary` function that, given a `ViewState`,
 * returns the visible tile's `TileReduction`. This decouples the probe
 * from the GPU dispatcher.
 */
export async function probePersistence(
  startView: ViewState,
  pixel: { s: number; t: number },
  tiltTarget: number,
  steps: number,
  tileSummary: (v: ViewState) => Promise<{
    outcome_impurity: number;
    coherence_score:  number;
    word?:            string;
  }>,
): Promise<PersistenceResult> {
  const trace: PersistenceTracePoint[] = [];
  const locked = lockAffine(startView, pixel);
  for (let i = 0; i < steps; i++) {
    const tau = (i / Math.max(1, steps - 1)) * (Math.PI / 2);
    const tilted = setTilts(locked, { tilt1: tau, tilt1Target: tiltTarget });
    const summary = await tileSummary(tilted);
    trace.push({
      tau,
      outcomeImpurity: summary.outcome_impurity,
      coherenceScore:  summary.coherence_score,
      freeGroupWord:   summary.word ?? null,
    });
  }
  return { trace, verdict: classifyPersistence(trace) };
}
```

## `src/burrau/stages.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import type { Vec3 } from '@/math/types.js';
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';
import { burrauTriangle } from './euclid.js';
import { makeAcuteAngleKChart } from './acute_angle.js';
import { makeBurrauMassChart }  from './mass_chart.js';
import { makeThetaKStrip, makeThetaDeltaMStrip } from './bifurcation.js';

/**
 * Frozen-configuration params for running the (L_z, E)/(L_z, K) charts
 * at a Burrau shape: the hyperspherical (α, β) of the ν-triangle plus
 * its natural masses. Wire the result into `ChartView.chartParams` (and
 * `view.m`). The lz decode realises the shape at the R̃ = 1 gauge, so
 * the triangle is rescaled — the SHAPE (α, β, side ratios) is what
 * carries over, exactly as the chart contract requires.
 */
export function burrauLzEParams(nu: number): {
  alpha: number; beta: number; m: Vec3;
} {
  const { r, m } = burrauTriangle(nu);
  const { rho, lambda } = particlePositionsToJacobi(r, m);
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rhoT    = Math.hypot(rho[0], rho[1]) * Math.sqrt(muRho);
  const lambdaT: [number, number] = [lambda[0] * Math.sqrt(muLambda),
                                     lambda[1] * Math.sqrt(muLambda)];
  const alpha = Math.atan2(Math.hypot(lambdaT[0], lambdaT[1]), rhoT);
  const beta  = Math.atan2(lambdaT[1], lambdaT[0]);
  return { alpha, beta, m };
}

/**
 * The Stage 1a → 4 escalation, materialised as concrete `Chart` objects
 * keyed by stage. The renderer / tile dispatcher reads these directly.
 */
export const burrauStages = {
  /** Stage 1a: discrete primitive triples at rest. Just a UI layer over
   *  the Euclid display chart with a small landmark list. */
  '1a': {
    chart: burrauEuclidChart,
    landmarks: ['(3,4,5)', '(5,12,13)', '(15,8,17)', '(7,24,25)'],
  },

  /** Stage 1b: continuous ν sweep. Same chart, no landmarks pinned. */
  '1b': { chart: burrauEuclidChart, landmarks: [] as string[] },

  /** Stage 2a: continuous masses at fixed ν (ν₀ = 1/2 → (3,4,5)). */
  '2a': makeBurrauMassChart(0.5),

  /** Stage 2b: (L_z, E) at fixed (3,4,5) shape & masses — the caller
   *  wires `burrauLzEParams(0.5)` into ChartView.chartParams / view.m. */
  '2b': lzEChart,

  /** Stage 3 (combined): mass × kinetic-energy strip. */
  '3': makeThetaDeltaMStrip({ mTarget: [1 / 3, 1 / 3, 1 / 3] }),

  /** Stage 4: full 8D — handled at the interaction layer via tilt
   *  sweeps. The probe lives in `hypothesis_probe.ts`. */
  '4_probe': null as Chart | null,

  /** Bonus: bifurcation strips. */
  thetaK:     makeThetaKStrip({ Kmax: 2, gammaK: 2 }),
  thetaDelta: makeThetaDeltaMStrip({ mTarget: [1 / 3, 1 / 3, 1 / 3] }),

  acuteK:     makeAcuteAngleKChart({ Kmax: 2, gammaK: 2 }),
};
```

## `src/burrau/index.ts`

```ts
export * from './euclid.js';
export * from './triples.js';
export * from './acute_angle.js';
export * from './mass_chart.js';
export * from './bifurcation.js';
export * from './hypothesis_probe.js';
export * from './stages.js';
```

## Tests

Unit tests: `euclid.test.ts` (Euclid identities, θ↔ν round trip, the
canonical (3,4,5) reference r₁=(0.6,0)/r₂=(0,0.8) with masses
(5,4,3)/12, distinct geometries for the first four primitive triples,
ν recovery), `triples.test.ts` (primitive enumeration, non-primitive
rejection, nearest-landmark), `acute_angle.test.ts` (invariant flag,
K = 0 rest start, and the decoded state carrying the requested K
EXACTLY to 1e-12 — the seed must include the √μ_ρ factor),
`stages.test.ts` (stage wiring + the `burrauLzEParams` handoff pinning
3 : 4 : 5 side ratios through the lz_e decode at the R̃ = 1 gauge).

### `test/golden/burrau_family_345.test.ts`

Three parts:

1. **Chart-pipeline exactness.** `burrauEuclidChart.decode([0.5, 0.5])`
   (ν = 1/2 sits at v = 0.5 of ν ∈ [1/32, 31/32]) returns masses
   (5, 4, 3)/12 exactly, a rest start, and side lengths 0.6 / 0.8 / 1.0
   to 1e-12 (canonicalisation is an isometry).
2. **f64 reference classification (the golden).** The adaptive inspector
   (epsRel 1e-11, epsAbs 1e-13, hMin 1e-13) classifies the canonical IC
   as `collision` with tEnd ∈ (4.89, 4.92), dMin < 1e-4 and
   ΔE_max < 1e-7. Generated once by a tolerance sweep (identical
   classification and time across epsRel 1e-9..1e-11 and hMax
   1e-2/2e-3), then pinned. The Szebehely–Peters t ≈ 60 escape needs
   G19 regularization; the non-regularized symplectic path blows up
   (drift ~1e+4) and must NOT be used as the reference here.
3. **Distinctness.** The first four primitive triples decode to four
   distinct leg ratios through the chart.

### `test/golden/burrau_persistence_probe.test.ts`

The Stage-4 probe with an injected synthetic `tileSummary`: 30 steps,
monotone τ, decaying impurity, and verdict `dissolves` (end impurity
0.1 < τ_imp) — the probe yields a verdict, not just a trace.

## Run it

```bash
npm test -- --run test/unit/burrau
npm test -- --run test/golden/burrau_family_345 test/golden/burrau_persistence_probe
```

## Acceptance check

```bash
npm test -- --run test/golden/burrau_family_345 test/golden/burrau_persistence_probe
```

The canonical (3, 4, 5) IC emerges exactly from the chart pipeline; its
f64 classification is pinned (collision at t ≈ 4.905 at project
thresholds); the persistence probe runs cleanly over 30 steps and yields
a smooth trace + verdict.

## Notes for the implementer

- **D11.1 — the geometry reconciliation.** M1's Burrau golden fixture
  (`test/golden/burrau.test.ts`, r₁ = (0.8, 0), r₂ = (0, 0.6)) is the
  LEGS-SWAPPED variant of the canonical spec IC (eq. `burrau_positions`:
  each mass opposite its own side — mass 4/12 on the 0.6 leg). The
  canonical IC's f64 truth at project thresholds is a sub-`r_coll`
  encounter at t ≈ 4.905 (converged; the adaptive inspector agrees
  across tolerances), which the fixed-substep symplectic path cannot
  resolve — it steps over the minimum and produces drift ~1e+4. The M1
  fixture is kept, relabelled as an integrator regression (its milder
  encounter history gives a stable outcome + pinned drift envelope);
  M11's golden pins the canonical truth via the inspector. G19
  regularization is what unlocks the classical t ≈ 60 escape.
- **Stage 4 wiring.** `probePersistence` accepts an injected
  `tileSummary` function so it works in tests without the GPU. In
  production, the function dispatches a one-shot tile compute
  (the tile centred on the locked pixel at the smallest depth), reads
  back the `TileReduction`, and returns the relevant fields. M5's
  `planFrame` already handles the dispatch.
- **Exact-K seeds.** A radial Jacobi momentum seed carries kinetic
  energy |p_ρ|²/(2μ_ρ) — set |p_ρ| = √(2 K μ_ρ) or the chart's K axis is
  silently off by 1/μ_ρ (D11.3). Pinned to 1e-12 by the unit tests.
- **Mass-axis charts and `requires_per_pixel_mass`.** Stage 2a, Stage 3,
  and the (θ, δm) strip all set this flag. The integration shader (M3 +
  M6) already reads `m_i` from `ICDescriptor` per pixel rather than from
  `SimUniforms.m[3]`, so no change is needed at this milestone — but the
  flag exists so dispatchers can refuse fixed-mass shortcuts in
  Burrau-family contexts.
- **Burrau Jacobi vector convention.** The classical Burrau labelling
  (1-indexed: body 1 at right angle) is preserved inside `euclid.ts` only
  to make formulae easy to compare with the literature. Every emitted
  `(m, r)` is already 0-indexed for the rest of the pipeline.
- **Acute angle range.** The chart maps θ ∈ (0, π/4]. θ = 0 is the
  degenerate limit ν → 1 (isoceles right triangle's mirror); θ = π/4 is
  ν → 0 (degenerate elongated triangle). The chart's small `theta_min`
  buffer keeps both ends finite.
- Detailed chart conventions: the `principia-charts` skill.
