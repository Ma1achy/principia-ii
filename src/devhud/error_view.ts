import type { TelemetryRecord, InMemorySink } from '@/error/telemetry.js';
import { Level } from '@/error/telemetry.js';
import type { AppError } from '@/error/kinds.js';
import { userMessage } from '@/error/kinds.js';
import {
  tileFlagDescriptor, hasTileFailure, type TileFlagDescriptor,
} from '@/error/tile_status.js';

/** One row in the recent-errors list, built from telemetry only. */
export interface ErrorRow {
  ts: number;
  level: Level;
  /** The stack-free user message that was logged (telemetry `message`). */
  message: string;
  kind?: string;            // context.kind, when present
  recoverable?: boolean;    // context.recoverable, when present
}

/** A tile flagged in the failure overlay. */
export interface TileFailureRow {
  tileKey: string;
  flags: number;
  descriptor: TileFlagDescriptor;
}

export interface ErrorOverlayVM {
  /** Most-recent-first list of error/warn telemetry rows. */
  rows: ErrorRow[];
  errorCount: number;       // Level.Error records
  warnCount: number;        // Level.Warn records
  /** Tiles carrying a hard-failure bit (drives the red overlay). */
  failedTiles: TileFailureRow[];
  /** Tiles carrying only a warn bit (e.g. AT_F32_FLOOR) — hatched, not red. */
  warnedTiles: TileFailureRow[];
}

/**
 * Project a directly-classified AppError into the row a freshly-captured
 * error would produce — used when surfacing the boundary's `onUserError`
 * hook live, before the record lands in the sink. Never reads `cause`.
 */
export function appErrorRow(e: AppError, ts: number): ErrorRow {
  return {
    ts,
    level: e.recoverable ? Level.Warn : Level.Error,
    message: userMessage(e),
    kind: e.kind,
    recoverable: e.recoverable,
  };
}

/**
 * Build the error-overlay view-model from a telemetry sink and the current
 * per-tile status_flags map (tileKey → status_flags u32). Pure. Messages
 * come exclusively from the boundary's userMessage()-formatted telemetry
 * `message` and tileFlagDescriptor().message — never a cause or stack.
 */
export function errorOverlayVM(
  sink: Pick<InMemorySink, 'records'>,
  tileFlags: ReadonlyMap<string, number> = new Map(),
  limit = 50,
): ErrorOverlayVM {
  const all = sink.records();
  const rows: ErrorRow[] = all
    .filter(r => r.level >= Level.Warn)
    .slice(-limit)
    .reverse()
    .map(recordRow);

  const failedTiles: TileFailureRow[] = [];
  const warnedTiles: TileFailureRow[] = [];
  for (const [tileKey, flags] of tileFlags) {
    const descriptor = tileFlagDescriptor(flags);
    if (hasTileFailure(flags)) {
      failedTiles.push({ tileKey, flags, descriptor });
    } else if (descriptor.severity === 'warn' && descriptor.label !== 'ok') {
      warnedTiles.push({ tileKey, flags, descriptor });
    }
  }

  return {
    rows,
    errorCount: all.filter(r => r.level === Level.Error).length,
    warnCount: all.filter(r => r.level === Level.Warn).length,
    failedTiles,
    warnedTiles,
  };
}

function recordRow(r: TelemetryRecord): ErrorRow {
  const kind = typeof r.context['kind'] === 'string'
    ? (r.context['kind'] as string) : undefined;
  const recoverable = typeof r.context['recoverable'] === 'boolean'
    ? (r.context['recoverable'] as boolean) : undefined;
  // `message` is already the stack-free userMessage logged by the boundary.
  return {
    ts: r.ts, level: r.level, message: r.message,
    ...(kind !== undefined ? { kind } : {}),
    ...(recoverable !== undefined ? { recoverable } : {}),
  };
}
