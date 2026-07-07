import type { App as AppCore } from '@/app/app.js';
import type { ViewState } from '@/interact/view_state.js';
import type { ErrorBoundary } from '@/error/boundary.js';
import type { CapabilityProfile } from '@/gpu/capability.js';
import { mountControlPanel } from './ControlPanel.js';
import { mountCanvas, type GestureGate } from './Canvas.js';
import { mountInspectorPanel } from './InspectorPanel.js';
import { mountChartBrowser } from './ChartBrowser.js';
import { mountChrome } from './Chrome.js';
import { mountLoadingIndicator } from './LoadingIndicator.js';
import { installKeybindings, makeA11yPreHandler, type OverlayHooks } from './Keybindings.js';
import { RenderParamsStore } from './render_params.js';
import { statusAria } from './a11y/aria.js';
import { LiveRegion } from './a11y/live_region.js';
import { applyTheme, prefersReducedMotion, DEFAULT_THEME, type ThemeState } from './a11y/theme.js';
import { PresetStore } from './presets.js';
import { initHistory, pushHistory, type History } from './history.js';
import { buildKeymap } from './keymap.js';
import { mountDebugHud, type DebugHudDeps } from '@/devhud/mount.js';

/** Shell dependencies (G12). Everything optional: the G8-era 3-arg
 *  mountUI(root, app, canvas) still works (tests, minimal embeds) —
 *  omitted pieces simply don't mount their chrome. */
export interface ShellDeps {
  boundary?: ErrorBoundary;            // G11: error overlay source
  capability?: CapabilityProfile;      // G9: warning banner source
  renderStore?: RenderParamsStore;     // render-only knobs (group-3 rebind)
  presets?: PresetStore;
  debug?: DebugHudDeps;                // G18: dev overlay (absent in prod)
}

export function mountUI(
  root: HTMLElement, app: AppCore, canvas: HTMLCanvasElement,
  deps: ShellDeps = {},
): () => void {
  root.innerHTML = `
    <div class="shell layout">
      <header class="shell-chrome"></header>
      <main class="canvas-area"></main>
      <aside class="control-area"></aside>
      <aside class="inspector-area"></aside>
      <section class="gallery-area"></section>
      <div class="loader-area"></div>
      <div class="devhud-area"></div>
      <div class="a11y-status a11y-visually-hidden"></div>
    </div>
  `;
  const area = (sel: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`mountUI: missing ${sel}`);
    return el;
  };

  // --- history ring: captured in ONE Store.subscribe, gated by
  // isComputeChange (inside pushHistory). Render-only edits flow through
  // the separate RenderParamsStore and can never reach it. A pointer
  // gesture suspends pushes and commits ONCE at gesture end.
  let history: History = initHistory(app.store.snapshot());
  let suspended = false;
  let anchor: ViewState | null = null;
  const offs: (() => void)[] = [];
  offs.push(app.store.subscribe((v) => {
    history = suspended ? { ...history, present: v } : pushHistory(history, v);
  }));
  const gate: GestureGate = {
    begin: () => {
      if (suspended) return;
      suspended = true;
      anchor = app.store.snapshot();
    },
    end: () => {
      if (!suspended) return;
      suspended = false;
      const a = anchor ?? history.present;
      anchor = null;
      // Rewind present to the gesture anchor, then push the final view —
      // one entry for the whole drag (or none, if nothing changed).
      history = pushHistory({ ...history, present: a }, app.store.snapshot());
    },
  };
  const getHistory = (): History => history;
  const setHistory = (h: History): void => { history = h; };

  // --- a11y: live region + theme (G13) ---
  const status = area('.a11y-status');
  for (const [k, v] of Object.entries(statusAria())) status.setAttribute(k, v);
  const live = new LiveRegion(status, app.store);
  offs.push(live.start());
  const liveSay = live.say.bind(live);

  const theme: ThemeState = { ...DEFAULT_THEME };
  const applyThemeNow = (t: ThemeState): void =>
    applyTheme(document.documentElement, t, prefersReducedMotion());
  applyThemeNow(theme);

  // --- keybindings → actions over the Store/history ---
  const presets = deps.presets ?? new PresetStore();
  let openPresetsFn = (): void => {};
  // Overlay hooks resolve late (the gallery mounts below); a dismiss with no
  // open overlay returns false so Escape falls through to G12's `unlock`.
  let overlay: OverlayHooks = { confirm: () => false, dismiss: () => false };
  const renderStore = deps.renderStore ?? new RenderParamsStore();
  offs.push(installKeybindings(window, app, buildKeymap(), {
    getHistory, setHistory,
    openPresets: () => openPresetsFn(),
  }, makeA11yPreHandler({
    render: renderStore, say: liveSay, theme, applyTheme: applyThemeNow,
    overlay: { confirm: () => overlay.confirm(), dismiss: () => overlay.dismiss() },
  })));

  // --- mounts ---
  offs.push(mountChrome(area('.shell-chrome'), deps.boundary, deps.capability));
  offs.push(mountCanvas(area('.canvas-area'), app, canvas, gate));
  offs.push(mountControlPanel(area('.control-area'), app, deps.renderStore, liveSay));
  offs.push(mountInspectorPanel(area('.inspector-area'), app));
  const gallery = mountChartBrowser(area('.gallery-area'), app, presets);
  openPresetsFn = () => { gallery.open(); };
  overlay = {
    confirm: () => false,   // no confirmable overlay in the shell yet
    dismiss: () => {
      if (!gallery.isOpen()) return false;
      gallery.close();
      return true;
    },
  };
  offs.push(gallery.dispose);
  offs.push(mountLoadingIndicator(area('.loader-area'), app.loop.ledger, app.loop.perf));
  if (deps.debug) offs.push(mountDebugHud(area('.devhud-area'), app, deps.debug));

  return () => offs.forEach((off) => off());
}
