import type { App } from '@/app/app.js';
import type { ViewState } from '@/interact/view_state.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState } from '@/math/types.js';
import { getChart } from '@/chart_atlas/index.js';
import { HoverStreamline } from '@/inspector/hover_streamline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

/**
 * Shape-sphere hover streamline (spec §shape_sphere_view): hovering a pixel
 * draws a live CPU f64 trajectory streaming out of it — a lightweight
 * preview of the locked-pixel inspector. Active only on the shape-sphere
 * chart (rendering surface = state space, so the n(t) path lives on the
 * chart itself); other charts have no such correspondence.
 */

/** Project a shape-sphere path n(t) into chart UV. Mirrors the chart's
 *  θ/φ mapping: u = (θ−ε)/(π−2ε), v = φ/2π, with θ = acos(n_z) unfolded
 *  over the full sphere (the chart renders both hemispheres; folding would
 *  snap the path at the equator). Returns null for points inside the pole
 *  buffer, which callers treat as segment breaks. */
export function shapePathToUv(
  path: readonly { x: number; y: number; z: number }[], poleBuffer: number,
): ({ u: number; v: number } | null)[] {
  const span = Math.PI - 2 * poleBuffer;
  return path.map((n) => {
    const theta = Math.acos(Math.max(-1, Math.min(1, n.z)));
    if (theta < poleBuffer || theta > Math.PI - poleBuffer) return null;
    let phi = Math.atan2(n.y, n.x);
    if (phi < 0) phi += 2 * Math.PI;
    return { u: (theta - poleBuffer) / span, v: phi / (2 * Math.PI) };
  });
}

function chartViewOf(v: ViewState): ChartView {
  return {
    chartParams: v.chartParams,
    z0: v.z0, q1: v.q1, q2: v.q2, mag: v.mag,
    alphaMin: ALPHA_MIN_DEFAULT, muMax: MU_MAX_DEFAULT, qMax: Q_MAX_DEFAULT,
    rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  };
}

export function mountStreamlineOverlay(
  canvasArea: HTMLElement, app: App, canvas: HTMLCanvasElement,
): () => void {
  const overlay = document.createElement('canvas');
  overlay.className = 'tile-overlay streamline-overlay';
  canvasArea.appendChild(overlay);
  const ctx = overlay.getContext('2d');

  let lastPath: { x: number; y: number; z: number }[] = [];

  const active = (v: ViewState): boolean =>
    v.chartType === 'shape_sphere' && v.chartParams['hoverStreamline'] !== false;

  const draw = (): void => {
    if (!ctx) return;
    const cr = canvas.getBoundingClientRect();
    const ar = canvasArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    overlay.style.left = `${cr.left - ar.left}px`;
    overlay.style.top = `${cr.top - ar.top}px`;
    overlay.style.width = `${cr.width}px`;
    overlay.style.height = `${cr.height}px`;
    if (overlay.width !== Math.round(cr.width * dpr)) overlay.width = Math.round(cr.width * dpr);
    if (overlay.height !== Math.round(cr.height * dpr)) overlay.height = Math.round(cr.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cr.width, cr.height);
    if (lastPath.length < 2) return;

    const v = app.store.snapshot();
    if (!active(v)) return;
    const eps = (v.chartParams['poleBuffer'] as number | undefined) ?? 0.05;
    const uv = shapePathToUv(lastPath, eps);

    // Chart UV → screen through the viewport window.
    const u0 = v.uvCentre[0] - v.uvHalfWidth[0];
    const w = 2 * v.uvHalfWidth[0];
    const v0 = v.uvCentre[1] - v.uvHalfWidth[1];
    const h = 2 * v.uvHalfWidth[1];

    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    let prev: { x: number; y: number } | null = null;
    let prevV = 0;
    for (let i = 0; i < uv.length; i++) {
      const p = uv[i];
      if (!p) { prev = null; continue; }                       // pole-buffer break
      const x = ((p.u - u0) / w) * cr.width;
      const y = ((p.v - v0) / h) * cr.height;
      // Break the polyline across the φ seam (v wraps 1 → 0).
      if (prev && Math.abs(p.v - prevV) > 0.5) prev = null;
      if (prev) {
        // Fade along the path: bright at the hovered IC, dim at the tail.
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - i / uv.length) + 0.1})`;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = { x, y };
      prevV = p.v;
    }
  };

  const stream = new HoverStreamline((traj) => { lastPath = traj; draw(); });

  const onMove = (e: PointerEvent): void => {
    const v = app.store.snapshot();
    if (!active(v) || e.buttons !== 0) return;       // dragging = panning, not hovering
    const rect = canvas.getBoundingClientRect();
    const s = (e.clientX - rect.left) / rect.width;
    const t = (e.clientY - rect.top) / rect.height;
    const su = v.uvCentre[0] + (2 * s - 1) * v.uvHalfWidth[0];
    const sv = v.uvCentre[1] + (2 * t - 1) * v.uvHalfWidth[1];
    stream.onMove((): TrajState | null => {
      const chart = getChart(v.chartType as Parameters<typeof getChart>[0]);
      const out = chart.decode([su, sv], chartViewOf(v));
      return out.kind === 'ok'
        ? { m: out.state.m, r: out.state.r, p: out.state.p, t: 0 }
        : null;
    });
  };
  const onLeave = (): void => stream.clear();

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const offStore = app.store.subscribe(() => draw());   // view pans/zooms: reproject

  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    offStore();
    overlay.remove();
  };
}
