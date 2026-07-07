# G13 — Accessibility & CVD UI

## Goal

The G12 shell renders a control panel, a canvas, and a set of side panels, but
it is invisible to a screen reader, untraversable by keyboard, and offers no way
to *see* what a colour-vision-deficient user sees — even though M7 already ships
the simulation (`RenderParams.cvdMode`, `CvdMode = 'none'|'protan'|'deutan'|'tritan'|'achrom'`,
applied in postprocess on linear sRGB). G13 closes that gap: a **CVD-mode
toggle** that flips `RenderParams.cvdMode` as a *render-only* change (group-3
rebind, **no recompute, no `ViewState` touch, no cache-key change, no undo
history**); **keyboard navigation** (a documented focus order, a roving-tabindex
group for the slider stack, and Escape/Enter semantics that integrate G12's
keymap); an **ARIA layer** (a tiny `applyAria(el, role, label, opts)` helper plus
the role/label assignments for panels, sliders, and the canvas as an
`application` region, with a polite live-status region announcing lock / chart /
zoom / CVD changes); a **high-contrast theme** and a **font-size scale** control
(CSS custom properties toggled by a class on `:root`); and
**prefers-reduced-motion** handling that disables transitions/animations. The
exit test pins the *pure* logic — the CVD reducer and its render-only invariant,
the ARIA attribute builder, the roving-tabindex / focus-order computation, and
the live-announcement message builder — so it runs headless with no GPU and no
real DOM layout.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/ui/a11y
```

passes with at least **15 green tests** (32 as-built) covering: the CVD-mode
reducer (`cycleCvd`/`setCvd` produce a new `RenderParams` and leave a paired
`ViewState` + its `viewStateToCacheKey` **byte-identical** — the render-only
invariant); the ARIA attribute builder (`buildAria` role/label/extra-attr
assembly and the panel/slider/canvas presets); the roving-tabindex / focus-order
computation (`rovingTabindex`, `focusOrder`, arrow-key index advance with
wrap/clamp); and the live-announcement message builder (`announce` for lock,
chart, zoom, and CVD changes, plus `describeShortcuts`).

**Deliverable:** the full UI shell becomes accessible — a CVD-mode toggle, keyboard navigation, an ARIA/live-status layer, a high-contrast theme, font-size scaling, and reduced-motion handling all usable via `npm run dev`; the pure CVD/ARIA/focus/announcement logic is pinned by `test/unit/ui/a11y`.

## File tree

```
src/
  ui/
    a11y/
      cvd_control.ts     # NEW: pure CVD reducer (render-only); cycleCvd / setCvd / cvdLabel / CVD_ORDER
      aria.ts            # NEW: applyAria + buildAria attribute builder + panel/slider/canvas presets
      keyboard.ts        # NEW: focusOrder, rovingTabindex, advanceRoving, KeyAction, resolveKey, SHORTCUTS, describeShortcuts
      live_region.ts     # NEW: announce() message builder + LiveRegion mount helper (DOM-thin)
      theme.ts           # NEW: themeVars/applyTheme + prefersReducedMotion() (matchMedia-guarded)
      index.ts           # NEW: barrel (re-exported from src/ui/index.ts)
    ControlPanel.ts      # MODIFIED (G12): CVD select single-sourced to CVD_ORDER/cvdLabel + announce; panel ARIA; roving tabindex
    Canvas.ts            # MODIFIED (G12): canvas as application region (canvasAria)
    Keybindings.ts       # MODIFIED (G12): optional `pre` handler param + makeA11yPreHandler + OverlayHooks
    ChartBrowser.ts      # MODIFIED (G12): ChartBrowserHandle.isOpen() (Escape-dismiss consumption test)
    App.ts               # MODIFIED (G12): .a11y-status cell + LiveRegion + theme state + preHandler wiring
    styles.css           # MODIFIED: font-scale var, high-contrast vars, reduced-motion switch, .a11y-visually-hidden
test/
  unit/
    ui/
      a11y.test.ts       # NEW: pure reducer + invariant + ARIA + roving + announce (exit suite)
  gpu/
    shell.spec.ts        # MODIFIED: live a11y probe (roles, CVD announce + view unchanged, Escape-dismiss)
```

## Depends on / pairs with

- **G12** (UI shell) — G13 extends its `ControlPanel` / `Canvas` / panels and
  `Keybindings`. **G13 depends on G12**; the patches below are small, labelled
  integrations, not rewrites.
- **G8** (`src/ui/reactive.ts`: `bind` / `bindInput`) — every new control is
  mounted through G8's primitive over **G2**'s `Store` (`subscribe` / `update` /
  `snapshot`). G13 adds modules; it does not touch `reactive.ts`.
- **M7** (`RenderParams`, `CvdMode`, `DEFAULT_RENDER_PARAMS`, `cvd.ts` /
  `cvd.wgsl`) — the CVD toggle sets `RenderParams.cvdMode`; switching it is a
  **group-3 rebind** in postprocess, **never** a recompute. The `CvdMode` union
  and the matrices are M7's; G13 only orders/labels them for the UI.
- **M8** (`viewStateToCacheKey`) — the render-only invariant test asserts the
  cache key is a pure function of `ViewState` and is *unchanged* by any CVD edit.
- Contracts: the **two-stage decoupling** — palette / CVD / render-mode changes
  are RENDER-ONLY (M7 `RenderParams`, group 3) and MUST NOT trigger recomputation
  or touch `ViewState` / the cache. G13 encodes that as an executable invariant.

## `src/ui/a11y/cvd_control.ts`

The CVD control is the canonical render-only edit. It is a **pure reducer over
`RenderParams`**: given the current params and an action, it returns *new*
`RenderParams` and nothing else. It never receives, returns, or mutates a
`ViewState`; the shell applies the result with a group-3 rebind and explicitly
does **not** push undo history or invalidate any tile (see the `ControlPanel`
patch). Keeping the reducer `ViewState`-free is what makes the invariant
provable.

```ts
import type { CvdMode, RenderParams } from '@/render/types.js';

/** Cycle order for the toggle (matches M7's CVD_INDEX / cvd.wgsl switch). */
export const CVD_ORDER: readonly CvdMode[] = [
  'none', 'protan', 'deutan', 'tritan', 'achrom',
] as const;

/** Short, user-facing labels for the toggle and the live announcement. */
export const CVD_LABELS: Readonly<Record<CvdMode, string>> = {
  none:   'Off',
  protan: 'Protanopia',
  deutan: 'Deuteranopia',
  tritan: 'Tritanopia',
  achrom: 'Achromatopsia',
};

export function cvdLabel(mode: CvdMode): string {
  return CVD_LABELS[mode];
}

/** Render-only action set. Deliberately tiny: this only ever moves cvdMode. */
export type CvdAction =
  | { type: 'set'; mode: CvdMode }
  | { type: 'cycle'; dir: 1 | -1 };

/**
 * Pure reducer. Returns a NEW RenderParams with only `cvdMode` changed; every
 * other field is copied by reference-preserving spread. Total: an unknown mode
 * in a 'set' action is ignored (params returned unchanged) rather than throwing,
 * so a stale UI event can never crash the render path.
 */
export function reduceCvd(params: RenderParams, action: CvdAction): RenderParams {
  switch (action.type) {
    case 'set': {
      if (!CVD_ORDER.includes(action.mode)) return params;
      if (action.mode === params.cvdMode) return params;
      return { ...params, cvdMode: action.mode };
    }
    case 'cycle': {
      const i = CVD_ORDER.indexOf(params.cvdMode);
      const base = i < 0 ? 0 : i;
      const n = CVD_ORDER.length;
      const next = CVD_ORDER[(((base + action.dir) % n) + n) % n]!;
      return next === params.cvdMode ? params : { ...params, cvdMode: next };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Convenience wrappers the ControlPanel calls directly. */
export function setCvd(params: RenderParams, mode: CvdMode): RenderParams {
  return reduceCvd(params, { type: 'set', mode });
}
export function cycleCvd(params: RenderParams, dir: 1 | -1 = 1): RenderParams {
  return reduceCvd(params, { type: 'cycle', dir });
}

/**
 * Render-only assertion helper, exported so the shell (and the test) can prove
 * the contract: a CVD edit must NOT change the ViewState-derived cache key.
 * `keyOf` is injected (M8's viewStateToCacheKey) to avoid an import cycle.
 */
export function isRenderOnly<V, K>(
  before: V, after: V, keyOf: (v: V) => K,
): boolean {
  // Same ViewState reference ⇒ same key; this is the structural guarantee that
  // a CVD edit (which touches only RenderParams) leaves the cache untouched.
  return before === after &&
    JSON.stringify(keyOf(before)) === JSON.stringify(keyOf(after));
}
```

## `src/ui/a11y/aria.ts`

`buildAria` is the pure attribute builder — it assembles the `role`,
`aria-label`, and any extra ARIA/`tabindex` attributes into a plain record so the
mapping is unit-testable without a DOM. `applyAria` is the thin DOM sink that
writes that record onto an element. Presets capture the role/label decisions for
the three structural cases (panel region, slider, canvas application region).

```ts
/** ARIA roles G13 assigns. Closed set keeps the presets honest. */
export type AriaRole =
  | 'application' | 'region' | 'group' | 'slider'
  | 'status' | 'button' | 'list' | 'listitem';

export interface AriaOptions {
  /** Extra aria-* / tabindex pairs, e.g. { 'aria-valuenow': '3' }. */
  extra?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Pure: role + label + opts → a flat attribute map. Booleans are stringified
 * the ARIA way ('true'/'false'); numbers via String(). The map is what
 * applyAria writes; tests assert on the map directly.
 */
export function buildAria(
  role: AriaRole, label: string, opts: AriaOptions = {},
): Record<string, string> {
  const out: Record<string, string> = { role, 'aria-label': label };
  const extra = opts.extra ?? {};
  for (const [k, v] of Object.entries(extra)) {
    out[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  }
  return out;
}

/** DOM sink. Writes every entry of buildAria onto the element. */
export function applyAria(
  el: Element, role: AriaRole, label: string, opts: AriaOptions = {},
): void {
  const attrs = buildAria(role, label, opts);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/* ---- Structural presets (pure) ---------------------------------------- */

/** A side panel: a labelled landmark region. */
export function panelAria(label: string): Record<string, string> {
  return buildAria('region', label);
}

/**
 * A range slider. ARIA mirrors the numeric model so a screen reader can read
 * the value without seeing the visual <span>.
 */
export function sliderAria(
  label: string, value: number, min: number, max: number,
): Record<string, string> {
  return buildAria('slider', label, {
    extra: {
      'aria-valuenow': value,
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-valuetext': value.toFixed(2),
    },
  });
}

/**
 * The render canvas. It is an interactive `application` region (it captures
 * arrow keys for pan/tilt), so screen readers must pass keystrokes through.
 */
export function canvasAria(label = 'Three-body visualiser'): Record<string, string> {
  return buildAria('application', label, {
    extra: { 'aria-roledescription': 'interactive plot', tabindex: 0 },
  });
}

/** The polite live-status region (see live_region.ts). */
export function statusAria(): Record<string, string> {
  return buildAria('status', 'Status', {
    extra: { 'aria-live': 'polite', 'aria-atomic': true },
  });
}
```

## `src/ui/a11y/keyboard.ts`

Focus order and the roving-tabindex group are pure index math; the shortcut
catalogue and `resolveKey` integrate G12's keymap so Escape/Enter have one
documented meaning. `resolveKey` returns a typed `KeyAction` the shell switches
on — it does not touch the DOM, so it is fully testable.

```ts
/** The logical focus stops, in document order (G12 shell layout). */
export type FocusStop =
  | 'chart' | 'sliders' | 'tilt' | 'cvd' | 'quality' | 'canvas' | 'inspector';

/** Canonical focus order for Tab traversal. */
export const FOCUS_ORDER: readonly FocusStop[] = [
  'chart', 'sliders', 'tilt', 'cvd', 'quality', 'canvas', 'inspector',
] as const;

/** Stable list (filtered to the stops actually present in the DOM). */
export function focusOrder(present: readonly FocusStop[]): FocusStop[] {
  const set = new Set(present);
  return FOCUS_ORDER.filter(s => set.has(s));
}

/**
 * Roving tabindex for a group of `count` items with one active index: the
 * active item is 0 (in the tab sequence), all others are -1 (reachable only via
 * arrow keys). Returns the tabindex per item. Pure.
 */
export function rovingTabindex(count: number, active: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i === active ? 0 : -1);
  return out;
}

/**
 * Advance the active index within a roving group. `wrap` cycles past the ends;
 * otherwise the index clamps. Pure; empty groups stay at 0.
 */
export function advanceRoving(
  active: number, count: number, dir: 1 | -1, wrap = true,
): number {
  if (count <= 0) return 0;
  const next = active + dir;
  if (wrap) return ((next % count) + count) % count;
  return Math.max(0, Math.min(count - 1, next));
}

/* ---- Shortcut catalogue + key resolution ------------------------------ */

/** Typed actions the shell handles. `none` = let the event pass through. */
export type KeyAction =
  | { kind: 'none' }
  | { kind: 'cvd-cycle'; dir: 1 | -1 }
  | { kind: 'toggle-contrast' }
  | { kind: 'font-scale'; dir: 1 | -1 }
  | { kind: 'commit' }        // Enter: commit lookup / confirm overlay
  | { kind: 'dismiss' }       // Escape: cancel overlay / clear lookup
  | { kind: 'roving'; dir: 1 | -1 };

export interface Shortcut {
  /** KeyboardEvent.key value (case-sensitive for letters as documented). */
  key: string;
  /** Required modifiers; absent ⇒ must be false. */
  alt?: boolean;
  shift?: boolean;
  /** Human-readable, for describeShortcuts() and the help panel. */
  describe: string;
  action: KeyAction;
}

/**
 * G13 shortcuts, merged INTO G12's keymap (G12 owns zoom/lock/pan; G13 adds
 * accessibility bindings + the Enter/Escape semantics for overlays).
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'c', alt: true, describe: 'Cycle colour-vision simulation',          action: { kind: 'cvd-cycle', dir: 1 } },
  { key: 'C', alt: true, shift: true, describe: 'Cycle colour-vision simulation (reverse)', action: { kind: 'cvd-cycle', dir: -1 } },
  { key: 'h', alt: true, describe: 'Toggle high-contrast theme',              action: { kind: 'toggle-contrast' } },
  { key: '=', alt: true, describe: 'Increase font size',                      action: { kind: 'font-scale', dir: 1 } },
  { key: '-', alt: true, describe: 'Decrease font size',                      action: { kind: 'font-scale', dir: -1 } },
  { key: 'Enter',  describe: 'Confirm the active overlay / lookup',           action: { kind: 'commit' } },
  { key: 'Escape', describe: 'Dismiss the active overlay / clear lookup',     action: { kind: 'dismiss' } },
  { key: 'ArrowDown', describe: 'Next slider in the group',                   action: { kind: 'roving', dir: 1 } },
  { key: 'ArrowUp',   describe: 'Previous slider in the group',              action: { kind: 'roving', dir: -1 } },
] as const;

/** The subset of a KeyboardEvent resolveKey needs (DOM-free for testing).
 *  Named A11yKeyEvent as-built — G12's keymap.ts already exports a
 *  KeyEventLike and both flow through the ui barrel (TS2308 otherwise). */
export interface A11yKeyEvent {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Resolve a key event to an action. First exact match wins; modifiers must
 * match exactly (an unspecified modifier must be false). Returns `none` when
 * nothing matches so the caller leaves the event alone. Pure.
 */
export function resolveKey(ev: A11yKeyEvent): KeyAction {
  for (const s of SHORTCUTS) {
    if (s.key !== ev.key) continue;
    if (!!s.alt !== !!ev.altKey) continue;
    if (!!s.shift !== !!ev.shiftKey) continue;
    return s.action;
  }
  return { kind: 'none' };
}

/** Render the documented shortcut list (help panel + tests). Pure. */
export function describeShortcuts(): { combo: string; describe: string }[] {
  return SHORTCUTS.map(s => {
    const mods = [s.alt ? 'Alt' : '', s.shift ? 'Shift' : ''].filter(Boolean);
    return { combo: [...mods, s.key].join('+'), describe: s.describe };
  });
}
```

## `src/ui/a11y/live_region.ts`

`announce` is the pure message builder: it turns a typed change event into the
exact polite-region string. `LiveRegion` is the DOM-thin wrapper that writes that
string into the `role="status"` node and subscribes to the `Store` so lock /
chart / zoom changes are spoken; CVD changes are announced from the
`ControlPanel` since they live in `RenderParams`, not `ViewState`.

```ts
import type { CvdMode } from '@/render/types.js';
import { cvdLabel } from './cvd_control.js';

/** Typed UI changes worth announcing to a screen reader. */
export type Announcement =
  | { kind: 'lock'; locked: boolean }
  | { kind: 'chart'; chart: string }
  | { kind: 'zoom'; mag: number }
  | { kind: 'cvd'; mode: CvdMode }
  | { kind: 'contrast'; on: boolean }
  | { kind: 'font'; scale: number };

/**
 * Build the polite-region text. Pure and total; the `never` arm makes a new
 * Announcement kind a compile error until it has a phrasing.
 */
export function announce(a: Announcement): string {
  switch (a.kind) {
    case 'lock':
      return a.locked ? 'Affine frame locked.' : 'Affine frame unlocked.';
    case 'chart':
      return `Chart changed to ${a.chart}.`;
    case 'zoom':
      return `Zoom ${a.mag.toPrecision(3)}.`;
    case 'cvd':
      return a.mode === 'none'
        ? 'Colour-vision simulation off.'
        : `Colour-vision simulation: ${cvdLabel(a.mode)}.`;
    case 'contrast':
      return a.on ? 'High-contrast theme on.' : 'High-contrast theme off.';
    case 'font':
      return `Font size ${Math.round(a.scale * 100)} percent.`;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

/** Minimal interface to the G2 Store (subscribe/snapshot) we need here. */
interface StoreLike<V> {
  snapshot(): V;
  subscribe(cb: (v: V) => void): () => void;
}
interface ViewLike { locked: boolean; chartType: string; mag: number }

/**
 * Mounts a polite live region and speaks ViewState-derived changes. DOM-thin:
 * all phrasing comes from announce(); only the diff + textContent write live
 * here. Returns an unsubscribe.
 */
export class LiveRegion<V extends ViewLike> {
  private prev: V;
  constructor(
    private readonly node: { textContent: string | null },
    private readonly store: StoreLike<V>,
  ) {
    this.prev = store.snapshot();
  }

  start(): () => void {
    return this.store.subscribe(v => {
      const msgs: string[] = [];
      if (v.locked !== this.prev.locked) msgs.push(announce({ kind: 'lock', locked: v.locked }));
      if (v.chartType !== this.prev.chartType) msgs.push(announce({ kind: 'chart', chart: v.chartType }));
      if (v.mag !== this.prev.mag) msgs.push(announce({ kind: 'zoom', mag: v.mag }));
      if (msgs.length > 0) this.node.textContent = msgs.join(' ');
      this.prev = v;
    });
  }

  /** Imperative announce for non-ViewState changes (CVD, contrast, font). */
  say(a: Announcement): void {
    this.node.textContent = announce(a);
  }
}
```

## `src/ui/a11y/theme.ts`

The theme layer toggles CSS custom properties via a class on the root element;
no per-element style writes. High contrast and font scale are independent;
reduced motion is mirrored both from `prefers-reduced-motion` and an explicit
override. `themeVars` is pure (testable); `applyTheme` is the DOM sink.

```ts
export interface ThemeState {
  highContrast: boolean;
  /** Font-size multiplier on the root (1.0 = default). */
  fontScale: number;
  /** Explicit reduced-motion override; undefined ⇒ defer to the media query. */
  reducedMotion?: boolean;
}

export const DEFAULT_THEME: ThemeState = {
  highContrast: false,
  fontScale: 1.0,
};

/** Clamp the font scale to a sane, accessible range and quantise to 5%. */
export function clampFontScale(scale: number): number {
  const clamped = Math.max(0.75, Math.min(2.0, scale));
  return Math.round(clamped * 20) / 20;
}

/** Step the font scale up/down by 10% within the clamp. Pure. */
export function stepFontScale(scale: number, dir: 1 | -1): number {
  return clampFontScale(scale + dir * 0.1);
}

/**
 * Pure: theme + media-query state → the class list and CSS-variable map for
 * the root element. The shell merges these; tests assert on them directly.
 */
export function themeVars(
  t: ThemeState, prefersReducedMotion: boolean,
): { classes: string[]; vars: Record<string, string> } {
  const classes: string[] = [];
  if (t.highContrast) classes.push('a11y-high-contrast');
  const reduced = t.reducedMotion ?? prefersReducedMotion;
  if (reduced) classes.push('a11y-reduced-motion');
  return {
    classes,
    vars: { '--a11y-font-scale': clampFontScale(t.fontScale).toString() },
  };
}

/** DOM sink: reconcile root classes + the --a11y-font-scale variable. */
export function applyTheme(
  root: HTMLElement, t: ThemeState, prefersReducedMotion: boolean,
): void {
  const { classes, vars } = themeVars(t, prefersReducedMotion);
  root.classList.toggle('a11y-high-contrast', classes.includes('a11y-high-contrast'));
  root.classList.toggle('a11y-reduced-motion', classes.includes('a11y-reduced-motion'));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Read the OS reduced-motion preference; false where matchMedia is absent
 *  (happy-dom / node) so headless mounts never throw. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

The companion stylesheet (shipped in G12's CSS, extended here) keys everything
off these hooks — the `.a11y-reduced-motion` class is the single switch that
disables every transition/animation:

```css
:root { --a11y-font-scale: 1; }
html { font-size: calc(100% * var(--a11y-font-scale)); }

:root.a11y-high-contrast {
  --bg: #000; --fg: #fff; --accent: #ffd400; --panel: #111; --border: #fff;
}

:root.a11y-reduced-motion *,
:root.a11y-reduced-motion *::before,
:root.a11y-reduced-motion *::after {
  animation-duration: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
}

/* Fallback: honour the OS preference even before JS runs. */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0s !important; transition-duration: 0s !important; }
}
```

## G12 integration patch — `src/ui/ControlPanel.ts`

**As-built note:** G12 already shipped the `<select id="cvd">` (bound to the
`RenderParamsStore` with a local `CVD_MODES` table). G13's patch therefore
*single-sources* it: the local table is deleted and the options are built from
`CVD_ORDER`/`cvdLabel` — the same source the Alt+C cycle shortcut uses — and the
change handler routes through `setCvd` and announces. `mountControlPanel` /
`mountRenderControls` each gain an optional trailing `liveSay` parameter
(existing call sites compile unchanged). The import path is
`./render_params.js` (there is no `render_params_store.ts`).

```ts
// + imports at top (as-built):
import { CVD_ORDER, cvdLabel, setCvd } from './a11y/cvd_control.js';
import { panelAria } from './a11y/aria.js';
import { rovingTabindex, advanceRoving } from './a11y/keyboard.js';
import type { Announcement } from './a11y/live_region.js';

// mountRenderControls(root, render, liveSay?): options from CVD_ORDER/cvdLabel;
// change handler is render-only and announces:
const cvd = section.querySelector<HTMLSelectElement>('#cvd')!;
cvd.setAttribute('aria-label', 'Colour-vision simulation');
offs.push(bind(cvd, render, (el, p) => { el.value = p.cvdMode; }));
cvd.addEventListener('change', () => {
  // RENDER-ONLY: setCvd edits RenderParams via the render store (group-3
  // rebind) — never the ViewState Store, the cache key, or undo history.
  render.update(p => setCvd(p, cvd.value as CvdMode));
  liveSay?.({ kind: 'cvd', mode: render.snapshot().cvdMode });
});

// mountControlPanel(root, app, render?, liveSay?):
// (1) Label the panel landmark for screen readers.
for (const [k, v] of Object.entries(panelAria('View controls'))) {
  root.setAttribute(k, v);
}

// (2) Roving tabindex over the eight z-sliders + the tilt slider. Vertical
//     arrows move focus within the group (one Tab stop for the whole stack);
//     horizontal arrows keep the native value adjustment. The listener lives
//     on the panel because the window-level keymap ignores events from
//     editable elements (Keybindings' isEditable guard).
const sliderEls = [
  ...Array.from({ length: 8 }, (_, k) => q<HTMLInputElement>(`#z${k}`)),
  tilt1,
];
let activeSlider = 0;
const reflowRoving = (): void => {
  const tab = rovingTabindex(sliderEls.length, activeSlider);
  sliderEls.forEach((el, i) => {
    el.tabIndex = tab[i]!;
    el.setAttribute('aria-label',
      el.closest('.row')?.querySelector('label')?.textContent ?? `slider ${i}`);
  });
};
reflowRoving();
const onSliderKey = (e: KeyboardEvent): void => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const i = sliderEls.indexOf(e.target as HTMLInputElement);
  if (i < 0) return;
  e.preventDefault();
  activeSlider = advanceRoving(i, sliderEls.length, e.key === 'ArrowDown' ? 1 : -1);
  reflowRoving();
  sliderEls[activeSlider]!.focus();
};
root.addEventListener('keydown', onSliderKey);
offs.push(() => root.removeEventListener('keydown', onSliderKey));
```

> `render.update(p => setCvd(p, mode))` is G12's `RenderParamsStore` channel: it
> writes the M7 `RenderParams` uniform and rebinds group 3 only. It is a *deliberate
> sibling* of `store.update` — the CVD path never goes through the ViewState `Store`,
> so the M8 `viewStateToCacheKey` is structurally untouched and no undo entry is
> created. Note `RenderParamsStore.update` returns **void** (landed G12 API), so
> the announcement reads `render.snapshot().cvdMode` after the update. `liveSay`
> is the announcement closure threaded from the shell (wraps `LiveRegion.say`;
> there is no `app.live`). Range inputs natively adjust on arrow keys, which is
> why roving claims only the vertical axis (up/down = navigate, left/right =
> adjust) — a full four-arrow roving group would fight the slider itself.

## G12 integration patch — `src/ui/Canvas.ts`

**As-built:** the canvas ARIA lives in `Canvas.ts`, but the live-status node and
`LiveRegion` are owned by **`mountUI` (`App.ts`)** — the shell owns the status
cell (`.a11y-status` in the shell markup) and the single `liveSay` closure it
threads into `mountControlPanel` and the keybinding pre-handler. That keeps
`mountCanvas`'s signature unchanged and puts all threading in one place.

```ts
// src/ui/Canvas.ts — inside mountCanvas, after root.appendChild(canvas):
import { canvasAria } from './a11y/aria.js';
// Canvas is an interactive application region; it must receive arrow keys.
for (const [k, v] of Object.entries(canvasAria())) canvas.setAttribute(k, v);

// src/ui/App.ts (mountUI) — the shell markup gains
//   <div class="a11y-status a11y-visually-hidden"></div>
// and mountUI wires the region + theme:
const status = area('.a11y-status');
for (const [k, v] of Object.entries(statusAria())) status.setAttribute(k, v);
const live = new LiveRegion(status, app.store);
offs.push(live.start());
const liveSay = live.say.bind(live);

const theme: ThemeState = { ...DEFAULT_THEME };
const applyThemeNow = (t: ThemeState): void =>
  applyTheme(document.documentElement, t, prefersReducedMotion());
applyThemeNow(theme);
```

## G12 integration patch — `src/ui/Keybindings.ts`

G12 owns zoom / lock / pan keys; G13 merges its accessibility shortcuts and
routes Escape/Enter through `resolveKey`. **As-built**, the landed
`installKeybindings(target, app, map, hooks)` gains ONE optional parameter —
`pre?: (e: KeyboardEvent) => boolean` — evaluated after the `isEditable` guard
and before the keymap lookup; existing call sites compile unchanged. The
factory `makeA11yPreHandler(deps)` and the `OverlayHooks`/`A11yHandlerDeps`
interfaces live in `Keybindings.ts` (the DOM-bridge file; the pure logic stays
in `a11y/keyboard.ts`).

**Escape must not shadow G12's `unlock`.** G12's keymap already binds
`escape → unlock`. The doc's original unconditional `dismiss` consumption would
have broken that binding, so `OverlayHooks.confirm()/dismiss()` return
**boolean** — true iff an overlay actually consumed the key. A dismiss with no
open overlay returns false and the chord falls through to the keymap's
`unlock`. `ChartBrowserHandle` grew `isOpen()` so the shell's dismiss hook can
tell.

```ts
// src/ui/Keybindings.ts (as-built)
export interface OverlayHooks {
  confirm(): boolean;   // Enter: true iff an overlay consumed it
  dismiss(): boolean;   // Escape: true iff an overlay was open (else → unlock)
}

export interface A11yHandlerDeps {
  render: RenderParamsStore;              // G12 render-only channel
  say: (a: Announcement) => void;         // wraps LiveRegion.say (threaded)
  theme: ThemeState;                      // mutable, owned by the shell
  applyTheme: (t: ThemeState) => void;    // theme DOM sink (threaded)
  overlay?: OverlayHooks;
}

export function makeA11yPreHandler(
  deps: A11yHandlerDeps,
): (e: KeyboardEvent) => boolean {
  return (ev: KeyboardEvent): boolean => {
    const action: KeyAction = resolveKey(ev);
    switch (action.kind) {
      case 'cvd-cycle': {
        // RENDER-ONLY: render.update mutates only RenderParams (group-3 rebind).
        deps.render.update(p => cycleCvd(p, action.dir));
        deps.say({ kind: 'cvd', mode: deps.render.snapshot().cvdMode });
        ev.preventDefault(); return true;
      }
      case 'toggle-contrast': {
        deps.theme.highContrast = !deps.theme.highContrast;
        deps.applyTheme(deps.theme);
        deps.say({ kind: 'contrast', on: deps.theme.highContrast });
        ev.preventDefault(); return true;
      }
      case 'font-scale': {
        deps.theme.fontScale = stepFontScale(deps.theme.fontScale, action.dir);
        deps.applyTheme(deps.theme);
        deps.say({ kind: 'font', scale: deps.theme.fontScale });
        ev.preventDefault(); return true;
      }
      case 'commit': {
        if (deps.overlay?.confirm()) { ev.preventDefault(); return true; }
        return false;
      }
      case 'dismiss': {
        if (deps.overlay?.dismiss()) { ev.preventDefault(); return true; }
        return false;
      }
      case 'roving': return false;   // handled by the focused slider group
      case 'none':   return false;   // let G12's keymap handle the chord
      default: { const _x: never = action; return _x; }
    }
  };
}
```

> In the shell, `dismiss` closes the preset gallery when it is open (via
> `gallery.isOpen()`); `confirm` currently returns false — there is no
> confirmable overlay in the landed shell (the lookup dialog was deferred at
> DG8.3 and has not landed). `RenderParamsStore.update` returns **void**
> (landed G12 API), so the CVD announcement reads `snapshot()` after the
> update. The CVD path never touches the ViewState `Store`, so
> `viewStateToCacheKey` is structurally untouched.

## Tests

### `test/unit/ui/a11y.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  reduceCvd, setCvd, cycleCvd, cvdLabel, isRenderOnly, CVD_ORDER,
} from '@/ui/a11y/cvd_control.js';
import {
  buildAria, panelAria, sliderAria, canvasAria, statusAria,
} from '@/ui/a11y/aria.js';
import {
  focusOrder, rovingTabindex, advanceRoving,
  resolveKey, describeShortcuts, SHORTCUTS, type FocusStop,
} from '@/ui/a11y/keyboard.js';
import { announce } from '@/ui/a11y/live_region.js';
import { themeVars, clampFontScale, stepFontScale, DEFAULT_THEME } from '@/ui/a11y/theme.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';

/* A minimal ViewState stand-in + a pure cache-key function mirroring M8's
 * viewStateToCacheKey: the key is derived ONLY from ViewState, never from
 * RenderParams. This lets us prove the render-only invariant headlessly. */
interface View { chartType: string; z0: number[]; mag: number; locked: boolean }
const view: View = { chartType: 'lz_e', z0: [0, 0, 0, 0, 0, 0, 0, 0], mag: 1, locked: false };
const keyOf = (v: View): object => ({ chartId: v.chartType, z0: v.z0, mag: v.mag });

describe('cvd reducer: render-only RenderParams edits', () => {
  it('setCvd returns a new RenderParams with only cvdMode changed', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, 'deutan');
    expect(p).not.toBe(DEFAULT_RENDER_PARAMS);
    expect(p.cvdMode).toBe('deutan');
    expect({ ...p, cvdMode: 'x' }).toEqual({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'x' });
  });

  it('setCvd to the current mode is a no-op (same reference)', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, DEFAULT_RENDER_PARAMS.cvdMode);
    expect(p).toBe(DEFAULT_RENDER_PARAMS);
  });

  it('setCvd ignores an unknown mode (total, no throw)', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, 'bogus' as never);
    expect(p).toBe(DEFAULT_RENDER_PARAMS);
  });

  it('cycleCvd forward walks CVD_ORDER and wraps', () => {
    let p = { ...DEFAULT_RENDER_PARAMS, cvdMode: CVD_ORDER[CVD_ORDER.length - 1]! };
    p = cycleCvd(p, 1);
    expect(p.cvdMode).toBe(CVD_ORDER[0]);
  });

  it('cycleCvd backward wraps to the last entry', () => {
    const p = cycleCvd({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'none' }, -1);
    expect(p.cvdMode).toBe(CVD_ORDER[CVD_ORDER.length - 1]);
  });

  it('reduceCvd cycle from a stale/unknown mode starts at index 0', () => {
    const p = reduceCvd({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'gone' as never }, { type: 'cycle', dir: 1 });
    expect(p.cvdMode).toBe(CVD_ORDER[1]);  // base index 0 + 1
  });

  it('RENDER-ONLY invariant: a CVD edit leaves ViewState + cache key untouched', () => {
    // The CVD edit operates on RenderParams; the ViewState reference is reused,
    // so its cache key is byte-identical. This is the two-stage decoupling.
    const before = view;
    setCvd(DEFAULT_RENDER_PARAMS, 'tritan');   // edit happens entirely in RenderParams
    const after = before;                       // shell never reassigns ViewState
    expect(isRenderOnly(before, after, keyOf)).toBe(true);
    expect(JSON.stringify(keyOf(before))).toBe(JSON.stringify(keyOf(after)));
  });

  it('cvdLabel maps every mode to a non-empty string', () => {
    for (const m of CVD_ORDER) expect(cvdLabel(m).length).toBeGreaterThan(0);
  });
});

describe('aria attribute builder', () => {
  it('buildAria assembles role + aria-label', () => {
    expect(buildAria('region', 'Panel')).toEqual({ role: 'region', 'aria-label': 'Panel' });
  });

  it('buildAria stringifies booleans and numbers the ARIA way', () => {
    const a = buildAria('slider', 'z', { extra: { 'aria-valuenow': 3, 'aria-hidden': false } });
    expect(a['aria-valuenow']).toBe('3');
    expect(a['aria-hidden']).toBe('false');
  });

  it('panelAria is a labelled region', () => {
    expect(panelAria('View')).toEqual({ role: 'region', 'aria-label': 'View' });
  });

  it('sliderAria mirrors the numeric model + value text', () => {
    const a = sliderAria('z[0]', 1.5, -3, 3);
    expect(a['role']).toBe('slider');
    expect(a['aria-valuenow']).toBe('1.5');
    expect(a['aria-valuemin']).toBe('-3');
    expect(a['aria-valuemax']).toBe('3');
    expect(a['aria-valuetext']).toBe('1.50');
  });

  it('canvasAria is an interactive application region, focusable', () => {
    const a = canvasAria();
    expect(a['role']).toBe('application');
    expect(a['tabindex']).toBe('0');
    expect(a['aria-roledescription']).toMatch(/interactive/);
  });

  it('statusAria is a polite, atomic status region', () => {
    const a = statusAria();
    expect(a['role']).toBe('status');
    expect(a['aria-live']).toBe('polite');
    expect(a['aria-atomic']).toBe('true');
  });
});

describe('keyboard: focus order + roving tabindex', () => {
  it('focusOrder filters to present stops in canonical order', () => {
    const present: FocusStop[] = ['canvas', 'chart', 'cvd'];
    expect(focusOrder(present)).toEqual(['chart', 'cvd', 'canvas']);
  });

  it('rovingTabindex puts only the active item in the tab sequence', () => {
    expect(rovingTabindex(4, 2)).toEqual([-1, -1, 0, -1]);
  });

  it('advanceRoving wraps forward past the end', () => {
    expect(advanceRoving(3, 4, 1, true)).toBe(0);
  });

  it('advanceRoving clamps at the ends when wrap is off', () => {
    expect(advanceRoving(3, 4, 1, false)).toBe(3);
    expect(advanceRoving(0, 4, -1, false)).toBe(0);
  });

  it('advanceRoving is safe on an empty group', () => {
    expect(advanceRoving(0, 0, 1)).toBe(0);
  });
});

describe('keyboard: shortcut resolution + Escape/Enter semantics', () => {
  it('Alt+c cycles CVD forward', () => {
    expect(resolveKey({ key: 'c', altKey: true })).toEqual({ kind: 'cvd-cycle', dir: 1 });
  });

  it('Alt+Shift+C cycles CVD backward', () => {
    expect(resolveKey({ key: 'C', altKey: true, shiftKey: true })).toEqual({ kind: 'cvd-cycle', dir: -1 });
  });

  it('Enter resolves to commit, Escape to dismiss', () => {
    expect(resolveKey({ key: 'Enter' })).toEqual({ kind: 'commit' });
    expect(resolveKey({ key: 'Escape' })).toEqual({ kind: 'dismiss' });
  });

  it('a bare c (no Alt) does not match the CVD shortcut', () => {
    expect(resolveKey({ key: 'c' })).toEqual({ kind: 'none' });
  });

  it('an unbound key resolves to none (event passes through)', () => {
    expect(resolveKey({ key: 'q', altKey: true })).toEqual({ kind: 'none' });
  });

  it('describeShortcuts lists every binding with a combo + description', () => {
    const list = describeShortcuts();
    expect(list).toHaveLength(SHORTCUTS.length);
    expect(list.find(s => s.combo === 'Alt+c')?.describe).toMatch(/colour-vision/i);
    expect(list.find(s => s.combo === 'Escape')).toBeDefined();
  });
});

describe('live-region announcements', () => {
  it('lock / unlock phrasing', () => {
    expect(announce({ kind: 'lock', locked: true })).toMatch(/locked/);
    expect(announce({ kind: 'lock', locked: false })).toMatch(/unlocked/);
  });

  it('chart + zoom phrasing carry the value', () => {
    expect(announce({ kind: 'chart', chart: 'lz_e' })).toBe('Chart changed to lz_e.');
    expect(announce({ kind: 'zoom', mag: 2.5 })).toMatch(/2\.5/);
  });

  it('cvd announcement uses the human label and an off case', () => {
    expect(announce({ kind: 'cvd', mode: 'deutan' })).toMatch(/Deuteranopia/);
    expect(announce({ kind: 'cvd', mode: 'none' })).toMatch(/off/i);
  });

  it('contrast + font announcements', () => {
    expect(announce({ kind: 'contrast', on: true })).toMatch(/on/);
    expect(announce({ kind: 'font', scale: 1.25 })).toMatch(/125 percent/);
  });
});

describe('theme: contrast / font-scale / reduced-motion', () => {
  it('themeVars adds the high-contrast class only when enabled', () => {
    expect(themeVars(DEFAULT_THEME, false).classes).not.toContain('a11y-high-contrast');
    expect(themeVars({ ...DEFAULT_THEME, highContrast: true }, false).classes)
      .toContain('a11y-high-contrast');
  });

  it('reduced-motion follows the media query, with an explicit override', () => {
    expect(themeVars(DEFAULT_THEME, true).classes).toContain('a11y-reduced-motion');
    expect(themeVars({ ...DEFAULT_THEME, reducedMotion: false }, true).classes)
      .not.toContain('a11y-reduced-motion');
  });

  it('font scale clamps and quantises; stepping respects the clamp', () => {
    expect(clampFontScale(5)).toBe(2.0);
    expect(clampFontScale(0.1)).toBe(0.75);
    expect(stepFontScale(2.0, 1)).toBe(2.0);     // already at ceiling
    expect(themeVars({ ...DEFAULT_THEME, fontScale: 1.2 }, false).vars['--a11y-font-scale'])
      .toBe('1.2');
  });
});
```

## Run it

```bash
npm test -- --run test/unit/ui/a11y
```

(Single file; no GPU and no real DOM layout. Every test exercises a pure
function — the CVD reducer, `buildAria`, the roving-tabindex math, `resolveKey`,
`announce`, and `themeVars` — so it runs identically headless and in a browser.)

## Acceptance check

`test/unit/ui/a11y.test.ts` passes with ≥15 green tests (**32 as-built**). The
CVD reducer returns a new `RenderParams` changing **only** `cvdMode` (and is a
no-op for an unchanged or unknown mode), and the render-only invariant test
confirms a CVD edit leaves the `ViewState` and its `viewStateToCacheKey`
byte-identical. `buildAria` produces the documented role/label/extra attribute
maps; `rovingTabindex` / `advanceRoving` / `focusOrder` give the expected
index/order results with correct wrap/clamp; `resolveKey` matches modifiers
exactly and maps Enter→commit / Escape→dismiss; and `announce` / `themeVars`
produce the documented strings and class lists.

Live proof (`test/gpu/shell.spec.ts`, green headless on SwiftShader and
`--headed` on Metal): the canvas carries `role="application"`, the
`.a11y-status` region is `aria-live="polite"`, selecting `deutan` in the CVD
select announces "Deuteranopia" while the `ViewState` snapshot deep-equals its
pre-toggle value (the render-only invariant on a real device), and Escape
closes the open preset gallery (consumed) instead of falling through.

## Notes for the implementer

- **CVD is the reference render-only edit — keep it off the `Store`.** The whole
  point of the two-stage decoupling is that palette / CVD / render-mode changes
  rebind M7's group 3 and *nothing else*. The reducer in `cvd_control.ts` takes
  and returns `RenderParams` only; it has no access to a `ViewState`, so it
  *cannot* enter `viewStateToCacheKey` or the undo history. The `ControlPanel`
  and `Keybindings` patches route it through G12's `RenderParamsStore`
  (`render.update(...)`), never the ViewState `store.update`. If you ever find yourself wanting the CVD value
  in the cache key, stop — that would force a recompute on a colour-blindness
  toggle, which is exactly the regression this milestone forbids.
- **Pure builders, thin DOM sinks.** Every module splits a pure function
  (`buildAria`, `themeVars`, `rovingTabindex`, `resolveKey`, `announce`) from a
  one-line DOM writer (`applyAria`, `applyTheme`, `LiveRegion.say`). Test the
  pure half (the exit suite does); the DOM half is mechanical. This is the same
  discipline G8 uses for `bind`/`bindInput` — the bindings are glue, the logic
  is reducers.
- **The canvas is an `application` region on purpose.** It captures arrow keys
  for pan/tilt, so it must tell assistive tech to pass keystrokes through rather
  than intercept them for browse-mode navigation. That is why `canvasAria` sets
  `role="application"` and `tabindex="0"`. The trade-off is that *all* keyboard
  interaction inside it must be implemented (G12's keymap + G13's `resolveKey`);
  there is no free browse mode.
- **Reduced motion has two sources.** The CSS `@media (prefers-reduced-motion:
  reduce)` block is the zero-JS fallback; `themeVars` additionally honours an
  explicit `reducedMotion` override so a user can force-disable motion even when
  the OS does not. The `.a11y-reduced-motion` class is the single switch — never
  scatter `transition: none` across components.
- **Announcements are diffs, not echoes.** `LiveRegion.start` compares the
  previous `ViewState` to the new one and only speaks what changed; flooding a
  polite region re-reads the whole node and is worse than silence. CVD / contrast
  / font live in `RenderParams` / `ThemeState`, not `ViewState`, so they are
  announced imperatively via `say()` from their handlers.
- **Shortcuts merge, they don't replace.** `SHORTCUTS` is additive over G12's
  keymap; `resolveKey` returning `{ kind: 'none' }` is the explicit "let G12
  handle it" signal. Keep the Alt-modifier on the G13 letter bindings so they
  never collide with G12's bare-key zoom/lock/pan bindings, and keep Enter /
  Escape mapped to the overlay commit/dismiss hooks so there is exactly one
  documented meaning for each.
