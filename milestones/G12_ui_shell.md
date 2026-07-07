# G12 — UI/UX shell (full)

> **As-built.** Rewritten after landing (living-document discipline). The
> draft's `panTransient` store bypass, private-hooks cast, `as any` binds,
> and mag-wired zoom keys were all replaced with cleaner landed designs —
> see ledger entries DG12.1–DG12.5.

## Goal

G8 shipped a *template* UI. G12 promotes it into a real shell while
keeping every contract intact: the `Store` (G2) stays the single source
of truth; G8's `bind`/`bindInput` stay the only DOM glue; and the
**two-stage decoupling** is honoured at the UI layer — palette / CVD /
render-mode changes drive `RenderParams` (M7 group-3 rebind,
render-only) and **never** touch `ViewState`, never invalidate the
cache, and never enter the undo/redo history. Only compute-affecting
edits push a history entry. G9 warnings and G11 user-facing errors are
wired into the shell chrome.

The risky, framework-free parts are the **pure reducers**: the undo/redo
history ring, the declarative keymap → action dispatch, and the preset
apply/save round-trip. Those are what the exit suite pins; DOM mounts are
exercised by a happy-dom smoke layer.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/ui/shell
```

passes with at least **15** green tests (25 landed; +7 in `shell_dom`)
covering: the history reducer (push/undo/redo, ring eviction, redo-fork
truncation, render-only changes never pushing); the keymap reducer
(chord parsing, lookup, rebind, unknown-key fall-through); and the
preset store (save/apply round-trip, render-only/transient exclusion,
built-in immutability).

**Deliverable:** the full interactive shell — preset gallery, keyboard
control, responsive CSS-grid layout, loading/error/warning chrome, and
undo/redo — live via `npm run dev`. Proven on Metal: the e2e spec passes
headed with the render-only controls mounted and the G11 error overlay
surfacing a real tile failure.

## File tree (as landed)

```
src/
  ui/
    history.ts          # NEW: ViewState undo/redo ring (pure reducer)
    keymap.ts           # NEW: declarative keymap → ActionId (pure)
    actions.ts          # NEW: ActionId catalogue + dispatch()
    presets.ts          # NEW: named ViewState presets (pure) + PresetStore
    render_params.ts    # NEW: RenderParamsStore (render-only; NOT in history)
    Keybindings.ts      # NEW: window keydown → keymap → dispatch
    ChartBrowser.ts     # NEW: preset gallery (apply/save)
    LoadingIndicator.ts # NEW: JobLedger in-flight + G10 budget → chrome
    Chrome.ts           # NEW: G9 warning banner + G11 error overlay
    App.ts              # MODIFIED: ShellDeps + the ONE history funnel + gate
    Canvas.ts           # MODIFIED: GestureGate (drag → one history entry)
    ControlPanel.ts     # MODIFIED: + mountRenderControls (colour/palette/CVD)
    reactive.ts         # MODIFIED: bind/bindInput generic over Subscribable<V>
    styles.css          # MODIFIED: .shell grid areas + breakpoints appended
  error/
    boundary.ts         # MODIFIED: + addUserErrorListener() (secondary hooks)
dev/
  main.ts               # MODIFIED: RenderParamsStore + ShellDeps wiring
test/
  unit/ui/
    shell.test.ts       # 25 tests (the exit gate)
    shell_dom.test.ts   # 7 tests (happy-dom: loader label, render store, keys)
```

## The pure reducers

- **`history.ts`** — immutable `{past, present, future, cap}`.
  `isComputeChange(prev, next)` defers to M8's `viewStateToCacheKey`
  (the authority on tile contents) plus lock / tilt / **uvCentre / 
  uvHalfWidth** (the draft omitted uvHalfWidth — a centre-zoom changes
  only the half-width and must still be undoable, DG12.2). `pushHistory`
  replaces the present without pushing on non-compute changes, else
  pushes + evicts beyond cap + clears the redo future (fork).
- **`keymap.ts`** — canonical chord strings (fixed modifier order,
  lowercased), `parseChord`/`eventToChord`/`buildKeymap`/`lookupChord`,
  immutable `rebind` that refuses to shadow without `override`.
  Defaults: Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, `=`/`-` zoom, `l` lock toggle,
  `p` presets, Escape unlock, Shift+? help.
- **`actions.ts`** — closed `ActionId` + one `dispatch(app, id, hooks)`
  funnel. **zoomIn/zoomOut are VIEWPORT zoom** (`zoomViewport`, the
  cache-preserving navigation the wheel and buttons use) — the draft
  wired them to `input.zoom` (mag = slice recompute), DG12.2.
- **`presets.ts`** — `PresetView` captures chart/slice/integration/
  quality fields only; excludes lock state, timestamps, the viewport
  window, and (structurally) all RenderParams. `applyPreset` merges over
  the current view, clears the lock (+`lockedPhysical`), refreshes the
  timestamp. `PresetStore` is immutable; built-ins frozen and
  irreplaceable.

## The two-stage decoupling, structurally

`RenderParamsStore` mirrors the Store contract
(`subscribe`/`update`/`snapshot`) but is a **distinct instance**; its
`onRebind` callback goes straight to the dispatcher's
`setRenderParams(p)` — M7's 64-byte group-3 rebind (packing lives there;
the draft's store-side `packRenderParams` would have packed twice,
DG12.3). `bind`/`bindInput` are now generic over `Subscribable<V>`, so
both stores bind through the same helpers with no casts (DG12.5).

## The one history funnel (and the gesture gate)

History is captured in a single `Store.subscribe` in `mountUI`. A
pointer gesture is bracketed by a `GestureGate` (`begin` at pointerdown,
`end` at pointerup): while suspended, view updates replace the present
without pushing; at `end` the funnel rewinds to the gesture anchor and
pushes the final view once — a long drag lands as ONE undo entry, and a
clean click-lock coalesces the same way. This replaces the draft's
`panTransient` store bypass (DG12.1): no `InputHandlers`/`Store`
semantics change, and the coalescing logic is in the same place as the
funnel it modifies.

## Chrome, gallery, loader

- **`Chrome.ts`** — G9 warnings rendered once (via `textContent`, never
  `innerHTML` — warning strings must not inject markup); G11 errors
  arrive through the new **`ErrorBoundary.addUserErrorListener()`**
  (multi-listener secondary hook, DG12.4 — the draft's cast into the
  private `hooks` field was rejected). Recoverable errors auto-dismiss
  after 5 s; fatal ones pin.
- **`ChartBrowser.ts`** — gallery over `PresetStore.all()`; apply = one
  `setView` (one history entry); save = user preset (`user_<ts>`).
- **`LoadingIndicator.ts`** — pure `progressLabel(inflight, over)` +
  an rAF-polled mount reading `app.loop.ledger.inflightCount` and
  `app.loop.perf` (G10) for the "(reducing quality)" hint.
- **`mountUI(root, app, canvas, deps?)`** — `ShellDeps` all optional
  (`boundary`, `capability`, `renderStore`, `presets`), so the G8-era
  3-arg call keeps working in tests and minimal embeds; ledger and perf
  are read off `app.loop` rather than injected (DG12.3). The wrapper
  carries both `.shell` and `.layout` classes (new grid + legacy rules).

## Run it

```bash
npm test -- --run test/unit/ui/shell       # 25 passed (exit gate)
npm test -- --run test/unit/ui/shell_dom   # 7 passed (happy-dom)
npm run dev                                # presets (p), keys, undo/redo, chrome
```

## Acceptance check

Landed: shell gate 25 ≥ 15; full suite 605 passed / 8 skipped; typecheck
+ lint clean; `gpu:check` + all four page checks green; e2e shell spec
green headless (~2.2 min SwiftShader) and headed on Metal (~6 s) with
the full shell mounted. In the running shell: a palette / render-mode /
CVD change rebinds M7 group 3 only — it cannot be undone with Ctrl+Z; a
`mag`/`chartType`/tilt/viewport change can.

## Notes for the implementer

- **One history funnel.** `pushHistory` is called from exactly one
  subscribe callback (plus the gate's end-of-gesture rewind). Never
  route render-only changes through the view `Store`.
- **`isComputeChange` defers to the cache key** and only adds
  lock/tilt/viewport on top. When M8/M10 extend the key, the reducer
  inherits it for free.
- **The keymap is data.** Persist user bindings as entries and rebuild
  with `buildKeymap(entries)`; the DOM listener holds no bindings.
- **Presets are charts, not looks or camera positions.** RenderParams
  travel with the session; the viewport window with the user.
- **Wheel-zoom flurries** push one history entry per notch (each is a
  real view change). If that ever feels noisy, bracket wheel bursts
  with the same `GestureGate` on a debounce timer.
- **Warning/error strings render as text nodes.** Keep it that way.
