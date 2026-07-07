import type { App } from '@/app/app.js';
import type { CachedTile, Lifecycle } from '@/quadtree/types.js';
import { tileBounds, TILE_STATUS } from '@/quadtree/index.js';

/**
 * Tile/quadtree diagnostic overlay. A transparent 2D canvas laid over the
 * WebGPU canvas, drawn from CPU-side data already on hand each frame
 * (`app.loop.cache`) — no GPU readback. Answers the "why is it blurry / what
 * is refining / where is deep zoom" questions the spec's scheduler-state
 * visualisation calls for (§two_stage).
 *
 * Modes:
 *   boundaries — quadtree tile outlines (depth-shaded).
 *   lifecycle  — fill by tile lifecycle (queued/computing/ready/refinable).
 *   decode     — fill by decode path (full / linearised / f32-floor) from the
 *                reduction status flags.
 */
export type TileOverlayMode = 'off' | 'boundaries' | 'lifecycle' | 'decode';

const LIFECYCLE_FILL: Record<Lifecycle, string> = {
  unseen:         'rgba(120,120,130,0.10)',
  queued:         'rgba(230,170,40,0.22)',
  computing:      'rgba(70,140,240,0.28)',
  ready:          'rgba(60,200,90,0.16)',
  readyRefinable: 'rgba(40,200,190,0.20)',
};

/** Mount the overlay canvas + its mode selector. `canvasArea` hosts the
 *  WebGPU `canvas`; the control is appended to `controlArea`. */
export function mountTileOverlay(
  canvasArea: HTMLElement, controlArea: HTMLElement,
  app: App, canvas: HTMLCanvasElement,
): () => void {
  canvasArea.classList.add('has-overlay');
  const overlay = document.createElement('canvas');
  overlay.className = 'tile-overlay';
  canvasArea.appendChild(overlay);
  const ctx = overlay.getContext('2d');

  const control = document.createElement('details');
  control.className = 'panel';
  control.innerHTML = `
    <summary><h3>Tile overlay</h3></summary>
    <div class="row">
      <label for="tileOverlay">Overlay</label>
      <select id="tileOverlay">
        <option value="off">Off</option>
        <option value="boundaries">Quadtree boundaries</option>
        <option value="lifecycle">Tile lifecycle</option>
        <option value="decode">Decode mode</option>
      </select>
    </div>
    <div class="row"><span id="tileOverlayLegend" class="hint"></span></div>
  `;
  controlArea.appendChild(control);
  const select = control.querySelector<HTMLSelectElement>('#tileOverlay')!;
  const legend = control.querySelector<HTMLSpanElement>('#tileOverlayLegend')!;

  let mode: TileOverlayMode = 'off';
  let raf = 0;

  const draw = (): void => {
    if (!ctx || mode === 'off') return;
    // Track the WebGPU canvas's on-screen box (it is max-width/height centred
    // in the flex canvas-area, so its rect moves with the window).
    const cr = canvas.getBoundingClientRect();
    const ar = canvasArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = cr.width, cssH = cr.height;
    overlay.style.left = `${cr.left - ar.left}px`;
    overlay.style.top = `${cr.top - ar.top}px`;
    overlay.style.width = `${cssW}px`;
    overlay.style.height = `${cssH}px`;
    if (overlay.width !== Math.round(cssW * dpr)) overlay.width = Math.round(cssW * dpr);
    if (overlay.height !== Math.round(cssH * dpr)) overlay.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const v = app.store.snapshot();
    const u0 = v.uvCentre[0] - v.uvHalfWidth[0];
    const w = 2 * v.uvHalfWidth[0];
    const v0 = v.uvCentre[1] - v.uvHalfWidth[1];
    const hh = 2 * v.uvHalfWidth[1];

    ctx.lineWidth = 1;
    for (const t of app.loop.cache.entries()) {
      const b = tileBounds(t.id);
      const x0 = ((b.uMin - u0) / w) * cssW;
      const x1 = ((b.uMax - u0) / w) * cssW;
      const y0 = ((b.vMin - v0) / hh) * cssH;
      const y1 = ((b.vMax - v0) / hh) * cssH;
      // Cull tiles fully outside the viewport.
      if (x1 < 0 || y1 < 0 || x0 > cssW || y0 > cssH) continue;
      const rw = x1 - x0, rh = y1 - y0;

      if (mode === 'lifecycle') {
        ctx.fillStyle = LIFECYCLE_FILL[t.lifecycle];
        ctx.fillRect(x0, y0, rw, rh);
      } else if (mode === 'decode') {
        ctx.fillStyle = decodeFill(t);
        ctx.fillRect(x0, y0, rw, rh);
      }
      // Boundaries drawn in all modes; depth shades the stroke.
      ctx.strokeStyle = `rgba(150,190,255,${Math.min(0.15 + t.id.z * 0.06, 0.7)})`;
      ctx.strokeRect(x0, y0, rw, rh);
    }
  };

  const tick = (): void => { draw(); if (mode !== 'off') raf = requestAnimationFrame(tick); };
  const offStore = app.store.subscribe(() => { if (mode !== 'off') draw(); });

  const LEGENDS: Record<TileOverlayMode, string> = {
    off: '',
    boundaries: 'line brightness ∝ depth',
    lifecycle: 'amber queued · blue computing · green ready · teal refinable',
    decode: 'blue full · purple linearised · red f32 floor',
  };
  select.addEventListener('change', () => {
    mode = select.value as TileOverlayMode;
    legend.textContent = LEGENDS[mode];
    if (raf) cancelAnimationFrame(raf);
    if (mode === 'off') { ctx?.clearRect(0, 0, overlay.width, overlay.height); }
    else { tick(); }
  });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    offStore();
    overlay.remove();
    control.remove();
    canvasArea.classList.remove('has-overlay');
  };
}

function decodeFill(t: CachedTile): string {
  const f = t.reduction?.status_flags ?? 0;
  if (f & TILE_STATUS.AT_F32_FLOOR) return 'rgba(230,60,60,0.28)';    // precision floor
  if (f & TILE_STATUS.DECODE_LINEAR) return 'rgba(170,80,230,0.24)';  // linearised
  if (t.reduction) return 'rgba(70,140,240,0.16)';                    // full nonlinear
  return 'rgba(120,120,130,0.08)';                                    // not yet computed
}
