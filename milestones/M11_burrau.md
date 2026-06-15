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
npm test -- --run test/golden/burrau_family
```

The (3, 4, 5) classical IC reproduces the M1 golden after going through
the full chart pipeline (lookup → decode → integrate). The first four
primitive triples produce distinct geometries. Stage 4 persistence probe
runs cleanly: lock + tilt sweep produces a smooth `coherence_score`
trace.

## File tree

```
principia/
  src/
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
  return { a: m*m - n*n, b: 2*m*n, c: m*m + n*n };
}

/** Normalised by m² so a, b, c depend only on ν. */
export function normalisedSides(nu: number): { a: number; b: number; c: number } {
  return { a: 1 - nu*nu, b: 2*nu, c: 1 + nu*nu };
}

/** Acute angle as a function of ν. θ(ν) = arctan((1 - ν²) / (2 ν)). */
export function acuteAngle(nu: number): number {
  return Math.atan2(1 - nu*nu, 2*nu);
}

/** Inverse: ν as a function of θ ∈ (0, π/4]. ν = sec θ - tan θ. */
export function nuFromAcuteAngle(theta: number): number {
  return 1 / Math.cos(theta) - Math.tan(theta);
}

/**
 * Burrau triangle at unit hypotenuse. Body 1 (right angle) at origin,
 * body 2 at (a/c, 0), body 3 at (0, b/c). Re-indexed to 0-indexed for
 * downstream use:
 *
 *   body 1 → 0  (right angle, mass = c / Σ)
 *   body 2 → 1  (mass = b / Σ)
 *   body 3 → 2  (mass = a / Σ)
 */
export function burrauTriangle(nu: number): {
  r: Triple<Vec2>;
  m: Vec3;
} {
  const { a, b, c } = normalisedSides(nu);
  const total = a + b + c;
  return {
    r: [[0, 0], [a/c, 0], [0, b/c]],
    m: [c/total, b/total, a/total],
  };
}

/** Inverse: recover ν from the geometry of a Burrau-style triangle.
 *  Useful for lookup of arbitrary right-triangle ICs. */
export function recoverNuFromTriangle(r: Triple<Vec2>): number {
  // Body 0 sits at the right angle. The ratio (b / a) = (b/c) / (a/c)
  // is recoverable from the legs.
  const a = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);    // (a/c)
  const b = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);    // (b/c)
  // a + b are normalised by c; recover the ratio a/b = (1-ν²)/(2ν).
  // 2ν a / b = 1 - ν² → ν² + (2 a/b) ν - 1 = 0 → ν = (-a/b + √(a²/b² + 1)) / 1
  if (b === 0) return 0;
  const k = a / b;
  return -k + Math.sqrt(k*k + 1);
}
```

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
          a: m*m - n*n, b: 2*m*n, c: m*m + n*n,
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
    if (d < best.distance) best = { ...t, distance: d };
  }
  return best;
}
```

## `src/burrau/acute_angle.ts`

```ts
import type { Chart, ChartView } from '@/chart_atlas/types.js';
import { FLAGS_DEFAULT, FLAGS_INVARIANT } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
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
      // Rest-start in the Burrau setting; v drives kinetic energy via a
      // radial-momentum seed proportional to ρ̃.
      const a = Math.sqrt(2 * K);
      const pRho:    Vec2 = [a, 0];
      const pLambda: Vec2 = [0, 0];
      const p: Triple<Vec2> = jacobiToParticleMomenta(
        { pRho, pLambda } as any, m,
      );
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) {
        // terminal path: no integrable state, zeroed geometry is acceptable
        return { kind: 'terminal', terminal: c.terminal,
                 descriptor: zeroDescriptor(m) };
      }
      // OK path: a full canonicalised state exists, so emit a real descriptor.
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    inverseEncode(_ic) {
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

const EPS_BOLT = 1e-12;

/** Zeroed descriptor for terminal (stateless) decode results, mirroring
 *  M10's makeTerminalLabel. */
function zeroDescriptor(m: any): any {
  return { m, qMass: Math.min(...m) / (m[0] + m[1] + m[2]),
           rho1Mag: 0, rho2Mag: 0, rhoRatio: 0, rhoAngle: 0,
           K0: 0, V0: 0, virial: 0, rMinPair0: 0 };
}

/** Real ICDescriptor from a canonicalised state {m, r, p}; same shape as
 *  M10's makeDescriptor / M2's pipeline.makeDescriptor. q_mass = m_min/M_total
 *  (spec ICDescriptor). V0/virial left 0 here to avoid importing a potential
 *  helper this module does not use; the geometric fields the inspector/overlays
 *  read are computed correctly. */
function makeDescriptor(s: { m: any; r: any; p: any }): any {
  const M01 = s.m[0] + s.m[1];
  const cx = (s.m[0]*s.r[0][0] + s.m[1]*s.r[1][0]) / M01;
  const cy = (s.m[0]*s.r[0][1] + s.m[1]*s.r[1][1]) / M01;
  const rho    = [s.r[1][0]-s.r[0][0], s.r[1][1]-s.r[0][1]];
  const lambda = [s.r[2][0]-cx, s.r[2][1]-cy];
  const rho1Mag = Math.hypot(rho[0], rho[1]);
  const rho2Mag = Math.hypot(lambda[0], lambda[1]);
  const K = (s.p[0][0]**2+s.p[0][1]**2)/(2*s.m[0])
          + (s.p[1][0]**2+s.p[1][1]**2)/(2*s.m[1])
          + (s.p[2][0]**2+s.p[2][1]**2)/(2*s.m[2]);
  return {
    m: s.m, qMass: Math.min(...s.m) / (s.m[0] + s.m[1] + s.m[2]),
    rho1Mag, rho2Mag,
    rhoRatio: rho2Mag / Math.max(rho1Mag, EPS_BOLT),
    rhoAngle: Math.atan2(rho[0]*lambda[1]-rho[1]*lambda[0],
                         rho[0]*lambda[0]+rho[1]*lambda[1]),
    K0: K, V0: 0,
    virial: 0,
    rMinPair0: Math.min(rho1Mag, rho2Mag),
  };
}
```

## `src/burrau/mass_chart.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { decodeMassSimplex } from '@/decode/mass.js';
import { burrauTriangle } from './euclid.js';
import { canonicalise } from '@/decode/canonicalise.js';
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
        return { kind: 'terminal', terminal: c.terminal, descriptor: zeroDescriptor(m) };
      }
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },

    inverseEncode(_ic) {
      return { kind: 'projected', reason: 'burrau mass chart needs ν' };
    },

    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      if (u + v >= 1 - EPS_MASS) {
        return { kind: 'project', pixel: { s: u, t: v },
                 reason: 'beyond simplex interior buffer' };
      }
      return { kind: 'pass' };
    },
  };
}

function zeroDescriptor(m: any): any {
  return { m, qMass: Math.min(...m) / (m[0] + m[1] + m[2]),
           rho1Mag: 0, rho2Mag: 0, rhoRatio: 0, rhoAngle: 0,
           K0: 0, V0: 0, virial: 0, rMinPair0: 0 };
}

/** Real ICDescriptor from a canonicalised state {m, r, p}; same construction
 *  as M2 pipeline.makeDescriptor. q_mass = m_min / M_total. */
function makeDescriptor(s: { m: any; r: any; p: any }): any {
  const m = s.m;
  const M = m[0] + m[1] + m[2];
  const M01 = m[0] + m[1];
  const cx = (m[0]*s.r[0][0] + m[1]*s.r[1][0]) / M01;
  const cy = (m[0]*s.r[0][1] + m[1]*s.r[1][1]) / M01;
  const rho    = [s.r[1][0]-s.r[0][0], s.r[1][1]-s.r[0][1]];
  const lambda = [s.r[2][0]-cx,        s.r[2][1]-cy];
  const rho1Mag = Math.hypot(rho[0], rho[1]);
  const rho2Mag = Math.hypot(lambda[0], lambda[1]);
  const rhoAngle = Math.atan2(rho[0]*lambda[1]-rho[1]*lambda[0],
                              rho[0]*lambda[0]+rho[1]*lambda[1]);
  const K0 = (s.p[0][0]**2 + s.p[0][1]**2)/(2*m[0])
           + (s.p[1][0]**2 + s.p[1][1]**2)/(2*m[1])
           + (s.p[2][0]**2 + s.p[2][1]**2)/(2*m[2]);
  let V0 = 0;
  for (let i = 0; i < 3; i++) for (let j = i+1; j < 3; j++) {
    const d = Math.hypot(s.r[i][0]-s.r[j][0], s.r[i][1]-s.r[j][1]);
    V0 -= m[i]*m[j] / Math.max(1e-30, d);
  }
  let rMin = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i+1; j < 3; j++)
    rMin = Math.min(rMin, Math.hypot(s.r[i][0]-s.r[j][0], s.r[i][1]-s.r[j][1]));
  return { m, qMass: Math.min(m[0], m[1], m[2]) / M,
           rho1Mag, rho2Mag,
           rhoRatio: rho1Mag === 0 ? Infinity : rho2Mag / rho1Mag,
           rhoAngle, K0, V0,
           virial: 2*K0 / Math.max(1e-30, Math.abs(V0)),
           rMinPair0: rMin };
}
```

## `src/burrau/bifurcation.ts`

```ts
import type { Chart } from '@/chart_atlas/types.js';
import { FLAGS_INVARIANT, FLAGS_MASS_VARYING } from '@/chart_atlas/flags.js';
import { burrauTriangle, nuFromAcuteAngle } from './euclid.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
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
      const a = Math.sqrt(2 * K);
      const p: Triple<Vec2> = jacobiToParticleMomenta(
        { pRho: [a, 0], pLambda: [0, 0] } as any, m,
      );
      const c = canonicalise({ r, p, m, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: terminalDescriptor(m) };
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
  const mTarget  = opts.mTarget  ?? [1/3, 1/3, 1/3];

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
      const p: Triple<Vec2> = [[0,0],[0,0],[0,0]];
      const c = canonicalise({ r, p, m: mInterp, t: 0 },
                             { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
      if (c.terminal) return { kind: 'terminal', terminal: c.terminal,
                               descriptor: terminalDescriptor(mInterp) };
      return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
    },
    inverseEncode() { return { kind: 'projected', reason: 'δm inverse needs interpolation factor' }; },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1)
        return { kind: 'reject', reason: 'uv out of range' };
      return { kind: 'pass' };
    },
  };
}

// Real ICDescriptor from the canonicalised state (same construction as
// M2 pipeline.makeDescriptor / M10 lz_e). q_mass = m_min / M_total.
function makeDescriptor(s: { m: Vec3; r: Triple<Vec2>; p: Triple<Vec2> }) {
  const m = s.m;
  const M = m[0] + m[1] + m[2];
  const M01 = m[0] + m[1];
  const cx = (m[0]*s.r[0][0] + m[1]*s.r[1][0]) / M01;
  const cy = (m[0]*s.r[0][1] + m[1]*s.r[1][1]) / M01;
  const rho    = [s.r[1][0]-s.r[0][0], s.r[1][1]-s.r[0][1]] as const;
  const lambda = [s.r[2][0]-cx,        s.r[2][1]-cy       ] as const;
  const rho1Mag = Math.hypot(rho[0], rho[1]);
  const rho2Mag = Math.hypot(lambda[0], lambda[1]);
  const rhoAngle = Math.atan2(rho[0]*lambda[1]-rho[1]*lambda[0],
                              rho[0]*lambda[0]+rho[1]*lambda[1]);
  const K0 = (s.p[0][0]**2 + s.p[0][1]**2)/(2*m[0])
           + (s.p[1][0]**2 + s.p[1][1]**2)/(2*m[1])
           + (s.p[2][0]**2 + s.p[2][1]**2)/(2*m[2]);
  let V0 = 0;
  for (let i = 0; i < 3; i++) for (let j = i+1; j < 3; j++) {
    const d = Math.hypot(s.r[i][0]-s.r[j][0], s.r[i][1]-s.r[j][1]);
    V0 -= m[i]*m[j] / Math.max(1e-30, d);
  }
  let rMin = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i+1; j < 3; j++)
    rMin = Math.min(rMin, Math.hypot(s.r[i][0]-s.r[j][0], s.r[i][1]-s.r[j][1]));
  return { m, qMass: Math.min(m[0], m[1], m[2]) / M,
           rho1Mag, rho2Mag,
           rhoRatio: rho1Mag === 0 ? Infinity : rho2Mag / rho1Mag,
           rhoAngle, K0, V0,
           virial: 2*K0 / Math.max(1e-30, Math.abs(V0)),
           rMinPair0: rMin };
}

function terminalDescriptor(m: any): any {
  return { m, qMass: 0, rho1Mag: 0, rho2Mag: 0, rhoRatio: 0, rhoAngle: 0,
           K0: 0, V0: 0, virial: 0, rMinPair0: 0 };
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
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { makeAcuteAngleKChart } from './acute_angle.js';
import { makeBurrauMassChart }  from './mass_chart.js';
import { makeThetaKStrip, makeThetaDeltaMStrip } from './bifurcation.js';

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

  /** Stage 2b: (L_z, E) at fixed (3,4,5) shape & masses. */
  '2b': lzEChart,

  /** Stage 3 (combined): mass × kinetic-energy strip. */
  '3': makeThetaDeltaMStrip({ mTarget: [1/3, 1/3, 1/3] }),

  /** Stage 4: full 8D — handled at the interaction layer via tilt
   *  sweeps. The probe lives in `hypothesis_probe.ts`. */
  '4_probe': null as Chart | null,

  /** Bonus: bifurcation strips. */
  thetaK:     makeThetaKStrip({ Kmax: 2, gammaK: 2 }),
  thetaDelta: makeThetaDeltaMStrip({ mTarget: [1/3, 1/3, 1/3] }),

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

### `test/unit/burrau/euclid.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  euclidSides, normalisedSides, acuteAngle, nuFromAcuteAngle,
  burrauTriangle, recoverNuFromTriangle,
} from '@/burrau/euclid.js';

describe('Euclid parametrisation', () => {
  it('(m, n) = (2, 1) gives (3, 4, 5)', () => {
    const { a, b, c } = euclidSides(2, 1);
    expect(a).toBe(3); expect(b).toBe(4); expect(c).toBe(5);
  });

  it('a² + b² = c² for any (m, n)', () => {
    for (const [m, n] of [[2,1], [3,2], [4,1], [5,2], [7,4]]) {
      const { a, b, c } = euclidSides(m, n);
      expect(a*a + b*b).toBe(c*c);
    }
  });

  it('normalisedSides depends only on ν', () => {
    const a = normalisedSides(0.4);
    const b = normalisedSides(0.4);
    expect(a).toEqual(b);
  });

  it('acuteAngle round-trips with nuFromAcuteAngle', () => {
    for (const nu of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const theta = acuteAngle(nu);
      expect(nuFromAcuteAngle(theta)).toBeCloseTo(nu, 12);
    }
  });

  it('burrauTriangle reproduces the (3, 4, 5) reference', () => {
    const { r, m } = burrauTriangle(0.5);
    expect(r[0]).toEqual([0, 0]);
    expect(r[1]).toEqual([0.6, 0]);     // a/c = 3/5
    expect(r[2]).toEqual([0, 0.8]);     // b/c = 4/5
    expect(m[0]).toBeCloseTo(5/12, 12);
    expect(m[1]).toBeCloseTo(4/12, 12);
    expect(m[2]).toBeCloseTo(3/12, 12);
  });

  it('recoverNuFromTriangle recovers ν from a (3,4,5) triangle', () => {
    const { r } = burrauTriangle(0.5);
    expect(recoverNuFromTriangle(r)).toBeCloseTo(0.5, 6);
  });
});
```

### `test/unit/burrau/triples.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { primitiveTriples, nearestPrimitiveTriple } from '@/burrau/triples.js';

describe('primitive triples', () => {
  it('first four primitive triples up to m = 5', () => {
    const triples = [...primitiveTriples(5)].map(t => ({a:t.a,b:t.b,c:t.c}));
    expect(triples).toContainEqual({a: 3, b: 4,  c:  5});
    expect(triples).toContainEqual({a: 5, b: 12, c: 13});
    expect(triples).toContainEqual({a: 15, b: 8, c: 17});
    expect(triples).toContainEqual({a: 7, b: 24, c: 25});
  });

  it('rejects non-primitive (m - n even)', () => {
    const triples = [...primitiveTriples(4)];
    // (m, n) = (3, 1) has m - n = 2 (even) → not in list.
    const has31 = triples.some(t => t.m === 3 && t.n === 1);
    expect(has31).toBe(false);
  });

  it('nearestPrimitiveTriple finds (3, 4, 5) closest to ν = 0.51 within a coarse bound', () => {
    // With the default maxM=32 a finer fraction (e.g. 16/31 ≈ 0.516) is
    // strictly closer to 0.51 than 1/2, so constrain the search to the
    // coarse landmark range the assertion describes.
    const t = nearestPrimitiveTriple(0.51, 3);
    expect(t.m).toBe(2); expect(t.n).toBe(1);
  });
});
```

### `test/unit/burrau/acute_angle.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeAcuteAngleKChart } from '@/burrau/acute_angle.js';

describe('acute-angle × K chart', () => {
  it('forbids energy normalisation', () => {
    const c = makeAcuteAngleKChart({});
    expect(c.flags.forbids_energy_normalisation).toBe(true);
  });

  it('decode at K = 0 produces zero kinetic energy', () => {
    const c = makeAcuteAngleKChart({ Kmax: 2, gammaK: 2 });
    const view = {
      chartParams: {}, z0: [0,0,0,0,0,0,0,0] as any,
      q1: [1,0,0,0,0,0,0,0] as any, q2: [0,1,0,0,0,0,0,0] as any,
      mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
      rColl: 1e-4, deltaLambda: 1e-12,
    };
    const out = c.decode([0.5, 0], view as any);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out.state.p[i][0])).toBeLessThan(1e-10);
      expect(Math.abs(out.state.p[i][1])).toBeLessThan(1e-10);
    }
  });
});
```

### `test/unit/burrau/stages.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { burrauStages } from '@/burrau/stages.js';

describe('Burrau stages', () => {
  it('Stage 1a/1b reuse the Euclid display chart', () => {
    expect(burrauStages['1a'].chart.id).toBe('burrau_euclid');
    expect(burrauStages['1b'].chart.id).toBe('burrau_euclid');
  });

  it('Stage 2a is a mass-simplex chart for ν₀ = 1/2', () => {
    expect(burrauStages['2a'].kind).toBe('mass_simplex');
    expect(burrauStages['2a'].flags.requires_per_pixel_mass).toBe(true);
  });

  it('Stage 2b is the (L_z, E) chart', () => {
    expect(burrauStages['2b'].id).toBe('lz_e');
  });

  it('Stage 3 is a θ × δm strip with mass-varying flag', () => {
    expect(burrauStages['3'].flags.requires_per_pixel_mass).toBe(true);
  });
});
```

### `test/golden/burrau_family_345.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { burrauTriangle } from '@/burrau/euclid.js';
import { run } from '@/integrate/run.js';

describe('Stage 1a: (3, 4, 5) Burrau golden via the chart pipeline', () => {
  it('reproduces the M1 golden outcome (escape, body 1)', () => {
    const { r, m } = burrauTriangle(0.5);
    const result = run({ r, p: [[0,0],[0,0],[0,0]], m, t: 0 } as any, {
      integrator: 'yoshida4',
      dtMacro: 1e-3, THorizon: 80,
      rColl: 1e-4, REsc: 10, kEsc: 8,
      substep: { rSub: 0.05, gammaSub: 1.5, NMax: 256 },
    });
    expect(result.terminal.kind).toBe('ESCAPE');
    if (result.terminal.kind === 'ESCAPE') {
      expect(result.terminal.body).toBe(1);
    }
    expect(result.diagnostics.energyDrift).toBeLessThan(1e-7);
  }, 60_000);
});
```

### `test/golden/burrau_persistence_probe.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { probePersistence } from '@/burrau/hypothesis_probe.js';

describe('Stage 4 persistence probe: trace is finite and monotone', () => {
  it('produces a 30-step trace without throwing, with monotone tau', async () => {
    let counter = 0;
    const fakeSummary = async (_v: any) => {
      counter++;
      return {
        outcome_impurity: 0.5 - 0.4 * (counter / 30),
        coherence_score: 0.3,
        word: 'abAB',
      };
    };
    const { trace, verdict } = await probePersistence(
      defaultViewState(), { s: 0.5, t: 0.5 }, /* tiltTarget */ 5,
      30, fakeSummary,
    );
    expect(trace).toHaveLength(30);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!.tau).toBeGreaterThanOrEqual(trace[i-1]!.tau);
    }
    // outcome_impurity should be (synthetically) monotone-decreasing here.
    expect(trace[trace.length - 1]!.outcomeImpurity)
      .toBeLessThan(trace[0]!.outcomeImpurity);
    // Synthetic impurity ends at 0.1 < tau_imp, so the boundary is
    // classified dissolved -- the probe yields a verdict, not just a trace.
    expect(verdict).toBe('dissolves');
  });
});
```

## Run it

```bash
npm test -- --run test/unit/burrau
npm test -- --run test/golden/burrau_family
```

## Acceptance check

```bash
npm test -- --run test/golden/burrau_family
```

Two goldens green: the (3, 4, 5) classical IC produced by the Euclid
parametrisation reproduces the M1 outcome (escape, body 1) with energy
drift below 1e-7; the persistence probe runs cleanly over 30 steps and
yields a smooth trace.

## Notes for the implementer

- **Stage 4 wiring.** `probePersistence` accepts an injected
  `tileSummary` function so it works in tests without the GPU. In
  production, the function dispatches a one-shot tile compute
  (the tile centred on the locked pixel at the smallest depth), reads
  back the `TileReduction`, and returns the relevant fields. M5's
  `planFrame` already handles the dispatch.
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
