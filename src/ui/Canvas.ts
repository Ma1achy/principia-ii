import type { App } from '@/app/app.js';
import { panViewport, zoomViewport } from '@/app/viewport_nav.js';
import { canvasAria } from './a11y/aria.js';

/** G12: brackets a pointer gesture so the history funnel coalesces the
 *  whole drag into ONE undo entry (begin at pointerdown, end at pointerup).
 *  The store still updates live per pointermove — only history is gated. */
export interface GestureGate {
  begin(): void;
  end(): void;
}

/**
 * Canvas gestures: drag pans the UV window, wheel zooms about the
 * pointer, a (non-drag) click locks the pixel. All three go through the
 * store — the canvas holds no view state of its own.
 */
export function mountCanvas(
  root: HTMLElement, app: App, canvas: HTMLCanvasElement, gate?: GestureGate,
): () => void {
  root.appendChild(canvas);

  // G13: the canvas is an interactive `application` region — assistive tech
  // must pass keystrokes through (arrow keys pan/tilt; no browse mode).
  for (const [k, v] of Object.entries(canvasAria())) canvas.setAttribute(k, v);

  let dragging = false;
  let moved = false;
  let last: [number, number] = [0, 0];

  const screenUv = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ];
  };

  const onDown = (e: PointerEvent): void => {
    dragging = true; moved = false; last = screenUv(e);
    gate?.begin();
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const cur = screenUv(e);
    const dx = cur[0] - last[0];
    const dy = cur[1] - last[1];
    if (Math.abs(dx) + Math.abs(dy) < 1e-4) return;
    moved = true;
    last = cur;
    app.store.update((v) => panViewport(
      v, -dx * 2 * v.uvHalfWidth[0], -dy * 2 * v.uvHalfWidth[1]));
  };
  const onUp = (e: PointerEvent): void => {
    canvas.releasePointerCapture(e.pointerId);
    if (dragging && !moved) {
      // A clean click (no drag): lock the pixel. Screen y is down;
      // lockAffine's t is the slice's v axis (also down in tile space).
      const [s, t] = screenUv(e);
      const v = app.store.snapshot();
      const su = v.uvCentre[0] + (2 * s - 1) * v.uvHalfWidth[0];
      const sv = v.uvCentre[1] + (2 * t - 1) * v.uvHalfWidth[1];
      app.input.lock({ s: su, t: sv });
    }
    dragging = false;
    // End the gesture AFTER the click/lock so the whole interaction —
    // pan frames or lock — lands as one history entry.
    gate?.end();
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 2 ** 0.5 : 2 ** -0.5;
    app.store.update((v) => zoomViewport(v, factor, screenUv(e)));
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
