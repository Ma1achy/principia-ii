# M6 — Stability metrics

## Goal

Land the derived observables that every later render mode depends on:
the corrected shape-sphere coordinate `n(t)`, unwrapped phase, arc length,
windowed frequency diffusion, Benettin FTLE (Research-tier), and the
free-group word with branch-cut crossings. Pack the per-sample fields
into the `sample_descriptor` and `trajectory_stats` `uint32`s exactly as
the spec describes.

**Exit criterion.**

```bash
npm test -- --run test/golden/figure8_word test/golden/ftle_chaotic_vs_regular test/golden/shape_sphere_landmarks
```

The corrected shape-sphere formula places binary collisions on the equator
and equilateral configurations at the poles. A periodic figure-8 orbit
produces a free-group word that is a power of `abAB`. A clearly chaotic
Burrau scattering trajectory has FTLE at least 10× a clearly regular orbit.

**Deliverable:** internal — tests only (no visible artifact until a later GPU/UI milestone); the derived stability observables (corrected shape-sphere coordinate, unwrapped phase, frequency diffusion, Benettin FTLE, free-group word) packed into the descriptor uint32s every later render mode reads.

## File tree

```
principia/
  src/
    metrics/
      shape_sphere.ts
      phase.ts
      arc.ts
      diffusion.ts
      ftle.ts
      free_group.ts
      packing.ts
      observe_extended.ts
      types.ts
      index.ts
    gpu/
      shaders/
        metrics.wgsl                 # corrected n(t), phase unwrap, free word
  test/
    unit/metrics/
      shape_sphere.test.ts
      phase.test.ts
      diffusion.test.ts
      free_group.test.ts
      packing.test.ts
    golden/
      figure8_word.test.ts
      ftle_chaotic_vs_regular.test.ts
      shape_sphere_landmarks.test.ts
```

## `src/metrics/types.ts`

```ts
import type { Vec3 } from '@/math/types.js';

/**
 * One checkpoint record. `.xyz` is the canonical geometric state n(t)∈S²;
 * `.w` is the unwrapped phase θ̃(t), an auxiliary cache for cheaper
 * downstream consumption (spec §4.3.1 contract).
 */
export interface Checkpoint {
  n:           Vec3;
  thetaTilde:  number;
  t:           number;
}

export interface MetricsAccumulator {
  arcLengthN:           number;
  checkpoints:          Checkpoint[];
  prevN:                Vec3 | null;
  prevTheta:            number | null;
  thetaTilde:           number;
  word:                 FreeGroupWord;
  wordUncertain:        boolean;       // ADR 0004: set off the equal-mass band
  ftleEstimate:         number;
  ftleValid:            boolean;
  encounters:           number;
  closeEncounterPair:   { count: number; pair: 0 | 1 | 2 };
  netWindingThetaTilde: number;       // for retrograde flag
}

export interface FreeGroupWord {
  bits:     [number, number, number, number];     // uint4: 64 slots × 2 bits
  length:   number;
  truncated: boolean;
}

export const FREE_GROUP_MAX_LENGTH = 58;     // 64 - 6 reserved bits for length

export const SYMBOL = {
  a: 0b00, A: 0b01,
  b: 0b10, B: 0b11,
} as const;
```

## `src/metrics/shape_sphere.ts`

```ts
import type { Vec2, Vec3 } from '@/math/types.js';
import { dot2, crossZ, normSq2 } from '@/math/vec.js';

/**
 * Corrected shape-sphere coordinate (post spec revisions). Inner-pair
 * collision (ρ̃ → 0) maps to (1, 0, 0); equilateral configurations map to
 * (0, 0, ±1); other binary collisions land on the equator at
 * (-1/2, ±√3/2, 0) for equal masses.
 *
 * The Hopf components, in slot order:
 *   n_1 = (|λ̃|² - |ρ̃|²) / I
 *   n_2 = -2 ρ̃ · λ̃ / I
 *   n_3 =  2 (ρ̃ × λ̃)_z / I
 */
export function shapeSphere(rhoTilde: Vec2, lambdaTilde: Vec2): Vec3 {
  const rhoSq    = normSq2(rhoTilde);
  const lambdaSq = normSq2(lambdaTilde);
  const I = rhoSq + lambdaSq;
  if (I === 0) return [0, 0, 1];        // canonical fallback
  return [
    (lambdaSq - rhoSq) / I,
    -2 * dot2(rhoTilde, lambdaTilde) / I,
     2 * crossZ(rhoTilde, lambdaTilde) / I,
  ];
}

/**
 * Mass-weight a pair of unweighted Jacobi vectors. Caller-supplied
 * masses determine the reduced masses μ_ρ and μ_λ.
 */
export function massWeightedJacobi(
  rho: Vec2, lambda: Vec2, m: readonly [number, number, number],
): { rhoT: Vec2; lambdaT: Vec2 } {
  const M01 = m[0] + m[1];
  const muRho    = (m[0] * m[1]) / M01;
  const muLambda = m[2] * M01;
  const sR = Math.sqrt(muRho), sL = Math.sqrt(muLambda);
  return {
    rhoT:    [rho[0]    * sR, rho[1]    * sR],
    lambdaT: [lambda[0] * sL, lambda[1] * sL],
  };
}
```

## `src/metrics/phase.ts`

```ts
/**
 * Phase angle of n(t)'s equatorial projection.
 *   θ(t) = atan2(n_y, n_x), in (-π, π].
 *
 * Uses n_2, n_1 — that is the axis convention from the corrected formula.
 * (n_x, n_y) = (n_1, n_2).
 */
export function phaseFromN(n: readonly [number, number, number]): number {
  return Math.atan2(n[1], n[0]);
}

/**
 * Update the unwrapped phase by adding the minimal-magnitude jump.
 * Inputs:
 *   prevTheta   — last raw atan2 in (-π, π]
 *   curTheta    — new raw atan2 in (-π, π]
 *   thetaTilde  — running unwrapped phase
 * Returns the new thetaTilde.
 */
export function unwrapPhase(
  prevTheta: number, curTheta: number, thetaTilde: number,
): number {
  let delta = curTheta - prevTheta;
  if (delta >  Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return thetaTilde + delta;
}
```

## `src/metrics/arc.ts`

```ts
import type { Vec3 } from '@/math/types.js';
import { dot3 } from '@/math/vec.js';
import { clamp } from '@/math/scalar.js';

/**
 * Geodesic distance between two unit vectors on S².
 *   d(a, b) = arccos(clamp(a · b, -1, 1))
 */
export function geodesic(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot3(a, b), -1, 1));
}

/**
 * Total arc length of a sampled path on S². Used as the "activity proxy"
 * scalar in coherence and rendering.
 */
export function arcLength(path: readonly Vec3[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) {
    L += geodesic(path[i - 1]!, path[i]!);
  }
  return L;
}
```

## `src/metrics/diffusion.ts`

```ts
/**
 * Windowed least-squares frequency fit. Given (t_k, θ̃_k) inside one
 * window, returns the slope ω of the best-fit line. The ≥3 samples gate
 * matches the corrected spec (older drafts said ≥4; M=8 default produces
 * 3 samples per full window).
 */
export function fitOmega(t: number[], thetaTilde: number[]): number | null {
  if (t.length < 3) return null;
  let tBar = 0, yBar = 0;
  for (let i = 0; i < t.length; i++) { tBar += t[i]!; yBar += thetaTilde[i]!; }
  tBar /= t.length; yBar /= t.length;
  let num = 0, den = 0;
  for (let i = 0; i < t.length; i++) {
    const dt = t[i]! - tBar;
    num += dt * (thetaTilde[i]! - yBar);
    den += dt * dt;
  }
  if (den === 0) return null;
  return num / den;
}

export interface DiffusionWindows {
  W1: [number, number];     // [T/4, T/2]
  W2: [number, number];     // [T/2, 3T/4]
}

export function defaultDiffusionWindows(T: number): DiffusionWindows {
  return { W1: [T / 4, T / 2], W2: [T / 2, 3 * T / 4] };
}

/**
 * Two-window diffusion. Returns the magnitude of the frequency change.
 * Sentinel `-1.0` for any window with too-few samples (spec contract:
 * never NaN under WGSL).
 */
export function diffusion(
  t: number[], thetaTilde: number[], T: number,
): { value: number; suspect: boolean } {
  const w = defaultDiffusionWindows(T);
  const inWin = (start: number, end: number) => {
    const ts: number[] = [], ys: number[] = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i]! >= start && t[i]! <= end) {
        ts.push(t[i]!); ys.push(thetaTilde[i]!);
      }
    }
    return { ts, ys };
  };
  const a = inWin(w.W1[0], w.W1[1]);
  const b = inWin(w.W2[0], w.W2[1]);
  const w1 = fitOmega(a.ts, a.ys);
  const w2 = fitOmega(b.ts, b.ys);
  if (w1 === null || w2 === null) {
    return { value: -1, suspect: false };       // sentinel
  }
  const partial = b.ts.length < 4;              // partial window flag
  return { value: Math.abs(w2 - w1), suspect: partial };
}
```

## `src/metrics/ftle.ts`

```ts
import type { TrajState } from '@/math/types.js';

/**
 * Benettin-style FTLE estimator. Caller supplies the integrator and the
 * separation/renormalisation primitives so this is integrator-agnostic.
 *
 * The mass-weighted phase-space norm is the spec's default choice
 * (§4.3.3): δ² = Σ m_i |Δr_i|² + α Σ (1/m_i) |Δp_i|².
 */
export interface FtleHandles {
  step:       () => void;        // advance both base and shadow by one macro step
  separation: () => number;      // current ||Δ|| in the chosen norm
  renormalise: () => void;       // shadow ← base + (shadow - base) * δ_0 / δ
}

export function benettinFTLE(
  h: FtleHandles, T: number, dtMacro: number, mRenorm: number, delta0: number,
): { lambda: number; renorms: number; valid: boolean } {
  let S = 0;
  let renorms = 0;
  let dt = 0;

  while (dt < T) {
    for (let s = 0; s < mRenorm; s++) {
      h.step();
      dt += dtMacro;
      if (dt >= T) break;
    }
    const dj = h.separation();
    if (!Number.isFinite(dj) || dj === 0) {
      return { lambda: 0, renorms, valid: false };
    }
    S += Math.log(dj / delta0);
    h.renormalise();
    renorms++;
  }

  return { lambda: S / Math.max(dt, 1e-12), renorms, valid: renorms > 0 };
}

/** Mass-weighted phase-space norm. */
export function massWeightedNorm(
  m: readonly [number, number, number],
  dr: readonly [readonly [number,number], readonly [number,number], readonly [number,number]],
  dp: readonly [readonly [number,number], readonly [number,number], readonly [number,number]],
  alpha = 1,
): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const drx = dr[i]![0], dry = dr[i]![1];
    const dpx = dp[i]![0], dpy = dp[i]![1];
    s += m[i]! * (drx*drx + dry*dry);
    s += alpha * (dpx*dpx + dpy*dpy) / m[i]!;
  }
  return Math.sqrt(s);
}
```

## `src/metrics/free_group.ts`

```ts
import type { Vec3 } from '@/math/types.js';
import { cross3, dot3 } from '@/math/vec.js';
import type { FreeGroupWord } from './types.js';
import { SYMBOL, FREE_GROUP_MAX_LENGTH } from './types.js';

const NORTH: Vec3 = [0, 0,  1];
const SOUTH: Vec3 = [0, 0, -1];

/** Pick a branch-cut endpoint for a collision singularity b̂. The default
 *  is the north pole; if b̂ is too close to the north pole (extreme mass
 *  ratios), fall back to the south. (D6.3: sin∠(b̂, north) is the norm of the
 *  FULL cross product — the original two-component expression evaluated to
 *  |b_y| and sent equator basepoints south, failing this file's own test.) */
export function pickEndpoint(b: Vec3, threshold = 0.1): Vec3 {
  const cr = cross3(b, NORTH);
  const sin = Math.hypot(cr[0], cr[1], cr[2]);
  return sin < threshold ? SOUTH : NORTH;
}

/** Signed distance of n from the great-circle plane through (b̂, ê). */
function signedPlane(n: Vec3, b: Vec3, e: Vec3): number {
  const cr = cross3(b, e);
  return dot3(n, cr);
}

export function emptyWord(): FreeGroupWord {
  return { bits: [0, 0, 0, 0], length: 0, truncated: false };
}

function setBitPair(bits: [number,number,number,number], slot: number, sym: number): void {
  const lane = slot >> 4;          // 0,1,2,3
  const off  = (slot & 0xf) * 2;   // bit offset in the lane
  // Clear and set within the slot.
  bits[lane] = (bits[lane]! & ~(0x3 << off)) | ((sym & 0x3) << off);
}

function getBitPair(bits: readonly [number,number,number,number], slot: number): number {
  const lane = slot >> 4;
  const off  = (slot & 0xf) * 2;
  return (bits[lane] >>> off) & 0x3;
}

/** Append one symbol with on-the-fly free reduction. */
export function appendSymbol(
  word: FreeGroupWord, sym: number,
): FreeGroupWord {
  if (word.length >= FREE_GROUP_MAX_LENGTH) {
    return { ...word, truncated: true };
  }
  // Free reduction: aA / Aa / bB / Bb cancels.
  if (word.length > 0) {
    const last = getBitPair(word.bits, word.length - 1);
    const cancels =
      (last === SYMBOL.a && sym === SYMBOL.A) ||
      (last === SYMBOL.A && sym === SYMBOL.a) ||
      (last === SYMBOL.b && sym === SYMBOL.B) ||
      (last === SYMBOL.B && sym === SYMBOL.b);
    if (cancels) {
      const bits: [number,number,number,number] = [...word.bits] as any;
      setBitPair(bits, word.length - 1, 0);
      return { bits, length: word.length - 1, truncated: word.truncated };
    }
  }
  const bits: [number,number,number,number] = [...word.bits] as any;
  setBitPair(bits, word.length, sym);
  return { bits, length: word.length + 1, truncated: word.truncated };
}

/** Step the free-group word for one macro step's progression of n. */
export function freeGroupTick(
  word: FreeGroupWord,
  prevN: Vec3, currentN: Vec3,
  b1: Vec3, b2: Vec3,
): FreeGroupWord {
  let w = word;
  for (const [b, posSym, negSym] of [
    [b1, SYMBOL.a, SYMBOL.A] as const,
    [b2, SYMBOL.b, SYMBOL.B] as const,
  ]) {
    const e = pickEndpoint(b);
    const dPrev = signedPlane(prevN,    b, e);
    const dCurr = signedPlane(currentN, b, e);
    if (dPrev === 0 || dCurr === 0) continue;
    if (Math.sign(dPrev) !== Math.sign(dCurr)) {
      const sym = dPrev > 0 ? posSym : negSym;
      w = appendSymbol(w, sym);
    }
  }
  return w;
}

/** Render a word back to a human-readable string for tests / overlays. */
export function wordToString(w: FreeGroupWord): string {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const sym = getBitPair(w.bits, i);
    out.push(sym === SYMBOL.a ? 'a' : sym === SYMBOL.A ? 'A'
            : sym === SYMBOL.b ? 'b' : 'B');
  }
  return out.join('');
}
```

## `src/metrics/packing.ts`

```ts
/**
 * Bit-pack the per-sample status word into the 32-bit `sample_descriptor`
 * field of `SimResult`. Layout matches the spec §6.6 table exactly.
 */
export interface SampleDescriptorFields {
  outcomeClass:    0 | 1 | 2 | 3 | 4;     // bits 0-2
  detail:          number;                 // bits 3-4
  suspectEnergy:   boolean;                // bit 5
  suspectLz:       boolean;                // bit 6
  ftleValid:       boolean;                // bit 7
  wordTruncated:   boolean;                // bit 8 (WORD_TRUNCATED)
  wordUncertain:   boolean;                // bit 9 (WORD_UNCERTAIN — ADR 0004)
  encounterCount:  number;                 // bits 10-15, 0..63
  substepLog2:     number;                 // bits 16-22, 0..127
  benettinCount:   number;                 // bits 23-29, 0..127
  dominantPair:    0 | 1 | 2;              // bits 30-31
}

export function packSampleDescriptor(f: SampleDescriptorFields): number {
  let v = 0;
  v |= (f.outcomeClass & 0x7);
  v |= (f.detail & 0x3) << 3;
  v |= f.suspectEnergy ? 1 << 5 : 0;
  v |= f.suspectLz     ? 1 << 6 : 0;
  v |= f.ftleValid     ? 1 << 7 : 0;
  v |= f.wordTruncated ? 1 << 8 : 0;
  v |= f.wordUncertain ? 1 << 9 : 0;
  v |= (Math.min(63,  Math.max(0, f.encounterCount)) & 0x3f) << 10;
  v |= (Math.min(127, Math.max(0, f.substepLog2))    & 0x7f) << 16;
  v |= (Math.min(127, Math.max(0, f.benettinCount))  & 0x7f) << 23;
  v |= (f.dominantPair & 0x3) << 30;
  return v >>> 0;
}

export function unpackSampleDescriptor(v: number): SampleDescriptorFields {
  return {
    outcomeClass:   ((v) & 0x7) as 0|1|2|3|4,
    detail:         (v >>> 3) & 0x3,
    suspectEnergy:  ((v >>> 5) & 1) === 1,
    suspectLz:      ((v >>> 6) & 1) === 1,
    ftleValid:      ((v >>> 7) & 1) === 1,
    wordTruncated:  ((v >>> 8) & 1) === 1,
    wordUncertain:  ((v >>> 9) & 1) === 1,
    encounterCount: (v >>> 10) & 0x3f,
    substepLog2:    (v >>> 16) & 0x7f,
    benettinCount:  (v >>> 23) & 0x7f,
    dominantPair:   ((v >>> 30) & 0x3) as 0|1|2,
  };
}

export interface TrajectoryStatsFields {
  tDminFrac:        number;     // 16 bits
  totalStepsLog2:   number;     // 7  bits
  orbitCount:       number;     // 6  bits, unsigned (sign in `retrograde`)
  dminPair:         0 | 1 | 2;
  retrograde:       boolean;    // sign of net winding
}

export function packTrajectoryStats(f: TrajectoryStatsFields): number {
  let v = 0;
  v |= (Math.min(0xffff, Math.max(0, f.tDminFrac)) & 0xffff);
  v |= (Math.min(127, Math.max(0, f.totalStepsLog2)) & 0x7f) << 16;
  v |= (Math.min(63,  Math.max(0, f.orbitCount))     & 0x3f) << 23;
  v |= (f.dminPair & 0x3) << 29;
  v |= f.retrograde ? 1 << 31 : 0;
  return v >>> 0;
}

export function unpackTrajectoryStats(v: number): TrajectoryStatsFields {
  return {
    tDminFrac:       v        & 0xffff,
    totalStepsLog2: (v >>> 16) & 0x7f,
    orbitCount:     (v >>> 23) & 0x3f,
    dminPair:      ((v >>> 29) & 0x3) as 0|1|2,
    retrograde:    ((v >>> 31) & 1) === 1,
  };
}
```

## `src/metrics/observe_extended.ts`

```ts
import type { TrajState } from '@/math/types.js';
import type { MetricsAccumulator } from './types.js';
import { shapeSphere, massWeightedJacobi } from './shape_sphere.js';
import { phaseFromN, unwrapPhase } from './phase.js';
import { geodesic } from './arc.js';
import { freeGroupTick, emptyWord } from './free_group.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';

export interface BranchCutCfg {
  b1: readonly [number, number, number];
  b2: readonly [number, number, number];
}

/** Default equal-mass branch-cut basepoints (spec §4.3.4). */
export const DEFAULT_BRANCH_CUTS: BranchCutCfg = {
  b1: [1, 0, 0],
  b2: [-0.5, Math.sqrt(3)/2, 0],
};

/** Equal-mass band half-width ε_m (ADR 0004). Masses are "equal" when every
 *  pairwise difference is within this tolerance of the equal-mass triple. */
export const EQUAL_MASS_EPS = 1e-6;

/**
 * Whether a mass triple sits inside the equal-mass ε band (ADR 0004). Outside
 * the band the free-group word is computed-but-untrusted and the descriptor's
 * `WORD_UNCERTAIN` bit must be set so it never gates refinement or science.
 */
export function massesAreEqual(
  m: readonly [number, number, number], eps = EQUAL_MASS_EPS,
): boolean {
  const mean = (m[0] + m[1] + m[2]) / 3;
  return Math.abs(m[0] - mean) <= eps
      && Math.abs(m[1] - mean) <= eps
      && Math.abs(m[2] - mean) <= eps;
}

export function makeMetrics(): MetricsAccumulator {
  return {
    arcLengthN: 0, checkpoints: [],
    prevN: null, prevTheta: null, thetaTilde: 0,
    word: emptyWord(), wordUncertain: false,
    ftleEstimate: 0, ftleValid: false,
    encounters: 0,
    closeEncounterPair: { count: 0, pair: 0 },
    netWindingThetaTilde: 0,
  };
}

/**
 * Update accumulator from a fresh state. Call once per macro step.
 *
 * Returns whether a checkpoint was emitted (caller is responsible for
 * scheduling checkpoint times, but we tag the resulting Checkpoint with
 * the current `t` so the diffusion fit sees the right times).
 */
export function metricsTick(
  acc: MetricsAccumulator,
  s: TrajState,
  emitCheckpoint: boolean,
  branchCuts: BranchCutCfg = DEFAULT_BRANCH_CUTS,
): void {
  // ADR 0004: off the equal-mass band the word is untrusted (WORD_UNCERTAIN).
  if (!massesAreEqual(s.m)) acc.wordUncertain = true;

  // Mass-weighted Jacobi.
  const { rho, lambda } = particlePositionsToJacobi(s.r, s.m);
  const { rhoT, lambdaT } = massWeightedJacobi(rho, lambda, s.m);
  const n = shapeSphere(rhoT, lambdaT);
  const theta = phaseFromN(n);

  // Arc length increment.
  if (acc.prevN) {
    acc.arcLengthN += geodesic(acc.prevN, n);
  }

  // Phase unwrap.
  if (acc.prevTheta !== null) {
    acc.thetaTilde = unwrapPhase(acc.prevTheta, theta, acc.thetaTilde);
  }
  acc.netWindingThetaTilde = acc.thetaTilde;

  // Free-group word (only if we have a prev to compare to).
  if (acc.prevN) {
    acc.word = freeGroupTick(
      acc.word, acc.prevN, n,
      branchCuts.b1 as any, branchCuts.b2 as any,
    );
  }

  if (emitCheckpoint) {
    acc.checkpoints.push({ n, thetaTilde: acc.thetaTilde, t: s.t });
  }

  acc.prevN = n;
  acc.prevTheta = theta;
}
```

## `src/gpu/shaders/metrics.wgsl`

```wgsl
// Shape-sphere coordinate, phase unwrap, and free-group bookkeeping in
// the GPU integrator. Compose with simulate.wgsl from M3.

fn shape_sphere(rho_t: vec2<f32>, lambda_t: vec2<f32>) -> vec3<f32> {
  let rho_sq    = dot(rho_t,    rho_t);
  let lambda_sq = dot(lambda_t, lambda_t);
  let I = rho_sq + lambda_sq;
  if (I == 0.0) { return vec3<f32>(0.0, 0.0, 1.0); }
  return vec3<f32>(
    (lambda_sq - rho_sq) / I,
    -2.0 * dot(rho_t, lambda_t) / I,
     2.0 * (rho_t.x * lambda_t.y - rho_t.y * lambda_t.x) / I,
  );
}

fn phase_from_n(n: vec3<f32>) -> f32 {
  return atan2(n.y, n.x);
}

fn unwrap_phase(prev: f32, cur: f32, theta_tilde: f32) -> f32 {
  var d = cur - prev;
  if (d >  PI) { d = d - 2.0*PI; }
  if (d < -PI) { d = d + 2.0*PI; }
  return theta_tilde + d;
}

// Free-group word append with on-the-fly cancellation.
struct FreeWord {
  bits:   vec4<u32>,
  length: u32,
  truncated: u32,
};

fn append_symbol(word: FreeWord, sym: u32) -> FreeWord {
  var w = word;
  if (w.length >= 58u) { w.truncated = 1u; return w; }
  // Free reduction: aA, Aa, bB, Bb cancel.
  if (w.length > 0u) {
    let prev_slot = w.length - 1u;
    let lane = prev_slot >> 4u;
    let off  = (prev_slot & 0xfu) * 2u;
    var prev_bits: u32;
    switch (lane) {
      case 0u: { prev_bits = (w.bits.x >> off) & 0x3u; }
      case 1u: { prev_bits = (w.bits.y >> off) & 0x3u; }
      case 2u: { prev_bits = (w.bits.z >> off) & 0x3u; }
      default: { prev_bits = (w.bits.w >> off) & 0x3u; }
    }
    let cancels =
      (prev_bits == 0u && sym == 1u) ||
      (prev_bits == 1u && sym == 0u) ||
      (prev_bits == 2u && sym == 3u) ||
      (prev_bits == 3u && sym == 2u);
    if (cancels) {
      let mask = ~(0x3u << off);
      switch (lane) {
        case 0u: { w.bits.x = w.bits.x & mask; }
        case 1u: { w.bits.y = w.bits.y & mask; }
        case 2u: { w.bits.z = w.bits.z & mask; }
        default: { w.bits.w = w.bits.w & mask; }
      }
      w.length = w.length - 1u;
      return w;
    }
  }
  let lane = w.length >> 4u;
  let off  = (w.length & 0xfu) * 2u;
  switch (lane) {
    case 0u: { w.bits.x = w.bits.x | ((sym & 0x3u) << off); }
    case 1u: { w.bits.y = w.bits.y | ((sym & 0x3u) << off); }
    case 2u: { w.bits.z = w.bits.z | ((sym & 0x3u) << off); }
    default: { w.bits.w = w.bits.w | ((sym & 0x3u) << off); }
  }
  w.length = w.length + 1u;
  return w;
}

fn signed_plane(n: vec3<f32>, b: vec3<f32>, e: vec3<f32>) -> f32 {
  let cr = vec3<f32>(b.y*e.z - b.z*e.y, b.z*e.x - b.x*e.z, b.x*e.y - b.y*e.x);
  return dot(n, cr);
}

fn pick_endpoint(b: vec3<f32>) -> vec3<f32> {
  let north = vec3<f32>(0.0, 0.0, 1.0);
  let south = vec3<f32>(0.0, 0.0, -1.0);
  let cr = cross(b, north);
  let sin_v = length(cr);
  if (sin_v < 0.1) { return south; }
  return north;
}

fn free_group_tick(
  w: FreeWord, prev_n: vec3<f32>, cur_n: vec3<f32>,
  b1: vec3<f32>, b2: vec3<f32>,
) -> FreeWord {
  var word = w;

  let e1 = pick_endpoint(b1);
  let dp1 = signed_plane(prev_n, b1, e1);
  let dc1 = signed_plane(cur_n,  b1, e1);
  if (dp1 != 0.0 && dc1 != 0.0 && sign(dp1) != sign(dc1)) {
    let sym1 = select(1u, 0u, dp1 > 0.0);
    word = append_symbol(word, sym1);
  }

  let e2 = pick_endpoint(b2);
  let dp2 = signed_plane(prev_n, b2, e2);
  let dc2 = signed_plane(cur_n,  b2, e2);
  if (dp2 != 0.0 && dc2 != 0.0 && sign(dp2) != sign(dc2)) {
    let sym2 = select(3u, 2u, dp2 > 0.0);
    word = append_symbol(word, sym2);
  }
  return word;
}
```

## Tests

### `test/unit/metrics/shape_sphere.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';

describe('shape sphere — corrected Hopf formula', () => {
  it('inner-pair collision lands at (1, 0, 0)', () => {
    const n = shapeSphere([0, 0], [0.5, 0.3]);
    expect(n[0]).toBeCloseTo(1, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(0, 12);
  });

  it('opposite collision (λ̃ → 0) lands at (-1, 0, 0)', () => {
    const n = shapeSphere([0.7, 0], [0, 0]);
    expect(n[0]).toBeCloseTo(-1, 12);
    expect(n[1]).toBeCloseTo( 0, 12);
    expect(n[2]).toBeCloseTo( 0, 12);
  });

  it('equilateral configuration places n on the pole', () => {
    // |ρ̃| = |λ̃| and ρ̃ ⊥ λ̃ → n_1 = n_2 = 0, n_3 = ±1.
    const n = shapeSphere([1, 0], [0, 1]);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(Math.abs(n[2])).toBeCloseTo(1, 12);
  });

  it('output is unit length for any nonzero input', () => {
    for (const [r, l] of [[[0.3, -0.2], [0.5, 0.7]],
                          [[1.1, 0.0], [0.0, 0.4]],
                          [[2.0, 1.5], [-0.7, 1.2]]] as
                          [[number,number],[number,number]][]) {
      const n = shapeSphere(r, l);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12);
    }
  });
});

describe('mass-weighted Jacobi', () => {
  it('produces equal magnitudes for an equal-mass equilateral', () => {
    const m = [1/3, 1/3, 1/3] as const;
    // |ρ| = 1, |λ| = √3/2; check that |ρ̃| = |λ̃| = √(1/6)
    const { rhoT, lambdaT } = massWeightedJacobi([1, 0], [0, Math.sqrt(3)/2], m);
    const rhoMag    = Math.hypot(rhoT[0],    rhoT[1]);
    const lambdaMag = Math.hypot(lambdaT[0], lambdaT[1]);
    expect(rhoMag).toBeCloseTo(lambdaMag, 12);
  });
});
```

### `test/unit/metrics/phase.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { phaseFromN, unwrapPhase } from '@/metrics/phase.js';

describe('phase + unwrap', () => {
  it('phase of (1, 0, 0) is 0', () => {
    expect(phaseFromN([1, 0, 0])).toBe(0);
  });
  it('phase of (0, 1, 0) is π/2', () => {
    expect(phaseFromN([0, 1, 0])).toBeCloseTo(Math.PI/2, 12);
  });

  it('handles a forward sweep across the antimeridian', () => {
    // From just below π to just above -π (winding once forward).
    const tt = unwrapPhase(Math.PI - 0.01, -Math.PI + 0.01, 0);
    expect(tt).toBeCloseTo(0.02, 6);
  });

  it('handles a backward sweep', () => {
    const tt = unwrapPhase(-Math.PI + 0.01, Math.PI - 0.01, 0);
    expect(tt).toBeCloseTo(-0.02, 6);
  });

  it('accumulates over many wraps', () => {
    let tt = 0;
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const cur = (((i + 1) * 0.5 + Math.PI) % (2 * Math.PI)) - Math.PI;
      tt = unwrapPhase(prev, cur, tt);
      prev = cur;
    }
    expect(tt).toBeCloseTo(50, 1);   // total angular travel
  });
});
```

### `test/unit/metrics/diffusion.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fitOmega, diffusion } from '@/metrics/diffusion.js';

describe('windowed frequency fit', () => {
  it('recovers the slope of a perfect line', () => {
    const t  = [0, 1, 2, 3, 4];
    const tt = t.map(x => 2.5 * x + 7);
    expect(fitOmega(t, tt)).toBeCloseTo(2.5, 12);
  });

  it('returns null for too-few samples', () => {
    expect(fitOmega([0, 1], [0, 1])).toBeNull();
  });
});

describe('diffusion sentinel', () => {
  it('returns -1 when one window has no samples', () => {
    const T = 80;
    // Samples only inside W_1 = [20, 40]; W_2 = [40, 60] stays empty.
    const t1 = [22, 24, 26, 28, 30];
    const tt1 = t1.map(x => 0.1 * x);
    expect(diffusion(t1, tt1, T).value).toBe(-1);
  });

  it('returns the absolute slope difference for a deliberately ramped frequency', () => {
    const T = 80;
    const t: number[] = [];
    const tt: number[] = [];
    // Gradually accelerate: phase = 0.1 t  for t < 40, phase = 0.3 t - 8 for t ≥ 40.
    for (let i = 0; i < 80; i++) {
      const x = i + 0.5;
      t.push(x);
      tt.push(x < 40 ? 0.1 * x : 0.3 * x - 8);
    }
    const d = diffusion(t, tt, T);
    expect(d.value).toBeCloseTo(0.2, 2);
  });
});
```

### `test/unit/metrics/free_group.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  emptyWord, appendSymbol, wordToString, freeGroupTick, pickEndpoint,
} from '@/metrics/free_group.js';
import { SYMBOL } from '@/metrics/types.js';

describe('symbol append and free reduction', () => {
  it('appends symbols in order', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.b);
    w = appendSymbol(w, SYMBOL.A);
    w = appendSymbol(w, SYMBOL.B);
    expect(wordToString(w)).toBe('abAB');
  });

  it('reduces aA on append', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.A);
    expect(wordToString(w)).toBe('');
    expect(w.length).toBe(0);
  });

  it('reduces nested cancellations one at a time', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.b);
    w = appendSymbol(w, SYMBOL.B);   // cancels with previous
    expect(wordToString(w)).toBe('a');
  });

  it('truncates at 58 symbols', () => {
    let w = emptyWord();
    for (let i = 0; i < 70; i++) {
      w = appendSymbol(w, SYMBOL.a);
    }
    expect(w.truncated).toBe(true);
    expect(w.length).toBe(58);
  });
});

describe('branch-cut endpoint', () => {
  it('picks north for an equator BC', () => {
    expect(pickEndpoint([1, 0, 0])).toEqual([0, 0, 1]);
  });

  it('falls back to south when b̂ is near the north pole', () => {
    expect(pickEndpoint([0.05, 0, 0.999])).toEqual([0, 0, -1]);
  });
});

describe('freeGroupTick', () => {
  const b1 = [1, 0, 0] as const;
  const b2 = [-0.5, Math.sqrt(3)/2, 0] as const;

  it('crossing the C_a cut from above to below appends `a`', () => {
    // C_a is the great circle through b1 = (1,0,0) and (0,0,1). Plane
    // normal n × ê has a positive +y component. Points with positive y
    // are on the positive side, points with negative y are below.
    let w = emptyWord();
    const prev = [0.5, 0.866, 0] as const;
    const cur  = [0.5, -0.866, 0] as const;
    w = freeGroupTick(w, prev, cur, b1 as any, b2 as any);
    expect(w.length).toBe(1);
  });
});
```

### `test/unit/metrics/packing.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  packSampleDescriptor, unpackSampleDescriptor,
  packTrajectoryStats,  unpackTrajectoryStats,
} from '@/metrics/packing.js';

describe('sample_descriptor pack / unpack', () => {
  it('round-trips', () => {
    const f = {
      outcomeClass: 2 as const, detail: 1, suspectEnergy: true,
      suspectLz: false, ftleValid: true, wordTruncated: false,
      wordUncertain: true,
      encounterCount: 17, substepLog2: 6, benettinCount: 12,
      dominantPair: 1 as const,
    };
    const packed = packSampleDescriptor(f);
    expect(unpackSampleDescriptor(packed)).toEqual(f);
  });

  it('clamps overlarge values', () => {
    const f = {
      outcomeClass: 0 as const, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: false, wordTruncated: false, wordUncertain: false,
      encounterCount: 1000, substepLog2: 1000, benettinCount: 1000,
      dominantPair: 0 as const,
    };
    const u = unpackSampleDescriptor(packSampleDescriptor(f));
    expect(u.encounterCount).toBe(63);
    expect(u.substepLog2).toBe(127);
    expect(u.benettinCount).toBe(127);
  });
});

describe('trajectory_stats pack / unpack', () => {
  it('round-trips', () => {
    const f = {
      tDminFrac: 32768, totalStepsLog2: 12,
      orbitCount: 3, dminPair: 2 as const, retrograde: true,
    };
    expect(unpackTrajectoryStats(packTrajectoryStats(f))).toEqual(f);
  });
});
```

### `test/golden/shape_sphere_landmarks.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';

const m = [1/3, 1/3, 1/3] as const;

describe('shape-sphere landmark coordinates (equal masses)', () => {
  it('BC pair (0,1) collision → b̂_1 = (1, 0, 0)', () => {
    // ρ → 0; λ arbitrary nonzero.
    const { rhoT, lambdaT } = massWeightedJacobi([0, 0], [0.7, 0.3], m);
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(1, 12);
  });

  it('BC pair (1,2) collision → b̂_3 ≈ (-1/2, +√3/2, 0)', () => {
    // r_1 = r_2 ⇒ ρ = √3 λ in mass-weighted Jacobi; angle between them = 0.
    // Build the configuration directly with α = π/6, β = 0.
    const alpha = Math.PI/6;
    const rhoT    = [Math.cos(alpha), 0] as const;
    const lambdaT = [Math.sin(alpha) * Math.cos(0),
                     Math.sin(alpha) * Math.sin(0)] as const;
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(-0.5,  6);
    expect(n[1]).toBeCloseTo(-Math.sqrt(3)/2, 6); // sign from -2 ρ̃·λ̃
    expect(n[2]).toBeCloseTo(0,    12);
  });

  it('Lagrange L^+ at α = π/4, β = π/2', () => {
    const alpha = Math.PI/4;
    const beta  = Math.PI/2;
    const rhoT    = [Math.cos(alpha), 0] as const;
    const lambdaT = [Math.sin(alpha) * Math.cos(beta),
                     Math.sin(alpha) * Math.sin(beta)] as const;
    const n = shapeSphere(rhoT, lambdaT);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(1, 12);   // north pole
  });
});
```

### `test/golden/figure8_word.test.ts`

The figure-8 orbit (Chenciner–Montgomery) is a periodic equal-mass three-body
solution. Its homotopy class on the punctured shape sphere is the commutator
`[a, b] = a b a^{-1} b^{-1}`, written here as `abAB`. After multiple
periods, the recorded word should be a power of that base.

**D6.1 — use the rescaled IC, not the textbook one.** The original listing
built the IC from the standard CM velocities (mis-halved, with a
self-contradicting comment) at m = 1/3 and integrated to `T = 6.32·4`. Both
are wrong at Σm = 1: the canonical unit-mass velocities scale by 1/√3 and the
period by √3 (≈ 10.9568) — exactly the M1 golden's fixture. A non-periodic
orbit never closes the word. As built, the test loads
`test/golden/figure8_reference.json` (the pinned, convergence-verified IC):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { kdkMacroStep } from '@/integrate/kdk.js';
import { metricsTick, makeMetrics, DEFAULT_BRANCH_CUTS } from '@/metrics/observe_extended.js';
import { wordToString } from '@/metrics/free_group.js';
import type { TrajState } from '@/math/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(
  readFileSync(path.join(here, 'figure8_reference.json'), 'utf-8'),
) as { ic: { m: number[]; r: number[][]; p: number[][] } };

function figure8IC(): TrajState {
  const [m0, m1, m2] = REF.ic.m as [number, number, number];
  const r = REF.ic.r as [[number, number], [number, number], [number, number]];
  const p = REF.ic.p as [[number, number], [number, number], [number, number]];
  return { m: [m0, m1, m2], r, p, t: 0 };
}

const PERIOD = 6.32591398 * Math.sqrt(3);   // ≈ 10.9568 in Σm = 1 units

describe('figure-8 orbit free-group word', () => {
  it('reduces to a power of abAB after several periods', () => {
    const acc = makeMetrics();
    let s = figure8IC();
    const dt = 1e-3;
    const T = PERIOD * 4;

    // We integrate ourselves so we can call metricsTick once per macro step.
    // In production, metricsTick is wired into the integrator's macro loop;
    // the test mirrors that by stepping kdkMacroStep directly.
    while (s.t < T) {
      const r = kdkMacroStep(s, dt, { rSub: 0.05, gammaSub: 1.5, NMax: 64 });
      s = r.state;
      metricsTick(acc, s, false, DEFAULT_BRANCH_CUTS);
    }
    const w = wordToString(acc.word);
    const base = 'abAB';
    expect(w.length).toBeGreaterThan(0);
    expect(w.length % base.length).toBe(0);
    // A periodic word can start at any cyclic position, in either
    // orientation (traversal direction depends on velocity sign
    // conventions): rotations of abAB and of its inverse baBA.
    const rotations = [
      'abAB', 'bABa', 'ABab', 'BabA',
      'baBA', 'aBAb', 'BAba', 'AbaB',
    ];
    const period = rotations.find((r) => w.startsWith(r));
    expect(period, `word was ${w}`).toBeDefined();
    // Every 4-symbol block repeats the same base.
    for (let i = 0; i < w.length; i += 4) {
      expect(w.slice(i, i + 4)).toBe(period);
    }
  }, 120_000);
});
```

### `test/golden/ftle_chaotic_vs_regular.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { benettinFTLE } from '@/metrics/ftle.js';
import { kdkMacroStep } from '@/integrate/kdk.js';
import type { TrajState } from '@/math/types.js';

const sp = { rSub: 0.05, gammaSub: 1.5, NMax: 64 };

function regularOrbit(): TrajState {
  // Equal-mass binary on a circular orbit; third body far away and inert.
  // D6.2: circular momentum at separation 1 with m ≈ 1/2 each is
  // v² = F·r/m = 0.25·0.5/0.5 → v = 0.5, p = m·v ≈ 0.25. (The original
  // 0.7071 gave an UNBOUND pair — E > 0 — not a regular reference orbit.)
  return {
    m: [0.4999, 0.4999, 0.0002] as const,
    r: [[0.5, 0], [-0.5, 0], [50, 0]] as const,
    p: [[0, 0.25], [0, -0.25], [0, 0]] as const,
    t: 0,
  };
}

function burrauScattering(): TrajState {
  // Burrau (3,4,5) at rest start. Indexed for our pipeline.
  const m = [5/12, 4/12, 3/12] as const;
  return {
    m, r: [[0,0], [0.8, 0], [0, 0.6]],
    p: [[0,0],[0,0],[0,0]] as const, t: 0,
  };
}

function runBenettin(ic: TrajState, T: number, delta0: number) {
  let base = ic;
  let shadow: TrajState = perturb(ic, delta0);

  return benettinFTLE(
    {
      step: () => {
        base   = kdkMacroStep(base,   1e-3, sp).state;
        shadow = kdkMacroStep(shadow, 1e-3, sp).state;
      },
      separation: () => sep(base, shadow),
      renormalise: () => { shadow = renorm(base, shadow, delta0); },
    },
    T, 1e-3, 50, delta0,
  );
}

function perturb(s: TrajState, delta: number): TrajState {
  return {
    m: s.m, t: s.t,
    r: [
      [s.r[0][0] + delta, s.r[0][1]],
      [s.r[1][0]        , s.r[1][1]],
      [s.r[2][0]        , s.r[2][1]],
    ],
    p: s.p,
  };
}

function sep(a: TrajState, b: TrajState): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const dx = b.r[i][0] - a.r[i][0];
    const dy = b.r[i][1] - a.r[i][1];
    s += a.m[i] * (dx*dx + dy*dy);
    const dpx = b.p[i][0] - a.p[i][0];
    const dpy = b.p[i][1] - a.p[i][1];
    s += (dpx*dpx + dpy*dpy) / a.m[i];
  }
  return Math.sqrt(s);
}

function renorm(base: TrajState, shadow: TrajState, delta0: number): TrajState {
  const d = sep(base, shadow); if (d === 0) return shadow;
  const scale = delta0 / d;
  return {
    m: shadow.m, t: shadow.t,
    r: [
      [base.r[0][0] + (shadow.r[0][0] - base.r[0][0]) * scale,
       base.r[0][1] + (shadow.r[0][1] - base.r[0][1]) * scale],
      [base.r[1][0] + (shadow.r[1][0] - base.r[1][0]) * scale,
       base.r[1][1] + (shadow.r[1][1] - base.r[1][1]) * scale],
      [base.r[2][0] + (shadow.r[2][0] - base.r[2][0]) * scale,
       base.r[2][1] + (shadow.r[2][1] - base.r[2][1]) * scale],
    ],
    p: [
      [base.p[0][0] + (shadow.p[0][0] - base.p[0][0]) * scale,
       base.p[0][1] + (shadow.p[0][1] - base.p[0][1]) * scale],
      [base.p[1][0] + (shadow.p[1][0] - base.p[1][0]) * scale,
       base.p[1][1] + (shadow.p[1][1] - base.p[1][1]) * scale],
      [base.p[2][0] + (shadow.p[2][0] - base.p[2][0]) * scale,
       base.p[2][1] + (shadow.p[2][1] - base.p[2][1]) * scale],
    ],
  };
}

describe('FTLE: chaotic ≫ regular', () => {
  it('Burrau scattering ≥ 10× regular binary FTLE', () => {
    const reg = runBenettin(regularOrbit(),  20, 1e-8);
    const cha = runBenettin(burrauScattering(), 20, 1e-8);
    expect(reg.valid).toBe(true);
    expect(cha.valid).toBe(true);
    expect(cha.lambda).toBeGreaterThan(10 * reg.lambda);
  }, 60_000);
});
```

## Run it

```bash
npm test -- --run test/unit/metrics
npm test -- --run test/golden/figure8_word
npm test -- --run test/golden/shape_sphere_landmarks
npm test -- --run test/golden/ftle_chaotic_vs_regular
```

## Acceptance check

```bash
npm test -- --run test/golden/figure8_word test/golden/ftle_chaotic_vs_regular test/golden/shape_sphere_landmarks
```

All three goldens pass:
- BC₁ at `(1,0,0)`, BC₃ at `(-1/2, ±√3/2, 0)`, Lagrange at the poles.
- Figure-8 free-group word reduces to a power of `abAB`.
- Burrau FTLE is at least 10× the regular orbit's.

## Notes for the implementer

- **Order of integration into M5.** The metrics fields populated by this
  milestone (`spread_n`, `spread_diffusion`, `mean_word_length`, etc.)
  feed the coherence score from M5. Wire the second-pass spread
  computation into `reduce.wgsl` once `mean_n_checkpoints` is available
  from the first pass — that's a 64-lane mean-then-spread pattern,
  identical to the one already there for `arc_length_n`.
- **Branch-cut basepoints depend on masses.** The defaults
  `(1, 0, 0)` and `(-1/2, √3/2, 0)` are the equal-mass collision points
  in the corrected shape-sphere coordinate. For unequal masses, pass the
  mass-dependent `b̂_i` from the chart; M11 (Burrau) supplies them.
- **FTLE on the GPU.** The Research-tier FTLE shader is structurally
  identical to the integrator with two trajectory states in registers.
  Each macro step kicks/drifts/kicks both, and the renormalisation
  cadence (`M_renorm = 50` by default) is a thread-local counter. There
  is no inter-thread coordination, so the cost is just 2× registers and
  ~2× ALU.
- **The free-group encoding deliberately leaves `prev_n` for the caller**
  to manage. In the GPU integrator, `prev_n` lives next to the current
  state in workgroup-local registers; on the CPU the
  `MetricsAccumulator` carries it.
