# M10 — Chart instantiations

## Goal

Promote charts from a hard-coded latent slice (M3) to a registered set of
chart objects, each with three operations: `decode(uv)`, `inverseEncode(ic)`,
`validate(uv)`. The GPU compute shader stays chart-agnostic — it reads
`(m_i, r_i, p_i)` regardless of which chart produced them.

After M10: latent affine slice, `(L_z, E)`, `(L_z, K)`, shape sphere with
hover streamline, ternary mass plot, mixed-axis factory, all wired
through the `chartRegistry`. Each chart declares its compatibility flags
(`forbids_energy_normalisation`, `has_redundant_hemisphere`,
`requires_per_pixel_mass`) so the validation pass and the integration
shader can react.

**Exit criterion.**

```bash
npm test -- --run test/integration/chart_totality test/integration/chart_lock_handoff
```

Every registered chart's `Φ` is total on `[0, 1]²` (no NaN, every pixel
either ok or terminal). Lock at the equilateral-triangle pixel in the
shape-sphere chart, switch to `(L_z, E)` chart at `K = 0`: lands at the
feasibility-parabola apex `(L_z = 0, E = U)`. The mass-simplex chart
respects the interior buffer at every corner.

**Deliverable:** internal — tests only (no visible artifact until a later GPU/UI milestone); a `chartRegistry` of total `(decode, inverseEncode, validate)` chart objects (latent affine, `(L_z, E)`, `(L_z, K)`, shape sphere, ternary mass, mixed-axis) with compatibility flags, all exercised headlessly.

## File tree

```
principia/
  src/
    decode/
      pipeline.ts             # EDIT: export makeDescriptor + makeTerminal
    chart_atlas/
      types.ts
      registry.ts
      flags.ts
      validation.ts
      frozen_configuration.ts
      momentum_construction.ts
      charts/
        latent_slice.ts
        lz_e.ts
        lz_k.ts
        shape_sphere.ts
        mass_simplex.ts
        burrau_euclid.ts
        mixed_axis.ts
      index.ts
  test/
    unit/charts/
      latent_slice.test.ts
      lz_e.test.ts
      lz_k.test.ts
      shape_sphere.test.ts
      mass_simplex.test.ts
      mixed_axis.test.ts
      validation.test.ts
    integration/
      chart_totality.test.ts
      chart_lock_handoff.test.ts
```

(The `chart.wgsl` dispatch hook stays reserved — see the notes; M10 ships
no chart-specific WGSL, so no shader file appears in the tree.)

## `src/decode/pipeline.ts` (edit)

Export M2's private helpers — they become the ONLY descriptor
constructors, shared by every chart (D10.1):

```ts
/** Terminal-before-geometry helper: labelled terminal + mass-only descriptor. */
export function makeTerminal(
  terminal: TerminalLabel, m: TrajState['m'],
): DecodeResult { /* unchanged body */ }

/** The ONE ICDescriptor constructor (q_mass = m_min / M_total, etc.). */
export function makeDescriptor(s: TrajState): ICDescriptor { /* unchanged body */ }
```

Charts NEVER re-implement descriptors: earlier drafts of this doc carried
three inline copies that drifted (`qMass: Math.min(...m)` instead of the
canonical `m_min / M_total`). Terminal-with-state (canonicalise says
terminal) uses `makeDescriptor(c.state)`; terminal-before-geometry uses
`makeTerminal(label, m)`.

## `src/chart_atlas/types.ts`

```ts
import type { Vec2, Vec3, Vec8, TerminalLabel, TrajState } from '@/math/types.js';
import type { ICDescriptor } from '@/decode/types.js';

export type ChartId =
  | 'latent_slice'
  | 'lz_e' | 'lz_k'
  | 'shape_sphere'
  | 'mass_simplex'
  | 'burrau_euclid'
  | 'mixed_axis';

export type ChartKind = 'affine' | 'invariant' | 'sphere' | 'mass_simplex' | 'mixed';

/** Each chart declares the compatibility flags downstream code reads. */
export interface ChartFlags {
  forbids_energy_normalisation: boolean;
  has_redundant_hemisphere:     boolean;
  requires_per_pixel_mass:      boolean;
}

export interface ChartDecodeOk {
  kind: 'ok';
  state: TrajState;
  descriptor: ICDescriptor;
}

export interface ChartDecodeTerminal {
  kind: 'terminal';
  terminal: TerminalLabel;
  descriptor: ICDescriptor;
}

export type ChartDecodeOut = ChartDecodeOk | ChartDecodeTerminal;

export type ValidationResult =
  | { kind: 'pass' }
  | { kind: 'project'; pixel: { s: number; t: number }; reason: string }
  | { kind: 'clamp';   pixel: { s: number; t: number }; reason: string }
  | { kind: 'reject';  reason: string };

export interface EncodeResult {
  kind: 'exact' | 'projected' | 'rejected';
  pixel?: { s: number; t: number };
  reason?: string;
  z?:    Vec8;
  clamped?: boolean;
}

export interface Chart {
  id:    ChartId;
  kind:  ChartKind;
  flags: ChartFlags;
  /** Map a tile-local (u, v) ∈ [0, 1]² to a physical IC. */
  decode(uv: Vec2, view: ChartView): ChartDecodeOut;
  /** Project a physical IC back to chart pixel space. */
  inverseEncode(ic: TrajState): EncodeResult;
  /** Validate (uv) is a representable point in the chart for this view. */
  validate(uv: Vec2, view: ChartView): ValidationResult;
  /** Optional: chart-specific WGSL fragment to inline at dispatch time. */
  wgsl?: string;
}

/** Chart-aware subset of ViewState that decode/validate need. */
export interface ChartView {
  chartParams: Record<string, unknown>;
  z0:          Vec8;
  q1:          Vec8;
  q2:          Vec8;
  mag:         number;
  m?:          Vec3;
  alphaMin:    number;
  muMax:       number;
  qMax:        number;
  rColl:       number;
  deltaLambda: number;
}
```

Note `ChartView.chartParams` is `Record<string, unknown>` under
`noUncheckedIndexedAccess`: read params as
`(view.chartParams['alpha'] as number | undefined) ?? DEFAULT`.

## `src/chart_atlas/flags.ts`

```ts
import type { ChartFlags } from './types.js';

export const FLAGS_DEFAULT: ChartFlags = {
  forbids_energy_normalisation: false,
  has_redundant_hemisphere:     false,
  requires_per_pixel_mass:      false,
};

export const FLAGS_INVARIANT: ChartFlags = {
  ...FLAGS_DEFAULT,
  forbids_energy_normalisation: true,
};

export const FLAGS_SPHERE: ChartFlags = {
  ...FLAGS_DEFAULT,
  has_redundant_hemisphere: true,
};

export const FLAGS_MASS_VARYING: ChartFlags = {
  ...FLAGS_DEFAULT,
  requires_per_pixel_mass: true,
};
```

## `src/chart_atlas/registry.ts`

```ts
import type { Chart, ChartId } from './types.js';

const charts = new Map<ChartId, Chart>();

export function registerChart(c: Chart): void {
  if (charts.has(c.id)) throw new Error(`chart ${c.id} already registered`);
  charts.set(c.id, c);
}

export function getChart(id: ChartId): Chart {
  const c = charts.get(id);
  if (!c) throw new Error(`chart ${id} not registered`);
  return c;
}

export function allCharts(): readonly Chart[] {
  return [...charts.values()];
}
```

## `src/chart_atlas/frozen_configuration.ts`

One realisation helper shared by every chart that fixes geometry
((L_z, E)/(L_z, K), shape sphere, mass simplex) — one copy, not three
(D10.3). Do NOT build this by calling `decodeConfigCanonical` and
mutating its output: `ConfigCanonical`'s `Vec2`s are readonly tuples and
the mutation does not typecheck.

```ts
import type { Vec2, Vec3, Triple } from '@/math/types.js';
import { jacobiToParticlePositions } from '@/decode/jacobi_particle.js';

/**
 * Realise a frozen configuration (α, β) at the R̃ = 1 hyperspherical
 * gauge: ρ̃ = [cos α, 0], λ̃ = [sin α cos β, sin α sin β], unweighted by
 * √μ and reconstructed to particle positions in the COM frame.
 *
 * At this gauge the COM-frame moment of inertia is
 * I = Σ mᵢ|rᵢ|² = |ρ̃|² + |λ̃|² = 1, which the momentum construction
 * relies on.
 */
export function realiseFrozenConfig(
  alpha: number, beta: number, m: Vec3,
): Triple<Vec2> {
  const rhoT:    Vec2 = [Math.cos(alpha), 0];
  const lambdaT: Vec2 = [Math.sin(alpha) * Math.cos(beta),
                         Math.sin(alpha) * Math.sin(beta)];
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rho:    Vec2 = [rhoT[0] / Math.sqrt(muRho), rhoT[1] / Math.sqrt(muRho)];
  const lambda: Vec2 = [lambdaT[0] / Math.sqrt(muLambda),
                        lambdaT[1] / Math.sqrt(muLambda)];
  return jacobiToParticlePositions(rho, lambda, m);
}
```

## `src/chart_atlas/momentum_construction.ts`

The ONE deterministic momentum construction, kind-tagged so charts map
failures onto ADR-0007 codes (D10.2). Never copy it inline.

```ts
import type { Vec2, Vec3, Triple } from '@/math/types.js';
import { J } from '@/math/vec.js';

/**
 * Deterministic momentum construction at fixed (L_z, K*). Used by the
 * (L_z, E) and (L_z, K) charts (they share it: with the configuration
 * frozen, E = U(r) + K*, so the E-axis is the K-axis shifted by U).
 *
 *   (i)   rigid part: ω = L_z / I,  v^L_i = ω · J(r_i), carrying exactly
 *         K_min = L_z² / (2 I);
 *   (ii)  seed field w: subtract COM drift, subtract the L_z component
 *         (β = L(w)/I, w := w − β·J(r)), normalise in the mass-weighted
 *         norm Σ mᵢ|wᵢ|² = 1;
 *   (iii) mix v_i = v^L_i + a·w_i with a = √(2(K* − K_min)). Because the
 *         L_z projection makes Σ mᵢ v^L_i · wᵢ = ω·L(w) = 0, the mix hits
 *         K* and L_z exactly — no iteration.
 *
 * Returns particle VELOCITIES (caller multiplies by mᵢ for momenta).
 * ADR-0007 mapping: 'infeasible' → INFEASIBLE_ENERGY (15),
 * 'seeds_exhausted' → MOMENTUM_SEEDS_EXHAUSTED (16).
 */
export type MomentumConstruction =
  | { kind: 'ok'; v: Triple<Vec2>; usedSeed: number }
  | { kind: 'infeasible' }
  | { kind: 'seeds_exhausted' };

export function constructMomentaForLzK(
  m: Vec3, r: Triple<Vec2>, Lz: number, KTarget: number, I = 1,
): MomentumConstruction {
  const omega = Lz / I;
  const Kmin = Lz * Lz / (2 * I);

  if (KTarget < Kmin - 1e-15) return { kind: 'infeasible' };

  const vL: Triple<Vec2> = [
    [omega * -r[0][1], omega * r[0][0]],
    [omega * -r[1][1], omega * r[1][0]],
    [omega * -r[2][1], omega * r[2][0]],
  ];

  // Seed families, tried in order until one survives the projection.
  // NOTE: the all-body rotational field [J(r_0), J(r_1), J(r_2)] is the
  // pure-rotation direction — the L_z projection annihilates it to zero
  // every time, so only PARTIAL rotational seeds appear here.
  const seedFamilies: Triple<Vec2>[] = [
    [r[0], r[1], r[2]],                 // radial (ρ̃/λ̃ directions)
    [[0, 0], [0, 0], r[2]],             // outer-body radial
    [J(r[0]), J(r[1]), [0, 0]],         // partial rotation (inner pair)
    [[0, 0], [0, 0], J(r[2])],          // partial rotation (outer body)
  ];
  for (let s = 0; s < seedFamilies.length; s++) {
    const w = projectAndNormalise(seedFamilies[s]!, m, r, I);
    if (w) {
      // K* can sit within fp noise below K_min — clamp before the sqrt.
      const a = Math.sqrt(Math.max(0, 2 * (KTarget - Kmin)));
      return {
        kind: 'ok',
        usedSeed: s,
        v: [
          [vL[0][0] + a * w[0][0], vL[0][1] + a * w[0][1]],
          [vL[1][0] + a * w[1][0], vL[1][1] + a * w[1][1]],
          [vL[2][0] + a * w[2][0], vL[2][1] + a * w[2][1]],
        ],
      };
    }
  }
  return { kind: 'seeds_exhausted' };
}

function projectAndNormalise(
  seed: Triple<Vec2>, m: Vec3, r: Triple<Vec2>, I: number,
  epsW = 1e-10,
): Triple<Vec2> | null {
  // Remove COM drift.
  const M = m[0] + m[1] + m[2];
  const cx = (m[0] * seed[0][0] + m[1] * seed[1][0] + m[2] * seed[2][0]) / M;
  const cy = (m[0] * seed[0][1] + m[1] * seed[1][1] + m[2] * seed[2][1]) / M;
  let w: Triple<Vec2> = [
    [seed[0][0] - cx, seed[0][1] - cy],
    [seed[1][0] - cx, seed[1][1] - cy],
    [seed[2][0] - cx, seed[2][1] - cy],
  ];
  // Remove the L_z component: β = L(w) / I, w := w − β·J(r), where
  // L(w) = Σ mᵢ (rᵢ × wᵢ)_z.
  const Lw = m[0] * (r[0][0] * w[0][1] - r[0][1] * w[0][0])
           + m[1] * (r[1][0] * w[1][1] - r[1][1] * w[1][0])
           + m[2] * (r[2][0] * w[2][1] - r[2][1] * w[2][0]);
  const beta = Lw / I;
  w = [
    [w[0][0] + beta * r[0][1], w[0][1] - beta * r[0][0]],
    [w[1][0] + beta * r[1][1], w[1][1] - beta * r[1][0]],
    [w[2][0] + beta * r[2][1], w[2][1] - beta * r[2][0]],
  ];
  // Mass-weighted norm; reject degenerate (collinear / zero) seeds.
  const mwn2 = m[0] * (w[0][0] ** 2 + w[0][1] ** 2)
             + m[1] * (w[1][0] ** 2 + w[1][1] ** 2)
             + m[2] * (w[2][0] ** 2 + w[2][1] ** 2);
  if (mwn2 < epsW * epsW) return null;
  const inv = 1 / Math.sqrt(mwn2);
  return [
    [w[0][0] * inv, w[0][1] * inv],
    [w[1][0] * inv, w[1][1] * inv],
    [w[2][0] * inv, w[2][1] * inv],
  ];
}
```

## `src/chart_atlas/charts/latent_slice.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import { add8, scale8 } from '@/math/vec.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export const latentSliceChart: Chart = {
  id: 'latent_slice',
  kind: 'affine',
  flags: FLAGS_DEFAULT,

  decode([u, v], view) {
    const su = (2 * u - 1) * view.mag;
    const sv = (2 * v - 1) * view.mag;
    const z = add8(view.z0, add8(scale8(view.q1, su), scale8(view.q2, sv)));
    return decodeLatent(z, KNOBS);      // DecodeResult ≡ ChartDecodeOut
  },

  inverseEncode(ic) {
    const enc = inverseEncodeLatent(ic, KNOBS);
    return { kind: enc.clamped ? 'projected' : 'exact', z: enc.z, clamped: enc.clamped };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of [0, 1]² range' };
    }
    return { kind: 'pass' };
  },
};
```

## `src/chart_atlas/charts/lz_e.ts`

```ts
import type { Chart, ChartDecodeOut, ChartView } from '../types.js';
import { FLAGS_INVARIANT } from '../flags.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { constructMomentaForLzK } from '../momentum_construction.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor, makeTerminal } from '@/decode/pipeline.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import { DegenerateReason } from '@/decode/types.js';
import type { Vec2, Vec3, Triple } from '@/math/types.js';

/**
 * Shared (L_z, K*) decode for the invariant charts. With the
 * configuration frozen at (α, β), E = U(r) + K*, so the (L_z, E) chart's
 * energy axis measured relative to U is numerically identical to the
 * (L_z, K) chart's kinetic axis: one decode serves both, warped as
 * K* = Kmax · v^γ, L_z = (2u − 1) · √(2 I K*).
 */
export function decodeLzChart([u, v]: Vec2, view: ChartView): ChartDecodeOut {
  const Kmax   = (view.chartParams['Kmax']   as number | undefined) ?? 2;
  const gammaK = (view.chartParams['gammaK'] as number | undefined) ?? 2;
  const m: Vec3 = view.m ?? [1 / 3, 1 / 3, 1 / 3];

  // Configuration: frozen at caller-supplied (α, β) via chartParams
  // (M11's Burrau ternary plot supplies them per pixel); default to
  // α = π/4, β = π/2 as a reasonable centre.
  const alpha = (view.chartParams['alpha'] as number | undefined) ?? Math.PI / 4;
  const beta  = (view.chartParams['beta']  as number | undefined) ?? Math.PI / 2;
  const r = realiseFrozenConfig(alpha, beta, m);

  // Invariant-domain warp. I = 1 at the R̃ = 1 gauge.
  const I = 1;
  const K = Kmax * Math.pow(v, gammaK);
  const Lmax = Math.sqrt(2 * I * K);
  const Lz = (2 * u - 1) * Lmax;

  const mc = constructMomentaForLzK(m, r, Lz, K, I);
  if (mc.kind !== 'ok') {
    // ADR 0007: distinguish the two invariant-momentum failures.
    const reason = mc.kind === 'infeasible'
      ? DegenerateReason.INFEASIBLE_ENERGY          // 15: K* < K_min
      : DegenerateReason.MOMENTUM_SEEDS_EXHAUSTED;  // 16: all seeds failed
    return makeTerminal({ kind: 'DEGENERATE', reason }, m);
  }
  const p: Triple<Vec2> = [
    [mc.v[0][0] * m[0], mc.v[0][1] * m[0]],
    [mc.v[1][0] * m[1], mc.v[1][1] * m[1]],
    [mc.v[2][0] * m[2], mc.v[2][1] * m[2]],
  ];

  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

export const lzEChart: Chart = {
  id: 'lz_e',
  kind: 'invariant',
  flags: FLAGS_INVARIANT,

  decode(uv, view) {
    return decodeLzChart(uv, view);
  },

  inverseEncode(ic) {
    // L_z and E recover directly from the IC, but mapping them to a
    // pixel needs the chart's (Kmax, γ) — inverseEncode takes no view,
    // so return a hint, not a guess.
    const Lz = angularMomentum(ic.r, ic.p);
    const E  = totalEnergy(ic.m, ic.r, ic.p);
    return {
      kind: 'projected',
      pixel: { s: 0.5 + 0.5 * Math.sign(Lz), t: 0.5 },
      reason: `lz_e inverse needs chart params (Lz=${Lz.toPrecision(6)}, E=${E.toPrecision(6)})`,
    };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
```

## `src/chart_atlas/charts/lz_k.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_INVARIANT } from '../flags.js';
import { lzEChart } from './lz_e.js';

/**
 * (L_z, K) chart. Shares lz_e's decode outright: with the configuration
 * frozen, E = U(r) + K*, so the two charts produce identical states for
 * identical (u, v) — the axes differ only in labelling (K directly vs
 * E relative to U) and in what inverseEncode reports.
 */
export const lzKChart: Chart = {
  ...lzEChart,
  id: 'lz_k',
  flags: FLAGS_INVARIANT,

  inverseEncode(ic) {
    const K = (ic.p[0][0] ** 2 + ic.p[0][1] ** 2) / (2 * ic.m[0])
            + (ic.p[1][0] ** 2 + ic.p[1][1] ** 2) / (2 * ic.m[1])
            + (ic.p[2][0] ** 2 + ic.p[2][1] ** 2) / (2 * ic.m[2]);
    return {
      kind: 'projected',
      pixel: { s: 0.5, t: 0.5 },
      reason: `lz_k inverse needs chart params (K=${K.toPrecision(6)})`,
    };
  },
};
```

## `src/chart_atlas/charts/shape_sphere.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_SPHERE } from '../flags.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

/**
 * Shape-sphere chart: the rendering surface and the dynamical state space
 * coincide. Each pixel is a point (θ, φ) on S²; the realisation map
 * recovers the canonical Jacobi (α, β) and decodes through the shared
 * pipeline.
 *
 * The chart sets `has_redundant_hemisphere = true`: φ ∈ (π, 2π) is the
 * reflection-equivalent copy of φ ∈ (0, π).
 */
export const shapeSphereChart: Chart = {
  id: 'shape_sphere',
  kind: 'sphere',
  flags: FLAGS_SPHERE,

  decode([u, v], view) {
    const eps   = (view.chartParams['poleBuffer'] as number | undefined) ?? 0.05;
    const theta = eps + (Math.PI - 2 * eps) * u;
    const phi   = 2 * Math.PI * v;

    // Realisation map: (θ, φ) → (α, β), from the spec revision:
    //   2α = arccos(−sin θ cos φ)
    //   β  = atan2(cos θ, −sin θ sin φ), folded into [0, π].
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const alpha = Math.acos(-sinT * cosPhi) / 2;
    let beta = Math.atan2(cosT, -sinT * sinPhi);
    if (beta < 0) beta += 2 * Math.PI;
    if (beta > Math.PI) beta = 2 * Math.PI - beta;     // hemisphere fold

    const m = view.m ?? [1 / 3, 1 / 3, 1 / 3];
    const r = realiseFrozenConfig(alpha, beta, m);

    const pRho    = (view.chartParams['pRho']    as Vec2 | undefined) ?? [0, 0];
    const pLambda = (view.chartParams['pLambda'] as Vec2 | undefined) ?? [0, 0];
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
    return { kind: 'projected',
             reason: 'shape_sphere inverse not unique without chart params' };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    // Pole buffer is enforced via theta(u) so no further check needed.
    return { kind: 'pass' };
  },
};
```

Note `{ pRho, pLambda }` IS a `JacobiMomenta` — no cast needed. Sphere
points where the map degenerates (α → 0 or π/2 gives |ρ̃| or |λ̃| → 0)
flow into `canonicalise`, which labels them `COLLISION_T0` — totality
holds without special-casing.

## `src/chart_atlas/charts/mass_simplex.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_MASS_VARYING } from '../flags.js';
import { decodeMassSimplex } from '@/decode/mass.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Triple } from '@/math/types.js';

const EPS_MASS = 1e-4;

/**
 * Ternary mass simplex chart. Geometry is fixed via `chartParams.alpha`/
 * `beta`; only the masses vary per pixel.
 *
 * Parametrisation (see `massFromSimplex`): m₁ = u, m₂ = (1−u)·v,
 * m₀ = (1−u)(1−v) — a bilinear map that covers the whole simplex for
 * (u, v) ∈ [0, 1]², with `decodeMassSimplex` shrinking toward the
 * barycentre by the interior buffer ε_m. Saturation therefore means a
 * RAW component below ε_m, not u + v ≥ 1 (the map is total; half the
 * square has u + v ≥ 1 with all masses comfortably interior).
 */
export const massSimplexChart: Chart = {
  id: 'mass_simplex',
  kind: 'mass_simplex',
  flags: FLAGS_MASS_VARYING,

  decode([u, v], view) {
    const m = decodeMassSimplex(u, v, EPS_MASS);
    const alpha = (view.chartParams['alpha'] as number | undefined) ?? Math.PI / 4;
    const beta  = (view.chartParams['beta']  as number | undefined) ?? Math.PI / 2;
    const r = realiseFrozenConfig(alpha, beta, m);
    const p: Triple<Vec2> = jacobiToParticleMomenta(
      { pRho: [0, 0], pLambda: [0, 0] }, m,
    );
    const c = canonicalise({ r, p, m, t: 0 },
                           { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c.terminal) {
      return { kind: 'terminal', terminal: c.terminal,
               descriptor: makeDescriptor(c.state) };
    }
    return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
  },

  inverseEncode(ic) {
    // Invert the interior buffer, then the bilinear simplex map:
    //   m₁ = u, m₂ = (1−u)·v  ⇒  u = m₁, v = m₂ / (1 − m₁).
    const raw = [
      (ic.m[0] - EPS_MASS) / (1 - 3 * EPS_MASS),
      (ic.m[1] - EPS_MASS) / (1 - 3 * EPS_MASS),
      (ic.m[2] - EPS_MASS) / (1 - 3 * EPS_MASS),
    ] as const;
    const clamped = raw.some((x) => x < 0 || x > 1);
    const m1 = Math.min(1, Math.max(0, raw[1]));
    const m2 = Math.min(1, Math.max(0, raw[2]));
    const u = m1;
    const v = 1 - m1 < 1e-12 ? 0 : Math.min(1, m2 / (1 - m1));
    return { kind: clamped ? 'projected' : 'exact', pixel: { s: u, t: v } };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    const rawMin = Math.min((1 - u) * (1 - v), u, (1 - u) * v);
    if (rawMin < EPS_MASS) {
      return { kind: 'project', pixel: { s: u, t: v },
               reason: 'inside the simplex interior buffer' };
    }
    return { kind: 'pass' };
  },
};
```

## `src/chart_atlas/charts/burrau_euclid.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import { EPS_DEADBAND, R_COLL_DEFAULT } from '@/math/constants.js';
import type { Vec2, Vec3, Triple } from '@/math/types.js';

/**
 * Burrau Euclid display chart: the horizontal axis is `m` (display only),
 * vertical is `ν = n/m`. Only ν affects the physics. Primitive triples
 * appear as overlay landmarks in the m-axis (M11 supplies them).
 */
export const burrauEuclidChart: Chart = {
  id: 'burrau_euclid',
  kind: 'mixed',          // technically 1D, but rendered as 2D
  flags: FLAGS_DEFAULT,

  decode([, v]) {
    const nuMin = 1 / 32, nuMax = 31 / 32;
    const nu = nuMin + (nuMax - nuMin) * v;
    const a = 1 - nu * nu;
    const b = 2 * nu;
    const c = 1 + nu * nu;
    const total = a + b + c;
    // Re-indexed: body 1→0 (right angle), 2→1, 3→2.
    const m: Vec3 = [c / total, b / total, a / total];
    // Geometric positions (Burrau classical: sides opposite the masses).
    const r: Triple<Vec2> = [[0, 0], [a / c, 0], [0, b / c]];
    const p: Triple<Vec2> = [[0, 0], [0, 0], [0, 0]];
    const c2 = canonicalise({ r, p, m, t: 0 },
                            { deltaLambda: EPS_DEADBAND, rColl: R_COLL_DEFAULT });
    if (c2.terminal) {
      return { kind: 'terminal', terminal: c2.terminal,
               descriptor: makeDescriptor(c2.state) };
    }
    return { kind: 'ok', state: c2.state, descriptor: makeDescriptor(c2.state) };
  },

  inverseEncode() {
    return { kind: 'projected',
             reason: 'burrau_euclid inverse via mass triple lookup' };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
```

## `src/chart_atlas/charts/mixed_axis.ts`

```ts
import type { Chart } from '../types.js';
import { FLAGS_DEFAULT, FLAGS_MASS_VARYING } from '../flags.js';
import { latentSliceChart } from './latent_slice.js';
import type { Vec8 } from '@/math/types.js';

export type AxisSpec =
  | { kind: 'latent';   index: number; range: [number, number] }
  | { kind: 'mass';     parameter: 'm1' | 'm2'; range: [number, number] }
  | { kind: 'lz';       range: [number, number] }
  | { kind: 'energy';   range: [number, number] }
  | { kind: 'shape_alpha'; range: [number, number] }
  | { kind: 'shape_beta';  range: [number, number] };

/**
 * Mixed-axis chart factory. Each axis is independent; the remaining 6
 * latent coordinates are frozen at the centre `z0`. The factory
 * propagates flags: any mass axis sets `requires_per_pixel_mass = true`.
 *
 * M10 ships only the latent × latent variant; other combinations throw
 * (unconstructible pairing) — that is construction-time totality, not a
 * per-pixel failure, and the factory is never registered.
 */
export function makeMixedAxisChart(opts: {
  hAxis: AxisSpec; vAxis: AxisSpec;
}): Chart {
  const flags =
    opts.hAxis.kind === 'mass' || opts.vAxis.kind === 'mass'
      ? FLAGS_MASS_VARYING : FLAGS_DEFAULT;

  return {
    id: 'mixed_axis',
    kind: 'mixed',
    flags,
    decode([u, v], view) {
      // Compose: write the per-axis derivation into the view's z0, then
      // decode the frozen point through the latent slice. M10 ships only
      // the latent + latent variant and declares the contract for the
      // rest (M11 / M12 fill in mass / shape / momentum axes).
      if (opts.hAxis.kind === 'latent' && opts.vAxis.kind === 'latent') {
        const z0 = [...view.z0] as [
          number, number, number, number, number, number, number, number,
        ];
        const [hLo, hHi] = opts.hAxis.range;
        const [vLo, vHi] = opts.vAxis.range;
        z0[opts.hAxis.index] = hLo + (hHi - hLo) * u;
        z0[opts.vAxis.index] = vLo + (vHi - vLo) * v;
        return latentSliceChart.decode([0.5, 0.5], { ...view, z0: z0 as Vec8 });
      }
      throw new Error(
        `mixed_axis: ${opts.hAxis.kind} × ${opts.vAxis.kind} not implemented`,
      );
    },
    inverseEncode() {
      return { kind: 'projected',
               reason: 'mixed_axis inverse depends on factory args' };
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

(`view.z0` is a readonly `Vec8` — spread into a mutable 8-tuple before
writing the axis coordinates.)

## `src/chart_atlas/validation.ts`

```ts
import type { Chart, ChartView, ValidationResult } from './types.js';

/**
 * Pre-dispatch validation: catch user-entered ICs that fall outside the
 * chart's feasibility region before they reach the GPU.
 */
export function validateBeforeDispatch(
  chart: Chart, uv: [number, number], view: ChartView,
): ValidationResult {
  return chart.validate(uv, view);
}

/**
 * Compatibility assertion: refuse to combine a
 * `forbids_energy_normalisation` chart with a non-zero energy
 * normalisation override. Spec §1.6.6.
 */
export function compatible(
  chart: Chart, energyNormalisationTarget?: number,
): { ok: boolean; reason?: string } {
  if (chart.flags.forbids_energy_normalisation && energyNormalisationTarget !== undefined) {
    return { ok: false,
             reason: `chart ${chart.id} forbids energy normalisation` };
  }
  return { ok: true };
}
```

## `src/chart_atlas/index.ts`

```ts
import { registerChart } from './registry.js';
import { latentSliceChart } from './charts/latent_slice.js';
import { lzEChart }  from './charts/lz_e.js';
import { lzKChart }  from './charts/lz_k.js';
import { shapeSphereChart } from './charts/shape_sphere.js';
import { massSimplexChart }  from './charts/mass_simplex.js';
import { burrauEuclidChart } from './charts/burrau_euclid.js';

registerChart(latentSliceChart);
registerChart(lzEChart);
registerChart(lzKChart);
registerChart(shapeSphereChart);
registerChart(massSimplexChart);
registerChart(burrauEuclidChart);

export * from './types.js';
export * from './flags.js';
export * from './registry.js';
export * from './validation.js';
export * from './momentum_construction.js';
export * from './frozen_configuration.js';
export { makeMixedAxisChart } from './charts/mixed_axis.js';
export type { AxisSpec } from './charts/mixed_axis.js';
```

## Tests

### `test/unit/charts/latent_slice.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('latent slice chart', () => {
  it('decode at (0.5, 0.5) returns the slice centre', () => {
    const out = latentSliceChart.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
  });

  it('validate rejects out-of-range UV', () => {
    expect(latentSliceChart.validate([1.1, 0.5], view).kind).toBe('reject');
  });

  it('inverseEncode round-trips for a non-saturated point', () => {
    const out = latentSliceChart.decode([0.3, 0.7], view);
    if (out.kind !== 'ok') throw new Error('expected ok');
    const enc = latentSliceChart.inverseEncode(out.state);
    expect(enc.kind === 'exact' || enc.kind === 'projected').toBe(true);
  });
});
```

### `test/unit/charts/lz_e.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';

const view: ChartView = {
  chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('(L_z, E) chart', () => {
  it('rest start at (0.5, 0) lands at the parabola apex (Lz=0, K=0)', () => {
    const out = lzEChart.decode([0.5, 0], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    // K = 0 means zero kinetic energy → all p = 0.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out.state.p[i]![0])).toBeLessThan(1e-12);
      expect(Math.abs(out.state.p[i]![1])).toBeLessThan(1e-12);
    }
  });

  it('the decoded state carries the requested (Lz, K) exactly', () => {
    // (u, v) = (0.7, 0.8): K = 2·0.8² = 1.28, Lmax = √(2K) = 1.6,
    // Lz = (2·0.7 − 1)·1.6 = 0.64. Canonicalisation only rotates
    // (β = π/2 → no mirror), which preserves both invariants.
    const out = lzEChart.decode([0.7, 0.8], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { m, r, p } = out.state;
    const K = (p[0][0] ** 2 + p[0][1] ** 2) / (2 * m[0])
            + (p[1][0] ** 2 + p[1][1] ** 2) / (2 * m[1])
            + (p[2][0] ** 2 + p[2][1] ** 2) / (2 * m[2]);
    expect(angularMomentum(r, p)).toBeCloseTo(0.64, 12);
    expect(K).toBeCloseTo(1.28, 12);
    // And E = U + K by definition.
    const E = totalEnergy(m, r, p);
    expect(E - K).toBeLessThan(0);       // U < 0
  });

  it('forbids energy normalisation', () => {
    expect(lzEChart.flags.forbids_energy_normalisation).toBe(true);
  });

  it('decodes every pixel without throwing', () => {
    for (let j = 0; j <= 10; j++) {
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, v = j / 10;
        const out = lzEChart.decode([u, v], view);
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});
```

### `test/unit/charts/lz_k.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { lzKChart } from '@/chart_atlas/charts/lz_k.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('(L_z, K) chart', () => {
  it('is a distinct id with the invariant flags', () => {
    expect(lzKChart.id).toBe('lz_k');
    expect(lzKChart.flags.forbids_energy_normalisation).toBe(true);
  });

  it('shares the (L_z, E) decode: identical states at identical (u, v)', () => {
    // With the configuration frozen, E = U + K*, so the two charts are
    // the same map with relabelled axes.
    const a = lzKChart.decode([0.65, 0.4], view);
    const b = lzEChart.decode([0.65, 0.4], view);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    for (let i = 0; i < 3; i++) {
      expect(a.state.r[i]![0]).toBe(b.state.r[i]![0]);
      expect(a.state.r[i]![1]).toBe(b.state.r[i]![1]);
      expect(a.state.p[i]![0]).toBe(b.state.p[i]![0]);
      expect(a.state.p[i]![1]).toBe(b.state.p[i]![1]);
    }
  });
});
```

### `test/unit/charts/shape_sphere.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { shapeSphereChart } from '@/chart_atlas/charts/shape_sphere.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { poleBuffer: 0.05 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('shape sphere chart', () => {
  it('declares hemisphere redundancy', () => {
    expect(shapeSphereChart.flags.has_redundant_hemisphere).toBe(true);
  });

  it('decode succeeds at a non-pole point', () => {
    const out = shapeSphereChart.decode([0.5, 0.25], view);
    expect(out.kind).toBe('ok');
  });

  it('decodes at every (u, v) in a 9×9 grid without throwing', () => {
    for (let j = 1; j < 9; j++) {
      for (let i = 1; i < 9; i++) {
        const out = shapeSphereChart.decode([i / 9, j / 9], view);
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});
```

### `test/unit/charts/mass_simplex.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { massSimplexChart } from '@/chart_atlas/charts/mass_simplex.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('mass simplex chart', () => {
  it('declares per-pixel mass requirement', () => {
    expect(massSimplexChart.flags.requires_per_pixel_mass).toBe(true);
  });

  it('respects interior buffer at every corner', () => {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const out = massSimplexChart.decode([u, v], view);
      expect(out.kind).toBe('ok');
      if (out.kind !== 'ok') continue;
      for (let i = 0; i < 3; i++) {
        // No mass ever saturates: all at least ε_m, none within 2·ε_m of 1.
        expect(out.state.m[i]!).toBeGreaterThan(1e-5);
        expect(out.state.m[i]!).toBeLessThan(1 - 1e-5);
      }
    }
  });

  it('flags saturated pixels and passes interior ones', () => {
    // (0.6, 0.6) decodes to raw masses (0.16, 0.6, 0.24) — comfortably
    // interior; the bilinear map covers the simplex for ALL of [0,1]²,
    // so u + v ≥ 1 is NOT a saturation criterion.
    expect(massSimplexChart.validate([0.6, 0.6], view).kind).toBe('pass');
    // Near u = 1 the raw m₀ = (1−u)(1−v) vanishes → interior buffer.
    expect(massSimplexChart.validate([0.99999, 0.5], view).kind)
      .toBe('project');
    // Corner (0, 0): raw m₁ = m₂ = 0 → buffered.
    expect(massSimplexChart.validate([0, 0], view).kind).toBe('project');
  });

  it('inverseEncode inverts decode away from the buffer', () => {
    const out = massSimplexChart.decode([0.3, 0.55], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const enc = massSimplexChart.inverseEncode(out.state);
    expect(enc.kind).toBe('exact');
    expect(enc.pixel!.s).toBeCloseTo(0.3, 10);
    expect(enc.pixel!.t).toBeCloseTo(0.55, 10);
  });
});
```

### `test/unit/charts/mixed_axis.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeMixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('mixed-axis factory', () => {
  it('latent × latent works', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 6, range: [-1, 1] },
      vAxis: { kind: 'latent', index: 7, range: [-1, 1] },
    });
    const out = c.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
  });

  it('latent axes actually move the decoded point', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 6, range: [-1, 1] },
      vAxis: { kind: 'latent', index: 7, range: [-1, 1] },
    });
    const a = c.decode([0.1, 0.5], view);
    const b = c.decode([0.9, 0.5], view);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    // z6/z7 are mass logits: different u ⇒ different masses.
    expect(a.state.m[0]).not.toBeCloseTo(b.state.m[0], 6);
  });

  it('mass-axis sets requires_per_pixel_mass', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    });
    expect(c.flags.requires_per_pixel_mass).toBe(true);
  });
});
```

### `test/unit/charts/validation.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { compatible } from '@/chart_atlas/validation.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';

describe('chart compatibility', () => {
  it('refuses energy normalisation on an invariant chart', () => {
    const r = compatible(lzEChart, 0.5);
    expect(r.ok).toBe(false);
  });

  it('allows energy normalisation on the latent chart', () => {
    expect(compatible(latentSliceChart, 0.5).ok).toBe(true);
  });

  it('allows undefined target on any chart', () => {
    expect(compatible(lzEChart).ok).toBe(true);
  });
});
```

### `test/integration/chart_totality.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import '@/chart_atlas/index.js';     // registers all charts
import { allCharts } from '@/chart_atlas/registry.js';
import type { ChartView } from '@/chart_atlas/types.js';

describe('every registered chart is total on (u, v)', () => {
  it('1000 random pixels per chart land in ok or terminal', () => {
    let rng = 17;
    const next = () => {
      rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    expect(allCharts().length).toBeGreaterThanOrEqual(6);
    for (const chart of allCharts()) {
      const view: ChartView = {
        chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2,
                       poleBuffer: 0.05 },
        z0: [0, 0, 0, 0, 0, 0, 0, 0],
        q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
        mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
        alphaMin: 0.05, muMax: 5, qMax: 2,
        rColl: 1e-4, deltaLambda: 1e-12,
      };
      let ok = 0, term = 0;
      for (let trial = 0; trial < 1000; trial++) {
        const u = next(), v = next();
        // No try/catch: registered charts NEVER throw (the mixed-axis
        // factory is exported, not registered, so it isn't in this loop).
        const out = chart.decode([u, v], view);
        if (out.kind === 'ok') {
          ok++;
          for (const body of out.state.r) {
            expect(Number.isFinite(body[0]) && Number.isFinite(body[1])).toBe(true);
          }
          for (const body of out.state.p) {
            expect(Number.isFinite(body[0]) && Number.isFinite(body[1])).toBe(true);
          }
        } else {
          term++;
        }
      }
      expect(ok + term).toBe(1000);
      expect(ok).toBeGreaterThan(0);    // every chart has a live interior
    }
  });
});
```

### `test/integration/chart_lock_handoff.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import '@/chart_atlas/index.js';
import { getChart } from '@/chart_atlas/registry.js';
import type { ChartView } from '@/chart_atlas/types.js';

describe('chart hand-off: lock at equilateral pole, switch to (Lz, E)', () => {
  it('lands at parabola apex K = 0 with zero momenta', () => {
    const sphere = getChart('shape_sphere');
    const view: ChartView = {
      chartParams: { poleBuffer: 0.05 },
      z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
      mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
      alphaMin: 0.05, muMax: 5, qMax: 2,
      rColl: 1e-4, deltaLambda: 1e-12,
    };
    // Equilateral L+: u = 0 (theta = 0 + buffer), v = 0 (phi = 0).
    const out = sphere.decode([0.01, 0], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;

    // Re-decode the same shape via the (Lz, E) chart at K=0, Lz=0.
    const lzE = getChart('lz_e');
    const view2: ChartView = {
      ...view,
      chartParams: {
        Kmax: 2, gammaK: 2,
        alpha: Math.PI / 4,            // equilateral has α near π/4
        beta:  Math.PI / 2,
      },
    };
    const out2 = lzE.decode([0.5, 0], view2);
    expect(out2.kind).toBe('ok');
    if (out2.kind !== 'ok') return;
    // K = 0 ⇒ all momenta zero: the feasibility-parabola apex (Lz=0, E=U).
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out2.state.p[i]![0])).toBeLessThan(1e-12);
      expect(Math.abs(out2.state.p[i]![1])).toBeLessThan(1e-12);
    }
  });
});
```

## Run it

```bash
npm test -- --run test/unit/charts
npm test -- --run test/integration/chart_totality test/integration/chart_lock_handoff
```

## Acceptance check

```bash
npm test -- --run test/integration/chart_totality
```

Every registered chart's `Φ` is total on (u, v): zero NaN outputs, every
pixel lands in ok or a labelled terminal.

## Notes for the implementer

- **Chart registry is the single dispatch point.** The renderer asks for
  `getChart(view.chartType)` and never branches on the chart kind. This
  is what keeps the GPU shader chart-agnostic: the WGSL only consumes
  `(m_i, r_i, p_i)`.
- **Descriptors have ONE home.** `makeDescriptor`/`makeTerminal` are
  exported from `@/decode/pipeline.js` (D10.1) and used by every chart.
  Never write a per-chart copy — earlier drafts of this doc carried three
  and they drifted on `qMass`.
- **The momentum-construction seed footgun.** The all-body rotational
  seed `[J(r_0), J(r_1), J(r_2)]` is annihilated by the L_z projection
  every time (it IS the pure-rotation direction) — seed families must be
  radial or PARTIAL rotational fields (D10.2). Also clamp the mix
  amplitude: `a = √(max(0, 2(K*−K_min)))`.
- **The `(L_z, E)` chart's α and β are frozen by the caller via
  `chartParams`.** M11's Burrau ternary plot supplies them per pixel,
  not the chart itself; the chart contract is just "what does
  `(L_z, K(t))` decode to given the surrounding configuration?". This
  keeps the chart factory composable. And `(L_z, E)`/`(L_z, K)` share a
  single decode: with frozen geometry E = U + K*, so the charts differ
  only in labelling and inverse-encode semantics (D10.4).
- **Mass-simplex saturation is a RAW-mass criterion.** The bilinear
  parametrisation (m₁ = u, m₂ = (1−u)v) is total on [0,1]²; `u + v ≥ 1`
  flags half the interior falsely. Validate against
  `min(raw components) < ε_m` (D10.5).
- **Mixed-axis is intentionally partial.** Latent × latent ships;
  mass × {anything else} and shape × {anything else} land in M11 and M12
  alongside their respective acceptance tests. The contract is locked
  here so M11 / M12 can extend without touching the registry. The
  factory is exported but never registered, so registered-chart totality
  is unconditional (D10.6).
- **The chart's `wgsl` field** is reserved for chart-specific WGSL
  fragments that get inlined into the GPU dispatch. M10 doesn't ship any
  yet — every chart so far decodes to `(m, r, p)` on the CPU and lets
  the GPU integrator run unchanged. M11's hover-streamline integration
  may need a chart-specific sphere mapping in the fragment shader, which
  is where this hook becomes useful.
- **Validation policy.** `compatible()` covers the
  energy-normalisation-vs-invariant-chart case. M12's acceptance pass
  enforces it for every export configuration.
- Detailed conventions: the `principia-charts` skill.
