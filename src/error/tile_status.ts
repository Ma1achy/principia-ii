import { TILE_STATUS } from '@/quadtree/reduction_types.js';

/**
 * Tile-level failure flags, OR'd into TileReduction.status_flags ABOVE the
 * ranges already spoken for: M5/G7 diagnostics own bits 0–5 (TILE_STATUS)
 * and bits 6–7 carry TILE_REDUCTION_SCHEMA_VERSION (stripped by
 * decodeTileReduction) — so G11's failure bits live at 8–10. These mark
 * that a tile CONTAINS samples that hit a failure terminal — the broad
 * outcome class itself stays in the per-sample descriptor (ADR 0002).
 *
 * Producers (reduce.wgsl, per-sample loop):
 * - SIM_FAILED: any sample carries a suspect-drift bit (descriptor bits
 *   5/6 — energy/Lz drift beyond threshold): the integration state is
 *   untrustworthy, NOT merely class-3 DEGENERATE (an expected terminal).
 * - MAX_SUBSTEPS: any sample classified TIMEOUT (class 4) — in the landed
 *   simulate.wgsl the substep-budget stall is the only class-4 producer.
 * - TIMEOUT: reserved for a wall-clock/horizon budget distinct from the
 *   substep ceiling. No landed producer sets it yet (the GPU kernel has
 *   no wall clock; horizon completion is BOUNDED by design).
 */
export const TILE_STATUS_FAIL = {
  /** Integration produced an untrustworthy state (suspect E/Lz drift). */
  SIM_FAILED:   1 << 8,
  /** Adaptive stepper hit the substep ceiling (ADR 0002: → TIMEOUT). */
  MAX_SUBSTEPS: 1 << 9,
  /** Wall-clock budget exhausted before classification (reserved). */
  TIMEOUT:      1 << 10,
} as const;

export type TileFailFlag = (typeof TILE_STATUS_FAIL)[keyof typeof TILE_STATUS_FAIL];

/** M5's precision-floor diagnostic, re-exported so the overlay can warn
 *  (not fail) on it without importing two modules. */
export const TILE_STATUS_AT_F32_FLOOR: number = TILE_STATUS.AT_F32_FLOOR;

export interface TileFlagDescriptor {
  /** Short label for the legend/overlay. */
  label: string;
  /** One-line user-facing explanation. */
  message: string;
  /** 'error' shades the tile red; 'warn' hatches it; drives overlay styling. */
  severity: 'error' | 'warn';
}

const DESCRIPTORS: { mask: number; descriptor: TileFlagDescriptor }[] = [
  {
    mask: TILE_STATUS_FAIL.SIM_FAILED,
    descriptor: {
      label: 'sim failed',
      message: 'Some trajectories in this region became numerically untrustworthy.',
      severity: 'error',
    },
  },
  {
    mask: TILE_STATUS_FAIL.MAX_SUBSTEPS,
    descriptor: {
      label: 'step ceiling',
      message: 'Some trajectories here needed more substeps than allowed and were cut short.',
      severity: 'error',
    },
  },
  {
    mask: TILE_STATUS_FAIL.TIMEOUT,
    descriptor: {
      label: 'timed out',
      message: 'Some trajectories here did not classify within the time budget.',
      severity: 'error',
    },
  },
  {
    mask: TILE_STATUS.AT_F32_FLOOR,
    descriptor: {
      label: 'precision floor',
      message: 'This region is at the limit of 32-bit precision; results may be coarse.',
      severity: 'warn',
    },
  },
];

/** Highest-severity descriptor for a status_flags value. `error` bits win
 *  over `warn`; within a severity, the first listed (most fundamental)
 *  wins. Returns a benign descriptor when no failure/warn bit is set. */
export function tileFlagDescriptor(flags: number): TileFlagDescriptor {
  const errors = DESCRIPTORS.filter(d => d.descriptor.severity === 'error');
  const warns = DESCRIPTORS.filter(d => d.descriptor.severity === 'warn');
  for (const d of [...errors, ...warns]) {
    if ((flags & d.mask) !== 0) return d.descriptor;
  }
  return { label: 'ok', message: 'This region computed cleanly.', severity: 'warn' };
}

/** All failure bits OR'd together — `(flags & TILE_FAIL_MASK) !== 0` ⇒ overlay. */
export const TILE_FAIL_MASK: number =
  TILE_STATUS_FAIL.SIM_FAILED | TILE_STATUS_FAIL.MAX_SUBSTEPS | TILE_STATUS_FAIL.TIMEOUT;

/** True iff a tile carries any hard-failure bit (drives the red overlay). */
export function hasTileFailure(flags: number): boolean {
  return (flags & TILE_FAIL_MASK) !== 0;
}
