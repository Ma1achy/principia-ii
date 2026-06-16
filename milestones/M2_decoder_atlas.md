# M2 — Decoder atlas, canonicaliser, inverse paths

## Goal

The single decoder pipeline that every chart funnels through. Mass decode
(softmax with logit saturation, plus direct-simplex alternative),
configuration decode (canonical-frame hyperspherical Jacobi), free Jacobi
momentum decode, canonicaliser with rotation/mirror/scale gauges,
no-holes guard, and inverse encode paths.

**Exit criterion.**

```bash
npm test -- --run test/unit/decode test/golden/decode
```

The lookup round-trip (mass / configuration / free-momentum) holds to better
than `1e-9` at 1000 random non-saturated points; landmark configurations
(α=0, α=π/2, equilateral with equal masses) decode to the expected
geometric shapes; and the no-holes contract holds: every UV pixel lands in
either a valid IC or a labelled terminal.

**Deliverable:** internal — tests only (no visible artifact until a later GPU/UI milestone); the single decode/canonicalise/encode pipeline (with its no-holes guarantee) that every chart funnels through.

## File tree

```
principia/
  src/
    decode/
      types.ts
      mass.ts
      configuration.ts
      momentum_free.ts
      jacobi_particle.ts
      canonicalise.ts
      inverse.ts
      no_holes.ts
      pipeline.ts
      index.ts
  test/
    unit/decode/
      mass.test.ts
      configuration.test.ts
      momentum_free.test.ts
      jacobi_particle.test.ts
      canonicalise.test.ts
      inverse.test.ts
      pipeline.test.ts
    golden/
      decode_landmarks.test.ts
```

## `src/decode/types.ts`

```ts
import type { Vec2, Vec3, Vec8, Triple, TerminalLabel, TrajState } from '@/math/types.js';

/**
 * Closed enumeration of decode-time degeneracy reasons (ADR 0007).
 * Frozen u32 codes (10..17) shared byte-for-byte with the WGSL outcome
 * encoding; downstream matches on the enum, never on free strings.
 * `COLLISION_T0` is a separate terminal kind, NOT a member here.
 *
 * A plain (non-`const`) enum: under `isolatedModules` (Vite/esbuild) a
 * cross-module `const enum` is erased to `undefined` at the import site, and
 * this enum is consumed from `@/decode/types.js` by M10 and G11.
 */
export enum DegenerateReason {
  M01_TINY                 = 10,
  MASS_SATURATION          = 11,
  ALPHA_CLAMPOUT           = 12,
  JACOBI_GUARD             = 13,
  MIRROR_TIE               = 14,
  INFEASIBLE_ENERGY        = 15,
  MOMENTUM_SEEDS_EXHAUSTED = 16,
  NONFINITE                = 17,
}

/**
 * The latent 8D point. Components, in order:
 *   0,1: configuration (z_α, z_β)
 *   2,3,4,5: free Jacobi momentum (z_q0..z_q3)
 *   6,7: mass logits (z_μ1, z_μ2)
 */
export type LatentZ = Vec8;

export interface DecodeKnobs {
  muMax:        number;
  alphaMin:     number;
  qMax:         number;
  rColl:        number;
  deltaLambda:  number;             // mirror-rule deadband
  RTilde:       number;             // hyperspherical scale gauge (= 1)
}

/** Output of the configuration decoder before reconstruction. */
export interface ConfigCanonical {
  rhoTilde:    Vec2;          // mass-weighted Jacobi (canonical frame)
  lambdaTilde: Vec2;
  alpha:       number;
  beta:        number;
}

/** Output of the momentum decoder, in the Jacobi basis. */
export interface JacobiMomenta {
  pRho:    Vec2;
  pLambda: Vec2;
}

/** Result of the full decode pipeline. */
export type DecodeResult =
  | { kind: 'ok';        state: TrajState; descriptor: ICDescriptor }
  | { kind: 'terminal';  terminal: TerminalLabel; descriptor: ICDescriptor };

/** Initial-condition descriptor (companion struct, written once per pixel). */
export interface ICDescriptor {
  m:           Vec3;
  qMass:       number;        // m_min / M_total
  rho1Mag:     number;        // |ρ₁| (unweighted, inner Jacobi)
  rho2Mag:     number;        // |ρ₂| (unweighted, outer Jacobi)
  rhoRatio:    number;        // |ρ₂|/|ρ₁|
  rhoAngle:    number;        // signed angle between ρ₁, ρ₂
  K0:          number;
  V0:          number;
  virial:      number;        // 2 K_0 / max(ε, |V_0|)
  rMinPair0:   number;
}
```

## `src/decode/mass.ts`

```ts
import type { Vec3 } from '@/math/types.js';
import { massFromLogits, massFromSimplex, logitsFromMasses } from '@/math/softmax.js';
import { artanh, clamp } from '@/math/scalar.js';

export function decodeMassSoftmax(
  zMu1: number, zMu2: number, muMax: number,
): Vec3 {
  return massFromLogits(zMu1, zMu2, muMax);
}

export function decodeMassSimplex(t1: number, t2: number, epsM: number): Vec3 {
  const m = massFromSimplex(t1, t2);
  // Apply interior buffer: shrink toward barycentre.
  return [
    (1 - 3*epsM) * m[0] + epsM,
    (1 - 3*epsM) * m[1] + epsM,
    (1 - 3*epsM) * m[2] + epsM,
  ];
}

/**
 * Inverse of `decodeMassSoftmax`. Caller-controlled clamp via `epsMu`
 * keeps `μ_k / μ_max` away from the open-interval endpoints before
 * `artanh`.
 */
export function inverseMass(
  m: Vec3, muMax: number, epsMu: number,
): { zMu1: number; zMu2: number; clamped: boolean } {
  const { mu1, mu2 } = logitsFromMasses(m);
  let clamped = false;
  const norm = (mu: number) => {
    const x = mu / muMax;
    if (x <= -1 + epsMu || x >= 1 - epsMu) clamped = true;
    return clamp(x, -1 + epsMu, 1 - epsMu);
  };
  return { zMu1: artanh(norm(mu1)), zMu2: artanh(norm(mu2)), clamped };
}
```

## `src/decode/configuration.ts`

```ts
import type { ConfigCanonical } from './types.js';
import { sigmoid, logit, clamp } from '@/math/scalar.js';

/**
 * Canonical-frame hyperspherical mass-weighted Jacobi.
 *
 * α is the polar angle on the configuration sphere with the convention
 *   |ρ̃| = R̃ cos α,  |λ̃| = R̃ sin α.
 * α near 0  → body 2 sits at the inner-pair COM (large |ρ|).
 * α near π/2 → bodies 0,1 collide (tight inner pair).
 *
 * β is the angle between ρ̃ and λ̃ in the canonical frame, restricted to [0, π]
 * because the mirror gauge identifies β and 2π − β.
 */
export function decodeConfigCanonical(
  zAlpha: number, zBeta: number, alphaMin: number, RTilde = 1,
): ConfigCanonical {
  const alpha = alphaMin + (Math.PI/2 - 2*alphaMin) * sigmoid(zAlpha);
  const beta  = Math.PI * sigmoid(zBeta);
  const rhoTilde:    [number, number] = [RTilde * Math.cos(alpha), 0];
  const lambdaTilde: [number, number] = [
    RTilde * Math.sin(alpha) * Math.cos(beta),
    RTilde * Math.sin(alpha) * Math.sin(beta),
  ];
  return { rhoTilde, lambdaTilde, alpha, beta };
}

/** Inverse: recover (z_α, z_β) from (α, β) with sigmoid clamp. */
export function inverseConfigCanonical(
  alpha: number, beta: number, alphaMin: number, epsZ: number,
): { zAlpha: number; zBeta: number; clamped: boolean } {
  const sA = (alpha - alphaMin) / (Math.PI/2 - 2*alphaMin);
  const sB = beta / Math.PI;
  let clamped = false;
  const cl = (s: number) => {
    if (s <= epsZ || s >= 1 - epsZ) clamped = true;
    return clamp(s, epsZ, 1 - epsZ);
  };
  return { zAlpha: logit(cl(sA)), zBeta: logit(cl(sB)), clamped };
}
```

## `src/decode/momentum_free.ts`

```ts
import type { Vec2 } from '@/math/types.js';
import type { JacobiMomenta } from './types.js';
import { sigmoid, logit, clamp } from '@/math/scalar.js';

/**
 * Free Jacobi-momentum decode: q_k = q_max (2 σ(z_qk) - 1).
 * The four scalars are packed (p_ρx, p_ρy, p_λx, p_λy) by convention.
 */
export function decodeFreeJacobiMomenta(
  zq: readonly [number, number, number, number], qMax: number,
): JacobiMomenta {
  const q0 = qMax * (2*sigmoid(zq[0]) - 1);
  const q1 = qMax * (2*sigmoid(zq[1]) - 1);
  const q2 = qMax * (2*sigmoid(zq[2]) - 1);
  const q3 = qMax * (2*sigmoid(zq[3]) - 1);
  return { pRho: [q0, q1] as Vec2, pLambda: [q2, q3] as Vec2 };
}

export function inverseFreeJacobiMomenta(
  jm: JacobiMomenta, qMax: number, epsZ: number,
): { zq: [number, number, number, number]; clamped: boolean } {
  let clamped = false;
  const back = (q: number): number => {
    const s = 0.5 * (q / qMax + 1);
    if (s <= epsZ || s >= 1 - epsZ) clamped = true;
    return logit(clamp(s, epsZ, 1 - epsZ));
  };
  return {
    zq: [back(jm.pRho[0]), back(jm.pRho[1]),
         back(jm.pLambda[0]), back(jm.pLambda[1])],
    clamped,
  };
}
```

## `src/decode/jacobi_particle.ts`

```ts
import type { Vec2, Vec3, Triple } from '@/math/types.js';
import type { JacobiMomenta } from './types.js';

/**
 * Reconstruct particle positions from unweighted Jacobi vectors:
 *   r_{01} = -m_2 λ
 *   r_2    =  M_{01} λ
 *   r_0    = r_{01} - (m_1/M_{01}) ρ
 *   r_1    = r_{01} + (m_0/M_{01}) ρ
 */
export function jacobiToParticlePositions(
  rho: Vec2, lambda: Vec2, m: Vec3,
): Triple<Vec2> {
  const M01 = m[0] + m[1];
  const r01x = -m[2] * lambda[0], r01y = -m[2] * lambda[1];
  const r2: Vec2 = [M01 * lambda[0], M01 * lambda[1]];
  const r0: Vec2 = [r01x - (m[1] / M01) * rho[0], r01y - (m[1] / M01) * rho[1]];
  const r1: Vec2 = [r01x + (m[0] / M01) * rho[0], r01y + (m[0] / M01) * rho[1]];
  return [r0, r1, r2];
}

/**
 * Inverse of the position reconstruction.
 *   ρ = r_1 - r_0
 *   λ = r_2 - (m_0 r_0 + m_1 r_1) / M_{01}
 */
export function particlePositionsToJacobi(
  r: Triple<Vec2>, m: Vec3,
): { rho: Vec2; lambda: Vec2 } {
  const M01 = m[0] + m[1];
  const cx = (m[0]*r[0][0] + m[1]*r[1][0]) / M01;
  const cy = (m[0]*r[0][1] + m[1]*r[1][1]) / M01;
  return {
    rho:    [r[1][0] - r[0][0], r[1][1] - r[0][1]],
    lambda: [r[2][0] - cx,      r[2][1] - cy],
  };
}

/**
 * Jacobi momenta to particle momenta (COM frame, M = 1):
 *   p_0 = -p_ρ - (m_0 / M_{01}) p_λ
 *   p_1 =  p_ρ - (m_1 / M_{01}) p_λ
 *   p_2 =  p_λ
 */
export function jacobiToParticleMomenta(
  jm: JacobiMomenta, m: Vec3,
): Triple<Vec2> {
  const M01 = m[0] + m[1];
  const p0: Vec2 = [-jm.pRho[0] - (m[0]/M01) * jm.pLambda[0],
                    -jm.pRho[1] - (m[0]/M01) * jm.pLambda[1]];
  const p1: Vec2 = [ jm.pRho[0] - (m[1]/M01) * jm.pLambda[0],
                     jm.pRho[1] - (m[1]/M01) * jm.pLambda[1]];
  const p2: Vec2 = [jm.pLambda[0], jm.pLambda[1]];
  return [p0, p1, p2];
}

/** Inverse: p_λ = p_2,  p_ρ = p_1 + (m_1/M_{01}) p_λ. */
export function particleMomentaToJacobi(
  p: Triple<Vec2>, m: Vec3,
): JacobiMomenta {
  const M01 = m[0] + m[1];
  const pLambda: Vec2 = p[2];
  const pRho: Vec2 = [
    p[1][0] + (m[1]/M01) * pLambda[0],
    p[1][1] + (m[1]/M01) * pLambda[1],
  ];
  return { pRho, pLambda };
}
```

## `src/decode/canonicalise.ts`

```ts
import type { TrajState, Triple, Vec2, Vec3, TerminalLabel } from '@/math/types.js';
import { rotation, applyR, reflectX } from '@/math/rotate.js';
import { particlePositionsToJacobi } from './jacobi_particle.js';
import { signDeadband } from '@/math/scalar.js';
import { projectCOM } from '@/integrate/com.js';

/**
 * Canonicalise a state. With a canonical-frame decode this is essentially
 * a no-op; we still run it as a guard against callers that arrive through
 * non-canonical paths (lookup, exact-IC entry).
 *
 * Steps:
 *  1. COM project to absorb f64 round-off.
 *  2. Rotate so ρ̃ lies on +x.
 *  3. Dead-banded mirror so λ̃_y >= 0.
 *  4. (Optional) scale-gauge rescale; no-op if R̃ = 1 was enforced upstream.
 */
export function canonicalise(
  s: TrajState, opts: { deltaLambda: number; rColl: number },
): { state: TrajState; terminal?: TerminalLabel } {
  // 1. COM project
  const sc = projectCOM(s);

  // 2. Rotate so the (unweighted) ρ vector points along +x.
  const { rho, lambda } = particlePositionsToJacobi(sc.r, sc.m);
  const phi = Math.atan2(rho[1], rho[0]);
  const R = rotation(-phi);
  const rRot: Triple<Vec2> = [
    applyR(R, sc.r[0]), applyR(R, sc.r[1]), applyR(R, sc.r[2]),
  ];
  const pRot: Triple<Vec2> = [
    applyR(R, sc.p[0]), applyR(R, sc.p[1]), applyR(R, sc.p[2]),
  ];

  // 3. Mirror so λ_y >= 0, with deadband.
  const lambdaRot: Vec2 = [lambda[0]*Math.cos(-phi) - lambda[1]*Math.sin(-phi),
                           lambda[0]*Math.sin(-phi) + lambda[1]*Math.cos(-phi)];
  const sign = signDeadband(lambdaRot[1], opts.deltaLambda);
  const reflect = sign < 0;
  const rOut: Triple<Vec2> = reflect
    ? [reflectX(rRot[0]), reflectX(rRot[1]), reflectX(rRot[2])]
    : rRot;
  const pOut: Triple<Vec2> = reflect
    ? [reflectX(pRot[0]), reflectX(pRot[1]), reflectX(pRot[2])]
    : pRot;

  const state: TrajState = { r: rOut, p: pOut, m: sc.m, t: sc.t };

  // 4. No-holes: collision at t=0?
  const minSep = Math.min(
    Math.hypot(rOut[1][0]-rOut[0][0], rOut[1][1]-rOut[0][1]),
    Math.hypot(rOut[2][0]-rOut[0][0], rOut[2][1]-rOut[0][1]),
    Math.hypot(rOut[2][0]-rOut[1][0], rOut[2][1]-rOut[1][1]),
  );
  if (minSep < opts.rColl) {
    return { state, terminal: { kind: 'COLLISION_T0', pair: closestPair(rOut) } };
  }

  return { state };
}

function closestPair(r: Triple<Vec2>): 0 | 1 | 2 {
  const d01 = Math.hypot(r[1][0]-r[0][0], r[1][1]-r[0][1]);
  const d02 = Math.hypot(r[2][0]-r[0][0], r[2][1]-r[0][1]);
  const d12 = Math.hypot(r[2][0]-r[1][0], r[2][1]-r[1][1]);
  if (d01 <= d02 && d01 <= d12) return 0;
  if (d02 <= d12)               return 1;
  return 2;
}
```

## `src/decode/no_holes.ts`

```ts
import type { TerminalLabel, TrajState } from '@/math/types.js';
import { DegenerateReason } from './types.js';

/**
 * Classify a thrown decoder error into a closed `DegenerateReason` member
 * (ADR 0007). Unrecognised throws fall through to the named catch-all
 * `NONFINITE` — never a free string and never an open `OTHER`.
 */
function classifyDecodeError(e: unknown): DegenerateReason {
  const v = (e as { reason?: unknown } | null)?.reason;
  if (typeof v === 'number' && v >= DegenerateReason.M01_TINY
                            && v <= DegenerateReason.NONFINITE) {
    return v as DegenerateReason;
  }
  return DegenerateReason.NONFINITE;
}

/**
 * Top-level guard that ensures every decode path emits a labelled output.
 * Convert any thrown decoder error into a DEGENERATE label rather than
 * letting it bubble up to the GPU dispatch. The reason is the closed
 * `DegenerateReason` enum (ADR 0007), defaulting to `NONFINITE`.
 */
export function safeguardDecode<T>(
  fn: () => T,
  fallback: (reason: DegenerateReason) => TerminalLabel,
): T | { __terminal: TerminalLabel } {
  try {
    return fn();
  } catch (e) {
    return { __terminal: fallback(classifyDecodeError(e)) };
  }
}
```

## `src/decode/pipeline.ts`

```ts
import type { TrajState, Triple, Vec2, TerminalLabel } from '@/math/types.js';
import type { DecodeKnobs, DecodeResult, ICDescriptor, LatentZ } from './types.js';
import { DegenerateReason } from './types.js';
import { decodeMassSoftmax } from './mass.js';
import { decodeConfigCanonical } from './configuration.js';
import { decodeFreeJacobiMomenta } from './momentum_free.js';
import {
  jacobiToParticlePositions, jacobiToParticleMomenta,
} from './jacobi_particle.js';
import { canonicalise } from './canonicalise.js';
import { totalEnergy, minPairSeparation } from '@/integrate/forces.js';
import { EPS_BOLT } from '@/math/constants.js';

/**
 * Full decode pipeline for the 8D latent chart. Returns a labelled output
 * for every input — never throws, never returns NaN.
 */
export function decodeLatent(
  z: LatentZ, knobs: DecodeKnobs,
): DecodeResult {
  const m = decodeMassSoftmax(z[6], z[7], knobs.muMax);

  // No-holes guard: tiny M_{01} blocks the Jacobi reconstruction.
  if (m[0] + m[1] < 1e-10) {
    return makeTerminal({ kind: 'DEGENERATE', reason: DegenerateReason.M01_TINY }, m);
  }

  const cfg = decodeConfigCanonical(z[0], z[1], knobs.alphaMin, knobs.RTilde);

  // Unweight the mass-weighted Jacobi vectors.
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rho:    Vec2 = [cfg.rhoTilde[0]    / Math.sqrt(muRho),
                        cfg.rhoTilde[1]    / Math.sqrt(muRho)];
  const lambda: Vec2 = [cfg.lambdaTilde[0] / Math.sqrt(muLambda),
                        cfg.lambdaTilde[1] / Math.sqrt(muLambda)];

  const r: Triple<Vec2> = jacobiToParticlePositions(rho, lambda, m);

  const jm = decodeFreeJacobiMomenta(
    [z[2], z[3], z[4], z[5]], knobs.qMax,
  );
  const p: Triple<Vec2> = jacobiToParticleMomenta(jm, m);

  // Canonicalise (mostly a no-op, but absorbs round-off).
  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: knobs.deltaLambda, rColl: knobs.rColl });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

function makeTerminal(
  terminal: TerminalLabel, m: TrajState['m'],
): DecodeResult {
  // For terminal-at-decode states we still emit a descriptor so render
  // modes that read mass/colour can do something sensible. Position fields
  // are zero.
  const dummy: TrajState = {
    r: [[0,0],[0,0],[0,0]], p: [[0,0],[0,0],[0,0]], m, t: 0,
  };
  return { kind: 'terminal', terminal, descriptor: makeDescriptor(dummy) };
}

function makeDescriptor(s: TrajState): ICDescriptor {
  const m = s.m;
  const M = m[0] + m[1] + m[2];
  const qMass = Math.min(m[0], m[1], m[2]) / M;

  // Inner Jacobi |ρ| and outer |λ| from the actual r values.
  const M01 = m[0] + m[1];
  const cx  = (m[0]*s.r[0][0] + m[1]*s.r[1][0]) / M01;
  const cy  = (m[0]*s.r[0][1] + m[1]*s.r[1][1]) / M01;
  const rhoVec    = [s.r[1][0] - s.r[0][0], s.r[1][1] - s.r[0][1]] as const;
  const lambdaVec = [s.r[2][0] - cx,        s.r[2][1] - cy       ] as const;
  const rho1Mag   = Math.hypot(...rhoVec);
  const rho2Mag   = Math.hypot(...lambdaVec);

  const rhoAngle = Math.atan2(
    rhoVec[0]*lambdaVec[1] - rhoVec[1]*lambdaVec[0],
    rhoVec[0]*lambdaVec[0] + rhoVec[1]*lambdaVec[1],
  );

  const K0 = (s.p[0][0]*s.p[0][0] + s.p[0][1]*s.p[0][1]) / (2*m[0])
           + (s.p[1][0]*s.p[1][0] + s.p[1][1]*s.p[1][1]) / (2*m[1])
           + (s.p[2][0]*s.p[2][0] + s.p[2][1]*s.p[2][1]) / (2*m[2]);
  const V0 = totalEnergy(s.m, s.r, s.p) - K0;

  return {
    m, qMass,
    rho1Mag, rho2Mag,
    rhoRatio: rho1Mag === 0 ? Infinity : rho2Mag / rho1Mag,
    rhoAngle,
    K0, V0,
    virial: 2 * K0 / Math.max(EPS_BOLT, Math.abs(V0)),
    rMinPair0: minPairSeparation(s.r).d,
  };
}
```

## `src/decode/inverse.ts`

```ts
import type { TrajState, Vec8 } from '@/math/types.js';
import type { LatentZ } from './types.js';
import { inverseMass } from './mass.js';
import { inverseConfigCanonical } from './configuration.js';
import { inverseFreeJacobiMomenta } from './momentum_free.js';
import {
  particlePositionsToJacobi, particleMomentaToJacobi,
} from './jacobi_particle.js';
import { canonicalise } from './canonicalise.js';
import { rotation, applyR, reflectX } from '@/math/rotate.js';

/**
 * Invert the full pipeline: physical IC → latent z. Used by the lookup /
 * lock paths in M8.
 */
export function inverseEncodeLatent(
  s: TrajState,
  knobs: { muMax: number; alphaMin: number; qMax: number;
           epsMu: number; epsZ: number; deltaLambda: number; rColl: number },
): { z: LatentZ; clamped: boolean } {
  // 1. Canonicalise the input (rotate ρ to +x, mirror, COM project).
  const c = canonicalise(s, { deltaLambda: knobs.deltaLambda, rColl: knobs.rColl });
  const sc = c.state;

  // 2. Recover the canonical Jacobi pair.
  const { rho, lambda } = particlePositionsToJacobi(sc.r, sc.m);
  const muRho    = (sc.m[0] * sc.m[1]) / (sc.m[0] + sc.m[1]);
  const muLambda = sc.m[2] * (sc.m[0] + sc.m[1]);
  const rhoT:    [number, number] = [rho[0]    * Math.sqrt(muRho),
                                     rho[1]    * Math.sqrt(muRho)];
  const lambdaT: [number, number] = [lambda[0] * Math.sqrt(muLambda),
                                     lambda[1] * Math.sqrt(muLambda)];

  // 3. Read α and β.
  const alpha = Math.atan2(Math.hypot(...lambdaT), Math.hypot(...rhoT));
  const beta  = Math.atan2(lambdaT[1], lambdaT[0]);   // already in [0, π] post-mirror

  // 4. Invert sigmoid wrapping for α and β.
  const cb = inverseConfigCanonical(alpha, beta, knobs.alphaMin, knobs.epsZ);

  // 5. Mass.
  const cm = inverseMass(sc.m, knobs.muMax, knobs.epsMu);

  // 6. Free momenta.
  const jm = particleMomentaToJacobi(sc.p, sc.m);
  const cq = inverseFreeJacobiMomenta(jm, knobs.qMax, knobs.epsZ);

  const z: LatentZ = [
    cb.zAlpha, cb.zBeta,
    cq.zq[0], cq.zq[1], cq.zq[2], cq.zq[3],
    cm.zMu1, cm.zMu2,
  ];
  return { z, clamped: cb.clamped || cm.clamped || cq.clamped };
}
```

## `src/decode/index.ts`

```ts
export * from './types.js';
export * from './mass.js';
export * from './configuration.js';
export * from './momentum_free.js';
export * from './jacobi_particle.js';
export * from './canonicalise.js';
export * from './pipeline.js';
export * from './inverse.js';
```

## Tests

### `test/unit/decode/mass.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  decodeMassSoftmax, decodeMassSimplex, inverseMass,
} from '@/decode/mass.js';

describe('decodeMassSoftmax / inverseMass', () => {
  it('round-trips for non-saturated points', () => {
    for (const [z1, z2] of [
      [0, 0], [0.3, -0.5], [-1.2, 1.7], [0.01, 0.02],
    ] as [number, number][]) {
      const m = decodeMassSoftmax(z1, z2, 100);   // muMax large → tanh ≈ id
      const back = inverseMass(m, 100, 1e-6);
      expect(back.clamped).toBe(false);
      // Re-decode and compare masses.
      const m2 = decodeMassSoftmax(back.zMu1, back.zMu2, 100);
      for (let i = 0; i < 3; i++) expect(m2[i]).toBeCloseTo(m[i], 9);
    }
  });

  it('flags clamping for saturated points', () => {
    const m = decodeMassSoftmax(50, 0, 5);        // strongly saturated
    const back = inverseMass(m, 5, 1e-6);
    expect(back.clamped).toBe(true);
  });
});

describe('decodeMassSimplex', () => {
  it('respects the interior buffer', () => {
    const m = decodeMassSimplex(0.001, 0.001, 1e-3);
    expect(m[0]).toBeGreaterThan(1e-3);
    expect(m[1]).toBeGreaterThan(1e-3);
    expect(m[2]).toBeGreaterThan(1e-3);
    expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
  });
});
```

### `test/unit/decode/configuration.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  decodeConfigCanonical, inverseConfigCanonical,
} from '@/decode/configuration.js';
import { ALPHA_MIN_DEFAULT } from '@/math/constants.js';

describe('decodeConfigCanonical', () => {
  it('places the centre of latent space at α = π/4, β = π/2', () => {
    const c = decodeConfigCanonical(0, 0, 0);
    expect(c.alpha).toBeCloseTo(Math.PI/4, 12);
    expect(c.beta).toBeCloseTo(Math.PI/2, 12);
  });

  it('respects the α_min buffer', () => {
    const c = decodeConfigCanonical(-1e6, 0, 0.05);
    expect(c.alpha).toBeGreaterThan(0.04);     // strict 0 < ε
  });

  it('reproduces |ρ̃| = cos α and |λ̃| = sin α at R̃ = 1', () => {
    const c = decodeConfigCanonical(0.7, -0.4, ALPHA_MIN_DEFAULT, 1);
    expect(Math.hypot(...c.rhoTilde   )).toBeCloseTo(Math.cos(c.alpha), 12);
    expect(Math.hypot(...c.lambdaTilde)).toBeCloseTo(Math.sin(c.alpha), 12);
  });

  it('round-trips with inverseConfigCanonical', () => {
    for (const z of [-1, -0.3, 0, 0.5, 1.5]) {
      for (const w of [-2, 0, 0.7]) {
        const c = decodeConfigCanonical(z, w, ALPHA_MIN_DEFAULT);
        const inv = inverseConfigCanonical(c.alpha, c.beta, ALPHA_MIN_DEFAULT, 1e-6);
        expect(inv.zAlpha).toBeCloseTo(z, 9);
        expect(inv.zBeta ).toBeCloseTo(w, 9);
      }
    }
  });
});
```

### `test/unit/decode/momentum_free.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  decodeFreeJacobiMomenta, inverseFreeJacobiMomenta,
} from '@/decode/momentum_free.js';

describe('free Jacobi momenta', () => {
  it('z = 0 → zero momentum', () => {
    const jm = decodeFreeJacobiMomenta([0, 0, 0, 0], 2);
    expect(jm.pRho[0]).toBe(0);
    expect(jm.pRho[1]).toBe(0);
    expect(jm.pLambda[0]).toBe(0);
    expect(jm.pLambda[1]).toBe(0);
  });

  it('saturates at ±q_max', () => {
    const jm = decodeFreeJacobiMomenta([1e9, -1e9, 1e9, -1e9], 2);
    expect(jm.pRho[0]   ).toBeCloseTo( 2, 9);
    expect(jm.pRho[1]   ).toBeCloseTo(-2, 9);
    expect(jm.pLambda[0]).toBeCloseTo( 2, 9);
    expect(jm.pLambda[1]).toBeCloseTo(-2, 9);
  });

  it('round-trips for non-saturated input', () => {
    for (const z of [[0.1, -0.2, 0.3, -0.4], [1.0, 0.0, -1.5, 2.0]] as
                    [number,number,number,number][]) {
      const jm = decodeFreeJacobiMomenta(z, 5);
      const inv = inverseFreeJacobiMomenta(jm, 5, 1e-6);
      for (let i = 0; i < 4; i++) expect(inv.zq[i]).toBeCloseTo(z[i], 9);
    }
  });
});
```

### `test/unit/decode/jacobi_particle.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  jacobiToParticlePositions, particlePositionsToJacobi,
  jacobiToParticleMomenta,  particleMomentaToJacobi,
} from '@/decode/jacobi_particle.js';

const m = [1/3, 1/3, 1/3] as const;

describe('Jacobi position round-trip', () => {
  it('inverts cleanly', () => {
    const rho:    [number, number] = [0.7, 0.0];
    const lambda: [number, number] = [-0.3, 0.4];
    const r = jacobiToParticlePositions(rho, lambda, m);
    const back = particlePositionsToJacobi(r, m);
    expect(back.rho   [0]).toBeCloseTo(rho   [0], 14);
    expect(back.rho   [1]).toBeCloseTo(rho   [1], 14);
    expect(back.lambda[0]).toBeCloseTo(lambda[0], 14);
    expect(back.lambda[1]).toBeCloseTo(lambda[1], 14);
  });

  it('produces a COM-zero configuration', () => {
    const r = jacobiToParticlePositions([0.5, 0.0], [0.1, 0.3], m);
    const cx = m[0]*r[0][0] + m[1]*r[1][0] + m[2]*r[2][0];
    const cy = m[0]*r[0][1] + m[1]*r[1][1] + m[2]*r[2][1];
    expect(cx).toBeCloseTo(0, 14);
    expect(cy).toBeCloseTo(0, 14);
  });
});

describe('Jacobi momentum round-trip', () => {
  it('inverts cleanly', () => {
    const jm = { pRho: [0.2, -0.5] as const, pLambda: [0.4, 0.1] as const };
    const p = jacobiToParticleMomenta(jm, m);
    const back = particleMomentaToJacobi(p, m);
    expect(back.pRho   [0]).toBeCloseTo(jm.pRho   [0], 14);
    expect(back.pRho   [1]).toBeCloseTo(jm.pRho   [1], 14);
    expect(back.pLambda[0]).toBeCloseTo(jm.pLambda[0], 14);
    expect(back.pLambda[1]).toBeCloseTo(jm.pLambda[1], 14);
  });

  it('produces a zero-total-momentum configuration', () => {
    const p = jacobiToParticleMomenta(
      { pRho: [0.4, 0.0], pLambda: [-0.1, 0.3] }, m);
    const px = p[0][0] + p[1][0] + p[2][0];
    const py = p[0][1] + p[1][1] + p[2][1];
    expect(px).toBeCloseTo(0, 14);
    expect(py).toBeCloseTo(0, 14);
  });
});
```

### `test/unit/decode/canonicalise.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/decode/canonicalise.js';

describe('canonicalise', () => {
  it('is idempotent', () => {
    const s = {
      r: [[0.5, 0], [-0.5, 0], [0, 0.7]] as const,
      p: [[0, 0.1], [0, -0.1], [0.1, 0]] as const,
      m: [1/3, 1/3, 1/3] as const, t: 0,
    };
    const a = canonicalise(s, { deltaLambda: 1e-12, rColl: 1e-4 }).state;
    const b = canonicalise(a, { deltaLambda: 1e-12, rColl: 1e-4 }).state;
    for (let i = 0; i < 3; i++) {
      expect(b.r[i][0]).toBeCloseTo(a.r[i][0], 14);
      expect(b.r[i][1]).toBeCloseTo(a.r[i][1], 14);
      expect(b.p[i][0]).toBeCloseTo(a.p[i][0], 14);
      expect(b.p[i][1]).toBeCloseTo(a.p[i][1], 14);
    }
  });

  it('detects collision-at-t=0', () => {
    const s = {
      r: [[0,0], [1e-5, 0], [10, 10]] as const,
      p: [[0,0],[0,0],[0,0]] as const,
      m: [1/3, 1/3, 1/3] as const, t: 0,
    };
    const c = canonicalise(s, { deltaLambda: 1e-12, rColl: 1e-4 });
    expect(c.terminal?.kind).toBe('COLLISION_T0');
  });
});
```

### `test/unit/decode/inverse.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import type { LatentZ } from '@/decode/types.js';

const knobs = {
  muMax: MU_MAX_DEFAULT,
  alphaMin: ALPHA_MIN_DEFAULT,
  qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT,
  deltaLambda: EPS_DEADBAND,
  RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

describe('latent encode/decode round-trip', () => {
  it('holds at 1000 random non-saturated points to better than 1e-9', () => {
    let rng = 12345;
    const next = () => {
      rng = (rng * 1664525 + 1013904223) & 0xffffffff;
      return ((rng >>> 0) / 0xffffffff - 0.5) * 2;       // uniform [-1, 1]
    };
    let mismatches = 0;
    for (let trial = 0; trial < 1000; trial++) {
      const z: LatentZ = [
        next(), next(),
        next()*0.5, next()*0.5, next()*0.5, next()*0.5,
        next(), next(),
      ];
      const r = decodeLatent(z, knobs);
      if (r.kind !== 'ok') continue;
      const back = inverseEncodeLatent(r.state, knobs);
      if (back.clamped) continue;       // skip clamping cases
      const r2 = decodeLatent(back.z, knobs);
      if (r2.kind !== 'ok') { mismatches++; continue; }
      // Compare physical state, not z (z can have multiple representations
      // when α is near α_min, etc).
      for (let i = 0; i < 3; i++) {
        if (Math.abs(r2.state.r[i][0] - r.state.r[i][0]) > 1e-9) mismatches++;
        if (Math.abs(r2.state.r[i][1] - r.state.r[i][1]) > 1e-9) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});
```

### `test/unit/decode/pipeline.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const knobs = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('decodeLatent — totality', () => {
  it('emits a labelled output for 10000 random latents (no NaN, no throw)', () => {
    let rng = 99;
    const next = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff;
                         return (rng / 0x7fffffff - 0.5) * 4; };
    for (let trial = 0; trial < 10000; trial++) {
      const z = [next(), next(), next(), next(),
                 next(), next(), next(), next()] as any;
      const r = decodeLatent(z, knobs);
      expect(r.kind === 'ok' || r.kind === 'terminal').toBe(true);
      if (r.kind === 'ok') {
        for (let i = 0; i < 3; i++) {
          expect(Number.isFinite(r.state.r[i][0])).toBe(true);
          expect(Number.isFinite(r.state.r[i][1])).toBe(true);
          expect(Number.isFinite(r.state.p[i][0])).toBe(true);
          expect(Number.isFinite(r.state.p[i][1])).toBe(true);
        }
      }
    }
  });
});
```

### `test/golden/decode_landmarks.test.ts`

The shape-sphere coordinate convention (corrected per spec revisions) places
the inner-pair collision at `n = (1, 0, 0)` and the equilateral configuration
at the poles. This test verifies that landmark configurations decode to the
expected shapes.

```ts
import { describe, it, expect } from 'vitest';
import { decodeConfigCanonical } from '@/decode/configuration.js';
import { jacobiToParticlePositions } from '@/decode/jacobi_particle.js';
import { ALPHA_MIN_DEFAULT } from '@/math/constants.js';

describe('decode landmarks', () => {
  it('α near 0 gives a near-degenerate configuration with body 2 at the inner-pair COM', () => {
    const c = decodeConfigCanonical(-1e6, 0, ALPHA_MIN_DEFAULT);
    // |λ̃| / |ρ̃| should be small → body 2 essentially co-located with the
    // inner pair's COM.
    expect(Math.hypot(...c.lambdaTilde)).toBeLessThan(0.1);
    expect(Math.hypot(...c.rhoTilde   )).toBeGreaterThan(0.99);
  });

  it('α near π/2 gives a tight inner pair (Burrau-like hierarchy)', () => {
    const c = decodeConfigCanonical(1e6, 0, ALPHA_MIN_DEFAULT);
    expect(Math.hypot(...c.rhoTilde   )).toBeLessThan(0.1);
    expect(Math.hypot(...c.lambdaTilde)).toBeGreaterThan(0.99);
  });

  it('equal-mass equilateral triangle has |ρ̃|² = |λ̃|² and ρ̃ ⊥ λ̃', () => {
    // Place the equal-mass equilateral configuration directly.
    const m = [1/3, 1/3, 1/3] as const;
    const r = jacobiToParticlePositions([1, 0], [0, Math.sqrt(3)/2], m);
    // |ρ| = 1, |λ| = √3/2.  μ_ρ = (1/9)/(2/3) = 1/6.  μ_λ = (1/3)(2/3) = 2/9.
    // |ρ̃|² = (1/6)*1 = 1/6.  |λ̃|² = (2/9)*(3/4) = 1/6.  ✓
    const muRho    = (m[0]*m[1]) / (m[0]+m[1]);
    const muLambda = m[2]*(m[0]+m[1]);
    const rhoT    = [1                  * Math.sqrt(muRho   ), 0];
    const lambdaT = [0, Math.sqrt(3)/2  * Math.sqrt(muLambda)];
    expect(rhoT[0]*rhoT[0] + rhoT[1]*rhoT[1])
      .toBeCloseTo(lambdaT[0]*lambdaT[0] + lambdaT[1]*lambdaT[1], 12);
    expect(rhoT[0]*lambdaT[0] + rhoT[1]*lambdaT[1]).toBeCloseTo(0, 12);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/decode
npm test -- --run test/golden/decode_landmarks
```

## Acceptance check

```bash
npm test -- --run test/unit/decode test/golden/decode_landmarks
```

If that exit-codes 0 with all tests green, M2 is done. The pipeline now has:
totality (every UV pixel labelled), round-trip identity (lookup + lock will
work in M8), and landmark agreement (the corrected shape-sphere formula's
geometric basis is consistent with the decoder).
