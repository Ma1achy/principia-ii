# G11 — Error handling & telemetry

> **As-built.** Rewritten after landing (living-document discipline). The
> draft's tile-failure bits collided with M5's schema-version field and
> its WGSL producers were speculative; both were reconciled against the
> landed tree — see ledger entries DG11.1–DG11.3.

## Goal

Principia previously failed quietly: GPU jobs rejected into a
`console.warn`, G9's unsupported reasons had one consumer (the boot
message), G7's device-loss listener logged and moved on, and M5's
per-tile `status_flags` never reached the user. G11 turns all of this
into one structured path: an `ErrorBoundary` that wraps async GPU/decode
operations, **classifies** every failure into a closed `AppErrorKind`
(unsupported, device-lost, tile sim-failure, decode
`DEGENERATE(reason)` per ADR 0007, generic), and emits a user-facing
message that **never leaks a raw stack**; plus a `telemetry` module with
leveled, timestamped, contextful records behind a pluggable sink (no
external service hardcoded — `NoopSink` default, `InMemorySink` for
tests/diagnostics).

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/error/boundary
```

passes with at least **15** green tests (26 landed) covering:
classification of each `AppErrorKind`; `status_flags`-bit → user-facing
descriptor mapping (including the bit-allocation pin); user messages
that contain no stack text; telemetry level filtering plus in-memory
sink buffering; and `ErrorBoundary.capture`/`wrap` semantics.

**Deliverable:** internal — tests only; but the funnel is live in the
shell: `dev/main.ts` wires an `ErrorBoundary` (InMemorySink telemetry at
`__principia.telemetry`, user messages on the console until G18's HUD),
and the first real surface happened during the shell e2e — a SwiftShader
tile carried `MAX_SUBSTEPS` and the boundary printed "Some trajectories
here needed more substeps than allowed and were cut short."

## File tree (as landed)

```
src/
  error/
    kinds.ts        # AppErrorKind, AppError, user-message catalogue
    boundary.ts     # classify(), ErrorBoundary.capture()/wrap()
    tile_status.ts  # TILE_STATUS_FAIL (bits 8-10) + descriptor map
    telemetry.ts    # Level, TelemetrySink, Telemetry, InMemorySink, NoopSink
    index.ts        # barrel
  gpu/shaders/
    reduce.wgsl     # MODIFIED: ORs the failure roll-up bits (see below)
  app/
    gpu_jobs.ts     # MODIFIED: .catch → boundary.capture; failure-bit surface
    frame_loop.ts   # MODIFIED: optional FrameLoopOpts.boundary → JobLedger
    app.ts          # MODIFIED: AppOpts.boundary pass-through
dev/
  main.ts           # MODIFIED: live boundary + telemetry in the shell boot
test/
  unit/error/
    boundary.test.ts        # 26 tests (the exit gate)
    ledger_boundary.test.ts # 4 tests: JobLedger routing
```

## Bit allocation (DG11.1 — the draft collided with the schema version)

`TileReduction.status_flags` is carved up as:

| bits | owner | contents |
|---|---|---|
| 0–5 | M5/G7 `TILE_STATUS` | HAS_ENSEMBLE, DECODE_LINEAR, AT_F32_FLOOR, SUSPECT_MAJORITY, FTLE_VALID, PLAYBACK_VALID |
| 6–7 | M5 schema version | `TILE_REDUCTION_SCHEMA_VERSION`, asserted + **stripped** by `decodeTileReduction` |
| 8–10 | **G11 `TILE_STATUS_FAIL`** | SIM_FAILED (1<<8), MAX_SUBSTEPS (1<<9), TIMEOUT (1<<10, reserved) |

The draft placed the failure bits at 6–8 — bits 6–7 are the version
field, so `SIM_FAILED`/`MAX_SUBSTEPS` would have been destroyed by the
version strip (and corrupted the version assert). The boundary suite
pins the non-collision so a future bit can't regress it.

## Producers (DG11.2 — grounded in landed signals)

The reduce shader's status assembly ORs, from data it already gathers:

- **SIM_FAILED** — any sample with a suspect E/Lz drift bit (sample
  descriptor bits 5/6): the integration state is untrustworthy. NOT
  keyed off broad class 3 — an ordinary DEGENERATE-IC tile is an
  *expected* terminal and must not shade as a sim failure.
- **MAX_SUBSTEPS** — any TIMEOUT-class sample (class 4): in the landed
  `simulate.wgsl` the substep-budget stall is the *only* class-4
  producer (horizon completion is BOUNDED by design).
- **TIMEOUT** — reserved, producer-less: the kernel has no wall clock.
  The constant, descriptor, and message exist so the CPU side is total;
  the ledger notes it must gain a producer before it can ever be set.

No struct change, no schema bump: the bits ride the existing u32 above
the stripped field.

## `src/error/*` (summary)

- **`telemetry.ts`** — `Level` (Debug/Info/Warn/Error), `Telemetry`
  (min-level filter *before* record build, injectable clock, base
  context, `child()` derivation), `TelemetrySink` (pluggable),
  `NoopSink` default, `InMemorySink` (capped ring) for tests/HUD.
- **`tile_status.ts`** — `TILE_STATUS_FAIL`, `TILE_FAIL_MASK`,
  `hasTileFailure()`, `tileFlagDescriptor()` (error bits beat warn
  bits; AT_F32_FLOOR re-exported as a warn descriptor, imported from
  M5's `TILE_STATUS` — not hardcoded).
- **`kinds.ts`** — closed `AppErrorKind` enum (plain, isolatedModules),
  `AppError` discriminated union (`cause` for telemetry only),
  `userMessage()` — pure, total, stack-free; the message catalogues are
  keyed by G9's `UnsupportedReason` and ADR 0007's `DegenerateReason`
  enum members (every code 10–17 covered, pinned by test).
- **`boundary.ts`** — `classify(err, hints)` priority: tile-failure
  hint > `UnsupportedError` > device-lost shape (`{reason,message}`
  without `name` — `GPUDeviceLostInfo` is not an `Error`) >
  decode-DEGENERATE shape > generic. `ErrorBoundary.capture()` logs
  full detail (serialised `causeSummary`, never user-shown) at warn
  (recoverable) / error (not), fires `onUserError(app, message)`, and
  returns the `AppError`. `wrap()` gives callers a discriminated
  `{ok}` result instead of try/catch.

## Integration (as landed)

- **`JobLedger`** takes an optional 4th `boundary` param (a
  `Pick<ErrorBoundary,'capture'>`, silent no-op default — G2's 3-arg
  construction unchanged). Its `.catch` routes through
  `capture(err, {tileKey})` (slot/entry release semantics unchanged),
  and — because **tile failures are data, not exceptions** — a
  *successful* completion whose reduction carries a failure bit calls
  `capture(undefined, {tileKey, statusFlags})` after ingest.
- **`FrameLoopOpts.boundary`** / **`AppOpts.boundary`** thread it from
  the shell; `dev/main.ts` builds the real one (InMemorySink(500) at
  `__principia.telemetry`; `onUserError` → `console.warn` until G18's
  HUD).

## Run it

```bash
npm test -- --run test/unit/error/boundary          # 26 passed
npm test -- --run test/unit/error/ledger_boundary   # 4 passed
```

No GPU needed — injected shapes, fixed clock, `InMemorySink`.

## Acceptance check

Landed: boundary suite 26 ≥ 15; full suite 573 passed / 8 skipped;
`gpu:check` + all four page checks green (reduce.wgsl change is
behaviour-preserving below bit 8); shell e2e green headless + the live
MAX_SUBSTEPS surface described above.

## Notes for the implementer

- **The boundary is the only place a raw cause is touched.**
  `userMessage` and `tile_status` are stack-free by construction;
  `capture` serialises the cause into telemetry and nowhere else.
- **Tile failures are data, not exceptions.** Don't model failure bits
  as rejected promises; the classifier checks the `statusFlags` hint
  first, so `capture(undefined, {statusFlags})` yields a `TileFailure`.
- **Respect the bit map.** Bits 6–7 are stripped by the decoder; new
  tile-level flags go at 11+, and the boundary suite's allocation pin
  must be extended with them.
- **`isDeviceLost` is shape-based on purpose** — `GPUDeviceLostInfo`
  has no `name`; G7's listener should pass the `info` object straight
  to `capture` *before* `recover()` so the user sees the "restoring"
  message during the rebuild window (G18 wires this).
- **Telemetry has no service baked in.** Implement `TelemetrySink` to
  forward (HTTP batch, IndexedDB, console); `child()` is the idiom for
  per-tile/per-session context.
- **A new `DegenerateReason` code** must be added to ADR 0007 *and* the
  `DECODE_MESSAGE` catalogue (the every-code test enforces the latter).
