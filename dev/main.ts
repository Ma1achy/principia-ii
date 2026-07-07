// Production shell boot (G8). Lives in dev/ because the Vite `?raw`
// shader imports (via dev/shader_modules.ts) have no d.ts and src/ must
// stay tsc-clean (G1 convention). Everything substantive is in src/:
// this file only wires detection → GPU → dispatcher → App → UI.
import '@/ui/styles.css';
import { App as AppCore } from '@/app/app.js';
import { makeRealDispatcher } from '@/app/dispatcher.js';
import { mountUI } from '@/ui/App.js';
import { liveCaptureFrom } from '@/devhud/capture.js';
import { RenderParamsStore } from '@/ui/render_params.js';
import { detectCapabilities } from '@/gpu/capability.js';
import { appEnv } from '@/env.js';
import { initGpu, UnsupportedError } from '@/gpu/init.js';
import { ErrorBoundary, Telemetry, InMemorySink, Level } from '@/error/index.js';
import { defaultViewState } from '@/interact/view_state.js';
import { tileKey } from '@/quadtree/index.js';
import type { InspectorResult } from '@/inspector/types.js';
import {
  SIMULATE_MODULE, RENDER_LAYER0_MODULE, REDUCE_MODULE, RENDER_GRAPH_MODULE,
} from './shader_modules.js';

const UNSUPPORTED_COPY: Record<string, string> = {
  'no-webgpu': 'This browser has no WebGPU (navigator.gpu). Use a current Chromium/Edge, or enable WebGPU.',
  'no-adapter': 'WebGPU is present but no GPU adapter was offered (blocklisted driver or headless config?).',
  'no-device': 'The GPU adapter refused a device at the requested limits.',
};

/** G15: opt-in offline support. OFF unless VITE_ENABLE_SW=1; a failure
 *  must never block startup — the SW is a progressive enhancement. */
async function registerServiceWorker(): Promise<void> {
  const env = appEnv();
  if (!env.serviceWorker || !('serviceWorker' in navigator)) return;
  try {
    // vite.config.ts emits src/sw.ts as a stable, un-hashed sw.js at the
    // site root (SW_FILE) so the registration URL survives deploys.
    await navigator.serviceWorker.register(`${env.baseUrl}sw.js`, {
      scope: env.baseUrl,
    });
  } catch {
    // Unsupported/blocked SW: the app runs online-only, silently.
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');

  // G9: detect first — an unsupported browser gets a message, not a throw.
  const cap = await detectCapabilities();
  if (!cap.supported || !cap.caps) {
    root.innerHTML = `<div class="boot-error">Principia needs WebGPU.\n${
      UNSUPPORTED_COPY[cap.reason ?? 'no-webgpu']}</div>`;
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = await initGpu(canvas);
  const canvasCtx = canvas.getContext('webgpu');
  if (!canvasCtx) throw new Error('webgpu canvas context unavailable');
  canvasCtx.configure({ device: ctx.device, format: ctx.format, alphaMode: 'opaque' });
  // GPU validation errors are async and never throw (M7's lesson): surface
  // them loudly or the symptom is silently-dropped submissions.
  ctx.device.addEventListener('uncapturederror', (e) => {
    console.error('[principia] uncaptured GPU error:', (e as GPUUncapturedErrorEvent).error.message);
  });

  const dispatcher = await makeRealDispatcher(
    ctx, () => canvasCtx.getCurrentTexture().createView(), {
      simulate: SIMULATE_MODULE,
      renderLayer0: RENDER_LAYER0_MODULE,
      reduce: REDUCE_MODULE,
      renderGraph: RENDER_GRAPH_MODULE,
    });

  // Seed the view from the detected tier (G9 caps feed the defaults).
  // Dev/CI knobs via URL: ?thorizon=20&n=16 shortens the physics horizon
  // and sample grid (SwiftShader in CI is ~100× slower than hardware).
  const qs = new URLSearchParams(location.search);
  const thorizon = Number(qs.get('thorizon')) || 0;
  const nOverride = Number(qs.get('n')) || 0;
  const view = {
    ...defaultViewState(),
    qualityTier: cap.caps.tier,
    samplesPerAxis: nOverride > 0 ? nOverride : cap.caps.samplesPerTileAxis,
    maxDepth: cap.caps.maxDepth,
    ...(thorizon > 0 ? { THorizon: thorizon } : {}),
  };

  // Headless/background Chromium throttles rAF to ~zero until something
  // presents — but the first presentation needs a tick. Race rAF against
  // a coarse timeout so the loop always makes progress; stray timeouts
  // after stop() are no-ops (the loop checks `running`).
  const schedule = (cb: () => void): number => {
    let fired = false;
    const fire = (): void => { if (!fired) { fired = true; cb(); } };
    const raf = requestAnimationFrame(fire);
    setTimeout(fire, 250);
    return raf;
  };

  // G11: every GPU/decode failure funnels through one boundary. Telemetry
  // buffers in memory (a diagnostics HUD reads it in G18); the user-facing
  // message — stack-free by construction — currently lands on the console.
  const telemetrySink = new InMemorySink(500);
  const boundary = new ErrorBoundary(
    new Telemetry({ minLevel: Level.Info, sink: telemetrySink }),
    { onUserError: (_app, message) => console.warn('[principia]', message) },
  );

  const app = new AppCore(dispatcher, {
    now: () => performance.now(),
    schedule,
    cancel: (id) => cancelAnimationFrame(id),
  }, {
    initialView: view,
    viewport: { widthPx: canvas.width, heightPx: canvas.height, tilePix: 256 },
    // G10: the dispatcher only times passes when initGpu enabled
    // timestamp-query on this device; tell the monitor the same thing.
    gpuTimingAvailable: ctx.device.features.has('timestamp-query'),
    boundary,
  });

  // G12: render-only knobs rebind M7 group 3 through the dispatcher —
  // never the view store, never the cache, never the undo history.
  const renderStore = new RenderParamsStore(
    undefined, (p) => dispatcher.setRenderParams(p));

  // G18: dev overlay ('~' toggles). Read-only feeds: perf monitor, telemetry
  // buffer, live per-tile status_flags, and the locked inspector result.
  // The inspector promise is tracked by identity — App.inspector() returns
  // the same promise per lock, so a resolved result is cached until the
  // lock changes (never re-runs the inspector from the HUD poll).
  const tileFlags = (): ReadonlyMap<string, number> => {
    const m = new Map<string, number>();
    for (const t of app.loop.cache.entries()) {
      if (t.reduction) m.set(tileKey(t.id), t.reduction.status_flags);
    }
    return m;
  };
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
    debug: {
      perf: app.loop.perf, sink: telemetrySink, tileFlags, inspector: inspectorNow,
      // The HUD's capture button: last dispatch inputs + current view →
      // FrameCaptureV2 (null before the first tile job).
      capture: () => liveCaptureFrom(dispatcher.lastDispatch(), app.store.snapshot()),
    },
  });
  app.start();
  void registerServiceWorker();

  for (const w of cap.warnings) console.warn('[principia]', w);
  // Expose for the headless shell check (dev/out/g8_shell_check.mjs) and
  // the G14 regression specs (renderStore: render-only mode switching).
  (window as unknown as { __principia?: unknown }).__principia =
    { app, cap, telemetry: telemetrySink, renderStore };
}

main().catch((err: unknown) => {
  const msg = err instanceof UnsupportedError
    ? UNSUPPORTED_COPY[err.reason]
    : err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  document.body.innerHTML = `<div class="boot-error">Failed to start: ${msg}</div>`;
});
