import { UnsupportedError } from '@/gpu/init.js';
import type { DegenerateReason } from '@/decode/types.js';
import { Telemetry, Level } from './telemetry.js';
import { AppErrorKind, type AppError, userMessage } from './kinds.js';
import { TILE_FAIL_MASK, tileFlagDescriptor } from './tile_status.js';

/** Shapes the boundary recognises without importing every producer's type. */
interface DeviceLostLike { reason?: string; message?: string }
interface DecodeDegenerateLike { kind: 'DEGENERATE'; reason: DegenerateReason }

function isDeviceLost(x: unknown): x is DeviceLostLike {
  // GPUDeviceLostInfo has { reason, message } and no `name`; an Error has `name`.
  return typeof x === 'object' && x !== null &&
    'reason' in x && !('name' in x) && 'message' in x;
}

function isDecodeDegenerate(x: unknown): x is DecodeDegenerateLike {
  return typeof x === 'object' && x !== null &&
    (x as { kind?: unknown }).kind === 'DEGENERATE' &&
    typeof (x as { reason?: unknown }).reason === 'number';
}

/** Optional hints the caller supplies (e.g. which tile, raw status_flags). */
export interface ClassifyHints {
  tileKey?: string;
  statusFlags?: number;
}

/**
 * Pure classifier: unknown throwable + hints → closed AppError.
 * Priority: explicit tile-failure hint > UnsupportedError > device-lost
 * shape > decode-degenerate shape > generic.
 */
export function classify(err: unknown, hints: ClassifyHints = {}): AppError {
  if (hints.statusFlags !== undefined && (hints.statusFlags & TILE_FAIL_MASK) !== 0) {
    const flag = hints.statusFlags & TILE_FAIL_MASK;
    return {
      kind: AppErrorKind.TileFailure,
      flag,
      tileKey: hints.tileKey ?? '?',
      recoverable: true,
      cause: err,
    };
  }
  if (err instanceof UnsupportedError) {
    return { kind: AppErrorKind.Unsupported, reason: err.reason, recoverable: false, cause: err };
  }
  if (isDeviceLost(err)) {
    return {
      kind: AppErrorKind.DeviceLost,
      gpuReason: err.reason ?? 'unknown',
      recoverable: true,
      cause: err,
    };
  }
  if (isDecodeDegenerate(err)) {
    return { kind: AppErrorKind.Decode, reason: err.reason, recoverable: false, cause: err };
  }
  return { kind: AppErrorKind.Generic, recoverable: false, cause: err };
}

export interface ErrorBoundaryHooks {
  /** Surface a user-facing message to the UI shell (G12/G18). */
  onUserError?: (app: AppError, message: string) => void;
}

/**
 * Wraps async GPU/decode operations. On rejection it classifies, logs the
 * full detail to telemetry, surfaces a stack-free message, and returns the
 * AppError so callers can branch on `recoverable` without ever touching
 * the raw cause.
 */
export class ErrorBoundary {
  private readonly listeners = new Set<NonNullable<ErrorBoundaryHooks['onUserError']>>();

  constructor(
    private readonly telemetry: Telemetry,
    private readonly hooks: ErrorBoundaryHooks = {},
  ) {}

  /** Register a secondary user-error listener (e.g. the G12 shell chrome,
   *  mounted after the boundary wraps GPU init). Returns an unsubscriber. */
  addUserErrorListener(fn: NonNullable<ErrorBoundaryHooks['onUserError']>): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Classify + log + surface. Returns the AppError (handled, never rethrown). */
  capture(err: unknown, hints: ClassifyHints = {}): AppError {
    const app = classify(err, hints);
    const message = userMessage(app);
    // Full technical detail goes to telemetry only — recoverable → warn,
    // else error.
    const level = app.recoverable ? Level.Warn : Level.Error;
    this.telemetry.log(level, message, {
      kind: app.kind,
      recoverable: app.recoverable,
      ...this.detailContext(app),
      // Stringify the cause for the sink; this never reaches the user.
      cause: causeSummary(app.cause),
    });
    // Tile failures are per-tile diagnostics, not user-actionable events:
    // on fractal regions MAX_SUBSTEPS fires on most tiles, so notifying the
    // shell would pin the error overlay permanently over the canvas. They
    // stay in telemetry — the G18 dev HUD's errors tab renders them.
    if (app.kind !== AppErrorKind.TileFailure) {
      this.hooks.onUserError?.(app, message);
      for (const fn of this.listeners) fn(app, message);
    }
    return app;
  }

  /**
   * Run an async op; on rejection, capture() it. Returns a discriminated
   * result so the caller never needs try/catch and never sees a raw error.
   */
  async wrap<T>(
    op: () => Promise<T>,
    hints: ClassifyHints = {},
  ): Promise<{ ok: true; value: T } | { ok: false; error: AppError }> {
    try {
      return { ok: true, value: await op() };
    } catch (err) {
      return { ok: false, error: this.capture(err, hints) };
    }
  }

  private detailContext(app: AppError): Record<string, unknown> {
    switch (app.kind) {
      case AppErrorKind.Unsupported: return { reason: app.reason };
      case AppErrorKind.DeviceLost: return { gpuReason: app.gpuReason };
      case AppErrorKind.TileFailure:
        return { tileKey: app.tileKey, flag: app.flag, descriptor: tileFlagDescriptor(app.flag).label };
      case AppErrorKind.Decode: return { degenerateReason: app.reason };
      case AppErrorKind.Generic: return {};
      default: { const _x: never = app; return _x; }
    }
  }
}

/** Compact, serialisable summary of a cause for the sink — never user-shown. */
function causeSummary(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'object' && cause !== null) {
    try { return JSON.stringify(cause); } catch { return '[unserialisable]'; }
  }
  return String(cause);
}
