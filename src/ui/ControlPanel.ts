import type { App } from '@/app/app.js';
import type { IntegratorId, QualityTier, ViewState } from '@/interact/view_state.js';
import type {
  BrightnessMode, ColourMode, CombinerMode, CvdMode, EventClassKey, PaletteId,
} from '@/render/types.js';
import { DEFAULT_EVENT_PALETTE, EVENT_CLASS_KEYS } from '@/render/types.js';
import { linearToSrgb, srgbToLinear } from '@/render/oklab.js';
import { zoomViewport } from '@/app/viewport_nav.js';
import { bind, bindInput } from './reactive.js';
import type { RenderParamsStore } from './render_params.js';
import { CVD_ORDER, cvdLabel, setCvd } from './a11y/cvd_control.js';
import { DEBUG_MODES } from '@/debug/debug_modes.js';
import { panelAria } from './a11y/aria.js';
import { rovingTabindex, advanceRoving } from './a11y/keyboard.js';
import type { Announcement } from './a11y/live_region.js';

/** Render-only selectors (G12): the FULL M7 mode space, grouped. Bound to
 *  the RenderParamsStore, NEVER the view Store — a colour/brightness/combiner/
 *  palette/vMF/CVD change rebinds group 3 only (no recompute, no history). */
const COLOUR_MODE_GROUPS: readonly { group: string; modes: readonly { id: ColourMode; label: string }[] }[] = [
  { group: 'Basin', modes: [{ id: 'event_class', label: 'Event classification' }] },
  { group: 'Invariants', modes: [
    { id: 'energy', label: 'Energy' }, { id: 'ang_momentum', label: 'Angular momentum' },
    { id: 'kinetic', label: 'Kinetic' }, { id: 'potential', label: 'Potential' },
    { id: 'virial', label: 'Virial ratio' },
  ] },
  { group: 'Geometry', modes: [
    { id: 'mass_ratio_12', label: 'Mass ratio 1:2' }, { id: 'mass_ratio_13', label: 'Mass ratio 1:3' },
    { id: 'mass_fraction', label: 'Mass fraction' }, { id: 'jacobi_rho1', label: 'Jacobi |ρ1|' },
    { id: 'jacobi_rho2', label: 'Jacobi |ρ2|' }, { id: 'jacobi_ratio', label: 'Jacobi ratio' },
    { id: 'jacobi_angle', label: 'Jacobi angle' }, { id: 'min_pair_dist', label: 'Min pair distance' },
  ] },
  { group: 'Trajectory', modes: [
    { id: 'escape_time', label: 'Escape time' }, { id: 'close_encounters', label: 'Close encounters' },
    { id: 'min_approach', label: 'Min approach' },
  ] },
  { group: 'Diagnostics', modes: [
    { id: 'energy_drift_abs', label: 'Energy drift (abs)' }, { id: 'energy_drift_rel', label: 'Energy drift (rel)' },
    { id: 'lz_drift_abs', label: 'Lz drift (abs)' }, { id: 'lz_drift_rel', label: 'Lz drift (rel)' },
  ] },
  { group: 'Shape / stability', modes: [
    { id: 'shape_sphere_vmf', label: 'Shape sphere (vMF)' },
    { id: 'shape_sphere_okabe_ito', label: 'Shape sphere (Okabe–Ito)' },
    { id: 'stability_x_hue', label: 'Stability × hue' },
  ] },
];
const BRIGHTNESS_MODES: readonly { id: BrightnessMode; label: string }[] = [
  { id: 'flat', label: 'Flat' }, { id: 'time_to_event', label: 'Time to event' },
  { id: 'diffusion', label: 'Diffusion' }, { id: 'bc_proximity', label: 'BC proximity' },
  { id: 'energy_drift', label: 'Energy drift' },
];
const COMBINER_MODES: readonly { id: CombinerMode; label: string }[] = [
  { id: 'replace_lightness', label: 'Replace lightness' },
  { id: 'modulate_lightness', label: 'Modulate lightness' },
  { id: 'multiply_rgb', label: 'Multiply RGB' },
];
const PALETTES: readonly PaletteId[] = [
  'viridis', 'cividis', 'plasma', 'magma', 'inferno',
  'twilight', 'cool_warm', 'principia', 'cubehelix',
];
const EVENT_CLASS_LABELS: Record<EventClassKey, string> = {
  bounded: 'Bounded', timeout: 'Timeout', degenerate: 'Degenerate',
  collision01: 'Collision 1–2', collision02: 'Collision 1–3', collision12: 'Collision 2–3',
  escape0: 'Escape body 1', escape1: 'Escape body 2', escape2: 'Escape body 3',
};

/** Linear-sRGB triple ↔ `<input type=color>` hex (which is gamma sRGB). */
function linearToHex(rgb: readonly [number, number, number]): string {
  const h = (c: number): string =>
    Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255)
      .toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
function hexToLinear(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 0xff) / 255),
    srgbToLinear(((n >> 8) & 0xff) / 255),
    srgbToLinear((n & 0xff) / 255),
  ];
}

/** Mount ONLY the render-only controls (called by mountControlPanel when a
 *  RenderParamsStore is supplied). Every knob here is a group-3 rebind. */
export function mountRenderControls(
  root: HTMLElement, render: RenderParamsStore,
  liveSay?: (a: Announcement) => void,
): () => void {
  const section = document.createElement('details');
  section.className = 'panel render-controls';
  section.open = true;
  section.innerHTML = `
    <summary><h3>Render (no recompute)</h3></summary>
    <div class="row">
      <label for="colourMode">Colour mode</label>
      <select id="colourMode">
        ${COLOUR_MODE_GROUPS.map((g) => `<optgroup label="${g.group}">${
          g.modes.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')
        }</optgroup>`).join('')}
      </select>
    </div>
    <div class="row">
      <label for="brightness">Brightness</label>
      <select id="brightness">
        ${BRIGHTNESS_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
      </select>
    </div>
    <div class="row">
      <label for="combiner">Combiner</label>
      <select id="combiner">
        ${COMBINER_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
      </select>
    </div>
    <div class="row">
      <label for="palette">Palette</label>
      <select id="palette">
        ${PALETTES.map((p) => `<option value="${p}">${p}</option>`).join('')}
      </select>
    </div>
    <div class="row">
      <label for="vmfKappa">vMF κ</label>
      <input type="range" id="vmfKappa" min="0.5" max="12" step="0.1">
      <span id="vmfKappa_v"></span>
    </div>
    <div class="row">
      <label for="vmfChroma">vMF chroma</label>
      <input type="range" id="vmfChroma" min="0.05" max="0.22" step="0.005">
      <span id="vmfChroma_v"></span>
    </div>
    <div class="row">
      <label for="vmfLightness">vMF lightness</label>
      <input type="range" id="vmfLightness" min="0.35" max="0.90" step="0.01">
      <span id="vmfLightness_v"></span>
    </div>
    <div class="row">
      <label for="overlay">Physics overlay</label>
      <input type="checkbox" id="overlay">
      <input type="range" id="overlayStrength" min="0" max="1" step="0.05">
      <span id="overlayStrength_v"></span>
    </div>
    <div class="row">
      <label for="cvd">CVD sim</label>
      <select id="cvd">
        ${CVD_ORDER.map((m) => `<option value="${m}">${cvdLabel(m)}</option>`).join('')}
      </select>
    </div>
    <div class="row">
      <label for="debugMode">Diagnostic</label>
      <select id="debugMode">
        <option value="-1">Off (production colour)</option>
        ${DEBUG_MODES.map((m) => `<option value="${m.mode}">${m.label}</option>`).join('')}
      </select>
    </div>
    <details class="panel event-colours">
      <summary><h3>Event colours</h3></summary>
      ${EVENT_CLASS_KEYS.map((k) => `
        <div class="row">
          <label for="ec_${k}">${EVENT_CLASS_LABELS[k]}</label>
          <input type="color" id="ec_${k}">
        </div>
      `).join('')}
      <div class="row"><button id="ecReset" type="button">Reset to defaults</button></div>
    </details>
  `;
  root.appendChild(section);

  const offs: (() => void)[] = [];
  const q = <T extends Element>(sel: string): T => {
    const el = section.querySelector<T>(sel);
    if (!el) throw new Error(`RenderControls: missing ${sel}`);
    return el;
  };

  // Reactive select bound to a RenderParams field.
  const sel = <V extends string>(
    id: string, get: (p: ReturnType<RenderParamsStore['snapshot']>) => V,
    set: (v: V) => void,
  ): void => {
    const el = q<HTMLSelectElement>(id);
    offs.push(bind(el, render, (e, p) => { e.value = get(p); }));
    el.addEventListener('change', () => set(el.value as V));
  };
  // Reactive range bound to a numeric RenderParams field.
  const num = (
    id: string, get: (p: ReturnType<RenderParamsStore['snapshot']>) => number,
    set: (n: number) => void, fmt: (n: number) => string = (n) => n.toFixed(2),
  ): void => {
    const el = q<HTMLInputElement>(id);
    const lab = q<HTMLSpanElement>(`${id}_v`);
    offs.push(bind(el, render, (e, p) => {
      if (e.ownerDocument.activeElement !== e) e.value = String(get(p));
    }));
    offs.push(bind(lab, render, (e, p) => { e.textContent = fmt(get(p)); }));
    el.addEventListener('input', () => set(parseFloat(el.value) || 0));
  };

  sel<ColourMode>('#colourMode', (p) => p.colourMode,
    (v) => render.update((p) => ({ ...p, colourMode: v })));
  sel<BrightnessMode>('#brightness', (p) => p.brightnessMode,
    (v) => render.update((p) => ({ ...p, brightnessMode: v })));
  sel<CombinerMode>('#combiner', (p) => p.combinerMode,
    (v) => render.update((p) => ({ ...p, combinerMode: v })));
  sel<PaletteId>('#palette', (p) => p.palette,
    (v) => render.update((p) => ({ ...p, palette: v })));
  num('#vmfKappa', (p) => p.vmfKappa, (n) => render.update((p) => ({ ...p, vmfKappa: n })), (n) => n.toFixed(1));
  num('#vmfChroma', (p) => p.vmfChroma, (n) => render.update((p) => ({ ...p, vmfChroma: n })), (n) => n.toFixed(3));
  num('#vmfLightness', (p) => p.vmfLightness, (n) => render.update((p) => ({ ...p, vmfLightness: n })));
  num('#overlayStrength', (p) => p.overlayStrength,
    (n) => render.update((p) => ({ ...p, overlayStrength: n })));

  const overlay = q<HTMLInputElement>('#overlay');
  offs.push(bind(overlay, render, (e, p) => { e.checked = p.physicsOverlay; }));
  overlay.addEventListener('change', () =>
    render.update((p) => ({ ...p, physicsOverlay: overlay.checked })));

  const cvd = q<HTMLSelectElement>('#cvd');
  cvd.setAttribute('aria-label', 'Colour-vision simulation');
  offs.push(bind(cvd, render, (el, p) => { el.value = p.cvdMode; }));
  cvd.addEventListener('change', () => {
    // RENDER-ONLY: setCvd edits RenderParams via the render store (group-3
    // rebind) — never the ViewState Store, the cache key, or undo history.
    render.update((p) => setCvd(p, cvd.value as CvdMode));
    liveSay?.({ kind: 'cvd', mode: render.snapshot().cvdMode });
  });

  // Diagnostic recolour (render-only, group-3): pre-empts the colour switch
  // to visualise the raw descriptor/drift/checkpoint state of the SAME
  // SimResult buffer — no recompute. -1 = off.
  const dbg = q<HTMLSelectElement>('#debugMode');
  offs.push(bind(dbg, render, (el, p) => { el.value = String(p.debugMode); }));
  dbg.addEventListener('change', () =>
    render.update((p) => ({ ...p, debugMode: Number(dbg.value) })));

  // Event-classification colours (render-only): per-class pickers over the
  // EventPalette uniform. Pickers speak gamma-sRGB hex; the store holds
  // linear sRGB (the render graph gamma-encodes at the very end).
  for (const key of EVENT_CLASS_KEYS) {
    const el = q<HTMLInputElement>(`#ec_${key}`);
    offs.push(bind(el, render, (e, p) => {
      if (e.ownerDocument.activeElement !== e) e.value = linearToHex(p.eventPalette[key]);
    }));
    el.addEventListener('input', () => render.update((p) => ({
      ...p, eventPalette: { ...p.eventPalette, [key]: hexToLinear(el.value) },
    })));
  }
  q<HTMLButtonElement>('#ecReset').addEventListener('click', () =>
    render.update((p) => ({ ...p, eventPalette: DEFAULT_EVENT_PALETTE })));

  offs.push(() => section.remove());
  return () => offs.forEach((off) => off());
}

const CHARTS: readonly { id: string; label: string }[] = [
  { id: 'latent_slice', label: 'Latent slice' },
  { id: 'lz_e', label: '(L_z, E)' },
  { id: 'lz_k', label: '(L_z, K)' },
  { id: 'shape_sphere', label: 'Shape sphere' },
  { id: 'mass_simplex', label: 'Mass simplex' },
  { id: 'burrau_euclid', label: 'Burrau Euclid' },
];
const INTEGRATORS: readonly { id: IntegratorId; label: string }[] = [
  { id: 'kdk', label: 'KDK leapfrog' },
  { id: 'yoshida4', label: 'Yoshida 4' },
  { id: 'yoshida6', label: 'Yoshida 6' },
  { id: 'rk4', label: 'RK4 (validation)' },
];
const LATENT_DIMS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function mountControlPanel(
  root: HTMLElement, app: App, render?: RenderParamsStore,
  liveSay?: (a: Announcement) => void,
): () => void {
  const dimOptions = LATENT_DIMS.map((k) => `<option value="${k}">z[${k}]</option>`).join('');
  root.innerHTML = `
    <details class="panel" open>
      <summary><h3>Chart</h3></summary>
      <div class="row">
        <label for="chart">Chart</label>
        <select id="chart">
          ${CHARTS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </div>
    </details>
    <details class="panel" open>
      <summary><h3>Position (z₀)</h3></summary>
      ${LATENT_DIMS.map((k) => `
        <div class="row">
          <label for="z${k}">z[${k}]</label>
          <input type="range" id="z${k}" min="-3" max="3" step="0.01">
          <span id="z${k}_v"></span>
        </div>
      `).join('')}
    </details>
    <details class="panel" open>
      <summary><h3>Slice &amp; tilt</h3></summary>
      <div class="row">
        <label for="tilt1">Tilt 1</label>
        <input type="range" id="tilt1" min="-1.5707" max="1.5707" step="0.01" value="0">
        <span id="tilt1_v"></span>
      </div>
      <div class="row">
        <label for="tilt1Target">↳ into</label>
        <select id="tilt1Target">${dimOptions}</select>
      </div>
      <div class="row">
        <label for="tilt2">Tilt 2</label>
        <input type="range" id="tilt2" min="-1.5707" max="1.5707" step="0.01" value="0">
        <span id="tilt2_v"></span>
      </div>
      <div class="row">
        <label for="tilt2Target">↳ into</label>
        <select id="tilt2Target">${dimOptions}</select>
      </div>
      <div class="row"><span id="tiltOverlap" class="hint"></span></div>
      <div class="row">
        <label for="rotation">Rotation</label>
        <input type="range" id="rotation" min="-3.1416" max="3.1416" step="0.01">
        <span id="rotation_v"></span>
      </div>
      <div class="row">
        <button id="zoomIn" type="button">Zoom in</button>
        <button id="zoomOut" type="button">Zoom out</button>
      </div>
      <div class="row">
        <label>Slice ±</label>
        <button id="magIn" type="button">mag ÷2</button>
        <button id="magOut" type="button">mag ×2</button>
        <span id="mag_v"></span>
      </div>
    </details>
    <details class="panel">
      <summary><h3>Integration</h3></summary>
      <div class="row">
        <label for="integrator">Integrator</label>
        <select id="integrator">
          ${INTEGRATORS.map((i) => `<option value="${i.id}">${i.label}</option>`).join('')}
        </select>
      </div>
      <div class="row"><label for="THorizon">Horizon T</label>
        <input type="number" id="THorizon" min="1" max="1000" step="1"></div>
      <div class="row"><label for="dtMacro">dt macro</label>
        <input type="number" id="dtMacro" min="1e-5" max="1e-1" step="1e-4"></div>
      <div class="row"><label for="NMax">N substeps</label>
        <input type="number" id="NMax" min="1" max="256" step="1"></div>
      <div class="row"><label for="checkpoints">Checkpoints</label>
        <input type="number" id="checkpoints" min="2" max="16" step="1"></div>
    </details>
    <details class="panel">
      <summary><h3>Quality &amp; tiles</h3></summary>
      <div class="row">
        <label for="quality">Quality</label>
        <select id="quality">
          <option value="preview">Preview</option>
          <option value="balanced">Balanced</option>
          <option value="research">Research</option>
        </select>
      </div>
      <div class="row"><label for="samplesPerAxis">Samples/axis</label>
        <input type="number" id="samplesPerAxis" min="1" max="64" step="1"></div>
      <div class="row"><label for="maxDepth">Max depth</label>
        <input type="number" id="maxDepth" min="0" max="24" step="1"></div>
      <div class="row"><label for="ensembleCount">Ensemble E</label>
        <input type="number" id="ensembleCount" min="0" max="16" step="1"></div>
    </details>
    <div class="row"><span id="status" role="status"></span></div>
  `;

  const offs: (() => void)[] = [];
  const store = app.store;
  const q = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`ControlPanel: missing ${sel}`);
    return el;
  };

  // A `type=number` input bound two-way to a numeric ViewState field.
  const numField = (
    id: string, get: (v: ViewState) => number, set: (v: ViewState, n: number) => ViewState,
  ): void => {
    offs.push(bindInput(q<HTMLInputElement>(id), store,
      (v) => String(get(v)), (v, s) => set(v, Number(s) || 0)));
  };
  // A `<select>` bound two-way to a string ViewState field.
  const selField = <V extends string>(
    id: string, get: (v: ViewState) => V, set: (v: ViewState, val: V) => ViewState,
  ): void => {
    const el = q<HTMLSelectElement>(id);
    offs.push(bind(el, store, (e, v) => { e.value = get(v); }));
    el.addEventListener('change', () => store.update((v) => set(v, el.value as V)));
  };
  // A `type=range` bound to a ViewState field with a formatted readout.
  const rangeField = (
    id: string, get: (v: ViewState) => number, set: (v: ViewState, n: number) => ViewState,
    fmt: (n: number) => string,
  ): void => {
    const el = q<HTMLInputElement>(id);
    const lab = q<HTMLSpanElement>(`${id}_v`);
    offs.push(bind(el, store, (e, v) => {
      if (e.ownerDocument.activeElement !== e) e.value = String(get(v));
    }));
    offs.push(bind(lab, store, (e, v) => { e.textContent = fmt(get(v)); }));
    el.addEventListener('input', () => store.update((v) => set(v, parseFloat(el.value) || 0)));
  };

  // Chart picker (goes through preserveLockAcrossChart).
  const chart = q<HTMLSelectElement>('#chart');
  offs.push(bind(chart, store, (el, v) => { el.value = v.chartType; }));
  chart.addEventListener('change', () => {
    const r = app.input.switchChart(chart.value);
    if (!r.ok) statusText(root, `chart switch refused: ${r.reason ?? ''}`);
    else if (r.reason) statusText(root, r.reason);
  });

  // Per-dimension z₀ sliders.
  for (const k of LATENT_DIMS) {
    offs.push(bindInput(q<HTMLInputElement>(`#z${k}`), store,
      (v) => (v.z0[k] ?? 0).toFixed(2),
      (v, value) => {
        const z0 = [...v.z0] as unknown as typeof v.z0;
        (z0 as unknown as number[])[k] = parseFloat(value) || 0;
        return { ...v, z0 };
      }));
    offs.push(bind(q<HTMLSpanElement>(`#z${k}_v`), store,
      (e, v) => { e.textContent = (v.z0[k] ?? 0).toFixed(2); }));
  }

  // Tilt: angles + targets ALL route through app.input.setTilt so the basis
  // (q1, q2) is recomputed from the chart base + Gram–Schmidt (never
  // accumulated). Degrees shown, radians stored.
  const deg = (rad: number): string => `${(rad * 180 / Math.PI).toFixed(1)}°`;
  const tilt1 = q<HTMLInputElement>('#tilt1');
  const tilt2 = q<HTMLInputElement>('#tilt2');
  offs.push(bind(q<HTMLSpanElement>('#tilt1_v'), store, (e, v) => { e.textContent = deg(v.tilt1); }));
  offs.push(bind(q<HTMLSpanElement>('#tilt2_v'), store, (e, v) => { e.textContent = deg(v.tilt2); }));
  tilt1.addEventListener('input', () => app.input.setTilt({ tilt1: parseFloat(tilt1.value) || 0 }));
  tilt2.addEventListener('input', () => app.input.setTilt({ tilt2: parseFloat(tilt2.value) || 0 }));
  const t1t = q<HTMLSelectElement>('#tilt1Target');
  const t2t = q<HTMLSelectElement>('#tilt2Target');
  offs.push(bind(t1t, store, (e, v) => { e.value = String(v.tilt1Target); }));
  offs.push(bind(t2t, store, (e, v) => { e.value = String(v.tilt2Target); }));
  t1t.addEventListener('change', () => app.input.setTilt({ tilt1Target: Number(t1t.value) }));
  t2t.addEventListener('change', () => app.input.setTilt({ tilt2Target: Number(t2t.value) }));
  // Overlap indicator: both tilts targeting one dim leans on the degenerate
  // fallback in reorthonormalise, so warn.
  offs.push(bind(q<HTMLSpanElement>('#tiltOverlap'), store, (e, v) => {
    e.textContent = v.tilt1Target === v.tilt2Target
      ? `⚠ both tilts target z[${v.tilt1Target}]` : '';
  }));

  rangeField('#rotation', (v) => v.rotation, (v, n) => ({ ...v, rotation: n }), deg);

  // Viewport zoom (slippy-map: same slice, deeper tiles — no recompute key).
  q<HTMLButtonElement>('#zoomIn').addEventListener('click',
    () => store.update((v) => zoomViewport(v, 0.5)));
  q<HTMLButtonElement>('#zoomOut').addEventListener('click',
    () => store.update((v) => zoomViewport(v, 2)));

  // Slice extent (mag — recomputes: mag is in the cache key).
  q<HTMLButtonElement>('#magIn').addEventListener('click', () => app.input.zoom(1));
  q<HTMLButtonElement>('#magOut').addEventListener('click', () => app.input.zoom(-1));
  offs.push(bind(q<HTMLSpanElement>('#mag_v'), store,
    (e, v) => { e.textContent = v.mag.toExponential(1); }));

  // Integration. NOTE: the GPU sim honours only KDK today; the integrator
  // select drives the CPU inspector + cache key now, and the GPU path in
  // Stage 3. dt/N/horizon/checkpoints are live on both paths.
  selField<IntegratorId>('#integrator', (v) => v.integrator, (v, val) => ({ ...v, integrator: val }));
  numField('#THorizon', (v) => v.THorizon, (v, n) => ({ ...v, THorizon: n }));
  numField('#dtMacro', (v) => v.dtMacro, (v, n) => ({ ...v, dtMacro: n }));
  numField('#NMax', (v) => v.NMax, (v, n) => ({ ...v, NMax: Math.round(n) }));
  numField('#checkpoints', (v) => v.checkpoints, (v, n) => ({ ...v, checkpoints: Math.round(n) }));

  // Quality & tiles.
  selField<QualityTier>('#quality', (v) => v.qualityTier, (v, val) => ({ ...v, qualityTier: val }));
  numField('#samplesPerAxis', (v) => v.samplesPerAxis, (v, n) => ({ ...v, samplesPerAxis: Math.round(n) }));
  numField('#maxDepth', (v) => v.maxDepth, (v, n) => ({ ...v, maxDepth: Math.round(n) }));
  numField('#ensembleCount', (v) => v.ensembleCount, (v, n) => ({ ...v, ensembleCount: Math.round(n) }));

  // G13: the panel is a labelled landmark region for screen readers.
  for (const [k, v] of Object.entries(panelAria('View controls'))) {
    root.setAttribute(k, v);
  }

  // G13: roving tabindex over the slice sliders (8 z + tilt1 + tilt2). One
  // Tab stop for the stack; vertical arrows move focus, horizontal arrows
  // keep native value adjustment. The listener lives on the panel because
  // the window keymap ignores events from editable elements.
  const sliderEls = [
    ...LATENT_DIMS.map((k) => q<HTMLInputElement>(`#z${k}`)),
    tilt1, tilt2,
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

  // Render-only section (G12): group-3 rebind, never the view store.
  if (render) offs.push(mountRenderControls(root, render, liveSay));

  return () => offs.forEach((off) => off());
}

function statusText(root: HTMLElement, msg: string): void {
  const el = root.querySelector<HTMLSpanElement>('#status');
  if (el) {
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
  }
}
