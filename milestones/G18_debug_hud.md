# G18 — Debug HUD integration

## Goal

G10 ships a `PerfMonitor`, G11 ships an `ErrorBoundary`/`Telemetry`/tile-failure
descriptor layer, M9 ships an `InspectorResult.validation` panel, and G17 ships
a **debug module** (`@/debug/*`: frame-capture, sample inspector, struct dumps)
that so far only runs from a standalone Vite page. None of it is visible while
the actual instrument is running: a developer cannot see the rolling frame
budget, the last captured `AppError`, which tiles carry failure bits, or the
inspector's GPU↔CPU validation delta *inside the live app*. G18 mounts all of it
as a single **toggleable dev overlay** in the G12/G8 shell.

G18 is integration glue, not new physics. It composes four read-only views over
already-shipped sources — a **perf HUD** over `PerfMonitor.snapshot()` (G10), an
**error + tile-failure overlay** over `ErrorBoundary`/`Telemetry` and the M5
`status_flags` → `tileFlagDescriptor()` map (G11), a **validation panel** over
`InspectorResult.validation` (M9), and a **capture panel** that extends G17's
`CapturedFrame` round-trip — behind one keyboard toggle, mounted into G12's
shell grid beside the existing chrome. The HUD panels are **G18's own**; it does
not host a G17 panel registry (G17 has none — its harness is a single standalone
Vite page). It also extends G17's `CapturedFrame` so a captured frame carries
the full M8 `ViewState` and the G7 ensemble seeds, so a captured repro can be
replayed deterministically (right tier, right chart, right jitter).

The overlay is a **dev tool**: it is read-only with respect to `ViewState` (it
never calls `app.store.update`), it never invalidates the cache or touches the
history ring (it mirrors G12's render-only discipline), and it degrades to an
inert no-op when no `document` is present (headless CI) — exactly like G12's
`shell_dom` smoke mount. The aggregation/formatting logic is pure and is what the
exit suite pins; the DOM mount is exercised by a happy-dom smoke suite and by a
live `~` probe in the G8 shell spec.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/ui/debug_hud
```

passes with at least **16 green tests** covering: the perf-HUD view-model derived
from a `PerfSnapshot` (budget colour bucket, per-pass GPU rows present/absent with
`timestamp-query`, the `recommend()` hint surfaced read-only); the error overlay
view-model from an `InMemorySink` (most-recent `AppError` message, severity, the
recoverable/non-recoverable split) and the tile-failure roll-up driven by
`hasTileFailure()`/`tileFlagDescriptor()` over a set of `status_flags`; the
validation-panel view-model from `InspectorResult.validation` (agree/disagree
flag, FTLE delta threshold); the overlay toggle reducer (`hidden`↔`shown`,
default-hidden); and the extended frame-capture round-trip carrying full
`ViewState` + ensemble seeds.

**Deliverable:** a toggleable in-app **dev overlay** — perf HUD, error /
tile-failure overlay, M9 validation panel, and a capture panel — mounted
into the G12/G8 shell behind one keyboard toggle, plus G17 `CapturedFrame`
extended to a full `ViewState` + ensemble-seed snapshot, verified by a pure
view-model suite and a jsdom smoke mount that skips cleanly headless.

## File tree

```
principia/
  src/
    devhud/
      perf_view.ts        # NEW: PerfSnapshot + recommend() → perf-HUD view-model (pure)
      error_view.ts       # NEW: InMemorySink + status_flags → error/tile-failure view-model (pure)
      validation_view.ts  # NEW: InspectorResult.validation → validation-panel view-model (pure)
      capture.ts          # NEW: extend G17 CapturedFrame with ViewState + ensemble seeds (pure)
      overlay_state.ts     # NEW: dev-overlay visibility reducer + tab selection (pure)
      mount.ts            # NEW: mountDebugHud() — wires the view-models into a drawer (DOM)
      index.ts            # NEW: barrel
    ui/
      App.ts              # MODIFIED: ShellDeps.debug + .devhud-area cell + conditional mount
      styles.css          # MODIFIED: .devhud drawer styles appended
  dev/
    main.ts               # MODIFIED: tileFlags/inspector feeds + debug in ShellDeps
  test/
    unit/
      ui/
        debug_hud.test.ts      # NEW: pure view-models + capture + toggle reducer (exit suite)
        debug_hud_dom.test.ts  # NEW: happy-dom smoke mount (G12 shell_dom idiom)
    gpu/
      shell.spec.ts       # MODIFIED: live `~` toggle probe (HUD shows, view unchanged)
```

## Depends on / pairs with

G18 is **pure consumer**: every type below is imported read-only and never
re-declared. The seams, by upstream milestone:

- **G17** (debug module) — G18 extends G17's capture record. G17 has **no**
  panel registry and **no** `HarnessPanel`/`harnessPanels`/`replayCapture`; its
  harness is a single standalone Vite page, so G18 owns its own HUD panels and
  does not mount anything from G17. Consumed symbols (G17 `src/debug/frame_capture.ts`):
  - `CapturedFrame` — G17's per-frame capture record
    (`version`, `N`, `M`, `uniforms`, `tile`, `label?`); G18's `capture.ts`
    widens it to `FrameCaptureV2` (full `ViewState` + seeds).
  - `captureFrame(...)` / `serializeFrame(...)` / `deserializeFrame(...)` /
    `packedInputs(...)` / `FRAME_CAPTURE_VERSION` — G17's capture/serialise/
    restore; G18 wraps capture to attach the extra fields and, for replay, uses
    `deserializeFrame` (plus a G18-local wrapper if needed) — there is no
    `replayCapture`.
  - `pickSample(...)` (G17 `src/debug/inspector.ts`) — the sample inspector,
    available for ad-hoc dev use; not required by the exit suite.
- **G10** (`PerfMonitor`, `PerfSnapshot`, `PerfRecommendation`, `GpuPass`,
  `GPU_PASSES`) — `perf_view.ts` reads `PerfMonitor.snapshot()` and
  `PerfMonitor.recommend(tier)`; **read-only** — it never applies the
  recommendation (G10's `FrameLoop` owns the dispatch-cap knob; the HUD only
  *shows* the hint).
- **G11** (`InMemorySink`, `TelemetryRecord`, `Level`, `AppError`,
  `AppErrorKind`, `userMessage`, `tileFlagDescriptor`, `hasTileFailure`,
  `TileFlagDescriptor`) — `error_view.ts` reads telemetry records + a tile
  `status_flags` map; messages come **only** from `userMessage()` /
  `tileFlagDescriptor().message`, never a raw stack/cause (CANON: the boundary is
  the only place a cause is touched).
- **M9** (`InspectorResult`, `InspectorResult['validation']`) —
  `validation_view.ts` reads the optional `validation` slot; the flagged
  predicate matches M9's `inspectorToOverlay` (which lives in
  `@/inspector/overlay.js`, not `types.js`, and is **not** imported here):
  `!gpuOutcomeAgrees || |gpuFtleDelta| > 0.1 || !gpuWordAgrees`.
- **M8** (`ViewState`, `defaultViewState`, `viewStateToCacheKey`) — `capture.ts`
  snapshots the full `ViewState` so a captured frame replays at the right
  chart/tier/zoom; `viewStateToCacheKey` confirms a replayed view matches.
- **G7** (`jitterOffsets`, `@/quadtree/ensemble_jitter.js`) — `capture.ts`
  records the ensemble seeds (`patternId` + the resolved jitter offsets for `E`)
  so a captured fractal-boundary frame replays with identical sub-pixel jitter.
  There is **no `EnsembleConfig` type in `@/gpu/ensemble.js`** — G7 carries
  `E`/`patternId` in the `TileRequest`, so the capture API takes them
  **structurally** (`{ E: number; patternId: 0 | 1 | 2 }`).
- **G2** (`App`, `Store`, `FrameStats`) — `mount.ts` reads `app.store.snapshot()`
  read-only and subscribes for live updates; it never calls `app.store.update`.
- **G8 / G12** (`mountUI`, `ShellDeps`, the shell grid) — the overlay is mounted
  as one more `off`-returning mount beside `mountChrome`, gated by a toggle from
  `overlay_state.ts`; an integration patch to `ShellDeps`/`mountUI` is below.
- Contracts: tiers per **ADR 0003**; outcome enum **ADR 0002**; the tile failure
  bits are G11's `TILE_STATUS_FAIL` at **bits 8–10** (`SIM_FAILED = 1<<8`,
  `MAX_SUBSTEPS = 1<<9`, `TIMEOUT = 1<<10` — bits 6–7 are the schema-version
  field, DG11.1), surfaced read-only.

> **G17 surface, declared.** G18 builds against G17's `@/debug/frame_capture.js`
> (`CapturedFrame`, `captureFrame`, `serializeFrame`, `deserializeFrame`,
> `packedInputs`, `FRAME_CAPTURE_VERSION`) and `@/debug/inspector.js`
> (`pickSample`). G17 exposes no panel registry. If G17's names drift, fix the
> imports in `src/devhud/*` only — the view-model shapes (`PerfHudVM`,
> `ErrorOverlayVM`, `ValidationVM`, `FrameCaptureV2`) are G18's own and the exit
> suite pins them independent of G17's internals.

## `src/devhud/perf_view.ts`

Pure projection of a `PerfSnapshot` (+ the read-only `recommend()` hint) into a
flat view-model the DOM layer renders without any further logic. No GPU, no DOM.

```ts
import type { GpuPass } from '@/perf/gpu_timing.js';
import { GPU_PASSES } from '@/perf/gpu_timing.js';
import type {
  PerfSnapshot, PerfRecommendation, BudgetState,
} from '@/perf/perf_monitor.js';
import type { QualityTier } from '@/gpu/capability.js';

/** Colour bucket for the budget chip — drives a CSS class, not a literal colour. */
export type BudgetBucket = 'ok' | 'warn' | 'bad';

export interface GpuPassRow {
  pass: GpuPass;
  p95Ms: number;
}

export interface PerfHudVM {
  frames: number;
  cpuMeanMs: number;
  cpuP95Ms: number;
  budget: BudgetState;
  bucket: BudgetBucket;
  /** Per-pass GPU p95 rows; empty when timestamp-query is unavailable. */
  gpuRows: GpuPassRow[];
  gpuTimingAvailable: boolean;
  overPercent: number;          // overFraction × 100, rounded
  /** Read-only scheduler hint from PerfMonitor.recommend(); the HUD shows it,
   *  it does NOT apply it (G10's FrameLoop owns the dispatch cap). */
  recommendation: {
    capScalePercent: number;    // dispatchCapScale × 100, rounded
    recommendTier: QualityTier | null;
    reason: string;
  };
}

/** Map the three-state budget classifier onto a colour bucket. */
export function budgetBucket(state: BudgetState): BudgetBucket {
  switch (state) {
    case 'ok': return 'ok';
    case 'over': return 'warn';
    case 'sustained': return 'bad';
    default: { const _x: never = state; return _x; }
  }
}

/**
 * Build the perf-HUD view-model. Pure: hand it a snapshot and the (already
 * computed) recommendation and it returns flat rows the DOM renders verbatim.
 */
export function perfHudVM(
  snap: PerfSnapshot, rec: PerfRecommendation,
): PerfHudVM {
  const gpuRows: GpuPassRow[] = [];
  if (snap.gpuTimingAvailable) {
    for (const pass of GPU_PASSES) {
      const v = snap.gpuP95Ms[pass];
      if (typeof v === 'number') gpuRows.push({ pass, p95Ms: v });
    }
  }
  return {
    frames: snap.frames,
    cpuMeanMs: snap.cpuMeanMs,
    cpuP95Ms: snap.cpuP95Ms,
    budget: snap.budget,
    bucket: budgetBucket(snap.budget),
    gpuRows,
    gpuTimingAvailable: snap.gpuTimingAvailable,
    overPercent: Math.round(snap.overFraction * 100),
    recommendation: {
      capScalePercent: Math.round(rec.dispatchCapScale * 100),
      recommendTier: rec.recommendTier,
      reason: rec.reason,
    },
  };
}
```

## `src/devhud/error_view.ts`

Pure projection of the G11 telemetry buffer and a tile `status_flags` map into an
error-overlay view-model. Messages come exclusively from G11's `userMessage()`
and `tileFlagDescriptor().message`; this module never reads `AppError.cause` or a
telemetry record's stringified `cause` (CANON: the cause stays inside the
boundary's sink, never on screen).

```ts
import type { TelemetryRecord } from '@/error/telemetry.js';
import { Level, InMemorySink } from '@/error/telemetry.js';
import type { AppError } from '@/error/kinds.js';
import { userMessage } from '@/error/kinds.js';
import {
  tileFlagDescriptor, hasTileFailure, type TileFlagDescriptor,
} from '@/error/tile_status.js';

/** One row in the recent-errors list, built from telemetry only. */
export interface ErrorRow {
  ts: number;
  level: Level;
  /** The stack-free user message that was logged (telemetry `message` field). */
  message: string;
  kind?: string;            // context.kind, when present
  recoverable?: boolean;    // context.recoverable, when present
}

/** A tile flagged in the failure overlay. */
export interface TileFailureRow {
  tileKey: string;
  flags: number;
  descriptor: TileFlagDescriptor;   // label/message/severity from tileFlagDescriptor()
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
 * Project a directly-classified AppError into the row a freshly-captured error
 * would produce — used when surfacing the boundary's `onUserError` hook live,
 * before the record lands in the sink.
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
 * per-tile status_flags map (tileKey → status_flags u32). Pure.
 */
export function errorOverlayVM(
  sink: InMemorySink,
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
  return { ts: r.ts, level: r.level, message: r.message, kind, recoverable };
}
```

## `src/devhud/validation_view.ts`

Pure projection of M9's `InspectorResult.validation` into a panel view-model. The
flagged predicate is the same one M9's `inspectorToOverlay` uses, restated here so
the dev panel and the user-facing overlay agree.

```ts
import type { InspectorResult } from '@/inspector/types.js';

/** FTLE delta above which the inspector flags a GPU↔CPU disagreement (M9). */
export const FTLE_DELTA_THRESHOLD = 0.1;

export interface ValidationVM {
  available: boolean;            // false when the inspector ran without a GPU SimResult
  gpuOutcomeAgrees: boolean;
  gpuFtleDelta: number;
  gpuWordAgrees: boolean;
  /** True iff any of the three checks disagree (matches M9 inspectorToOverlay). */
  flagged: boolean;
  /** The inspector's own outcome, for the panel header. */
  outcome: InspectorResult['outcome'];
}

/**
 * Build the validation-panel view-model. When `result.validation` is absent
 * (inspector ran with no GPU SimResult to compare), returns `available:false`
 * and leaves the comparison fields neutral.
 */
export function validationVM(result: InspectorResult): ValidationVM {
  const v = result.validation;
  if (!v) {
    return {
      available: false,
      gpuOutcomeAgrees: true, gpuFtleDelta: 0, gpuWordAgrees: true,
      flagged: false, outcome: result.outcome,
    };
  }
  const flagged =
    !v.gpuOutcomeAgrees
    || Math.abs(v.gpuFtleDelta) > FTLE_DELTA_THRESHOLD
    || !v.gpuWordAgrees;
  return {
    available: true,
    gpuOutcomeAgrees: v.gpuOutcomeAgrees,
    gpuFtleDelta: v.gpuFtleDelta,
    gpuWordAgrees: v.gpuWordAgrees,
    flagged,
    outcome: result.outcome,
  };
}
```

## `src/devhud/capture.ts`

Extends G17's `CapturedFrame` to a `FrameCaptureV2` carrying the full M8
`ViewState` and the G7 ensemble seeds, so a captured repro replays
deterministically. Pure: it composes G17's base record with snapshots taken from
the live `Store` and a structural `{E, patternId}` ensemble config; the
round-trip is what the exit suite pins.

`viewStateToCacheKey` (M8) returns a `TileCacheKey` **object**, not a string, so
the captured `cacheKey` is its `serialiseCacheKey()` (M4, `@/quadtree/cache_key.js`)
string form — that keeps the `!==` comparison in `checkCaptureReplayable` honest
and the `toBe(...)` assertion in the exit suite well-typed.

```ts
import type { CapturedFrame } from '@/debug/frame_capture.js';   // G17 base record
import type { ViewState } from '@/interact/view_state.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';
import { serialiseCacheKey } from '@/quadtree/cache_key.js';
import { jitterOffsets } from '@/quadtree/ensemble_jitter.js';

/** Resolved sub-pixel jitter seed (one per ensemble copy). */
export interface SeedOffset { du: number; dv: number }

/** The ensemble seeding needed to replay a frame's sub-pixel jitter (G7).
 *  The input is structural ({E, patternId}) — there is no EnsembleConfig
 *  type in @/gpu/ensemble.js; G7 carries E/patternId in the TileRequest. */
export interface EnsembleSeeds {
  E: number;
  patternId: 0 | 1 | 2;
  offsets: SeedOffset[];
}

/**
 * G18's widened capture: G17's base frame record plus everything needed to
 * reconstruct the *inputs* — the full ViewState (M8) and the ensemble seeds
 * (G7). `cacheKey` is captured alongside so a replay can assert it lands on the
 * same tile signature without re-deriving it.
 */
export interface FrameCaptureV2 extends CapturedFrame {
  view: ViewState;
  cacheKey: string;   // serialiseCacheKey(viewStateToCacheKey(view))
  seeds: EnsembleSeeds;
}

/** Snapshot the ensemble seeds for a (patternId, E) pair (G7 jitter). */
export function captureSeeds(cfg: { E: number; patternId: 0 | 1 | 2 }): EnsembleSeeds {
  const offsets = jitterOffsets(cfg.patternId, Math.max(1, cfg.E))
    .map(o => ({ du: o.du, dv: o.dv }));
  return { E: cfg.E, patternId: cfg.patternId, offsets };
}

/**
 * Widen a G17 base capture with the current ViewState + ensemble seeds. Pure —
 * pass it the base record (from G17's captureFrame), the live view, and the
 * ensemble config; it never reads the GPU or the DOM.
 */
export function extendCapture(
  base: CapturedFrame, view: ViewState, cfg: { E: number; patternId: 0 | 1 | 2 },
): FrameCaptureV2 {
  return {
    ...base,
    view,
    cacheKey: serialiseCacheKey(viewStateToCacheKey(view)),
    seeds: captureSeeds(cfg),
  };
}

/**
 * Verify a V2 capture is internally consistent for replay: its cacheKey matches
 * its view, and its seed table matches its declared (patternId, E). Returns the
 * list of mismatches (empty ⇒ replayable). Used by the capture panel's "replay"
 * action and pinned by the exit suite.
 */
export function checkCaptureReplayable(cap: FrameCaptureV2): string[] {
  const problems: string[] = [];
  if (serialiseCacheKey(viewStateToCacheKey(cap.view)) !== cap.cacheKey) {
    problems.push('cacheKey does not match captured ViewState');
  }
  const expected = jitterOffsets(cap.seeds.patternId, Math.max(1, cap.seeds.E));
  if (expected.length !== cap.seeds.offsets.length) {
    problems.push('seed count does not match (patternId, E)');
  } else {
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i]!;
      const got = cap.seeds.offsets[i]!;
      if (e.du !== got.du || e.dv !== got.dv) {
        problems.push(`seed ${i} differs from regenerated jitter`);
        break;
      }
    }
  }
  return problems;
}
```

## `src/devhud/overlay_state.ts`

Pure reducer for the dev overlay's visibility and active tab. The overlay is
**default-hidden** — it only appears on the keyboard toggle — and switching tabs
never affects `ViewState`, the cache, or history.

```ts
/** The four hosted views; 'capture' is G18's own frame-capture/replay panel. */
export type DevTab = 'perf' | 'errors' | 'validation' | 'capture';

export const DEV_TABS: readonly DevTab[] = ['perf', 'errors', 'validation', 'capture'];

export interface DevOverlayState {
  visible: boolean;
  tab: DevTab;
}

export type DevOverlayAction =
  | { type: 'toggle' }
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'selectTab'; tab: DevTab };

/** Default-hidden, perf tab pre-selected. */
export function initDevOverlay(): DevOverlayState {
  return { visible: false, tab: 'perf' };
}

/** Pure reducer. Selecting a tab also reveals the overlay (so the keybinding
 *  for a specific tab both shows it and switches to it). */
export function devOverlayReducer(
  s: DevOverlayState, a: DevOverlayAction,
): DevOverlayState {
  switch (a.type) {
    case 'toggle': return { ...s, visible: !s.visible };
    case 'show':   return { ...s, visible: true };
    case 'hide':   return { ...s, visible: false };
    case 'selectTab': return { visible: true, tab: a.tab };
    default: { const _x: never = a; return _x; }
  }
}
```

## `src/devhud/mount.ts`

Wires the three view-models and G18's own capture panel into a collapsible
drawer, subscribing to the live `App.store` (read-only) and polling the
`PerfMonitor` each animation frame. Mirrors G12's mount idiom: returns an `off()`
and degrades to an inert no-op when there is no `document`. It does **not** mount
any G17 panel registry (G17 has none).

```ts
import type { App } from '@/app/app.js';
import type { PerfMonitor } from '@/perf/perf_monitor.js';
import type { InMemorySink } from '@/error/telemetry.js';
import type { InspectorResult } from '@/inspector/types.js';
import type { FrameCaptureV2 } from './capture.js';
import { perfHudVM } from './perf_view.js';
import { errorOverlayVM } from './error_view.js';
import { validationVM } from './validation_view.js';
import { checkCaptureReplayable } from './capture.js';
import {
  initDevOverlay, devOverlayReducer,
  type DevOverlayState, type DevTab, DEV_TABS,
} from './overlay_state.js';

export interface DebugHudDeps {
  perf: PerfMonitor;                          // G10
  sink: Pick<InMemorySink, 'records'>;        // G11 telemetry buffer
  /** Live per-tile status_flags (tileKey → u32), supplied by the caller. */
  tileFlags: () => ReadonlyMap<string, number>;
  /** The current locked inspector result, or null when unlocked (M9 / G2). */
  inspector: () => InspectorResult | null;
  /** The most-recent extended capture, or null when nothing is captured yet. */
  capture?: () => FrameCaptureV2 | null;
  /** Injectable rAF for tests; defaults to requestAnimationFrame. */
  raf?: (cb: () => void) => number;
  caf?: (h: number) => void;
}

/**
 * Mount the dev overlay into `root`. Read-only over `app.store`. Returns an
 * `off()` that unsubscribes and stops the rAF poll.
 * No-op (returns a no-op off) when `document` is absent — headless CI safe.
 */
export function mountDebugHud(
  root: HTMLElement, app: App, deps: DebugHudDeps,
): () => void {
  if (typeof document === 'undefined') return () => {};

  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((h) => cancelAnimationFrame(h));

  let state: DevOverlayState = initDevOverlay();
  const offs: (() => void)[] = [];

  root.innerHTML = `
    <div class="devhud" hidden>
      <nav class="devhud-tabs">${
        DEV_TABS.map(t => `<button data-tab="${t}">${t}</button>`).join('')
      }</nav>
      <section class="devhud-body"></section>
    </div>
  `;
  const drawer = root.querySelector<HTMLDivElement>('.devhud')!;
  const body = root.querySelector<HTMLElement>('.devhud-body')!;

  const dispatch = (a: Parameters<typeof devOverlayReducer>[1]) => {
    state = devOverlayReducer(state, a);
    drawer.hidden = !state.visible;
    render();
  };

  for (const btn of root.querySelectorAll<HTMLButtonElement>('.devhud-tabs button')) {
    btn.addEventListener('click', () =>
      dispatch({ type: 'selectTab', tab: btn.dataset['tab'] as DevTab }));
  }

  // `~` toggles the whole overlay; the keybinding is registered here so the dev
  // tool is self-contained (G12's keymap is for user-facing, compute-affecting
  // actions only — the dev HUD is neither and must not enter that map).
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '~' || (e.key === '`' && e.shiftKey)) dispatch({ type: 'toggle' });
  };
  window.addEventListener('keydown', onKey);
  offs.push(() => window.removeEventListener('keydown', onKey));

  function render(): void {
    if (!state.visible) return;
    body.replaceChildren();
    const tier = app.store.snapshot().qualityTier;
    if (state.tab === 'perf') {
      const vm = perfHudVM(deps.perf.snapshot(), deps.perf.recommend(tier));
      body.appendChild(renderPerf(vm));
    } else if (state.tab === 'errors') {
      body.appendChild(renderErrors(errorOverlayVM(deps.sink, deps.tileFlags())));
    } else if (state.tab === 'validation') {
      const r = deps.inspector();
      body.appendChild(renderValidation(r ? validationVM(r) : null));
    } else if (state.tab === 'capture') {
      const cap = deps.capture?.() ?? null;
      body.appendChild(renderCapture(cap));
    }
  }

  // Render-only poll: re-derive the visible tab each frame. Never writes state.
  let rafHandle = 0;
  const tick = () => { render(); rafHandle = raf(tick); };
  rafHandle = raf(tick);
  offs.push(() => caf(rafHandle));

  // Read-only subscription: a ViewState change re-renders (e.g. tier badge).
  offs.push(app.store.subscribe(() => render()));

  return () => { offs.forEach(off => off()); root.replaceChildren(); };
}

// --- tiny DOM builders (presentation only; no logic — all logic is in the VMs) ---

function renderPerf(vm: ReturnType<typeof perfHudVM>): HTMLElement {
  const el = document.createElement('div');
  el.className = `devhud-perf budget-${vm.bucket}`;
  const gpu = vm.gpuTimingAvailable
    ? vm.gpuRows.map(r => `${r.pass}: ${r.p95Ms.toFixed(2)}ms`).join(' · ')
    : 'cpu-only';
  el.textContent =
    `frames ${vm.frames} · cpu ${vm.cpuMeanMs.toFixed(2)}/${vm.cpuP95Ms.toFixed(2)}ms ` +
    `· ${vm.budget} (${vm.overPercent}% over) · ${gpu} ` +
    `· cap ${vm.recommendation.capScalePercent}%` +
    (vm.recommendation.recommendTier ? ` → ${vm.recommendation.recommendTier}` : '');
  return el;
}

function renderErrors(vm: ReturnType<typeof errorOverlayVM>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'devhud-errors';
  const head = document.createElement('div');
  head.textContent = `errors ${vm.errorCount} · warns ${vm.warnCount} ` +
    `· failed tiles ${vm.failedTiles.length} · warned ${vm.warnedTiles.length}`;
  el.appendChild(head);
  for (const r of vm.rows.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = `devhud-error level-${r.level}`;
    row.textContent = r.message;
    el.appendChild(row);
  }
  for (const t of vm.failedTiles.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'devhud-tile-failure';
    row.textContent = `${t.tileKey}: ${t.descriptor.label}`;
    el.appendChild(row);
  }
  return el;
}

function renderValidation(vm: ReturnType<typeof validationVM> | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'devhud-validation';
  if (!vm || !vm.available) { el.textContent = 'no locked inspector result'; return el; }
  el.classList.toggle('flagged', vm.flagged);
  el.textContent =
    `outcome ${vm.outcome} · outcomeAgrees ${vm.gpuOutcomeAgrees} ` +
    `· ftleΔ ${vm.gpuFtleDelta.toFixed(4)} · wordAgrees ${vm.gpuWordAgrees}`;
  return el;
}

function renderCapture(cap: FrameCaptureV2 | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'devhud-capture';
  if (!cap) { el.textContent = 'no captured frame'; return el; }
  const problems = checkCaptureReplayable(cap);
  el.classList.toggle('stale', problems.length > 0);
  el.textContent =
    `frame ${cap.N}×${cap.M} · chart ${cap.view.chartType} ` +
    `· key ${cap.cacheKey} · ` +
    (problems.length === 0 ? 'replayable' : `stale: ${problems.join('; ')}`);
  return el;
}
```

## `src/devhud/index.ts`

```ts
export * from './perf_view.js';
export * from './error_view.js';
export * from './validation_view.js';
export * from './capture.js';
export * from './overlay_state.js';
export * from './mount.js';
```

## G12 integration patch — `ShellDeps` / `mountUI` (`src/ui/App.ts`)

`mountUI` and `ShellDeps` live in `src/ui/App.ts` (imported as `@/ui/App.js`),
not a `shell.ts` (which does not exist — G8 introduced `App.ts`, G12 extended it).
The dev overlay is mounted as one more `off`-returning mount beside `mountChrome`.
Additive: existing `ShellDeps` fields and callers are unchanged; the dev HUD is
**optional** so a production shell can omit it.

```ts
// src/ui/App.ts (as-built patch against G12's mountUI)
import { mountDebugHud, type DebugHudDeps } from '@/devhud/mount.js';

export interface ShellDeps {
  boundary?: ErrorBoundary;            // G11: error overlay source
  capability?: CapabilityProfile;      // G9: warning banner source
  renderStore?: RenderParamsStore;     // render-only knobs (group-3 rebind)
  presets?: PresetStore;
  debug?: DebugHudDeps;                // G18: dev overlay (absent in prod)
}

// In mountUI(root, app, canvas, deps): a `.devhud-area` cell joins the shell
// markup (after `.loader-area`), and the HUD mounts only when supplied:
//   <div class="devhud-area"></div>
//   if (deps.debug) offs.push(mountDebugHud(area('.devhud-area'), app, deps.debug));
```

G12's `ShellDeps` fields are **all optional** (the G8-era 3-arg `mountUI` still
works) — the doc's earlier required `boundary`/`capability`/`renderStore` and the
`ledger`/`perf` fields never existed; `mountLoadingIndicator` takes
`app.loop.ledger`/`app.loop.perf` directly. The HUD lives in its own grid cell
(`.devhud-area`, floating over the canvas bottom edge in `styles.css`), starts
hidden, and surfaces on `~`. Because it reads `app.store.snapshot()` and never
calls `app.store.update`, it cannot enter the history ring or invalidate the
cache — the same render-only guarantee G12's `RenderParamsStore` carries.

## Live wiring — `dev/main.ts` (as-built)

The dev shell supplies the four feeds:

```ts
// tileFlags: iterate the live cache; only tiles with a landed reduction
// carry status_flags (CachedTile.reduction is optional).
const tileFlags = (): ReadonlyMap<string, number> => {
  const m = new Map<string, number>();
  for (const t of app.loop.cache.entries()) {
    if (t.reduction) m.set(tileKey(t.id), t.reduction.status_flags);
  }
  return m;
};
// inspector: App.inspector() returns the SAME promise per lock — track it
// by identity so the resolved result is cached until the lock changes and
// the HUD poll never re-runs the inspector.
let inspectorResult: InspectorResult | null = null;
let trackedInspector: Promise<InspectorResult> | null = null;
const inspectorNow = (): InspectorResult | null => {
  const p = app.inspector();
  if (p !== trackedInspector) {
    trackedInspector = p;
    inspectorResult = null;
    p?.then((r) => { if (trackedInspector === p) inspectorResult = r; },
            () => { /* surfaced by the boundary, not the HUD */ });
  }
  return inspectorResult;
};

mountUI(root, app, canvas, {
  boundary, capability: cap, renderStore,
  debug: { perf: app.loop.perf, sink: telemetrySink, tileFlags, inspector: inspectorNow },
});
```

**Deferred: the live capture button.** `capture?` is omitted in `dev/main.ts`
(the tab renders its empty state) because the dispatcher does not yet expose its
last-dispatch `SimUniforms`/`TileRequest` — G17's `captureFrame` needs those as
inputs. `extendCapture`/`checkCaptureReplayable` are fully exercised by the exit
suite; wiring a live capture button is follow-up work once the dispatcher
exposes its last dispatch.

## Tests

### `test/unit/ui/debug_hud.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { perfHudVM, budgetBucket } from '@/devhud/perf_view.js';
import { errorOverlayVM, appErrorRow } from '@/devhud/error_view.js';
import { validationVM, FTLE_DELTA_THRESHOLD } from '@/devhud/validation_view.js';
import {
  extendCapture, captureSeeds, checkCaptureReplayable, type FrameCaptureV2,
} from '@/devhud/capture.js';
import {
  initDevOverlay, devOverlayReducer, DEV_TABS,
} from '@/devhud/overlay_state.js';
import type { PerfSnapshot, PerfRecommendation } from '@/perf/perf_monitor.js';
import { Telemetry, Level, InMemorySink } from '@/error/telemetry.js';
import { AppErrorKind, type AppError } from '@/error/kinds.js';
import { TILE_STATUS_FAIL, TILE_STATUS_AT_F32_FLOOR } from '@/error/tile_status.js';
import type { InspectorResult } from '@/inspector/types.js';
import { jitterOffsets } from '@/quadtree/ensemble_jitter.js';
import { defaultViewState, viewStateToCacheKey } from '@/interact/view_state.js';
import { serialiseCacheKey } from '@/quadtree/cache_key.js';

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  frames: 120, cpuMeanMs: 8, cpuP95Ms: 12,
  gpuP95Ms: {}, gpuTimingAvailable: false,
  budget: 'ok', overFraction: 0,
  ...over,
});
const rec = (over: Partial<PerfRecommendation> = {}): PerfRecommendation => ({
  dispatchCapScale: 1, recommendTier: null, reason: 'within budget', ...over,
});

describe('perfHudVM: budget bucket + rows', () => {
  it('maps the three budget states onto colour buckets', () => {
    expect(budgetBucket('ok')).toBe('ok');
    expect(budgetBucket('over')).toBe('warn');
    expect(budgetBucket('sustained')).toBe('bad');
  });

  it('CPU-only snapshot yields no GPU rows', () => {
    const vm = perfHudVM(snap({ gpuTimingAvailable: false }), rec());
    expect(vm.gpuRows).toHaveLength(0);
    expect(vm.gpuTimingAvailable).toBe(false);
  });

  it('surfaces per-pass GPU rows when timestamp-query is present', () => {
    const vm = perfHudVM(snap({
      gpuTimingAvailable: true,
      gpuP95Ms: { simulate: 14, reduce: 3 },
    }), rec());
    expect(vm.gpuRows.map(r => r.pass)).toEqual(['simulate', 'reduce']);
    expect(vm.gpuRows[0]!.p95Ms).toBe(14);
  });

  it('surfaces the recommend() hint read-only (cap %, tier, reason)', () => {
    const vm = perfHudVM(
      snap({ budget: 'sustained', overFraction: 1 }),
      rec({ dispatchCapScale: 0.25, recommendTier: 'balanced', reason: 'research → balanced' }),
    );
    expect(vm.bucket).toBe('bad');
    expect(vm.overPercent).toBe(100);
    expect(vm.recommendation.capScalePercent).toBe(25);
    expect(vm.recommendation.recommendTier).toBe('balanced');
    expect(vm.recommendation.reason).toMatch(/balanced/);
  });
});

describe('errorOverlayVM: telemetry rows + tile-failure roll-up', () => {
  const fill = (sink: InMemorySink) => {
    const t = new Telemetry({ minLevel: Level.Debug, sink, now: () => 1000 });
    t.info('debug-noise');                                    // below Warn → excluded
    t.warn('The GPU connection was lost and is being restored.',
      { kind: AppErrorKind.DeviceLost, recoverable: true });
    t.error('Something went wrong while computing this region.',
      { kind: AppErrorKind.Generic, recoverable: false });
  };

  it('lists only Warn+ rows, most-recent first, with counts', () => {
    const sink = new InMemorySink();
    fill(sink);
    const vm = errorOverlayVM(sink);
    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0]!.message).toMatch(/went wrong/);       // last in, first out
    expect(vm.errorCount).toBe(1);
    expect(vm.warnCount).toBe(1);
    expect(vm.rows[0]!.recoverable).toBe(false);
  });

  it('never includes a record below Warn (no debug noise)', () => {
    const sink = new InMemorySink();
    fill(sink);
    expect(errorOverlayVM(sink).rows.some(r => r.level < Level.Warn)).toBe(false);
  });

  it('splits failed tiles (hard bit) from warned tiles (f32 floor)', () => {
    const sink = new InMemorySink();
    const flags = new Map<string, number>([
      ['2/1/3', TILE_STATUS_FAIL.SIM_FAILED],
      ['2/1/4', TILE_STATUS_AT_F32_FLOOR],
      ['2/1/5', 0],                                           // clean → neither list
    ]);
    const vm = errorOverlayVM(sink, flags);
    expect(vm.failedTiles.map(t => t.tileKey)).toEqual(['2/1/3']);
    expect(vm.failedTiles[0]!.descriptor.severity).toBe('error');
    expect(vm.warnedTiles.map(t => t.tileKey)).toEqual(['2/1/4']);
    expect(vm.warnedTiles[0]!.descriptor.severity).toBe('warn');
  });

  it('appErrorRow builds a stack-free row from a live AppError', () => {
    const e: AppError = { kind: AppErrorKind.Generic, recoverable: false };
    const row = appErrorRow(e, 42);
    expect(row.ts).toBe(42);
    expect(row.level).toBe(Level.Error);
    expect(row.message).toMatch(/went wrong/);
    expect(row.message).not.toMatch(/at .+\(.+:\d+:\d+\)/);   // no V8 stack frame
  });
});

describe('validationVM: M9 validation slot', () => {
  const base = (over: Partial<InspectorResult> = {}): InspectorResult => ({
    t: [], r: [], p: [], nShape: [], energy: [], lz: [],
    outcome: 'bounded', tEnd: 5, dMin: 0.1, deltaEMax: 0, ftle: 0,
    freeGroupWord: '', ic: { m: [1, 1, 1] as any, r: [] as any, p: [] as any },
    nSteps: 0, nReject: 0, cpuMs: 0,
    ...over,
  });

  it('absent validation → available:false, not flagged', () => {
    const vm = validationVM(base());
    expect(vm.available).toBe(false);
    expect(vm.flagged).toBe(false);
  });

  it('all-agree validation → available, not flagged', () => {
    const vm = validationVM(base({
      validation: { gpuOutcomeAgrees: true, gpuFtleDelta: 0.01, gpuWordAgrees: true },
    }));
    expect(vm.available).toBe(true);
    expect(vm.flagged).toBe(false);
  });

  it('flags an FTLE delta past the threshold', () => {
    const vm = validationVM(base({
      validation: {
        gpuOutcomeAgrees: true,
        gpuFtleDelta: FTLE_DELTA_THRESHOLD + 0.05,
        gpuWordAgrees: true,
      },
    }));
    expect(vm.flagged).toBe(true);
  });

  it('flags an outcome disagreement', () => {
    const vm = validationVM(base({
      validation: { gpuOutcomeAgrees: false, gpuFtleDelta: 0, gpuWordAgrees: true },
    }));
    expect(vm.flagged).toBe(true);
  });
});

describe('overlay toggle reducer', () => {
  it('starts hidden on the perf tab', () => {
    const s = initDevOverlay();
    expect(s.visible).toBe(false);
    expect(s.tab).toBe('perf');
    expect(DEV_TABS).toContain('capture');
  });

  it('toggle flips visibility', () => {
    const s0 = initDevOverlay();
    const s1 = devOverlayReducer(s0, { type: 'toggle' });
    expect(s1.visible).toBe(true);
    expect(devOverlayReducer(s1, { type: 'toggle' }).visible).toBe(false);
  });

  it('selecting a tab also reveals the overlay', () => {
    const s = devOverlayReducer(initDevOverlay(), { type: 'selectTab', tab: 'capture' });
    expect(s.visible).toBe(true);
    expect(s.tab).toBe('capture');
  });
});

describe('extended frame-capture: ViewState + ensemble seeds', () => {
  // There is no EnsembleConfig type in @/gpu/ensemble.js — G7 carries
  // E/patternId in the TileRequest, so the capture API takes them
  // structurally (see src/devhud/capture.ts).
  const ensembleCfg = (E: number, patternId: 0 | 1 | 2): { E: number; patternId: 0 | 1 | 2 } =>
    ({ E, patternId });
  // G17 CapturedFrame base record: version/N/M/uniforms/tile/chart/label?
  const baseFrame = () =>
    ({ version: 2, N: 256, M: 64, uniforms: {}, tile: {}, chart: {} }) as any;

  it('captureSeeds reproduces G7 jitterOffsets for (patternId, E)', () => {
    const seeds = captureSeeds(ensembleCfg(4, 1));
    const expected = jitterOffsets(1, 4);
    expect(seeds.E).toBe(4);
    expect(seeds.patternId).toBe(1);
    expect(seeds.offsets).toHaveLength(expected.length);
    expect(seeds.offsets[0]).toEqual({ du: expected[0]!.du, dv: expected[0]!.dv });
  });

  it('extendCapture attaches the full ViewState and a matching cacheKey', () => {
    const view = { ...defaultViewState(), chartType: 'lz_e' };
    const cap: FrameCaptureV2 = extendCapture(baseFrame(), view, ensembleCfg(4, 2));
    expect(cap.N).toBe(256);                                  // base field preserved
    expect(cap.view.chartType).toBe('lz_e');
    expect(cap.cacheKey).toBe(serialiseCacheKey(viewStateToCacheKey(view)));
    expect(cap.seeds.E).toBe(4);
  });

  it('a freshly-extended capture is replayable (no mismatches)', () => {
    const cap = extendCapture(baseFrame(), defaultViewState(), ensembleCfg(2, 0));
    expect(checkCaptureReplayable(cap)).toEqual([]);
  });

  it('detects a tampered cacheKey / seed table on replay check', () => {
    const good = extendCapture(baseFrame(), defaultViewState(), ensembleCfg(2, 0));
    const tampered: FrameCaptureV2 = {
      ...good,
      cacheKey: 'not-the-real-key',
      seeds: { ...good.seeds, offsets: [{ du: 9, dv: 9 }] },
    };
    const problems = checkCaptureReplayable(tampered);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some(p => /cacheKey/.test(p))).toBe(true);
  });
});
```

### `test/unit/ui/debug_hud_dom.test.ts`

Uses the `// @vitest-environment happy-dom` header (G12's `shell_dom.test.ts`
idiom) rather than a `skipIf` — the suite always runs, in happy-dom. Six tests
as-built: hidden mount + disposer, `~` toggle + perf tab, disposer removes the
`~` listener, capture tab, errors tab (counts + `sim failed` tile row), and the
validation tab's no-lock state.

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountDebugHud, type DebugHudDeps } from '@/devhud/mount.js';
import type { App } from '@/app/app.js';

// happy-dom smoke mount, mirroring G12's shell_dom.test.ts. The HUD only
// reads store.snapshot()/subscribe() and its injected deps — minimal fakes.
const fakeApp = (): App => {
  const view = { qualityTier: 'balanced' };
  return {
    store: {
      snapshot: () => view,
      subscribe: (f: (v: unknown) => void) => { f(view); return () => {}; },
    },
  } as unknown as App;
};
const deps = (over: Partial<DebugHudDeps> = {}): DebugHudDeps => ({
  perf: {
    snapshot: () => ({
      frames: 1, cpuMeanMs: 8, cpuP95Ms: 9, gpuP95Ms: {},
      gpuTimingAvailable: false, budget: 'ok', overFraction: 0,
    }),
    recommend: () => ({ dispatchCapScale: 1, recommendTier: null, reason: 'ok' }),
  } as any,
  sink: { records: () => [] } as any,
  tileFlags: () => new Map(),
  inspector: () => null,
  capture: () => null,
  raf: () => 0,            // no real animation frame in the test
  caf: () => {},
  ...over,
});

describe('mountDebugHud (happy-dom smoke)', () => {
  it('mounts hidden and returns a disposer', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    expect(root.querySelector('.devhud')!.hasAttribute('hidden')).toBe(true);
    off();
    expect(root.querySelector('.devhud')).toBeNull();
  });

  it('toggles visible on the `~` key and renders the perf tab', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '~' }));
    expect(root.querySelector('.devhud')!.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.devhud-perf')!.textContent).toMatch(/cpu/);
    off();
  });

  it('the disposer removes the `~` listener (no zombie toggles)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const off = mountDebugHud(root, fakeApp(), deps());
    off();
    // After dispose the root is emptied and re-dispatching must not throw
    // or resurrect the drawer.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '~' }));
    expect(root.querySelector('.devhud')).toBeNull();
    root.remove();
  });

  it("selecting the capture tab renders G18's own capture panel", () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps({ capture: () => null }));
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-tab="perf"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    expect(root.querySelector('.devhud-capture')!.textContent).toMatch(/no captured frame/);
    off();
  });

  it('the errors tab renders counts from the sink and tile flags', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps({
      tileFlags: () => new Map([['1/0/0', 1 << 8]]),          // SIM_FAILED
    }));
    root.querySelector<HTMLButtonElement>('button[data-tab="errors"]')!.click();
    const el = root.querySelector('.devhud-errors')!;
    expect(el.textContent).toMatch(/failed tiles 1/);
    expect(root.querySelector('.devhud-tile-failure')!.textContent).toMatch(/sim failed/);
    off();
  });

  it('the validation tab reports the no-lock state', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    root.querySelector<HTMLButtonElement>('button[data-tab="validation"]')!.click();
    expect(root.querySelector('.devhud-validation')!.textContent)
      .toMatch(/no locked inspector result/);
    off();
  });
});
```

## Run it

```bash
npm test -- --run test/unit/ui/debug_hud        # both suites (25 tests as-built)
npx playwright test                             # shell spec incl. live `~` HUD probe
npx playwright test --headed                    # same on the real (Metal) GPU
```

## Acceptance check

```bash
npm test -- --run test/unit/ui/debug_hud
```

`test/unit/ui/debug_hud.test.ts` passes with ≥16 green tests (**as-built: 19
pure + 6 happy-dom = 25**): `perfHudVM` buckets the three budget states, emits
per-pass GPU rows only with `timestamp-query`, and surfaces the `recommend()`
hint read-only; `errorOverlayVM` lists only Warn+ telemetry rows
most-recent-first with correct counts, splits failed tiles (`hasTileFailure`)
from f32-floor warned tiles, and `appErrorRow` is stack-free; `validationVM`
flags an outcome/word disagreement or an FTLE delta past
`FTLE_DELTA_THRESHOLD` and reports `available:false` when M9 ran without a GPU
`SimResult`; the toggle reducer is default-hidden and `selectTab` reveals;
`extendCapture` attaches the full `ViewState` (its `cacheKey` matching
`serialiseCacheKey(viewStateToCacheKey(view))`) plus G7 ensemble seeds, and
`checkCaptureReplayable` is empty for a fresh capture and non-empty for a
tampered one. The happy-dom smoke mount starts hidden, toggles on `~` (and the
disposer removes the listener), renders all four tabs, and shows the tile-failure
rows. Live proof: `test/gpu/shell.spec.ts` presses `Shift+`` in the running app —
the drawer appears with live perf numbers and the errors tab, hides again, and
the `ViewState` snapshot is unchanged by the whole exchange (read-only pin);
green both headless (SwiftShader) and `--headed` (Metal).

## Notes for the implementer

- **Upstream symbols this milestone consumes (the seams).** Keep these imports in
  `src/devhud/*` only; if an upstream name drifts, this is the single place to fix.
  - G17 `@/debug/frame_capture.js`: `CapturedFrame`, `captureFrame`,
    `serializeFrame`, `deserializeFrame`, `packedInputs`, `FRAME_CAPTURE_VERSION`
    (G18 wraps `captureFrame` and replays via `deserializeFrame` — there is no
    `replayCapture`); `@/debug/inspector.js`: `pickSample`. G17 has no panel
    registry.
  - G10 `@/perf/perf_monitor.js`: `PerfSnapshot`, `PerfRecommendation`,
    `BudgetState`, `PerfMonitor.snapshot()`, `PerfMonitor.recommend()`;
    `@/perf/gpu_timing.js`: `GpuPass`, `GPU_PASSES`.
  - G11 `@/error/telemetry.js`: `InMemorySink`, `TelemetryRecord`, `Level`;
    `@/error/kinds.js`: `AppError`, `AppErrorKind`, `userMessage`;
    `@/error/tile_status.js`: `tileFlagDescriptor`, `hasTileFailure`,
    `TileFlagDescriptor`, `TILE_STATUS_FAIL`, `TILE_STATUS_AT_F32_FLOOR`.
  - M9 `@/inspector/types.js`: `InspectorResult`, `InspectorResult['validation']`
    (the flagged predicate mirrors `inspectorToOverlay`, which lives in
    `@/inspector/overlay.js` and is not imported here).
  - M8 `@/interact/view_state.js`: `ViewState`, `defaultViewState`,
    `viewStateToCacheKey` (returns a `TileCacheKey` **object**);
    M4 `@/quadtree/cache_key.js`: `serialiseCacheKey` (the object→string form the
    captured `cacheKey` stores).
  - G7 `@/quadtree/ensemble_jitter.js`: `jitterOffsets`. (**No `EnsembleConfig`
    exists in `@/gpu/ensemble.js`** — the capture API takes `{E, patternId}`
    structurally.)
  - G2 `@/app/app.js`: `App` (its `store.snapshot()`/`subscribe()` only);
    `@/app/store.ts`: `Store`.
  - G8/G12 `@/ui/App.js`: `ShellDeps`, `mountUI` (the integration patch; there is
    no `@/ui/shell.js`).
- **The HUD is read-only over `ViewState`.** It calls `app.store.snapshot()` and
  `subscribe()` but never `update`/`setView`. That is the structural guarantee
  it can't enter the history ring (G12) or invalidate the cache — the exact
  discipline `RenderParamsStore` carries for render-only knobs. Do not let a
  "jump to this captured view" button mutate the store from the HUD; route it
  through `App`/`InputHandlers` like any user gesture so it goes through history.
- **The recommendation is shown, not applied.** G10's `FrameLoop` owns the
  dispatch-cap back-pressure; `perfHudVM` only *displays* `recommend()` so a dev
  can see why the cap moved. Applying it from here would double-count the
  back-pressure.
- **Messages come from the catalogue, never the cause.** `error_view.ts` reads
  the telemetry record's `message` (already `userMessage()`-formatted by the
  boundary) and `tileFlagDescriptor().message`. It must never read
  `AppError.cause` or `context.cause` — those are technical detail that stays
  inside the sink (G11 CANON). The `appErrorRow` test pins that the rendered text
  has no V8 stack frame.
- **Tile failures are data.** The failed/warned-tile split is driven by
  `hasTileFailure()` and `tileFlagDescriptor().severity` over the live
  `status_flags` map the scheduler supplies — an ordinary DEGENERATE-IC tile is
  *not* a failure (G11 CANON #13), so it appears in neither list. Source the map
  from M5's reductions, not from the broad outcome class.
- **Capture must round-trip its inputs.** `extendCapture` stores the full
  `ViewState` and the resolved ensemble seeds so a replay reconstructs the
  *inputs*, not just the outputs. `checkCaptureReplayable` regenerates the jitter
  from `(patternId, E)` and recomputes `serialiseCacheKey(viewStateToCacheKey(...))`
  — if either differs, the capture is stale and won't replay deterministically.
  Because `viewStateToCacheKey` returns a `TileCacheKey` object, the stored
  `cacheKey` and the comparison both go through `serialiseCacheKey` so the `!==`
  is a string compare, not a reference compare. This is what makes a captured
  fractal-boundary repro actually reproducible.
- **Headless-safe by construction.** `mountDebugHud` returns a no-op when
  `document` is absent, and the pure view-models (`perf_view`, `error_view`,
  `validation_view`, `capture`, `overlay_state`) touch neither the GPU nor the
  DOM — that is why the exit suite needs no browser. The DOM smoke test runs
  under the `// @vitest-environment happy-dom` header (G12's `shell_dom` idiom —
  it always runs; no `skipIf` needed since the environment is per-file).
- **G18 owns its panels; it does not host a G17 registry.** G17's harness is a
  single standalone Vite page with no exported panel contract, so there is
  nothing to mount. The four tabs (`perf`/`errors`/`validation`/`capture`) are
  G18's own DOM builders over the pure view-models; the `capture` tab renders
  G18's `FrameCaptureV2` and its `checkCaptureReplayable` status. Replay reuses
  G17's `deserializeFrame` (wrap it locally if a V2 deserialiser is wanted),
  never a nonexistent `replayCapture`.
- **The `~` toggle is the HUD's own keybinding, not G12's keymap.** G12's keymap
  is for compute-affecting, user-facing actions; the dev HUD is neither, so it
  registers its own `keydown` listener and removes it on `off()`. Keep dev-tool
  keybindings out of the user keymap so they never collide with a shipped shortcut.
- **The live capture button is deferred (as-built).** `dev/main.ts` omits the
  `capture?` dep because the dispatcher does not yet expose its last-dispatch
  `SimUniforms`/`TileRequest` — the inputs G17's `captureFrame` needs. The
  capture tab renders its empty state; `extendCapture`/`checkCaptureReplayable`
  are pinned by the exit suite. Follow-up: expose the last dispatch on
  `GpuDispatcher`, then wire a capture button in the HUD.
- **Inspector feed: track the promise by identity.** `App.inspector()` returns
  the *same* `Promise<InspectorResult>` for the lifetime of a lock (and `null`
  when unlocked). The `dev/main.ts` feed caches the resolved result keyed on
  promise identity, so the HUD's rAF poll never re-runs the inspector and a
  re-lock invalidates the cached result automatically.