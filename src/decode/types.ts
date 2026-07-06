import type { Vec2, Vec3, Vec8, TerminalLabel, TrajState } from '@/math/types.js';

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
