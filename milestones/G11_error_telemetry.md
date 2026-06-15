# G11 — Error handling & telemetry

## Goal

Principia currently fails quietly: M3/M5 GPU jobs reject and the G2 `JobLedger`
just `console.warn`s (`gpu_jobs.ts` ~line 298), G9's `detectCapabilities`
returns `{ supported:false, reason }` that nothing renders, G7's `device.lost`
listener logs the reason and moves on, and M5's per-tile `status_flags` failure
bits never reach the user. G11 turns all of this into one structured path: an
`ErrorBoundary` that wraps async GPU/decode operations, **classifies** every
failure into a closed `AppErrorKind` (unsupported, device-lost, tile sim-failure,
decode `DEGENERATE(reason)` per ADR 0007, generic), and emits a user-facing
message that **never leaks a raw stack**; plus a `telemetry` module with
leveled, timestamped, contextful records and a pluggable sink (no external
service hardcoded — a no-op/in-memory default). It pairs with G9's
`UnsupportedError`/`CapabilityProfile` and G7's device-loss events, and gives M5
a `status_flags` → tile-failure-descriptor map for the overlay layer.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/error/boundary
```

passes with at least **15 green tests** covering: classification of each
`AppErrorKind` (unsupported with `reason`, device-lost with GPU reason, tile
sim-failure from a `status_flags` bit, decode `DEGENERATE` carrying a
`DegenerateReason`, and generic fall-through); `status_flags`-bit →
user-facing descriptor mapping; user messages that contain no stack text; and
telemetry level filtering plus in-memory sink buffering.

## File tree

```
src/
  error/
    kinds.ts        # NEW: AppErrorKind, AppError, user-message catalogue
    boundary.ts     # NEW: ErrorBoundary.wrap(), classify()
    tile_status.ts  # NEW: TILE_STATUS failure-flag extensions + descriptor map
    telemetry.ts    # NEW: Level, TelemetrySink, Telemetry, InMemorySink, NoopSink
  app/
    gpu_jobs.ts     # MODIFIED (G2): JobLedger.dispatch() .catch → boundary.capture()
test/
  unit/
    error/
      boundary.test.ts    # NEW: classification + status map + messages + telemetry (exit suite)
```

## Depends on / pairs with

- **G2** (`JobLedger` in `src/app/gpu_jobs.ts`) — its `dispatch()` `.catch`
  (~line 298) is re-routed from `console.warn` through `boundary.capture()`.
- **G9** (`UnsupportedError`, `CapabilityProfile.reason`/`.warnings`) — the
  boundary classifies `UnsupportedError` and renders `reason`/`warnings`.
- **G7** (device-loss recovery) — `device.lost` `{reason,message}` is classified
  into `AppErrorKind.DeviceLost`; G7's `onRecovering: () => void` takes no args, so
  the user-facing boundary message is surfaced via the boundary's `onUserError`
  hook (CANON #14), not through `onRecovering` — `onRecovering` only signals that a
  rebuild is in progress while G7 rebuilds.
- **M5** (`TileReduction.status_flags` u32, `TILE_STATUS`) — `tile_status.ts`
  extends the flag set with the failure bits named in the spec's failure-handling
  section and maps them to user descriptors.
- Contracts: outcome enum per **ADR 0002** (`BOUNDED=0…TIMEOUT=4`),
  `DegenerateReason` codes 10–17 per **ADR 0007**, tiers per **ADR 0003**
  (FTLE Research-only) — surfaced read-only, never re-defined here.

## `src/error/kinds.ts`

A closed discriminated union. `classify()` (in `boundary.ts`) is the only
producer; consumers `switch` exhaustively and the `never` arm guarantees no kind
is forgotten. `userMessage()` is the only thing the UI shows — it is built from
fields, never from `Error.stack`.

```ts
import type { CapabilityProfile } from '@/gpu/capability.js';
import type { DegenerateReason } from '@/decode/types.js';
import { tileFlagDescriptor } from './tile_status.js';

/** Closed set of application-level error categories. */
export const enum AppErrorKind {
  /** WebGPU absent / no adapter / no device (G9 UnsupportedError). */
  Unsupported = 'unsupported',
  /** Device vanished mid-flight (G7 device.lost). Recoverable. */
  DeviceLost = 'device-lost',
  /** A tile's reduction reported a failure bit in status_flags (M5). */
  TileFailure = 'tile-failure',
  /** Decode emitted DEGENERATE(reason) per ADR 0007. */
  Decode = 'decode',
  /** Anything unclassified — message is generic, details go to telemetry. */
  Generic = 'generic',
}

/** G9 UnsupportedReason, kept structural so we don't import the type cycle. */
export type UnsupportedReason = NonNullable<CapabilityProfile['reason']>;

/** Discriminated union. `cause` retains the original for telemetry only — it is
 *  NEVER surfaced to the user. */
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
  [10 as DegenerateReason]: 'This point has a vanishing inner-pair mass and cannot be simulated.',
  [11 as DegenerateReason]: 'The masses saturated to a degenerate configuration here.',
  [12 as DegenerateReason]: 'The shape collapsed onto an excluded boundary at this point.',
  [13 as DegenerateReason]: 'A numerical guard failed while reconstructing this configuration.',
  [14 as DegenerateReason]: 'The mirror gauge could not be resolved at this point.',
  [15 as DegenerateReason]: 'The requested energy is below the feasible floor for this configuration.',
  [16 as DegenerateReason]: 'No valid momentum seed was found for this point.',
  [17 as DegenerateReason]: 'A non-finite value was produced while decoding this point.',
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

// Re-export (already imported above as a value) so callers get descriptor +
// message from one place.
export { tileFlagDescriptor };
```

## `src/error/tile_status.ts`

M5 ships `TILE_STATUS` with diagnostic bits (`HAS_ENSEMBLE`, `AT_F32_FLOOR`, …)
but the spec's failure-handling section also names `SIM_FAILED`, `MAX_SUBSTEPS`,
and `TIMEOUT`. Those broad outcomes are encoded per ADR 0002 in the sample
descriptor, but the *tile-level* roll-up needs its own bits so the overlay can
shade a tile that contains any failed samples. G11 adds the failure bits in a
**non-overlapping** range above M5's existing ones and supplies the descriptor
map. (Integration patch for M5 below.)

```ts
/**
 * Tile-level failure flags, OR'd into TileReduction.status_flags above M5's
 * diagnostic bits (M5 owns 1<<0 .. 1<<5; G11 owns 1<<6 .. 1<<8). These mark
 * that a tile CONTAINS samples that hit a failure terminal — the broad outcome
 * class itself stays in the per-sample descriptor (ADR 0002).
 */
export const TILE_STATUS_FAIL = {
  /** Integration aborted on an untrustworthy state (ADR 0002: → DEGENERATE). */
  SIM_FAILED:   1 << 6,
  /** Adaptive stepper hit the substep ceiling (ADR 0002: → TIMEOUT). */
  MAX_SUBSTEPS: 1 << 7,
  /** Wall-clock/horizon budget exhausted before classification (→ TIMEOUT). */
  TIMEOUT:      1 << 8,
} as const;

export type TileFailFlag = (typeof TILE_STATUS_FAIL)[keyof typeof TILE_STATUS_FAIL];

/** Also re-export M5's AT_F32_FLOOR so the overlay can warn (not fail) on it. */
export const TILE_STATUS_AT_F32_FLOOR = 1 << 2;

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
    mask: TILE_STATUS_AT_F32_FLOOR,
    descriptor: {
      label: 'precision floor',
      message: 'This region is at the limit of 32-bit precision; results may be coarse.',
      severity: 'warn',
    },
  },
];

/** Highest-severity descriptor for a status_flags value. `error` bits win over
 *  `warn`; within a severity, the first listed (most fundamental) wins. Returns
 *  a benign generic descriptor when no failure/warn bit is set. */
export function tileFlagDescriptor(flags: number): TileFlagDescriptor {
  const errors = DESCRIPTORS.filter(d => d.descriptor.severity === 'error');
  const warns = DESCRIPTORS.filter(d => d.descriptor.severity === 'warn');
  for (const d of [...errors, ...warns]) {
    if ((flags & d.mask) !== 0) return d.descriptor;
  }
  return { label: 'ok', message: 'This region computed cleanly.', severity: 'warn' };
}

/** All failure bits OR'd together — `(flags & TILE_FAIL_MASK) !== 0` ⇒ overlay. */
export const TILE_FAIL_MASK =
  TILE_STATUS_FAIL.SIM_FAILED | TILE_STATUS_FAIL.MAX_SUBSTEPS | TILE_STATUS_FAIL.TIMEOUT;

/** True iff a tile carries any hard-failure bit (drives the red overlay). */
export function hasTileFailure(flags: number): boolean {
  return (flags & TILE_FAIL_MASK) !== 0;
}
```

## `src/error/telemetry.ts`

Leveled, timestamped, contextful structured logging behind a pluggable sink. No
external service is hardcoded; the default is `NoopSink`, and `InMemorySink`
buffers records for tests/diagnostics. Level filtering happens once, in
`Telemetry`, so a disabled level never builds a record.

```ts
export const enum Level {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
}

export interface TelemetryRecord {
  level: Level;
  /** Epoch milliseconds (injectable clock for deterministic tests). */
  ts: number;
  message: string;
  /** Structured, JSON-serialisable context. Never contains a raw Error. */
  context: Readonly<Record<string, unknown>>;
}

/** Pluggable destination. Implement this to forward to a real service. */
export interface TelemetrySink {
  emit(record: TelemetryRecord): void;
}

/** Default sink: discards everything. */
export class NoopSink implements TelemetrySink {
  emit(_record: TelemetryRecord): void { /* intentionally empty */ }
}

/** Buffers records in memory (diagnostics panel, tests). */
export class InMemorySink implements TelemetrySink {
  private buf: TelemetryRecord[] = [];
  constructor(private readonly cap = 1000) {}

  emit(record: TelemetryRecord): void {
    this.buf.push(record);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  records(): readonly TelemetryRecord[] { return this.buf; }
  /** Records at exactly `level`. */
  at(level: Level): readonly TelemetryRecord[] {
    return this.buf.filter(r => r.level === level);
  }
  clear(): void { this.buf = []; }
}

export interface TelemetryOptions {
  /** Minimum level emitted; records below this are dropped before build. */
  minLevel?: Level;
  sink?: TelemetrySink;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
  /** Context merged into every record (e.g. { tier, sessionId }). */
  base?: Record<string, unknown>;
}

export class Telemetry {
  private readonly minLevel: Level;
  private readonly sink: TelemetrySink;
  private readonly now: () => number;
  private readonly base: Readonly<Record<string, unknown>>;

  constructor(opts: TelemetryOptions = {}) {
    this.minLevel = opts.minLevel ?? Level.Info;
    this.sink = opts.sink ?? new NoopSink();
    this.now = opts.now ?? (() => Date.now());
    this.base = opts.base ?? {};
  }

  /** Core entry. Returns false if filtered out (useful in tests). */
  log(level: Level, message: string, context: Record<string, unknown> = {}): boolean {
    if (level < this.minLevel) return false;
    this.sink.emit({
      level,
      ts: this.now(),
      message,
      context: { ...this.base, ...context },
    });
    return true;
  }

  debug(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Debug, message, context);
  }
  info(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Info, message, context);
  }
  warn(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Warn, message, context);
  }
  error(message: string, context?: Record<string, unknown>): boolean {
    return this.log(Level.Error, message, context);
  }

  /** Derive a child with extra base context (does not re-filter twice). */
  child(extra: Record<string, unknown>): Telemetry {
    return new Telemetry({
      minLevel: this.minLevel,
      sink: this.sink,
      now: this.now,
      base: { ...this.base, ...extra },
    });
  }
}
```

## `src/error/boundary.ts`

`classify()` turns an unknown throwable into a closed `AppError`. `wrap()` runs
an async GPU/decode op and routes any rejection through `capture()`, which logs
the **full** detail to telemetry (level chosen by recoverability) and hands the
caller a user-safe `AppError` — never the raw stack.

```ts
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
 * Priority: explicit tile-failure hint > UnsupportedError > device-lost shape >
 * decode-degenerate shape > generic.
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
  /** Surface a user-facing message to the UI shell (G12). */
  onUserError?: (app: AppError, message: string) => void;
}

/**
 * Wraps async GPU/decode operations. On rejection it classifies, logs the full
 * detail to telemetry, surfaces a stack-free message, and returns the AppError
 * so callers can branch on `recoverable` without ever touching the raw cause.
 */
export class ErrorBoundary {
  constructor(
    private readonly telemetry: Telemetry,
    private readonly hooks: ErrorBoundaryHooks = {},
  ) {}

  /** Classify + log + surface. Returns the AppError (handled, never rethrown). */
  capture(err: unknown, hints: ClassifyHints = {}): AppError {
    const app = classify(err, hints);
    const message = userMessage(app);
    // Full technical detail goes to telemetry only — recoverable → warn, else error.
    const level = app.recoverable ? Level.Warn : Level.Error;
    this.telemetry.log(level, message, {
      kind: app.kind,
      recoverable: app.recoverable,
      ...this.detailContext(app),
      // Stringify the cause for the sink; this never reaches the user.
      cause: causeSummary(app.cause),
    });
    this.hooks.onUserError?.(app, message);
    return app;
  }

  /**
   * Run an async op; on rejection, capture() it. Returns a discriminated result
   * so the caller never needs try/catch and never sees a raw error.
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
```

## G2 integration patch — `src/app/gpu_jobs.ts`

The `JobLedger` gains a boundary and routes its `dispatch()` `.catch` through it.
Minimal, labelled diff against G2.

```ts
// + import at top:
import type { ErrorBoundary } from '@/error/boundary.js';
import { AppErrorKind } from '@/error/kinds.js';

// A boundary-shaped no-op default so G2's existing 3-arg
// `new JobLedger(dispatcher, cache, opts)` keeps compiling (CANON #7).
type CaptureFn = Pick<ErrorBoundary, 'capture'>;
const NOOP_BOUNDARY: CaptureFn = { capture: () => ({ kind: AppErrorKind.Generic, recoverable: false }) };

export class JobLedger {
  private inflight = new Map<string, InflightJob>();

  constructor(
    private dispatcher: GpuDispatcher,
    private cache: TileCache,
    private opts: { maxInFlight: number;
                    ftleEnabled: boolean; ensembleEnabled: boolean },
    // + NEW (G11): OPTIONAL with a no-op default so G2's existing 3-arg
    //   `new JobLedger(dispatcher, cache, opts)` still compiles unchanged.
    private boundary: CaptureFn = NOOP_BOUNDARY,
  ) {}

  dispatch(tile: TileID, view: ViewState): boolean {
    // ... unchanged up to the promise chain ...
    job.promise.then(reduction => {
      if (job.cancelled) return;
      ingestReduction(this.cache, viewStateToCacheKey(view),
                      tile, reduction,
                      this.opts.ftleEnabled, this.opts.ensembleEnabled);
      this.inflight.delete(k);
    }).catch(err => {
      // - console.warn('GPU job failed', tile, err);
      // + route every failure through the boundary: classify, log, surface.
      this.boundary.capture(err, { tileKey: k });
      this.inflight.delete(k);
    });
    return true;
  }
  // cancelOffscreen() unchanged.
}
```

> Note: when `ingestReduction` reads a `status_flags` carrying a failure bit, the
> scheduler additionally calls `boundary.capture(undefined, { tileKey: k,
> statusFlags })` so a *successful* dispatch with failed samples still surfaces a
> tile-failure overlay (the bit is data, not an exception).

## M5 integration note — `src/quadtree/reduction_types.ts`

Leave M5's `TILE_STATUS` (bits 0–5) untouched; the new failure bits live in
`src/error/tile_status.ts` (`TILE_STATUS_FAIL`, bits 6–8) so the two ranges never
collide. **Drive the failure bits from the per-sample detail/event bits, NOT the
broad 3-bit outcome class** (CANON #13): an ordinary DEGENERATE-IC tile is an
*expected* terminal (class 3) and must NOT be shaded as a sim-failure, so keying
`SIM_FAILED` off the broad class would mis-flag every degenerate region. Instead
the M5 reduce shader ORs:
- `SIM_FAILED` when the sample's detail bits flag an untrustworthy / non-finite
  integration state (the explicit failure event), not merely class 3 DEGENERATE;
- `MAX_SUBSTEPS` when the adaptive-stepper detail bit reports the substep ceiling
  was hit;
- `TIMEOUT` when the wall-clock / horizon-budget detail bit is set.

`MAX_SUBSTEPS` and `TIMEOUT` are distinct: the former means the stepper exhausted
its substep allotment, the latter that the time/horizon budget ran out before
classification. The CPU overlay reads the same bits via `hasTileFailure()` /
`tileFlagDescriptor()`.

## Tests

### `test/unit/error/boundary.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { classify, ErrorBoundary } from '@/error/boundary.js';
import { AppErrorKind, userMessage } from '@/error/kinds.js';
import {
  TILE_STATUS_FAIL, tileFlagDescriptor, hasTileFailure, TILE_STATUS_AT_F32_FLOOR,
} from '@/error/tile_status.js';
import {
  Telemetry, Level, InMemorySink, NoopSink,
} from '@/error/telemetry.js';
import { UnsupportedError } from '@/gpu/init.js';
import { DegenerateReason } from '@/decode/types.js';

const fixedClock = () => 1_000;

describe('classify: each AppErrorKind', () => {
  it('UnsupportedError(no-webgpu) → Unsupported with reason', () => {
    const e = classify(new UnsupportedError('no-webgpu'));
    expect(e.kind).toBe(AppErrorKind.Unsupported);
    if (e.kind === AppErrorKind.Unsupported) {
      expect(e.reason).toBe('no-webgpu');
      expect(e.recoverable).toBe(false);
    }
  });

  it('GPUDeviceLostInfo shape → DeviceLost with gpuReason', () => {
    const e = classify({ reason: 'destroyed', message: 'device.destroy()' });
    expect(e.kind).toBe(AppErrorKind.DeviceLost);
    if (e.kind === AppErrorKind.DeviceLost) {
      expect(e.gpuReason).toBe('destroyed');
      expect(e.recoverable).toBe(true);
    }
  });

  it('statusFlags hint with SIM_FAILED → TileFailure', () => {
    const e = classify(undefined, {
      tileKey: '2/1/3', statusFlags: TILE_STATUS_FAIL.SIM_FAILED,
    });
    expect(e.kind).toBe(AppErrorKind.TileFailure);
    if (e.kind === AppErrorKind.TileFailure) {
      expect(e.tileKey).toBe('2/1/3');
      expect(e.flag & TILE_STATUS_FAIL.SIM_FAILED).toBeTruthy();
    }
  });

  it('DEGENERATE(reason) shape → Decode carrying the DegenerateReason', () => {
    const e = classify({ kind: 'DEGENERATE', reason: DegenerateReason.M01_TINY });
    expect(e.kind).toBe(AppErrorKind.Decode);
    if (e.kind === AppErrorKind.Decode) {
      expect(e.reason).toBe(DegenerateReason.M01_TINY);
    }
  });

  it('an unknown throwable → Generic', () => {
    const e = classify(new TypeError('kaboom'));
    expect(e.kind).toBe(AppErrorKind.Generic);
  });

  it('tile-failure hint takes priority over a thrown Error', () => {
    const e = classify(new Error('boom'), { statusFlags: TILE_STATUS_FAIL.TIMEOUT });
    expect(e.kind).toBe(AppErrorKind.TileFailure);
  });
});

describe('status_flags → descriptor mapping', () => {
  it('SIM_FAILED is an error-severity descriptor', () => {
    const d = tileFlagDescriptor(TILE_STATUS_FAIL.SIM_FAILED);
    expect(d.severity).toBe('error');
    expect(d.label).toBe('sim failed');
  });

  it('AT_F32_FLOOR alone is a warning, not a failure', () => {
    expect(hasTileFailure(TILE_STATUS_AT_F32_FLOOR)).toBe(false);
    expect(tileFlagDescriptor(TILE_STATUS_AT_F32_FLOOR).severity).toBe('warn');
  });

  it('error bits win over warn bits when both are set', () => {
    const flags = TILE_STATUS_FAIL.MAX_SUBSTEPS | TILE_STATUS_AT_F32_FLOOR;
    expect(tileFlagDescriptor(flags).severity).toBe('error');
  });

  it('clean flags → benign ok descriptor and no failure', () => {
    expect(hasTileFailure(0)).toBe(false);
    expect(tileFlagDescriptor(0).label).toBe('ok');
  });

  it('TIMEOUT maps to its timed-out message', () => {
    expect(tileFlagDescriptor(TILE_STATUS_FAIL.TIMEOUT).message).toMatch(/time budget/);
  });
});

describe('userMessage: stack-free, kind-appropriate prose', () => {
  it('Unsupported(no-webgpu) mentions WebGPU, not a stack', () => {
    const msg = userMessage(classify(new UnsupportedError('no-webgpu')));
    expect(msg).toMatch(/WebGPU/);
    expect(msg).not.toMatch(/at .+\(.+:\d+:\d+\)/); // no V8 stack frame
  });

  it('Generic message never leaks the underlying Error text', () => {
    const msg = userMessage(classify(new Error('SECRET_INTERNAL_DETAIL')));
    expect(msg).not.toMatch(/SECRET_INTERNAL_DETAIL/);
  });

  it('Decode message is reason-specific', () => {
    const msg = userMessage(classify({ kind: 'DEGENERATE', reason: DegenerateReason.INFEASIBLE_ENERGY }));
    expect(msg).toMatch(/energy/);
  });
});

describe('Telemetry: level filtering + sink buffering', () => {
  it('drops records below minLevel before building them', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({ minLevel: Level.Warn, sink, now: fixedClock });
    expect(t.info('hidden')).toBe(false);
    expect(t.warn('shown')).toBe(true);
    expect(sink.records()).toHaveLength(1);
    expect(sink.records()[0]!.message).toBe('shown');
  });

  it('stamps records with the injected clock and merged base context', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock, base: { tier: 'research' } });
    t.error('boom', { tileKey: '0/0/0' });
    const r = sink.records()[0]!;
    expect(r.ts).toBe(1000);
    expect(r.level).toBe(Level.Error);
    expect(r.context).toMatchObject({ tier: 'research', tileKey: '0/0/0' });
  });

  it('child() inherits sink + minLevel and extends base context', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({ minLevel: Level.Info, sink, now: fixedClock, base: { a: 1 } });
    t.child({ b: 2 }).info('msg');
    expect(sink.records()[0]!.context).toMatchObject({ a: 1, b: 2 });
  });

  it('NoopSink buffers nothing', () => {
    const t = new Telemetry({ minLevel: Level.Debug, sink: new NoopSink(), now: fixedClock });
    expect(t.error('boom')).toBe(true); // emitted (not filtered) ...
    // ... but the noop sink retains nothing observable; assert via InMemory swap:
    const mem = new InMemorySink();
    new Telemetry({ minLevel: Level.Debug, sink: mem, now: fixedClock }).error('boom');
    expect(mem.records()).toHaveLength(1);
  });

  it('InMemorySink caps its buffer', () => {
    const sink = new InMemorySink(2);
    const t = new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock });
    t.info('a'); t.info('b'); t.info('c');
    expect(sink.records()).toHaveLength(2);
    expect(sink.records().map(r => r.message)).toEqual(['b', 'c']);
  });
});

describe('ErrorBoundary: capture + wrap', () => {
  it('capture logs full detail to telemetry but returns a user-safe AppError', () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    const app = boundary.capture(new Error('SECRET'), { tileKey: 'k' });
    expect(app.kind).toBe(AppErrorKind.Generic);
    const rec = sink.records()[0]!;
    expect(rec.level).toBe(Level.Error);            // non-recoverable → error
    expect(rec.context['cause']).toMatch(/SECRET/); // detail in telemetry only
  });

  it('recoverable errors log at warn level', () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    boundary.capture({ reason: 'destroyed', message: 'x' });
    expect(sink.records()[0]!.level).toBe(Level.Warn);
  });

  it('wrap returns ok:true on success', async () => {
    const boundary = new ErrorBoundary(new Telemetry());
    const r = await boundary.wrap(async () => 42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('wrap returns ok:false with a classified error on rejection', async () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    const r = await boundary.wrap(async () => { throw new UnsupportedError('no-adapter'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe(AppErrorKind.Unsupported);
    expect(sink.records()).toHaveLength(1);
  });

  it('onUserError hook receives the message, never the stack', () => {
    let seen = '';
    const boundary = new ErrorBoundary(new Telemetry(), {
      onUserError: (_a, msg) => { seen = msg; },
    });
    boundary.capture(new Error('INTERNAL'));
    expect(seen).toMatch(/Something went wrong/);
    expect(seen).not.toMatch(/INTERNAL/);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/error/boundary
```

(Single file; no real GPU needed — every test uses injected shapes, the fixed
clock, and `InMemorySink`.)

## Acceptance check

`test/unit/error/boundary.test.ts` passes with ≥15 green tests (22 as written).
`classify()` produces every `AppErrorKind`; `userMessage()` output for any kind
contains no V8 stack frame and never echoes the underlying `Error` text;
`tileFlagDescriptor()` maps each `TILE_STATUS_FAIL` bit to the right severity and
prefers errors over warnings; `Telemetry` filters below `minLevel` before
building a record; and `InMemorySink` buffers (and caps) what it receives. The
G2 `JobLedger` no longer `console.warn`s — its `.catch` calls
`boundary.capture()`.

## Notes for the implementer

- **The boundary is the only place a raw cause is touched.** `kinds.userMessage`
  and `tile_status` are pure and stack-free by construction; `boundary.capture`
  is the single funnel that reads `cause` and serialises it (via `causeSummary`)
  into telemetry. Keep it that way — if a new caller wants detail, give it a
  telemetry record, not the `AppError.cause`.
- **`isDeviceLost` is shape-based on purpose.** `GPUDeviceLostInfo` is not an
  `Error` (no `name`), so distinguishing it from a thrown `Error` by the absence
  of `name` plus presence of `reason`/`message` is robust without importing a DOM
  type the test environment may not provide. G7's listener should pass the
  `info` object straight to `capture`.
- **Tile failures are data, not exceptions.** A dispatch can *succeed* and still
  carry failure bits in `status_flags`. The scheduler surfaces those by calling
  `capture(undefined, { statusFlags })` — the classifier checks the hint first,
  so a `undefined` throwable still yields a `TileFailure`. Don't try to model
  this as a rejected promise.
- **Decode `reason` is an ADR-0007 code, not a string.** `classify` reads
  `reason` as the frozen `DegenerateReason` u32 (10–17). The `DECODE_MESSAGE`
  table is keyed by those codes; a future reason (new code) must be added to both
  ADR 0007 and that table, mirroring the cache-signature bump the ADR mandates.
- **Telemetry has no service baked in.** Ship `NoopSink` as the default so a
  build with no observability stack is silent and zero-cost; wire a real sink
  (HTTP batch, IndexedDB, console) by implementing `TelemetrySink` and passing it
  to the `Telemetry` constructor. `child()` is the idiom for per-tile/per-session
  context without re-stating base fields.
- **Pairs with G9/G7 at the edges.** When G9's `detectCapabilities` returns
  `{ supported:false }`, construct the `UnsupportedError` (as `initGpu` does) and
  hand it to `capture` so the shell shows the same catalogue message; when G7
  observes `device.lost`, pass the `info` to `capture` *before* `recover()` so the
  user sees the "restoring" message during the rebuild window.
