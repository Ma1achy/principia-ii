import type { App } from '@/app/app.js';
import type { PerfMonitor } from '@/perf/perf_monitor.js';
import type { InMemorySink } from '@/error/telemetry.js';
import type { InspectorResult } from '@/inspector/types.js';
import type { FrameCaptureV2 } from './capture.js';
import { perfHudVM, type PerfHudVM } from './perf_view.js';
import { errorOverlayVM, type ErrorOverlayVM } from './error_view.js';
import { validationVM, type ValidationVM } from './validation_view.js';
import { checkCaptureReplayable } from './capture.js';
import {
  initDevOverlay, devOverlayReducer,
  type DevOverlayState, type DevOverlayAction, type DevTab, DEV_TABS,
} from './overlay_state.js';

export interface DebugHudDeps {
  perf: PerfMonitor;                          // G10
  sink: Pick<InMemorySink, 'records'>;        // G11 telemetry buffer
  /** Live per-tile status_flags (tileKey → u32), supplied by the caller. */
  tileFlags: () => ReadonlyMap<string, number>;
  /** The current locked inspector result, or null when unlocked (M9 / G2). */
  inspector: () => InspectorResult | null;
  /** Snapshot the live dispatch inputs as an extended capture, or null
   *  before the first dispatch. Called on the capture button's click —
   *  never on the render poll, so a capture is a stable, user-taken
   *  snapshot rather than a churning live view. */
  capture?: () => FrameCaptureV2 | null;
  /** Injectable rAF for tests; defaults to requestAnimationFrame. */
  raf?: (cb: () => void) => number;
  caf?: (h: number) => void;
}

/**
 * Mount the dev overlay into `root`. Read-only over `app.store` (it never
 * calls update/setView — the structural guarantee it can't enter the G12
 * history ring or invalidate the cache). Returns an `off()` that
 * unsubscribes and stops the rAF poll. No-op when `document` is absent —
 * headless CI safe.
 */
export function mountDebugHud(
  root: HTMLElement, app: App, deps: DebugHudDeps,
): () => void {
  if (typeof document === 'undefined') return () => {};

  const raf = deps.raf ?? ((cb): number => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((h): void => cancelAnimationFrame(h));

  let state: DevOverlayState = initDevOverlay();
  let captured: FrameCaptureV2 | null = null;   // the user's taken snapshot
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

  function render(): void {
    if (!state.visible) return;
    body.replaceChildren();
    const tier = app.store.snapshot().qualityTier;
    if (state.tab === 'perf') {
      body.appendChild(renderPerf(
        perfHudVM(deps.perf.snapshot(), deps.perf.recommend(tier))));
    } else if (state.tab === 'errors') {
      body.appendChild(renderErrors(errorOverlayVM(deps.sink, deps.tileFlags())));
    } else if (state.tab === 'validation') {
      const r = deps.inspector();
      body.appendChild(renderValidation(r ? validationVM(r) : null));
    } else {
      body.appendChild(renderCaptureTab(captured, deps.capture, (cap) => {
        captured = cap;
        render();
      }));
    }
  }

  const dispatch = (a: DevOverlayAction): void => {
    state = devOverlayReducer(state, a);
    drawer.hidden = !state.visible;
    render();
  };

  for (const btn of root.querySelectorAll<HTMLButtonElement>('.devhud-tabs button')) {
    btn.addEventListener('click', () =>
      dispatch({ type: 'selectTab', tab: btn.dataset['tab'] as DevTab }));
  }

  // `~` toggles the overlay. The keybinding is registered here so the dev
  // tool is self-contained — G12's keymap is for user-facing,
  // compute-affecting actions and the dev HUD must not enter that map.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === '~' || (e.key === '`' && e.shiftKey)) dispatch({ type: 'toggle' });
  };
  window.addEventListener('keydown', onKey);
  offs.push(() => window.removeEventListener('keydown', onKey));

  // Render-only poll: re-derive the visible tab each frame. Never writes
  // view state. The capture tab is EXCLUDED from the poll — it holds an
  // interactive button and a user-taken snapshot, neither of which is
  // live data, and a per-frame rebuild detaches the button faster than a
  // click can land. It re-renders on dispatch (tab switch, toggle, take).
  let rafHandle = 0;
  const tick = (): void => {
    if (state.tab !== 'capture') render();
    rafHandle = raf(tick);
  };
  rafHandle = raf(tick);
  offs.push(() => caf(rafHandle));

  // Read-only subscription: a ViewState change re-renders (e.g. tier badge).
  offs.push(app.store.subscribe(() => render()));

  return () => { offs.forEach(off => off()); root.replaceChildren(); };
}

// ── tiny DOM builders (presentation only; all logic is in the VMs) ──────

function renderPerf(vm: PerfHudVM): HTMLElement {
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

function renderErrors(vm: ErrorOverlayVM): HTMLElement {
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

function renderValidation(vm: ValidationVM | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'devhud-validation';
  if (!vm || !vm.available) {
    el.textContent = vm ? `outcome ${vm.outcome} · no GPU comparison`
                        : 'no locked inspector result';
    return el;
  }
  el.classList.toggle('flagged', vm.flagged);
  el.textContent =
    `outcome ${vm.outcome} · outcomeAgrees ${vm.gpuOutcomeAgrees} ` +
    `· ftleΔ ${vm.gpuFtleDelta.toFixed(4)} · wordAgrees ${vm.gpuWordAgrees}`;
  return el;
}

function renderCaptureTab(
  captured: FrameCaptureV2 | null,
  take: (() => FrameCaptureV2 | null) | undefined,
  onCaptured: (cap: FrameCaptureV2 | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'devhud-capture-tab';

  const btn = document.createElement('button');
  btn.className = 'devhud-capture-take';
  btn.textContent = 'capture now';
  btn.disabled = take === undefined;
  btn.title = take === undefined
    ? 'no capture source wired' : 'snapshot the last dispatch inputs';
  btn.addEventListener('click', () => onCaptured(take?.() ?? null));
  wrap.appendChild(btn);

  wrap.appendChild(renderCapture(captured));

  if (captured) {
    const dl = document.createElement('a');
    dl.className = 'devhud-capture-download';
    dl.textContent = 'download JSON';
    // FrameCaptureV2 is plain JSON (uniforms/tile/chart/view/seeds).
    dl.href = `data:application/json,${
      encodeURIComponent(JSON.stringify(captured, null, 2))}`;
    dl.download = `principia-capture-${captured.cacheKey.slice(0, 24)}.json`;
    wrap.appendChild(dl);
  }
  return wrap;
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
