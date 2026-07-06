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
  trace?:      TrajState[] | undefined;  // optional checkpointed trace
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

export type { TerminalLabel, TrajState, Vec2, Vec3, Triple };
