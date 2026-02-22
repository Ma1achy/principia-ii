import { state, navPrefs } from '../state.js';
import { clamp } from '../ui/utils.js';

// ─── Gestures ────────────────────────────────────────────────────────────────

export let dragging = false;
export let dragMode = "pan";

let lastX = 0, lastY = 0;
let zoomTimeout = null;

function getActiveCanvas(glCanvas, outCanvas) {
  return outCanvas.style.display !== "none" ? outCanvas : glCanvas;
}

export function panByPixels(dx, dy, glCanvas, outCanvas) {
  const rect = getActiveCanvas(glCanvas, outCanvas).getBoundingClientRect();
  const sx = navPrefs.invertPanX ? -1 : 1;
  const sy = navPrefs.invertPanY ? -1 : 1;
  state.viewPanX -= sx * (dx / rect.width)  * state.viewZoom * navPrefs.panSpeed;
  state.viewPanY += sy * (dy / rect.height) * state.viewZoom * navPrefs.panSpeed;
}

export function zoomAt(px, py, zoomFactor, glCanvas, outCanvas) {
  const rect = getActiveCanvas(glCanvas, outCanvas).getBoundingClientRect();
  const ux = (px - rect.left) / rect.width;
  const uy = 1.0 - (py - rect.top) / rect.height;
  const oldZ = state.viewZoom;
  const newZ = clamp(oldZ * zoomFactor, 0.000001, 1000.0);
  const worldX = state.viewPanX + ux * oldZ;
  const worldY = state.viewPanY + uy * oldZ;
  state.viewZoom = newZ;
  state.viewPanX = worldX - ux * newZ;
  state.viewPanY = worldY - uy * newZ;
}

export function resetView(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  state.viewZoom = 1.0; state.viewPanX = 0.0; state.viewPanY = 0.0;
  scheduleRender("view-reset"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function attachGestures(el, glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawOverlayHUD, showProbeAtEvent, interactionState) {
  const $ = id => document.getElementById(id);

  el.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    interactionState.isDragging = true;
    probeTooltip.hide();
    dragMode = e.shiftKey ? "gamma" : e.altKey ? "tilt" : "pan";
    el.setPointerCapture?.(e.pointerId);
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
    interactionState.isDragging = false;
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragMode === "pan") {
      panByPixels(dx, dy, glCanvas, outCanvas);
      scheduleRender("pan");
    } else if (dragMode === "gamma") {
      state.gammaDeg = (state.gammaDeg + dx * 0.25) % 360;
      if (state.gammaDeg < 0) state.gammaDeg += 360;
      $("gamma").value = String(state.gammaDeg);
      $("gammaVal").value = state.gammaDeg.toFixed(2);
      scheduleRender("γ drag");
    } else if (dragMode === "tilt") {
      state.tiltAmt1 = Math.max(-2.0, Math.min(2.0, state.tiltAmt1 + dx * 0.01));
      state.tiltAmt2 = Math.max(-2.0, Math.min(2.0, state.tiltAmt2 - dy * 0.01));
      $("tiltAmt1").value = String(state.tiltAmt1);
      $("tiltAmt2").value = String(state.tiltAmt2);
      $("tiltAmt1Val").value = state.tiltAmt1.toFixed(2);
      $("tiltAmt2Val").value = state.tiltAmt2.toFixed(2);
      scheduleRender("tilt drag");
    }
    writeHash(); updateStateBox(); drawOverlayHUD();
  });

  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    probeTooltip.hide();
    
    interactionState.isZooming = true;
    
    const sign = navPrefs.invertScroll ? -1 : 1;
    const rate = 0.0015 * navPrefs.zoomSpeed;
    const delta = sign * e.deltaY * rate;
    zoomAt(e.clientX, e.clientY, Math.exp(delta), glCanvas, outCanvas);
    scheduleRender("zoom"); writeHash(); updateStateBox(); drawOverlayHUD();
    
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
      interactionState.isZooming = false;
    }, 500);
  }, { passive: false });

  el.addEventListener("dblclick", () => resetView(scheduleRender, writeHash, updateStateBox, drawOverlayHUD));

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      showProbeAtEvent(e);
      setTimeout(() => { probeTooltip.hide(); }, 2200);
    }
  }, { passive: true });
}

export function attachProbe(el, probeTooltip, showProbeAtEvent, interactionState) {
  let rafId = null;
  
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && !dragging) {
      // Use requestAnimationFrame to throttle to screen refresh rate
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          showProbeAtEvent(e);
          rafId = null;
        });
      }
    }
    else if (dragging) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      probeTooltip.hide();
      if (interactionState) interactionState.probeActive = false;
    }
  });
  el.addEventListener("pointerleave", () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    probeTooltip.hide();
    if (interactionState) {
      interactionState.probeActive = false;
      interactionState.hasCollision = false;
      interactionState.hasEscape = false;
    }
  });
}
