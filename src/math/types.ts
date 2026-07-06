/**
 * Tuple types for plane and 8D latent vectors. Tuples (rather than
 * `number[]`) give us length-checked arithmetic at compile time.
 */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];
export type Vec8 = readonly [
  number, number, number, number,
  number, number, number, number,
];

export type Triple<T> = readonly [T, T, T];

/**
 * Trajectory state in the COM frame.
 *
 * Positions and momenta are kept per-body. Masses sum to 1 in the
 * dimensionless system (M = 1, G = 1, I = 1).
 */
export interface TrajState {
  readonly r: Triple<Vec2>;   // positions
  readonly p: Triple<Vec2>;   // momenta
  readonly m: Vec3;           // masses, sum = 1
  readonly t: number;         // simulation time
}

/**
 * Terminal labels, used at decode time and by the integrator's event
 * detection. These are total — every UV pixel ends up in exactly one
 * state (spec §1.6.7, §4).
 */
export type TerminalLabel =
  | { kind: 'NONE' }
  // `reason` is a closed ADR-0007 `DegenerateReason` code (10..17, defined in
  // `@/decode/types.js` — not imported here to keep math the base layer).
  | { kind: 'DEGENERATE'; reason: number }
  | { kind: 'COLLISION_T0'; pair: 0 | 1 | 2 }
  | { kind: 'COLLISION'; pair: 0 | 1 | 2; t: number }
  | { kind: 'ESCAPE'; body: 0 | 1 | 2; t: number }
  | { kind: 'BOUNDED'; T: number }
  | { kind: 'TIMEOUT'; T: number }
  | { kind: 'MAX_SUBSTEPS'; t: number }
  | { kind: 'SIM_FAILED'; reason: string; t: number };
