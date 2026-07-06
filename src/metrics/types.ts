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
