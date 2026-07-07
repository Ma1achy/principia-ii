# G8 — UI shell, CI configuration, performance baselines

> **As-built.** This document was rewritten after the milestone landed
> (living-document discipline). The original draft prescribed a
> `src/perf/` pooling layer and a stub-level dispatcher; measurement and
> the landed G2 architecture made both obsolete — see "What changed and
> why" and ledger entries DG8.1–DG8.8 in
> `docs/build-decisions-ledger.md`.

## Goal

Three bundled deliverables that the v1 hand-off depends on:

1. **UI shell.** Vanilla TS + a small reactive layer (no framework —
   `Store` from G2 is already the reactive primitive). The minimal UI
   that wires every gesture from M8 / G2 to the canvas, plus the piece
   the doc draft hand-waved: a **real `GpuDispatcher`** that runs the
   full M3→M5 pipeline per tile and draws the G2 render plan (self
   tiles *and* stretched ancestors) through a windowed render graph.

2. **CI configuration.** GitHub Actions yaml, Playwright config for the
   WebGPU e2e spec, an "acceptance gate" runner that fails the build
   when any spec §7 check fails.

3. **Performance baselines.** The draft prescribed pooling patches for
   M1/M5/M6/M9. Measurement showed the landed hot paths are already
   ~60× under budget (KDK macro step: **0.75–0.82 µs** vs the 50 µs
   budget — M1 landed flat-tuple monomorphic from the start), so the
   patches were **rejected** and the perf deliverable is **regression
   baselines only** (DG8.4).

After G8: `npm run dev` opens a working slippy-map of the 3-body
manifold; `npm run build:web && npm run preview` produces a production
bundle; GitHub Actions runs unit + integration + golden + acceptance on
every push.

**Exit criterion.**

```bash
npm run dev      # opens localhost; canvas renders the latent slice
npm test -- --run test/integration/perf_baseline
npm test -- --run test/integration/ci_acceptance
npm run test:gpu # Playwright shell spec (headless SwiftShader)
```

The dev shell renders and answers pan/zoom/lock end-to-end, the
perf-baseline test stays under budget (KDK macro step < 50 µs at f64 in
Node; inspector run to t=2 < 250 ms), and the ci-acceptance test runs
all §7 checks in under 30 seconds.

**Deliverable:** `npm run dev` opens a working, interactive slippy-map
of the 3-body manifold you can pan, zoom, and click-to-inspect; CI runs
on every push. Proven on real hardware (Metal): the full e2e spec
passes headed in ~5 s; screenshots in `dev/out/g8_shell{,_full}.png`.

## File tree (as landed)

```
principia/
  src/
    app/
      dispatcher.ts                # real GpuDispatcher: M3→M5 per tile + windowed render
      viewport_nav.ts              # pan/zoom in view-window space (pure)
    ui/
      App.ts                       # mountUI: layout + panel wiring
      Canvas.ts                    # pointer gestures: drag-pan, wheel-zoom, click-lock
      ControlPanel.ts              # chart picker, z-sliders, tilt, zoom, mag, quality
      InspectorPanel.ts            # locked-pixel overlay (M9 inspector results)
      reactive.ts                  # bind/bindInput: store→DOM subscription glue
      styles.css
      index.ts
  dev/
    main.ts                        # boot entry (dev/, not src/ — G1 ?raw convention)
  index.html                       # root entry; loads /dev/main.ts
  playwright.config.ts
  .github/workflows/
    ci.yml                         # unit → integration_no_gpu → golden
    acceptance.yml                 # spec §7 gate + gated SwiftShader smoke
  test/
    gpu/shell.spec.ts              # Playwright e2e: boot/converge/pan/zoom/lock
    integration/
      perf_baseline.test.ts
      ci_acceptance.test.ts
      ui_smoke.test.ts
```

Not in the draft, landed here: `src/app/dispatcher.ts`,
`src/app/viewport_nav.ts`, the `TileWindow` uniform +
`render_graph.wgsl` quad rewrite (`src/gpu/layouts.ts`,
`src/gpu/buffers.ts`, `src/render/pipeline.ts`). In the draft, **not**
landed: `src/perf/*` (rejected by measurement), `LookupDialog.ts` /
`LegendOverlay.ts` / `bindings.ts` (deferred to G12, the full UI
shell). `vite.config.ts` predates G8 (the G17 harness landed it, with
the `@` → `src/` alias) — G8 only added `index.html` at the root.

## 1. Windowed render graph (prerequisite the draft missed)

G2's `RenderPlan` says *where* each tile draws (own footprint, or an
ancestor stretched over a sub-rect). M7's render graph could only paint
one tile over the whole target. G8 adds the missing windowing:

- **`TileWindow` uniform (32 B) at `@group(3) @binding(1)`**:
  `rect: vec4<f32>` — destination rect in y-down normalised screen
  coords; `uv: vec4<f32>` — the source window into the tile's UV square
  (identity `[0,0,1,1]` for self tiles, the `subrect(...)` window for
  ancestor stretching).
- **`render_graph.wgsl`**: `vs_main` emits a 6-vertex quad mapped
  through `rect` (NDC flip inside the shader); `fs_main` samples the
  graph by **interpolated UV** (`sx = floor(uv.x * N)` clamped) instead
  of the old `frag.x / tile_pix` mapping — the shader no longer assumes
  it owns the whole target.
- `RENDER_LAYOUT_DESC` gains binding 1 (VERTEX|FRAGMENT uniform);
  `TILE_WINDOW_SIZE = 32`; `packTileWindow` / `createTileWindowBuffer`
  in `src/gpu/buffers.ts`; `RenderGraph` carries `windowBuffer`;
  `draw(3)` → `draw(6)` everywhere.

Struct discipline: WGSL struct + TS packer + pin test changed in the
same commit (non-negotiable #1).

## 2. The real dispatcher — `src/app/dispatcher.ts`

`makeRealDispatcher(ctx, getTarget, shaders)` implements G2's
`GpuDispatcher` against the real pipelines:

- **Shared staging, retained results.** One set of staging
  `TileBuffers` (N=32, M=8, E_max=16) is reused for every dispatch; the
  post-simulation graph buffer is `copyBufferToBuffer`'d into a
  per-tile **retained** buffer (LRU-capped at 512) that render passes
  bind directly. Retained key =
  `${chartType}|${z0}|${q1}|${q2}|${mag}|${tileKey}`.
- **Serialized dispatch chain.** Tile jobs share staging, so they run
  strictly one-at-a-time: `chain = chain.catch(() => undefined).then(run)`.
  Failures release the slot (G2's ledger contract, DG2.3).
- **G6 wiring**: `shouldLineariseAtDepth(z)` → `buildLinearised` over
  the chart's decode closure → `DECODE_LINEAR` status flag; a kinked
  patch (null) falls back to full decode.
- **G7 wiring**: `view.ensembleCount` → E copies on the dispatch
  z-axis, stratified pattern.
- **Render**: one pass per frame; per-entry window slots (a small pool
  of 32 B uniform buffers + bind groups, all `writeBuffer`s issued
  before the single submit), `setBindGroup(1, retainedGraph)` +
  `setBindGroup(3, windowSlot)` + `draw(6)` per entry. Ancestor
  entries pass `entry.subrect` as the UV window.
- **Inspect** delegates to M9's `runInspector`.

## 3. UI shell — vanilla TS reactive

`Store` (G2) is the source of truth; `src/ui/reactive.ts` provides
`bind` (store → DOM) and `bindInput` (DOM → store, skipping the
focused element so typing isn't clobbered by echo).

- **`ControlPanel.ts`** — chart picker (6 charts), 8 z-sliders + tilt,
  viewport **Zoom in/out** (see below), **Slice ±** (mag zoom via
  `app.input.zoom` — a recompute), quality select, status line.
- **`Canvas.ts`** — drag-pan (pointer capture), wheel-zoom about the
  pointer (2^±0.5 per notch), clean click → lock with screen→world UV
  mapping.
- **`viewport_nav.ts`** — pure pan/zoom on the `(uvCentre,
  uvHalfWidth)` view window. Zoom keeps the world point under the
  focus fixed: `c' = f − (f − c)·k`, clamped to
  `[2⁻²⁸, 0.5]` half-width. **DG8.2:** the draft wired the wheel to
  `mag` (slice magnification = full recompute per notch); landed wheel
  zoom is *viewport* zoom — pure view-window navigation that re-uses
  the cache and quadtree, exactly what a slippy map means. `mag`
  remains available as the explicit Slice ± control.
- **`InspectorPanel.ts`** — locked-pixel overlay; a generation counter
  discards superseded lock results; all fields render defensively
  (`x !== undefined ? … : '—'`).
- **`dev/main.ts`** — boot: `detectCapabilities()` → friendly message
  on unsupported (G9); `initGpu(canvas)`; canvas configured
  `alphaMode: 'opaque'`; `uncapturederror` → `console.error` (GPU
  validation never throws — M7's lesson); view seeded from the
  detected tier; `window.__principia = { app, cap }` for headless
  checks. Lives in `dev/` because `?raw` WGSL imports stay out of
  `src/` (G1 convention) — hence `index.html` loads `/dev/main.ts`.

### Headless realities (baked into the boot + spec)

- **rAF starvation (DG8.6):** headless Chromium throttles rAF to ~zero
  until something presents — but the first present needs a tick.
  `dev/main.ts`'s scheduler races rAF against a 250 ms `setTimeout`
  (fire-once guard), so the loop always makes progress.
- **Presentation glitch (DG8.7):** headless Chromium never composites
  the WebGPU canvas — pixels read back alpha-0 even when rendering is
  valid (the same glitch every dev harness works around by painting to
  a 2D canvas). Even *headed*, `drawImage` from a WebGPU canvas can
  read the cleared current texture rather than the presented frame.
  The shell spec therefore treats in-page pixel probes as
  *best-effort*: they bind only when the 2D copy sees pixels;
  compositor screenshots are the human proof; automated pixel truth is
  pinned offscreen by the M7 render check.
- **CI horizon knobs (DG8.8):** SwiftShader is ~100× slower than
  hardware, and the spec-true horizon (T=80) is a minutes-long first
  paint there. `?thorizon=&n=` URL params shorten the physics horizon
  and sample grid for dev/CI. Production defaults stay spec-true.

## 4. CI configuration

- **`.github/workflows/ci.yml`** — three jobs on push/PR to
  `webgpu-rewrite` (Node 22): `unit` (lint + typecheck +
  `test/unit`), `integration_no_gpu` (the whole `test/integration`
  tree — GPU suites self-skip without an adapter, per M3/G9 guard),
  `golden` (`test/golden`).
- **`.github/workflows/acceptance.yml`** — `spec_section_7`
  (un-gated, push/PR/nightly cron): runs
  `test/integration/ci_acceptance.test.ts`, which executes every
  registered §7 check via `runAllAcceptance()` (≥6 results, all
  passed, < 30 s). `webgpu_swiftshader_smoke` (gated on the
  `needs-gpu` label or the nightly schedule): `npm run test:gpu` +
  `npm run gpu:check` under
  `--enable-unsafe-webgpu --enable-unsafe-swiftshader`.
- **`playwright.config.ts`** — testDir `test/gpu`, 300 s timeout,
  webServer `npx vite dev --port 5197 --strictPort`, Chromium flags
  for headless WebGPU.
- **`test/gpu/shell.spec.ts`** — the e2e proof: boot → converge
  (`lastStats.visible > 0 && cacheHits === visible`) → conditional
  pixel probe → wheel-zoom (uvHalfWidth shrinks; frontier redraws) →
  drag-pan (centre moves) → click-lock (inspector appears with an
  outcome) → unlock (hides) → zero console/page errors → reconverge →
  screenshots. Passes headless (~2.5 min, SwiftShader) and headed
  (~5 s, Metal).

## 5. Performance baselines — `test/integration/perf_baseline.test.ts`

Measurement first (DG8.4): the draft's pooling layer targeted a
never-landed allocation profile. Actual numbers on the landed code:

| Path | Budget | Measured |
|---|---|---|
| KDK macro step (f64, Node) | < 50 µs | **0.75 µs** |
| Inspector DOPRI5 to t=2 | < 250 ms | **13.5 ms** (734 steps) |

The baselines exist to catch *regressions* (a stray per-substep
allocation, a quadratic slip), with deliberately loose budgets (CI
runners vary ~3×). Reported numbers land in the console for
trend-watching. No `src/perf/` module ships; if a future milestone
measures a real hot-path problem, pooling can be reconsidered
against evidence.

## Run it

```bash
npm run dev            # interactive shell (spec-true horizon)
# dev/CI: http://localhost:5173/index.html?thorizon=20&n=16
npm run test:gpu       # Playwright e2e, headless SwiftShader
npx playwright test --headed   # real-GPU run (the true presentation proof)
```

## Acceptance check

```bash
npm test -- --run test/integration/perf_baseline    # 2 passed
npm test -- --run test/integration/ci_acceptance    # 1 passed (all §7)
npm test -- --run test/integration/ui_smoke         # 4 passed
npm run test:gpu                                    # 1 passed
npm test -- --run                                   # full suite green (513 at landing)
```

## Notes for the implementer

- **The render plan needs windowing before the shell can exist.** If
  tiles can only paint full-target, ancestor fallback (the thing that
  keeps the screen from blanking during refinement) is undrawable.
  Build §1 first.
- **One staging set, serialized jobs, retained copies** is the
  simplest dispatcher that is actually correct: no per-tile pipeline
  builds, no readback races, and render never binds a buffer that a
  compute pass is writing.
- **Issue every `writeBuffer` before the render pass encodes.** The
  per-entry window slots exist so a single pass can draw N entries
  with N different windows without dynamic offsets.
- **Wheel = viewport zoom, not mag.** Conflating them turns every
  scroll notch into a full slice recompute and makes the cache
  useless.
- **Trust nothing about headless presentation.** Assert convergence
  via `lastStats`, keep pixel probes conditional, and do the real
  pixel proof headed on hardware (or offscreen via the M7 check).
- A clean click must be distinguished from a drag-end (small movement
  threshold) or every pan locks a pixel.
- Inspector results arrive async; a generation counter is the minimum
  correct way to drop superseded locks.
