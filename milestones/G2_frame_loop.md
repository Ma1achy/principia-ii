# G2 — Frame loop and orchestration

> **Status: LANDED** (branch `feat/g2-frame-loop`). Folded back to the
> as-built reality. The original draft had five substantive defects —
> all in the seams between G2 and the landed M4/M5/M8 contracts —
> ledgered as DG2.1–DG2.5 in `docs/build-decisions-ledger.md`. The
> landed source under `src/app/` is the authoritative listing.

## Goal

The top-level `App` class that owns the per-frame schedule. After G2,
the milestone graph has a "main" — every other milestone is something
this loop calls into.

The loop:
1. Reads `ViewState` from the reactive store.
2. Bridges it to a `QuadtreeView` and collects the visible tile
   frontier at the camera-derived depth.
3. Walks ancestors for any missing tile (so the screen never blanks).
4. Plans this frame's compute jobs via M5's `planFrame`.
5. Dispatches GPU compute + reduction jobs; ingests reductions on
   completion; logically cancels offscreen work.
6. Renders the frontier via the pluggable dispatcher (M7's render
   graph in production).
7. Handles input events: sliders, zoom, tilt, chart switches, lock,
   lookup.

**Exit criterion.**

```bash
npm test -- --run test/integration/app_frame_loop
```

A synthetic harness (mocked GPU dispatch, manually-driven ticks) covers:
100 steady ticks, a pan, a zoom step, a chart switch with a live lock,
the inspector lifecycle, and a cache-key-neutral state write. Every
frame renders; no tile is ever dispatched twice; the frontier converges
to 100 % cache hits; the inspector recomputes once on lock and no more.

**Deliverable:** a running frame loop — the top-level `App` ticks
read-view → plan → dispatch → render each frame, verified by the
mocked-GPU integration harness (the milestone graph's "main", not yet a
visible canvas — G8/G12 mount it).

## File tree (as landed)

```
principia/
  src/
    app/
      types.ts             # FrameDeps, GpuDispatcher, RenderPlan, FrameStats
      store.ts             # reactive store wrapping ViewState
      view_bridge.ts       # ViewState → QuadtreeView (+ Viewport) — DG2.1
      input.ts             # gesture → state transitions
      gpu_jobs.ts          # JobLedger: job lifecycle + cache claiming
      frame_loop.ts        # the per-frame body
      app.ts               # public App facade
      index.ts
  test/
    helpers/
      stub_reduction.ts    # all-31-lane synthetic TileReduction
    unit/app/
      store.test.ts        # 4 tests
      input.test.ts        # 7 tests
      gpu_jobs.test.ts     # 5 tests
    integration/
      app_frame_loop.test.ts  # 6 tests
```

The draft's `render_dispatch.ts` was dropped: its only content was an
identity function ("M7's pipeline reads this directly") — the
`RenderPlan` type in `types.ts` IS the contract, and the real
compositing lives behind `GpuDispatcher.render`.

## The pieces (contracts, not listings — the source is authoritative)

### `store.ts` — single source of truth

`Store` wraps `ViewState` with `snapshot / setView / update / subscribe`
(subscribers fire once on subscribe and on every change). Every
entry-point on `App` reads or writes through it — which is what makes
M12's URL-share / sidecar-reproduce path work without surgery.

### `view_bridge.ts` — ViewState → QuadtreeView (DG2.1)

M4/M5's `visibleTiles`, `planFrame`, and `computePriority` all take a
`QuadtreeView` (cacheKey + UV window + zBase/zMax + viewport pixels) —
NOT M8's `ViewState`, which the draft passed straight through.
`toQuadtreeView(v, viewport)` derives `zBase` from the camera's
`zoomLevel` formula on the viewport's UV width, caps at `v.maxDepth`,
and computes the cache key via `viewStateToCacheKey`. The `Viewport`
(`widthPx/heightPx/tilePix`, default 800×600 @ 256) is a loop option.

### `input.ts` — gesture handlers

Thin wrappers over the M8 interact helpers (`setSlider`,
`applyZoomStep`, `setTilts`, `lockAffine`/`unlock`, `lookup`,
`preserveLockAcrossChart`). Discriminated-union results are surfaced as
`{ ok, reason? }`; a rejected operation leaves the store untouched
(handlers read the snapshot, call the helper, and only `setView` on
ok — the draft's side-effecting `store.update` closures notified
subscribers even on rejection).

Note on rejection reachability: with default knobs the decode
pipeline's totality clamps (αMin, qMax) mean `lookup` cannot actually
hit a terminal — near-collisions surface as clamped-ok. The rejection
surface exists for M10's chart-specific validators.

### `gpu_jobs.ts` — JobLedger (DG2.2, DG2.3)

Tracks in-flight jobs by tile key: duplicate dispatches collapse,
`maxInFlight` bounds concurrency. Two contract points the draft missed:

- **The ledger claims the cache entry at dispatch time** — inserting
  (or lifecycle-transitioning) the tile to `'computing'` BEFORE the GPU
  job starts. This is load-bearing twice: M5's `planFrame` skips
  `'computing'` tiles (otherwise it re-proposes the same tile every
  frame), and M5's `ingestReduction` **drops results for tiles with no
  cache entry** — without the early claim, every completion would land
  on the floor (DG2.2).
- **Cancellation must release the slot and the entry.** WebGPU
  dispatches cannot be aborted, so cancellation is logical — but the
  draft's completion handler returned early on `cancelled`, leaking the
  in-flight map entry (permanently eating a `maxInFlight` slot) and
  leaving the cache entry `'computing'` forever. Landed: the handler
  always deletes the ledger entry and transitions a discarded tile back
  to `'unseen'` so it can recompute later (DG2.3). Failures do the
  same.

`cancelOffscreen(visible)` keeps a job when its tile is visible OR a
**descendant of a visible tile** — split children live one level below
the frontier, and the draft's visible-keys-only check would have
cancelled every child the scheduler just requested (DG2.4).

### `frame_loop.ts` — the per-frame body

`tickOnce()` (public, deterministic — tests drive it directly): bridge
the view, list visible tiles, build the render plan (`self` when
ready/readyRefinable, else nearest cached ancestor with
`subrect(ancestor, tile)`), run `planFrame` with
`maxInFlight: ledger.inflightCount`, dispatch the returned jobs, cancel
offscreen work, render, return `FrameStats`. `start()/stop()` wrap it
in the injected rAF schedule — the draft's `start()` guard
(`if (!this.stopped) return` with `stopped` initialised `false`) made
the first `start()` a no-op; landed uses a `running` flag (DG2.5).

### `app.ts` — the facade

Builds Store + InputHandlers + FrameLoop (defaults: budget 16 jobs,
maxInFlight 4, FTLE/ensemble off). The store subscription owns the
inspector lifecycle's three signals: lock transition fires
`dispatcher.inspect` exactly once with the locked physical IC; unlock
drops the promise; chart-switch preserves the lock so the promise
survives. `inspector()` exposes the current promise (or null) for the
UI's validation panel.

## Run it

```bash
npm test -- --run test/unit/app
npm test -- --run test/integration/app_frame_loop
```

## Acceptance check

```bash
npm test -- --run test/integration/app_frame_loop
```

Six integration assertions pass: 100 steady ticks render every frame,
dispatch each tile at most once, and converge to full cache hits; a pan
re-dispatches only newly exposed tiles; a zoom step deepens the
frontier without duplicate dispatches; a chart switch preserves the
lock; the inspector fires once per lock and clears on unlock; a
cache-key-neutral store write dispatches nothing.

## Notes for the implementer

- **Why a class, not a function.** The loop holds long-lived state (the
  cache, the in-flight ledger, the rAF id) across many invocations. A
  class makes the lifecycle explicit; tests call `tickOnce()`
  deterministically without driving the rAF schedule.
- **The ledger owns the early lifecycle.** Dispatch = claim
  (`'computing'`) → complete = `ingestReduction` (→ `'ready'`) OR
  release (→ `'unseen'`). Nothing else writes those transitions; the
  M5 scheduler only reads them.
- **Cancellation model.** Logical only: the job still runs; its
  reduction is discarded on completion and the tile is released for
  recompute. Eviction reclaims memory separately (and never evicts
  `'computing'` tiles).
- **Tile ranges are edge-inclusive.** `visibleTilesAt` includes the
  tile touched by the viewport's max edge, so a "pan by half a
  viewport" may expose zero new tiles at shallow depths — the
  integration pan test zooms to z = 2 first for real uncovered ground.
- **Frame-budget tuning.** `frameBudget: 16` (tile-jobs/frame, not ms)
  with `maxInFlight: 4` is the starting point; G9's `TierCaps` feeds
  the real per-tier numbers when G8/G12 wire the boot path
  (`ctx.capability.caps`).
- **What G2 does NOT wire yet.** The production `GpuDispatcher` (M3
  dispatch + M5 reduce + G6 decode-mode selection + G7 ensemble
  offsets + M7 render) is G8/G12 territory; G2 ships the seam and
  proves the orchestration against a mock.
