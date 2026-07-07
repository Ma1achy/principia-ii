import type { App } from '@/app/app.js';
import type { QualityTier } from '@/interact/view_state.js';
import { zoomViewport } from '@/app/viewport_nav.js';
import { bind, bindInput } from './reactive.js';

const CHARTS: readonly { id: string; label: string }[] = [
  { id: 'latent_slice', label: 'Latent slice' },
  { id: 'lz_e', label: '(L_z, E)' },
  { id: 'lz_k', label: '(L_z, K)' },
  { id: 'shape_sphere', label: 'Shape sphere' },
  { id: 'mass_simplex', label: 'Mass simplex' },
  { id: 'burrau_euclid', label: 'Burrau Euclid' },
];

export function mountControlPanel(root: HTMLElement, app: App): () => void {
  root.innerHTML = `
    <div class="panel">
      <h3>View</h3>
      <div class="row">
        <label>Chart</label>
        <select id="chart">
          ${CHARTS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </div>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `
        <div class="row">
          <label>z[${k}]</label>
          <input type="range" id="z${k}" min="-3" max="3" step="0.01">
          <span id="z${k}_v"></span>
        </div>
      `).join('')}
      <div class="row">
        <label>Tilt 1 (z<sub><span id="t1t"></span></sub>)</label>
        <input type="range" id="tilt1" min="-1.5707" max="1.5707" step="0.01" value="0">
        <span id="tilt1_v"></span>
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
      <div class="row">
        <label>Quality</label>
        <select id="quality">
          <option value="preview">Preview</option>
          <option value="balanced">Balanced</option>
          <option value="research">Research</option>
        </select>
      </div>
      <div class="row"><span id="status" role="status"></span></div>
    </div>
  `;

  const offs: (() => void)[] = [];
  const q = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`ControlPanel: missing ${sel}`);
    return el;
  };

  // Chart picker.
  const chart = q<HTMLSelectElement>('#chart');
  offs.push(bind(chart, app.store, (el, v) => { el.value = v.chartType; }));
  chart.addEventListener('change', () => {
    const r = app.input.switchChart(chart.value);
    if (!r.ok) statusText(root, `chart switch refused: ${r.reason ?? ''}`);
    else if (r.reason) statusText(root, r.reason);
  });

  // Per-dimension sliders.
  for (let k = 0; k < 8; k++) {
    const el = q<HTMLInputElement>(`#z${k}`);
    const lab = q<HTMLSpanElement>(`#z${k}_v`);
    offs.push(bindInput(el, app.store,
      (v) => (v.z0[k] ?? 0).toFixed(2),
      (v, value) => {
        const z0 = [...v.z0] as unknown as typeof v.z0;
        (z0 as unknown as number[])[k] = parseFloat(value) || 0;
        return { ...v, z0 };
      }));
    offs.push(bind(lab, app.store,
      (e, v) => { e.textContent = (v.z0[k] ?? 0).toFixed(2); }));
  }

  // Tilt slider.
  const tilt1 = q<HTMLInputElement>('#tilt1');
  offs.push(bind(q<HTMLSpanElement>('#t1t'), app.store,
    (e, v) => { e.textContent = String(v.tilt1Target); }));
  offs.push(bind(q<HTMLSpanElement>('#tilt1_v'), app.store,
    (e, v) => { e.textContent = `${(v.tilt1 * 180 / Math.PI).toFixed(1)}°`; }));
  tilt1.addEventListener('input', () => {
    app.input.setTilt({ tilt1: parseFloat(tilt1.value) || 0 });
  });

  // Viewport zoom (slippy-map: same slice, deeper tiles).
  q<HTMLButtonElement>('#zoomIn').addEventListener('click',
    () => app.store.update((v) => zoomViewport(v, 0.5)));
  q<HTMLButtonElement>('#zoomOut').addEventListener('click',
    () => app.store.update((v) => zoomViewport(v, 2)));

  // Slice extent (mag — recomputes: mag is in the cache key).
  q<HTMLButtonElement>('#magIn').addEventListener('click', () => app.input.zoom(1));
  q<HTMLButtonElement>('#magOut').addEventListener('click', () => app.input.zoom(-1));
  offs.push(bind(q<HTMLSpanElement>('#mag_v'), app.store,
    (e, v) => { e.textContent = v.mag.toExponential(1); }));

  // Quality selector.
  const quality = q<HTMLSelectElement>('#quality');
  offs.push(bind(quality, app.store, (el, v) => { el.value = v.qualityTier; }));
  quality.addEventListener('change', () => {
    app.store.update((v) => ({ ...v, qualityTier: quality.value as QualityTier }));
  });

  return () => offs.forEach((off) => off());
}

function statusText(root: HTMLElement, msg: string): void {
  const el = root.querySelector<HTMLSpanElement>('#status');
  if (el) {
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
  }
}
