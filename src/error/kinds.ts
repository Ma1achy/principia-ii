import type { CapabilityProfile } from '@/gpu/capability.js';
import { DegenerateReason } from '@/decode/types.js';
import { tileFlagDescriptor } from './tile_status.js';

/** Closed set of application-level error categories.
 *  (Plain enum, not const enum — isolatedModules.) */
export enum AppErrorKind {
  /** WebGPU absent / no adapter / no device (G9 UnsupportedError). */
  Unsupported = 'unsupported',
  /** Device vanished mid-flight (G7 device.lost). Recoverable. */
  DeviceLost = 'device-lost',
  /** A tile's reduction reported a failure bit in status_flags (M5/G11). */
  TileFailure = 'tile-failure',
  /** Decode emitted DEGENERATE(reason) per ADR 0007. */
  Decode = 'decode',
  /** Anything unclassified — message is generic, details go to telemetry. */
  Generic = 'generic',
}

/** G9 UnsupportedReason, kept structural so we don't import the type cycle. */
export type UnsupportedReason = NonNullable<CapabilityProfile['reason']>;

/** Discriminated union. `cause` retains the original for telemetry only —
 *  it is NEVER surfaced to the user. */
export type AppError =
  | { kind: AppErrorKind.Unsupported; reason: UnsupportedReason; recoverable: false; cause?: unknown }
  | { kind: AppErrorKind.DeviceLost; gpuReason: string; recoverable: true; cause?: unknown }
  | { kind: AppErrorKind.TileFailure; flag: number; tileKey: string; recoverable: true; cause?: unknown }
  | { kind: AppErrorKind.Decode; reason: DegenerateReason; recoverable: false; cause?: unknown }
  | { kind: AppErrorKind.Generic; recoverable: false; cause?: unknown };

const UNSUPPORTED_MESSAGE: Record<UnsupportedReason, string> = {
  'no-webgpu': 'This browser does not support WebGPU. Try a recent Chrome, Edge, or Safari.',
  'no-adapter': 'No compatible GPU was found. Update your graphics drivers or enable hardware acceleration.',
  'no-device': 'The GPU could not be initialised. Close other GPU-heavy tabs and reload.',
};

/** Decode reasons (ADR 0007 codes 10–17) → user-facing one-liners. */
const DECODE_MESSAGE: Record<DegenerateReason, string> = {
  [DegenerateReason.M01_TINY]: 'This point has a vanishing inner-pair mass and cannot be simulated.',
  [DegenerateReason.MASS_SATURATION]: 'The masses saturated to a degenerate configuration here.',
  [DegenerateReason.ALPHA_CLAMPOUT]: 'The shape collapsed onto an excluded boundary at this point.',
  [DegenerateReason.JACOBI_GUARD]: 'A numerical guard failed while reconstructing this configuration.',
  [DegenerateReason.MIRROR_TIE]: 'The mirror gauge could not be resolved at this point.',
  [DegenerateReason.INFEASIBLE_ENERGY]: 'The requested energy is below the feasible floor for this configuration.',
  [DegenerateReason.MOMENTUM_SEEDS_EXHAUSTED]: 'No valid momentum seed was found for this point.',
  [DegenerateReason.NONFINITE]: 'A non-finite value was produced while decoding this point.',
};

/**
 * Build the user-facing message. Pure, total, and stack-free: every branch
 * returns prose composed from typed fields only. The exhaustive `switch`
 * (with the `never` default) makes adding a kind a compile error until handled.
 */
export function userMessage(e: AppError): string {
  switch (e.kind) {
    case AppErrorKind.Unsupported:
      return UNSUPPORTED_MESSAGE[e.reason];
    case AppErrorKind.DeviceLost:
      return 'The GPU connection was lost and is being restored. Your view will refresh shortly.';
    case AppErrorKind.TileFailure:
      return tileFlagDescriptor(e.flag).message;
    case AppErrorKind.Decode:
      return DECODE_MESSAGE[e.reason] ?? 'This point is degenerate and cannot be simulated.';
    case AppErrorKind.Generic:
      return 'Something went wrong while computing this region. The area will be retried.';
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

// Re-export so callers get descriptor + message from one place.
export { tileFlagDescriptor };
