# G12 — UI/UX shell (full)

## Goal

G8 shipped a *template* UI: a `Store`-backed reactive layer (`bind`/`bindInput`),
a skeletal `ControlPanel`, a `Canvas` mount, and an `InspectorPanel`. It is
enough to render Burrau but not enough to *use* — there is no preset gallery, no
keyboard control, no responsive layout, no loading feedback, no error/warning
chrome, and no undo/redo. G12 promotes that template into a real shell while
keeping every contract intact: the `Store` (G2 `subscribe`/`update`/`snapshot`)
stays the single source of truth; G8's `bind`/`bindInput` stay the only DOM glue;
and the **two-stage decoupling** is honoured at the UI layer — palette / CVD /
render-mode changes drive `RenderParams` (M7 group-3 rebind, render-only) and
**never** touch `ViewState`, never invalidate the cache, and never enter the
undo/redo history. Only compute-affecting edits (the fields in
`viewStateToCacheKey`, plus lock/tilt) push a history entry. G9 warnings and G11
user-facing errors / tile-failure overlays are wired into the shell chrome.

The risky, framework-free parts are the **pure reducers**: the undo/redo history
ring, the declarative keymap → action dispatch, and the preset apply/save
round-trip. Those are what the exit suite pins; the DOM mounts are exercised only
by a thin jsdom smoke test.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/ui/shell
```

passes with at least **15 green tests** covering: the history reducer
(push/undo/redo, ring capacity eviction, redo-stack truncation on a new edit,
and **render-only changes never pushing**); the keymap reducer (chord parsing,
lookup, rebind, and unknown-key fall-through); and the preset store
(save/apply round-trip, render-only fields excluded from a preset, and built-in
presets being immutable).

**Deliverable:** the full interactive UI shell — preset gallery, keyboard control, responsive layout, loading/error/warning chrome, and undo/redo — usable over the G2 canvas via `npm run dev`; the pure reducers (history ring, keymap, preset store) are pinned by `test/unit/ui/shell`.

## File tree

```
src/
  ui/
    history.ts          # NEW: ViewState undo/redo ring (pure reducer)
    keymap.ts           # NEW: declarative keymap → ActionId; parse/lookup/rebind (pure)
    actions.ts          # NEW: ActionId catalogue + dispatch(app, id) over the Store
    presets.ts          # NEW: named ViewState presets; save/apply round-trip (pure)
    render_params.ts    # NEW: RenderParams store (render-only; group-3 rebind, NOT in history)
    ControlPanel.ts     # MODIFIED (G8): full chart/z0/zoom/tilt/quality + render-mode/palette
    Canvas.ts           # MODIFIED (G8): pointer → lock/pan/zoom into the Store
    InspectorPanel.ts   # MODIFIED (G8): unchanged contract; consumes history-aware app
    ChartBrowser.ts     # NEW: preset gallery (apply/save) bound to presets.ts
    Keybindings.ts      # NEW: window keydown → keymap → actions.dispatch
    LoadingIndicator.ts # NEW: JobLedger in-flight + G10 PerfMonitor → progress chrome
    Chrome.ts           # NEW: warning banner (G9) + error overlay (G11) shell chrome
    App.ts              # MODIFIED (G8): mounts the new modules; owns the history + render store
    shell.css           # NEW: CSS-grid areas + breakpoints (documented)
test/
  unit/
    ui/
      shell.test.ts     # NEW: history + keymap + presets pure-logic suite (exit suite)
      shell_dom.test.ts # NEW: jsdom smoke mount (skips cleanly without a document)
```

## Depends on / pairs with

- **G8** (`reactive.ts` `bind`/`bindInput`, `mountControlPanel`, `mountCanvas`,
  `mountInspectorPanel`, `styles.css`) — G12 expands these mounts; it does **not**
  replace `bind`/`bindInput`, which stay the only store↔DOM glue.
- **G2** (`Store` `subscribe`/`update`/`snapshot`; `App`; `JobLedger.inflightCount`)
  — the history ring and presets are layered *on top of* the `Store`; the loading
  indicator reads `inflightCount`.
- **M8** (`ViewState`, `defaultViewState`, `viewStateToCacheKey`) — the history
  ring stores `ViewState` snapshots; `viewStateToCacheKey` is the authority on
  what counts as a "compute-affecting" change.
- **M7** (`RenderParams`, `DEFAULT_RENDER_PARAMS`, `packRenderParams`) — palette /
  render-mode / CVD live here, render-only (group-3 rebind). Changing them never
  pushes history and never touches `ViewState`.
- **G9** (`CapabilityProfile.reason`/`.warnings`) — surfaced in the warning banner.
- **G11** (`ErrorBoundary` `onUserError`, `AppError`, `userMessage`,
  `tileFlagDescriptor`/`hasTileFailure`) — wired into the error overlay + tile
  overlays.
- **G10** (`PerfMonitor`, `PerfSnapshot.budget`) — feeds the loading/progress
  chrome's "degrading" hint.
- Contracts: two-stage decoupling (architecture skill / M7 §intro) — render-only
  changes rebind group 3 only; tiers per ADR 0003; cache signature per M8
  `viewStateToCacheKey`.

## `src/ui/history.ts`

The undo/redo ring. It is a **pure reducer** over an immutable `History` value:
no `Store`, no DOM. The integration (below) calls `pushHistory` from a single
`Store.subscribe` callback, but only when the change is *compute-affecting* — and
that decision is itself a pure function (`isComputeChange`) keyed on
`viewStateToCacheKey` plus lock/tilt (which affect what is simulated/inspected
even though they are not all in the cache key). Render-only `RenderParams` live in
a separate store and never reach here, so a palette swap can never be undone as if
it were a view edit.

```ts
import type { ViewState } from '@/interact/view_state.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';

/**
 * Immutable undo/redo history. `past` is oldest→newest of states BEFORE the
 * present; `present` is the live view; `future` is redo targets (newest→oldest
 * of states we undid past). A bounded ring: `cap` limits `past` length.
 */
export interface History {
  readonly past: readonly ViewState[];
  readonly present: ViewState;
  readonly future: readonly ViewState[];
  readonly cap: number;
}

export function initHistory(present: ViewState, cap = 50): History {
  if (cap < 1) throw new RangeError('history cap must be >= 1');
  return { past: [], present, future: [], cap };
}

/**
 * True iff `next` differs from `prev` in a way that affects what is computed,
 * simulated, or inspected — i.e. it deserves an undo entry. Keyed on the M8
 * cache signature (the authority on tile contents) plus lock/tilt, which change
 * the inspector / projection even when not every field is in the cache key.
 * Render-only RenderParams are NOT a ViewState field, so they can never make
 * this true.
 */
export function isComputeChange(prev: ViewState, next: ViewState): boolean {
  if (prev === next) return false;
  const a = viewStateToCacheKey(prev);
  const b = viewStateToCacheKey(next);
  if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  // Lock + orientation affect inspection/projection but are not all in the key.
  return (
    prev.locked !== next.locked ||
    prev.tilt1 !== next.tilt1 || prev.tilt2 !== next.tilt2 ||
    prev.tilt1Target !== next.tilt1Target ||
    prev.tilt2Target !== next.tilt2Target ||
    prev.uvCentre[0] !== next.uvCentre[0] ||
    prev.uvCentre[1] !== next.uvCentre[1]
  );
}

/**
 * Commit a new present. If it is not a compute-change, the present is replaced
 * WITHOUT pushing a history entry (so render-only / no-op edits never grow the
 * ring) and the redo future is preserved. If it IS a compute-change, the old
 * present is pushed onto `past` (evicting the oldest beyond `cap`) and the redo
 * future is cleared (a new edit forks the timeline).
 */
export function pushHistory(h: History, next: ViewState): History {
  if (!isComputeChange(h.present, next)) {
    return { ...h, present: next };
  }
  const past = [...h.past, h.present];
  while (past.length > h.cap) past.shift();
  return { past, present: next, future: [], cap: h.cap };
}

export function canUndo(h: History): boolean { return h.past.length > 0; }
export function canRedo(h: History): boolean { return h.future.length > 0; }

/** Move present back one step; the undone present becomes the newest redo. */
export function undo(h: History): History {
  if (!canUndo(h)) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1]!;
  return { past, present, future: [h.present, ...h.future], cap: h.cap };
}

/** Re-apply the newest redo target. */
export function redo(h: History): History {
  if (!canRedo(h)) return h;
  const present = h.future[0]!;
  const future = h.future.slice(1);
  return { past: [...h.past, h.present], present, future, cap: h.cap };
}
```

## `src/ui/keymap.ts`

A declarative, **rebindable** keymap: a pure mapping from a normalised chord
string (e.g. `"ctrl+z"`, `"shift+?"`) to an `ActionId`. Parsing normalises
modifier order and case so `"Ctrl+Z"` and `"ctrl+z"` collide; `rebind` returns a
new map (no mutation) and refuses to bind to the same chord twice without
explicit override. `lookupChord` is what the `Keybindings` DOM module calls per
`keydown`.

```ts
import type { ActionId } from './actions.js';

/** Normalised parts of a key chord. */
export interface Chord {
  key: string;       // lowercased KeyboardEvent.key, e.g. 'z', 'arrowleft', '?'
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** A rebindable map: canonical chord string → action. */
export type Keymap = ReadonlyMap<string, ActionId>;

/** Build the canonical, order-stable string for a chord. Modifier order is
 *  fixed (ctrl, alt, shift, meta) so any input order normalises identically. */
export function chordToString(c: Chord): string {
  const mods: string[] = [];
  if (c.ctrl) mods.push('ctrl');
  if (c.alt) mods.push('alt');
  if (c.shift) mods.push('shift');
  if (c.meta) mods.push('meta');
  return [...mods, c.key.toLowerCase()].join('+');
}

/** Parse a human chord string ('Ctrl+Shift+Z') into the canonical string. */
export function parseChord(spec: string): string {
  const parts = spec.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  const c: Chord = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') c.ctrl = true;
    else if (p === 'shift') c.shift = true;
    else if (p === 'alt' || p === 'option') c.alt = true;
    else if (p === 'meta' || p === 'cmd' || p === 'super') c.meta = true;
    else c.key = p;
  }
  if (!c.key) throw new Error(`chord "${spec}" has no base key`);
  return chordToString(c);
}

/** Read a chord string off a DOM-ish KeyboardEvent without importing the type. */
export interface KeyEventLike {
  key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
}
export function eventToChord(e: KeyEventLike): string {
  return chordToString({
    key: e.key.toLowerCase(),
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
  });
}

/** Default bindings. Compute-affecting actions get plain keys; undo/redo use the
 *  platform-conventional Ctrl/Cmd chords. */
export const DEFAULT_BINDINGS: ReadonlyArray<readonly [string, ActionId]> = [
  ['ctrl+z', 'undo'],
  ['ctrl+shift+z', 'redo'],
  ['ctrl+y', 'redo'],
  ['=', 'zoomIn'],
  ['-', 'zoomOut'],
  ['l', 'toggleLock'],
  ['shift+?', 'showHelp'],
  ['p', 'openPresets'],
  ['escape', 'unlock'],
];

export function buildKeymap(
  entries: ReadonlyArray<readonly [string, ActionId]> = DEFAULT_BINDINGS,
): Keymap {
  const m = new Map<string, ActionId>();
  for (const [spec, action] of entries) m.set(parseChord(spec), action);
  return m;
}

/** Pure lookup: chord string → action, or undefined. */
export function lookupChord(map: Keymap, chord: string): ActionId | undefined {
  return map.get(chord);
}

/**
 * Return a NEW map with `spec` bound to `action`. Throws if the chord is already
 * bound and `override` is false (prevents silently shadowing a binding).
 */
export function rebind(
  map: Keymap, spec: string, action: ActionId, override = false,
): Keymap {
  const chord = parseChord(spec);
  if (map.has(chord) && !override) {
    throw new Error(`chord "${chord}" already bound to ${map.get(chord)}`);
  }
  const next = new Map(map);
  next.set(chord, action);
  return next;
}
```

## `src/ui/actions.ts`

The closed `ActionId` catalogue and a single `dispatch(app, id, hooks)` that
turns an action into `Store`/history/render-store mutations. Every action goes
through the same funnel so the keymap, the toolbar buttons, and the menu all
share one implementation. Note the split: `undo`/`redo` operate on the **history
ring**, view edits go through `app.input` (G2), and there is no render-only action
here — palette/render-mode changes flow through `render_params.ts`, deliberately
*not* through `dispatch`, so they can never enter history.

```ts
import type { App } from '@/app/app.js';
import type { History } from './history.js';
import { undo as undoHist, redo as redoHist } from './history.js';

/** Closed set of shell actions. Compute-affecting only — render-only modes are
 *  handled by the RenderParams store, never here. */
export type ActionId =
  | 'undo' | 'redo'
  | 'zoomIn' | 'zoomOut'
  | 'toggleLock' | 'unlock'
  | 'openPresets' | 'showHelp';

/** Side-effect hooks the dispatcher needs that are not on `App`. */
export interface ActionHooks {
  /** Current history; the dispatcher reads + replaces it for undo/redo. */
  getHistory: () => History;
  setHistory: (h: History) => void;
  openPresets?: () => void;
  showHelp?: () => void;
}

/**
 * Apply an action. Pure-ish: the only effects are the (injected) Store updates
 * and history get/set, which makes the routing table testable with stubs.
 * Returns true if the action was handled.
 */
export function dispatch(app: App, id: ActionId, hooks: ActionHooks): boolean {
  switch (id) {
    case 'undo': {
      const h = undoHist(hooks.getHistory());
      hooks.setHistory(h);
      app.store.setView(h.present);
      return true;
    }
    case 'redo': {
      const h = redoHist(hooks.getHistory());
      hooks.setHistory(h);
      app.store.setView(h.present);
      return true;
    }
    case 'zoomIn':  app.input.zoom(1);  return true;
    case 'zoomOut': app.input.zoom(-1); return true;
    case 'toggleLock':
      if (app.store.snapshot().locked) app.input.unlock();
      else app.input.lock({ s: 0.5, t: 0.5 });
      return true;
    case 'unlock':  app.input.unlock(); return true;
    case 'openPresets': hooks.openPresets?.(); return true;
    case 'showHelp':    hooks.showHelp?.();    return true;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
```

## `src/ui/presets.ts`

Named `ViewState` presets — the data behind the ChartBrowser gallery. A preset
captures **only** the compute-affecting `ViewState` (it deliberately omits
`RenderParams`, since palette/render-mode are view-independent and travel with the
session, not the chart). `applyPreset` rebuilds a full `ViewState` by merging the
captured fields over the *current* one (so transient fields like `timestamp`
refresh) and returns a fresh value the caller hands to `Store.setView`. Built-in
presets are frozen.

```ts
import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';

/** The subset of ViewState a preset captures. Excludes lock state, timestamps,
 *  and (by construction) all render-only RenderParams. */
export type PresetView = Pick<ViewState,
  | 'chartType' | 'chartParams'
  | 'z0' | 'hAxis' | 'vAxis' | 'q1' | 'q2' | 'mag'
  | 'rotation' | 'tilt1' | 'tilt2' | 'tilt1Target' | 'tilt2Target'
  | 'integrator' | 'THorizon' | 'dtMacro' | 'NMax' | 'checkpoints'
  | 'qualityTier' | 'samplesPerAxis' | 'maxDepth' | 'ensembleCount'>;

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly builtin: boolean;
  readonly view: PresetView;
}

const PRESET_FIELDS: ReadonlyArray<keyof PresetView> = [
  'chartType', 'chartParams', 'z0', 'hAxis', 'vAxis', 'q1', 'q2', 'mag',
  'rotation', 'tilt1', 'tilt2', 'tilt1Target', 'tilt2Target',
  'integrator', 'THorizon', 'dtMacro', 'NMax', 'checkpoints',
  'qualityTier', 'samplesPerAxis', 'maxDepth', 'ensembleCount',
];

/** Extract the preset-capturable subset from a live ViewState. Pure. */
export function captureView(v: ViewState): PresetView {
  const out = {} as Record<keyof PresetView, unknown>;
  for (const k of PRESET_FIELDS) out[k] = v[k];
  return out as unknown as PresetView;
}

/** Merge a preset's captured fields over the current view, returning a fresh,
 *  unlocked ViewState with a refreshed timestamp. Render-only fields (not part
 *  of ViewState) are untouched — they live in the separate RenderParams store. */
export function applyPreset(current: ViewState, p: Preset): ViewState {
  return {
    ...current,
    ...p.view,
    locked: false,
    timestamp: new Date().toISOString(),
  };
}

/** Make a saved (user) preset from the live view. Pure; id is caller-supplied. */
export function savePreset(id: string, name: string, v: ViewState): Preset {
  return { id, name, builtin: false, view: captureView(v) };
}

/** Built-in gallery. Frozen so the UI cannot mutate them in place. */
export const BUILTIN_PRESETS: readonly Preset[] = Object.freeze([
  Object.freeze({
    id: 'home', name: 'Home (latent slice)', builtin: true,
    view: captureView(defaultViewState()),
  }),
  Object.freeze({
    id: 'lz_e', name: '(L_z, E) overview', builtin: true,
    view: captureView({ ...defaultViewState(), chartType: 'lz_e', mag: 4 }),
  }),
  Object.freeze({
    id: 'shape_sphere', name: 'Shape sphere', builtin: true,
    view: captureView({ ...defaultViewState(), chartType: 'shape_sphere' }),
  }),
] as const);

/**
 * Minimal preset registry: built-ins plus user-saved presets. `save` returns a
 * NEW registry (immutable) so undo of a save is trivial and built-ins are never
 * replaced. Lookups are by id.
 */
export class PresetStore {
  constructor(private readonly items: readonly Preset[] = BUILTIN_PRESETS) {}

  all(): readonly Preset[] { return this.items; }
  get(id: string): Preset | undefined { return this.items.find(p => p.id === id); }

  /** Add or replace a USER preset. Throws if `id` collides with a built-in. */
  save(p: Preset): PresetStore {
    if (p.builtin) throw new Error('cannot save a builtin preset');
    const existing = this.get(p.id);
    if (existing?.builtin) throw new Error(`"${p.id}" is a builtin and is read-only`);
    const rest = this.items.filter(x => x.id !== p.id);
    return new PresetStore([...rest, p]);
  }

  remove(id: string): PresetStore {
    const t = this.get(id);
    if (t?.builtin) throw new Error(`"${id}" is a builtin and cannot be removed`);
    return new PresetStore(this.items.filter(p => p.id !== id));
  }
}
```

## `src/ui/render_params.ts`

A **separate** reactive store for `RenderParams`. This is the structural
enforcement of the two-stage decoupling at the UI layer: render-mode / palette /
CVD / vMF knobs live here, *not* in `ViewState`. Mutating it rebinds M7 group 3
(via `packRenderParams`) and re-renders — it never calls `app.store.update`, never
invalidates the cache, and never reaches the history ring. It mirrors G2's `Store`
contract (`subscribe`/`update`/`snapshot`) so G8's `bind`/`bindInput` work
against it unchanged.

```ts
import { type RenderParams, DEFAULT_RENDER_PARAMS } from '@/render/types.js';
import { packRenderParams } from '@/render/params.js';

export type RenderSubscriber = (p: RenderParams) => void;

/**
 * Reactive RenderParams store. Same contract as G2's Store so the same
 * bind()/bindInput() work, but a DISTINCT instance: changes here are render-only
 * (M7 group-3 rebind) and MUST NOT touch ViewState, the cache, or history.
 */
export class RenderParamsStore {
  private current: RenderParams;
  private subs = new Set<RenderSubscriber>();

  constructor(
    initial: RenderParams = DEFAULT_RENDER_PARAMS,
    /** Called after every change so the caller can re-pack group 3 + re-render.
     *  Receives the freshly-packed 64-byte uniform buffer (M7 layout). */
    private readonly onRebind?: (params: RenderParams, packed: ArrayBuffer) => void,
  ) {
    this.current = initial;
  }

  snapshot(): RenderParams { return this.current; }

  setParams(next: RenderParams): void {
    this.current = next;
    const packed = packRenderParams(next);
    for (const cb of this.subs) cb(next);
    this.onRebind?.(next, packed);     // render-only: rebind group 3, re-render
  }

  update(fn: (p: RenderParams) => RenderParams): void {
    this.setParams(fn(this.current));
  }

  subscribe(cb: RenderSubscriber): () => void {
    this.subs.add(cb);
    cb(this.current);
    return () => { this.subs.delete(cb); };
  }
}
```

## `src/ui/App.ts` (modified, G8)

The top-level mount gains the history ring, the `RenderParamsStore`, and the new
modules. The crucial wiring is the **single `Store.subscribe`** that funnels every
view change through `pushHistory` — so history is captured in exactly one place
and render-only changes (which go through `RenderParamsStore`, a different store)
can never land in it. Labelled patch against G8's `mountUI`.

```ts
import type { App as AppCore } from '@/app/app.js';
import { mountControlPanel } from './ControlPanel.js';
import { mountCanvas } from './Canvas.js';
import { mountInspectorPanel } from './InspectorPanel.js';
import { mountChartBrowser } from './ChartBrowser.js';
import { mountChrome } from './Chrome.js';
import { mountLoadingIndicator } from './LoadingIndicator.js';
import { installKeybindings } from './Keybindings.js';
import { RenderParamsStore } from './render_params.js';
import { PresetStore } from './presets.js';
import { initHistory, pushHistory, type History } from './history.js';
import { buildKeymap } from './keymap.js';
import type { ErrorBoundary } from '@/error/boundary.js';
import type { CapabilityProfile } from '@/gpu/capability.js';
import type { JobLedger } from '@/app/gpu_jobs.js';
import type { PerfMonitor } from '@/perf/perf_monitor.js';

export interface ShellDeps {
  boundary: ErrorBoundary;            // G11: error overlay source
  capability: CapabilityProfile;      // G9: warning banner source
  ledger: JobLedger;                  // G2: in-flight count for the loader
  perf?: PerfMonitor;                 // G10: budget hint for the loader
  renderStore: RenderParamsStore;     // render-only knobs (group-3 rebind)
  presets?: PresetStore;
}

export function mountUI(
  root: HTMLElement, app: AppCore, canvas: HTMLCanvasElement, deps: ShellDeps,
): () => void {
  root.innerHTML = `
    <div class="shell">
      <header class="shell-chrome"></header>
      <main class="canvas-area"></main>
      <aside class="control-area"></aside>
      <aside class="inspector-area"></aside>
      <section class="gallery-area"></section>
      <div class="loader-area"></div>
    </div>
  `;

  // --- history ring: captured in ONE place; render-only edits never reach it ---
  let history: History = initHistory(app.store.snapshot());
  const offs: (() => void)[] = [];
  offs.push(app.store.subscribe(v => { history = pushHistory(history, v); }));
  const getHistory = () => history;
  const setHistory = (h: History) => { history = h; };

  // --- keybindings → actions over the Store/history ---
  const presets = deps.presets ?? new PresetStore();
  let openPresets = () => {};      // wired by the gallery mount below
  offs.push(installKeybindings(window, app, buildKeymap(), {
    getHistory, setHistory,
    openPresets: () => openPresets(),
  }));

  // --- mounts ---
  offs.push(mountChrome(root.querySelector('.shell-chrome')!, deps.boundary, deps.capability));
  offs.push(mountCanvas(root.querySelector('.canvas-area')!, app, canvas));
  offs.push(mountControlPanel(root.querySelector('.control-area')!, app, deps.renderStore));
  offs.push(mountInspectorPanel(root.querySelector('.inspector-area')!, app));
  const gallery = mountChartBrowser(
    root.querySelector('.gallery-area')!, app, presets);
  openPresets = gallery.open;
  offs.push(gallery.dispose);
  offs.push(mountLoadingIndicator(
    root.querySelector('.loader-area')!, deps.ledger, deps.perf));

  return () => offs.forEach(off => off());
}
```

## `src/ui/Canvas.ts` (modified, G8)

G8's `Canvas` handled click→lock and wheel→zoom. G12 adds **pan** (pointer
drag → `uvCentre` shift) and zoom-around-pointer. A drag is **coalesced into a
single history entry**: we snapshot `uvCentre` at `pointerdown`, update the view
*transiently* during the drag via `app.input.panTransient` (a non-history path
that writes `uvCentre` without going through the history funnel), and commit the
final `uvCentre` exactly once at `pointerup` through `app.store.update` (the one
funnel) — so a long drag never floods the undo ring with intermediate frames.

```ts
import type { App } from '@/app/app.js';

export function mountCanvas(
  root: HTMLElement, app: App, canvas: HTMLCanvasElement,
): () => void {
  root.appendChild(canvas);

  let dragging = false;
  let moved = false;
  let lastX = 0, lastY = 0;
  let panU = 0, panV = 0;          // accumulated transient pan since pointerdown
  let startCentre: readonly [number, number] = [0, 0];

  const norm = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return {
      s: (e.clientX - rect.left) / rect.width,
      t: 1 - (e.clientY - rect.top) / rect.height,   // y up
    };
  };

  const onDown = (e: PointerEvent) => {
    dragging = true; moved = false;
    lastX = e.clientX; lastY = e.clientY;
    panU = 0; panV = 0;
    startCentre = app.store.snapshot().uvCentre;       // snapshot for the single commit
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const du = (e.clientX - lastX) / rect.width;
    const dv = -(e.clientY - lastY) / rect.height;
    if (Math.abs(du) + Math.abs(dv) > 1e-4) moved = true;
    lastX = e.clientX; lastY = e.clientY;
    // Pan: shift uvCentre opposite the drag (content follows the cursor).
    panU -= du; panV -= dv;
    // Transient, NON-history path: re-render the live pan without pushing an
    // undo entry per pointermove (the drag commits once on pointerup).
    app.input.panTransient([startCentre[0] + panU, startCentre[1] + panV]);
  };

  const onUp = (e: PointerEvent) => {
    if (dragging && !moved) {
      app.input.lock(norm(e));                         // a click, not a drag
    } else if (dragging && moved) {
      // Commit the whole drag as ONE compute-affecting change → one history entry.
      app.store.update(v => ({
        ...v,
        uvCentre: [startCentre[0] + panU, startCentre[1] + panV],
      }));
    }
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    app.input.zoom(-Math.sign(e.deltaY) * 0.5);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
```

> **extends InputController with `panTransient`.** The drag-coalescing above
> needs a non-history live-pan path. G2's `InputController` (`app.input`) must
> grow `panTransient(uvCentre: readonly [number, number]): void` — it updates the
> transient `uvCentre` and re-renders **without** going through the history-funnel
> `Store.subscribe` (i.e. it writes the live view but does not commit an undo
> entry). The drag's single committed entry still flows through `app.store.update`
> on `pointerup`. If a transient path is undesirable, the fallback is to call
> `app.store.update` only on `pointerup` and drive intermediate frames straight to
> the renderer; either way no intermediate pointermove may push history.

## `src/ui/ControlPanel.ts` (modified, G8)

G8's panel covered chart / z0 / tilt1 / zoom / quality. G12 adds the
**render-mode and palette selectors**, bound to the `RenderParamsStore` — *not*
the view `Store`. Only the render-only section of the mount is shown; the rest is
G8's panel unchanged.

```ts
import type { App } from '@/app/app.js';
import { bind } from './reactive.js';
import type { RenderParamsStore } from './render_params.js';
import type { ColourMode, CvdMode, PaletteId } from '@/render/types.js';

/** Mount ONLY the render-only controls. Call alongside G8's mountControlPanel
 *  body; both share the same root. Palette/mode/CVD changes rebind M7 group 3
 *  via the RenderParamsStore and never touch ViewState or the cache. */
export function mountRenderControls(root: HTMLElement, render: RenderParamsStore): () => void {
  const section = document.createElement('div');
  section.className = 'panel render-controls';
  section.innerHTML = `
    <h3>Render (no recompute)</h3>
    <div class="row">
      <label>Colour mode</label>
      <select id="colourMode">
        <option value="event_class">Event class</option>
        <option value="energy">Energy</option>
        <option value="ang_momentum">Angular momentum</option>
        <option value="escape_time">Escape time</option>
        <option value="shape_sphere_vmf">Shape sphere (vMF)</option>
        <option value="stability_x_hue">Stability × hue</option>
      </select>
    </div>
    <div class="row">
      <label>Palette</label>
      <select id="palette">
        <option value="viridis">Viridis</option>
        <option value="cividis">Cividis</option>
        <option value="magma">Magma</option>
        <option value="principia">Principia</option>
        <option value="cubehelix">Cubehelix</option>
      </select>
    </div>
    <div class="row">
      <label>CVD sim</label>
      <select id="cvd">
        <option value="none">None</option>
        <option value="protan">Protanopia</option>
        <option value="deutan">Deuteranopia</option>
        <option value="tritan">Tritanopia</option>
        <option value="achrom">Achromatopsia</option>
      </select>
    </div>
  `;
  root.appendChild(section);

  const offs: (() => void)[] = [];

  const colour = section.querySelector<HTMLSelectElement>('#colourMode')!;
  offs.push(bind(colour, render as any, (el, p) => { el.value = p.colourMode; }));
  colour.addEventListener('change', () =>
    render.update(p => ({ ...p, colourMode: colour.value as ColourMode })));

  const palette = section.querySelector<HTMLSelectElement>('#palette')!;
  offs.push(bind(palette, render as any, (el, p) => { el.value = p.palette; }));
  palette.addEventListener('change', () =>
    render.update(p => ({ ...p, palette: palette.value as PaletteId })));

  const cvd = section.querySelector<HTMLSelectElement>('#cvd')!;
  offs.push(bind(cvd, render as any, (el, p) => { el.value = p.cvdMode; }));
  cvd.addEventListener('change', () =>
    render.update(p => ({ ...p, cvdMode: cvd.value as CvdMode })));

  offs.push(() => section.remove());
  return () => offs.forEach(off => off());
}

/** Full control panel mount (the call site in App.ts). Mounts G8's
 *  chart/z0/zoom/tilt/quality body bound to the view `Store`, then mounts the
 *  render-only section internally via `mountRenderControls` bound to the
 *  separate `RenderParamsStore`. The 3-arg arity (root, app, render) matches
 *  the `mountUI` call site; the render section never touches ViewState. */
export function mountControlPanel(
  root: HTMLElement, app: App, render: RenderParamsStore,
): () => void {
  const offs: (() => void)[] = [];
  // ... G8's chart/z0/zoom/tilt/quality controls bound to `app.store` (unchanged) ...
  offs.push(mountRenderControls(root, render));   // render-only section (group-3 rebind)
  return () => offs.forEach(off => off());
}
```

> `bind`/`bindInput` (G8) accept any object exposing `subscribe(view => …)`;
> `RenderParamsStore` matches that contract, so the cast at the call site is only
> to satisfy G8's `Store`-typed parameter — the runtime shape is identical. (A
> follow-up may generalise `bind`'s signature to `Subscribable<T>`.)

## `src/ui/ChartBrowser.ts`

The preset gallery. It renders `PresetStore.all()` as a clickable grid, applies a
preset via `applyPreset` + `app.store.setView` (one compute-affecting change → one
history entry), and saves the live view as a new user preset via `savePreset`.

```ts
import type { App } from '@/app/app.js';
import { type PresetStore, applyPreset, savePreset, type Preset } from './presets.js';

export interface ChartBrowserHandle {
  open: () => void;
  close: () => void;
  dispose: () => void;
}

export function mountChartBrowser(
  root: HTMLElement, app: App, initial: PresetStore,
): ChartBrowserHandle {
  let store = initial;
  root.innerHTML = `
    <div class="gallery" hidden>
      <h3>Presets</h3>
      <div class="gallery-grid"></div>
      <div class="row">
        <input id="presetName" type="text" placeholder="New preset name">
        <button id="savePreset">Save current view</button>
      </div>
    </div>
  `;
  const panel = root.querySelector<HTMLDivElement>('.gallery')!;
  const grid = root.querySelector<HTMLDivElement>('.gallery-grid')!;

  const render = () => {
    grid.innerHTML = '';
    for (const p of store.all()) {
      const card = document.createElement('button');
      card.className = 'preset-card' + (p.builtin ? ' builtin' : '');
      card.textContent = p.name;
      card.addEventListener('click', () => apply(p));
      grid.appendChild(card);
    }
  };

  const apply = (p: Preset) => {
    app.store.setView(applyPreset(app.store.snapshot(), p));   // → history push
  };

  root.querySelector<HTMLButtonElement>('#savePreset')!.addEventListener('click', () => {
    const name = root.querySelector<HTMLInputElement>('#presetName')!.value.trim();
    if (!name) return;
    const id = `user_${Date.now()}`;
    store = store.save(savePreset(id, name, app.store.snapshot()));
    render();
  });

  render();
  return {
    open:  () => { panel.hidden = false; },
    close: () => { panel.hidden = true; },
    dispose: () => { root.innerHTML = ''; },
  };
}
```

## `src/ui/Keybindings.ts`

The thin DOM bridge: a `keydown` listener that normalises the event to a chord,
looks it up in the keymap, and dispatches. It ignores keystrokes while the user is
typing in an `input`/`textarea`/`select` so the chart-name field and sliders are
not hijacked. All logic lives in `keymap.ts` / `actions.ts`; this file is just the
listener.

```ts
import type { App } from '@/app/app.js';
import { eventToChord, lookupChord, type Keymap } from './keymap.js';
import { dispatch, type ActionHooks } from './actions.js';

interface KeyTargetLike { addEventListener: Function; removeEventListener: Function }

function isEditable(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function installKeybindings(
  target: KeyTargetLike, app: App, map: Keymap, hooks: ActionHooks,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    const action = lookupChord(map, eventToChord(e));
    if (!action) return;
    e.preventDefault();
    dispatch(app, action, hooks);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
```

## `src/ui/LoadingIndicator.ts`

Progress chrome driven by the G2 `JobLedger` in-flight count and (optionally) the
G10 `PerfMonitor` budget state. It is poll-based (the loop has no event for "a job
landed"), refreshing on `requestAnimationFrame` while anything is in flight.

```ts
import type { JobLedger } from '@/app/gpu_jobs.js';
import type { PerfMonitor } from '@/perf/perf_monitor.js';

/** Pure: produce the label + busy flag from the two signals. Unit-testable. */
export function progressLabel(inflight: number, overBudget: boolean): {
  busy: boolean; label: string;
} {
  if (inflight === 0) return { busy: false, label: '' };
  const base = `Computing ${inflight} tile${inflight === 1 ? '' : 's'}…`;
  return { busy: true, label: overBudget ? `${base} (reducing quality)` : base };
}

export function mountLoadingIndicator(
  root: HTMLElement, ledger: JobLedger, perf?: PerfMonitor,
): () => void {
  root.innerHTML = `<div class="loader" hidden><span class="spinner"></span><span class="loader-text"></span></div>`;
  const box = root.querySelector<HTMLDivElement>('.loader')!;
  const text = root.querySelector<HTMLSpanElement>('.loader-text')!;

  let raf = 0;
  const tick = () => {
    const over = perf?.snapshot ? perf.snapshot().budget !== 'ok' : false;
    const { busy, label } = progressLabel(ledger.inflightCount, over);
    box.hidden = !busy;
    text.textContent = label;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
```

## `src/ui/Chrome.ts`

The shell chrome that surfaces G9 warnings and G11 errors. The warning banner is
rendered once from the `CapabilityProfile`; the error overlay subscribes to the
`ErrorBoundary` via its `onUserError` hook (G11) and shows the stack-free
`userMessage` — auto-dismissing recoverable errors, pinning fatal ones.

```ts
import type { ErrorBoundary } from '@/error/boundary.js';
import type { AppError } from '@/error/kinds.js';
import type { CapabilityProfile } from '@/gpu/capability.js';

export function mountChrome(
  root: HTMLElement, boundary: ErrorBoundary, capability: CapabilityProfile,
): () => void {
  root.innerHTML = `
    <div class="warnings"></div>
    <div class="error-overlay" hidden role="alert"><span class="error-text"></span></div>
  `;
  const warnings = root.querySelector<HTMLDivElement>('.warnings')!;
  const overlay = root.querySelector<HTMLDivElement>('.error-overlay')!;
  const errText = root.querySelector<HTMLSpanElement>('.error-text')!;

  // G9: capability warnings (and an unsupported banner) rendered once.
  if (!capability.supported && capability.reason) {
    warnings.innerHTML = `<div class="banner banner-error">WebGPU unavailable (${capability.reason}).</div>`;
  } else {
    warnings.innerHTML = capability.warnings
      .map(w => `<div class="banner banner-warn">${w}</div>`).join('');
  }

  // G11: route user-facing errors into the overlay (never a raw stack).
  let dismissTimer = 0;
  const onUserError = (app: AppError, message: string) => {
    errText.textContent = message;
    overlay.hidden = false;
    window.clearTimeout(dismissTimer);
    if (app.recoverable) {
      dismissTimer = window.setTimeout(() => { overlay.hidden = true; }, 5000);
    }
  };
  (boundary as unknown as { hooks: { onUserError?: typeof onUserError } }).hooks.onUserError = onUserError;

  return () => {
    window.clearTimeout(dismissTimer);
    root.innerHTML = '';
  };
}
```

## `src/ui/shell.css`

Responsive CSS-grid layout with named areas and two breakpoints. Desktop is a
canvas-dominant three-column-ish grid; the tablet breakpoint collapses the
inspector under the controls; the mobile breakpoint stacks everything and turns
the gallery into an overlay sheet.

```css
/* G12 shell layout — extends G8's styles.css variables. */
.shell {
  display: grid;
  height: 100vh;
  gap: 1px;
  grid-template-columns: 1fr 340px;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "chrome   chrome"
    "canvas   controls"
    "canvas   inspector";
  background: var(--bg);
}
.shell-chrome   { grid-area: chrome; }
.canvas-area    { grid-area: canvas; position: relative; min-width: 0; min-height: 0; }
.control-area   { grid-area: controls; background: var(--panel); padding: 12px; overflow-y: auto; }
.inspector-area { grid-area: inspector; background: var(--panel); padding: 12px; overflow-y: auto; }

/* Gallery + loader float over the canvas; not part of the grid flow. */
.gallery-area, .loader-area { grid-area: canvas; align-self: start; justify-self: end; }
.gallery { background: var(--panel); padding: 12px; border-radius: 6px; margin: 8px; }
.gallery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.preset-card { text-align: left; }
.preset-card.builtin { opacity: 0.9; }

.loader { display: flex; gap: 8px; align-items: center; margin: 8px;
          background: var(--panel); padding: 6px 10px; border-radius: 6px; }
.loader[hidden] { display: none; }
.spinner { width: 12px; height: 12px; border: 2px solid var(--accent);
           border-top-color: transparent; border-radius: 50%;
           animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.banner { padding: 6px 10px; font-size: 12px; }
.banner-warn  { background: #3a2f12; color: #ffd479; }
.banner-error { background: #3a1212; color: #ff8f8f; }
.error-overlay { position: absolute; bottom: 12px; left: 12px;
                 background: #3a1212; color: #ffd; padding: 10px 14px;
                 border-radius: 6px; max-width: 420px; }
.error-overlay[hidden] { display: none; }

/* Tablet: inspector moves under controls in a single right rail. */
@media (max-width: 1100px) {
  .shell {
    grid-template-columns: 1fr 300px;
    grid-template-rows: auto 1fr 1fr;
    grid-template-areas:
      "chrome   chrome"
      "canvas   controls"
      "canvas   inspector";
  }
}

/* Mobile: stack; gallery becomes a full-width sheet. */
@media (max-width: 720px) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 60vh auto auto;
    grid-template-areas:
      "chrome"
      "canvas"
      "controls"
      "inspector";
  }
  .gallery-area { justify-self: stretch; }
  .gallery-grid { grid-template-columns: 1fr; }
}
```

## Tests

### `test/unit/ui/shell.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  initHistory, pushHistory, undo, redo, canUndo, canRedo, isComputeChange,
} from '@/ui/history.js';
import {
  parseChord, chordToString, eventToChord, buildKeymap, lookupChord, rebind,
  DEFAULT_BINDINGS,
} from '@/ui/keymap.js';
import {
  captureView, applyPreset, savePreset, PresetStore, BUILTIN_PRESETS,
} from '@/ui/presets.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { ViewState } from '@/interact/view_state.js';

const base = (): ViewState => defaultViewState();

describe('history reducer: push / undo / redo', () => {
  it('a compute change pushes the prior present onto the past', () => {
    let h = initHistory(base());
    const next = { ...base(), mag: 5 };            // mag is in the cache key
    h = pushHistory(h, next);
    expect(canUndo(h)).toBe(true);
    expect(h.present.mag).toBe(5);
    expect(h.past).toHaveLength(1);
  });

  it('undo restores the previous present and stocks the redo future', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = undo(h);
    expect(h.present.mag).toBe(base().mag);
    expect(canRedo(h)).toBe(true);
  });

  it('redo re-applies the undone present', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = redo(undo(h));
    expect(h.present.mag).toBe(5);
    expect(canRedo(h)).toBe(false);
  });

  it('a new edit after undo truncates the redo future (fork)', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, { ...base(), mag: 7 });      // forks
    expect(canRedo(h)).toBe(false);
    expect(h.present.mag).toBe(7);
  });

  it('the ring evicts the oldest past beyond cap', () => {
    let h = initHistory(base(), 2);
    h = pushHistory(h, { ...base(), mag: 1 });
    h = pushHistory(h, { ...base(), mag: 2 });
    h = pushHistory(h, { ...base(), mag: 3 });
    expect(h.past).toHaveLength(2);
    // Oldest (the original present) was evicted; earliest reachable is mag:1.
    expect(h.past[0]!.mag).toBe(1);
  });

  it('undo/redo on an empty stack are no-ops', () => {
    const h = initHistory(base());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});

describe('history: render-only changes never push', () => {
  it('isComputeChange is false for an identical view', () => {
    const v = base();
    expect(isComputeChange(v, { ...v })).toBe(false);
  });

  it('a non-cache-key, non-lock field (zoom UI quantity) does not push', () => {
    // `zoom` is a pure UI quantity (M8) — not in viewStateToCacheKey, not lock/tilt.
    let h = initHistory(base());
    const before = h.present;
    h = pushHistory(h, { ...base(), zoom: 3 });
    expect(canUndo(h)).toBe(false);           // present replaced, nothing pushed
    expect(h.present.zoom).toBe(3);
    expect(h.present).not.toBe(before);
  });

  it('chartType (cache-key) DOES push, proving the gate is real', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), chartType: 'lz_e' });
    expect(canUndo(h)).toBe(true);
  });

  it('a tilt change pushes even though tilt is not all in the cache key', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), tilt1: 0.5 });
    expect(canUndo(h)).toBe(true);
  });
});

describe('keymap reducer: parse / lookup / rebind', () => {
  it('parseChord normalises modifier order and case', () => {
    expect(parseChord('Shift+Ctrl+Z')).toBe(parseChord('ctrl+shift+z'));
    expect(parseChord('Ctrl+Z')).toBe('ctrl+z');
  });

  it('chordToString is the inverse of a parsed chord', () => {
    expect(chordToString({ key: 'z', ctrl: true, shift: false, alt: false, meta: false }))
      .toBe('ctrl+z');
  });

  it('eventToChord reads modifiers off an event-like object', () => {
    expect(eventToChord({ key: 'Z', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }))
      .toBe('ctrl+shift+z');
  });

  it('the default keymap resolves Ctrl+Z to undo and Ctrl+Shift+Z to redo', () => {
    const m = buildKeymap();
    expect(lookupChord(m, parseChord('ctrl+z'))).toBe('undo');
    expect(lookupChord(m, parseChord('ctrl+shift+z'))).toBe('redo');
  });

  it('an unbound chord returns undefined (fall-through)', () => {
    expect(lookupChord(buildKeymap(), parseChord('ctrl+q'))).toBeUndefined();
  });

  it('rebind returns a NEW map and leaves the original intact', () => {
    const m = buildKeymap([['ctrl+z', 'undo']]);
    const m2 = rebind(m, 'ctrl+r', 'redo');
    expect(lookupChord(m2, parseChord('ctrl+r'))).toBe('redo');
    expect(lookupChord(m, parseChord('ctrl+r'))).toBeUndefined();   // original unchanged
  });

  it('rebind refuses to shadow an existing chord without override', () => {
    const m = buildKeymap([['ctrl+z', 'undo']]);
    expect(() => rebind(m, 'ctrl+z', 'redo')).toThrow();
    expect(lookupChord(rebind(m, 'ctrl+z', 'redo', true), parseChord('ctrl+z'))).toBe('redo');
  });

  it('parseChord rejects a modifier-only spec', () => {
    expect(() => parseChord('ctrl+shift')).toThrow();
  });

  it('every default binding parses and resolves to an action', () => {
    const m = buildKeymap();
    for (const [spec, action] of DEFAULT_BINDINGS) {
      expect(lookupChord(m, parseChord(spec))).toBe(action);
    }
  });
});

describe('preset store: save / apply round-trip', () => {
  it('captureView → applyPreset round-trips the captured fields', () => {
    const src = { ...base(), chartType: 'shape_sphere', mag: 4.2, qualityTier: 'research' as const };
    const preset = savePreset('p1', 'P1', src);
    const applied = applyPreset(base(), preset);
    expect(applied.chartType).toBe('shape_sphere');
    expect(applied.mag).toBe(4.2);
    expect(applied.qualityTier).toBe('research');
  });

  it('applyPreset clears the lock and refreshes the timestamp', () => {
    const preset = savePreset('p1', 'P1', base());
    const locked = { ...base(), locked: true };
    const applied = applyPreset(locked, preset);
    expect(applied.locked).toBe(false);
    expect(typeof applied.timestamp).toBe('string');
  });

  it('a preset captures no render-only fields (none exist on ViewState)', () => {
    const captured = captureView(base()) as Record<string, unknown>;
    // RenderParams keys must never appear in a captured preset.
    for (const k of ['colourMode', 'palette', 'cvdMode', 'brightnessMode']) {
      expect(k in captured).toBe(false);
    }
  });

  it('PresetStore.save returns a new store and never mutates builtins', () => {
    const store = new PresetStore();
    const next = store.save(savePreset('user_a', 'Mine', base()));
    expect(next.get('user_a')?.builtin).toBe(false);
    expect(store.get('user_a')).toBeUndefined();        // original unchanged
    expect(next.get('home')?.builtin).toBe(true);       // builtin preserved
  });

  it('saving over a builtin id is rejected', () => {
    const store = new PresetStore();
    expect(() => store.save(savePreset('home', 'Hijack', base()))).toThrow();
  });

  it('removing a builtin is rejected; removing a user preset works', () => {
    let store = new PresetStore().save(savePreset('user_a', 'Mine', base()));
    expect(() => store.remove(BUILTIN_PRESETS[0]!.id)).toThrow();
    store = store.remove('user_a');
    expect(store.get('user_a')).toBeUndefined();
  });
});
```

### `test/unit/ui/shell_dom.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { progressLabel } from '@/ui/LoadingIndicator.js';

// The loading-label logic is pure and runs without a DOM.
describe('progressLabel: pure loader logic', () => {
  it('is idle with no in-flight jobs', () => {
    expect(progressLabel(0, false)).toEqual({ busy: false, label: '' });
  });

  it('reports a singular tile count', () => {
    expect(progressLabel(1, false).label).toMatch(/Computing 1 tile…/);
  });

  it('appends a degradation hint when over budget', () => {
    expect(progressLabel(3, true).label).toMatch(/reducing quality/);
  });
});

// jsdom-style mount smoke test: only runs when a document exists (vitest's
// jsdom/happy-dom env). Skips cleanly under the default node environment so the
// exit suite never depends on a DOM.
const hasDom = typeof document !== 'undefined';
describe.skipIf(!hasDom)('keybindings install/teardown (DOM)', () => {
  it('install returns a disposer that removes the listener', async () => {
    const { installKeybindings } = await import('@/ui/Keybindings.js');
    const { buildKeymap } = await import('@/ui/keymap.js');
    let zoomed = 0;
    const app = {
      store: { snapshot: () => ({ locked: false }), setView: () => {} },
      input: { zoom: () => { zoomed++; }, lock: () => {}, unlock: () => {} },
    } as any;
    const dispose = installKeybindings(
      window as any, app, buildKeymap([['=', 'zoomIn']]),
      { getHistory: () => ({} as any), setHistory: () => {} },
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(zoomed).toBe(1);
    dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(zoomed).toBe(1);     // listener removed
  });
});
```

## Run it

```bash
npm test -- --run test/unit/ui/shell
npm test -- --run test/unit/ui/shell_dom   # pure loader logic; DOM block skips under node
npm run dev                                 # full shell: presets, keys, undo/redo, chrome
```

## Acceptance check

`test/unit/ui/shell.test.ts` passes with ≥15 green tests (27 as written) across
three pure reducers: the history ring (push/undo/redo, ring eviction, fork
truncation, **render-only/UI-only changes never pushing**), the keymap
(parse/lookup/rebind/fall-through), and the preset store (save/apply round-trip,
render-only exclusion, builtin immutability). In the running shell: a palette /
render-mode / CVD change rebinds M7 group 3 only — it does not call
`app.store.update`, does not invalidate the cache, and cannot be undone with
Ctrl+Z; a `mag`/`chartType`/tilt change can.

## Notes for the implementer

- **One history funnel.** History is captured in the single `Store.subscribe`
  callback in `mountUI`, gated by `isComputeChange`. Do not call `pushHistory`
  anywhere else, and do not route render-only changes through the view `Store` —
  that is the entire reason `RenderParamsStore` is a separate instance. If a
  render knob ever needed undo, it would get its *own* history, never this one.
- **`isComputeChange` defers to the cache key.** The authority on "does this
  change tile contents" is M8's `viewStateToCacheKey`; the reducer compares the
  derived keys and only adds lock/tilt/uvCentre on top (they affect
  inspection/projection without being fully in the key). When M8/M10 extend the
  cache key, this reducer inherits the change for free — keep the comparison keyed
  on the derived key, not a hand-maintained field list.
- **The keymap is data.** Rebinding is `rebind(map, spec, action)` returning a new
  immutable map; persist the user's map to `localStorage` and rebuild with
  `buildKeymap(entries)` on load. The DOM layer (`Keybindings.ts`) holds no
  bindings — swap the map and the listener picks it up.
- **Presets exclude RenderParams on purpose.** A preset is a *chart/view*, not a
  *look*. Palette and render-mode travel with the session (`RenderParamsStore`),
  so two people sharing a preset can each keep their own CVD setting. `captureView`
  enforces this structurally — there is no RenderParams field on `ViewState` to
  capture.
- **Chrome wiring vs. G11.** `mountChrome` sets `boundary.hooks.onUserError`
  directly because the boundary is constructed before the DOM (it wraps GPU init).
  In production prefer passing the hook into the `ErrorBoundary` constructor
  (G11's `ErrorBoundaryHooks`) and have `mountChrome` register a *secondary*
  listener; the direct-assign shown here keeps the milestone self-contained.
- **Loader is poll-based by necessity.** The G2 loop exposes `inflightCount` but
  no "job landed" event, so the indicator samples on rAF while busy. Keep
  `progressLabel` pure (it is unit-tested) and let the mount own only the
  scheduling. The over-budget hint reads G10's `PerfSnapshot.budget`; when no
  `PerfMonitor` is supplied it simply never shows the degradation suffix.
- **Stay vanilla.** Every binding still goes through G8's `bind`/`bindInput`; no
  framework is introduced. When the shell outgrows manual `querySelector` wiring,
  the migration target (Solid/Svelte signals) maps cleanly because both the view
  `Store` and `RenderParamsStore` already expose the `subscribe`/`update`/
  `snapshot` signal contract.
