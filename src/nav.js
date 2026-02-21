import { state, navPrefs } from './state.js';
import { interactionState } from './main.js';

export let dragging = false;
export let dragMode = "pan";

let lastX = 0, lastY = 0;
let zoomTimeout = null; // For debouncing zoom state

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

export function attachGestures(el, glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawOverlayHUD, showProbeAtEvent) {
  const $ = id => document.getElementById(id);

  el.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    interactionState.isDragging = true; // Set dragging state
    probeTooltip.hide();
    dragMode = e.shiftKey ? "gamma" : e.altKey ? "tilt" : "pan";
    el.setPointerCapture?.(e.pointerId);
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
    interactionState.isDragging = false; // Clear dragging state
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
    
    // Set zooming state
    interactionState.isZooming = true;
    
    const sign = navPrefs.invertScroll ? -1 : 1;
    const rate = 0.0015 * navPrefs.zoomSpeed;
    const delta = sign * e.deltaY * rate;
    zoomAt(e.clientX, e.clientY, Math.exp(delta), glCanvas, outCanvas);
    scheduleRender("zoom"); writeHash(); updateStateBox(); drawOverlayHUD();
    
    // Clear zooming state after a short delay (debounce)
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
      interactionState.isZooming = false;
    }, 500); // Consider zooming stopped after 500ms of no wheel events
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
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && !dragging) showProbeAtEvent(e);
    else if (dragging) {
      probeTooltip.hide();
      if (interactionState) interactionState.probeActive = false;
    }
  });
  el.addEventListener("pointerleave", () => {
    probeTooltip.hide();
    if (interactionState) {
      interactionState.probeActive = false;
      interactionState.hasCollision = false;
      interactionState.hasEscape = false;
    }
  });
}

export function attachHintTooltips(hintTooltip) {
  let hintTimer = null;
  let hintActive = false;

  function showHint(text, x, y) {
    const FONT_SIZE = 10, LINE_H = 13, PAD_X = 10, PAD_Y = 7;
    const approxCharsPerLine = 28;
    const words = text.split(" ");
    let lineW = 0, maxW = 0, lines = 1;
    for (const w of words) {
      if (lineW + w.length > approxCharsPerLine && lineW > 0) {
        maxW = Math.max(maxW, lineW);
        lineW = w.length; lines++;
      } else {
        lineW += w.length + 1;
      }
    }
    maxW = Math.max(maxW, lineW);
    const PW = Math.min(220, Math.max(120, maxW * 6.2 + PAD_X * 2));
    const PH = lines * LINE_H + PAD_Y * 2;
    const vw = window.innerWidth, vh = window.innerHeight;
    let sx = x + 12, sy = y + 12;
    if (sx + PW > vw - 8) sx = x - PW - 8;
    if (sy + PH > vh - 8) sy = y - PH - 8;
    hintTooltip.render([{ type: "hint", text }], sx, sy, Math.round(PW), Math.round(PH), null);
    hintActive = true;
  }

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest("[data-tip]");
    clearTimeout(hintTimer);
    if (!el) {
      if (hintActive) { hintTooltip.hide(); hintActive = false; }
      return;
    }
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
    const tip = el.dataset.tip;
    hintTimer = setTimeout(() => showHint(tip, e.clientX, e.clientY), 600);
  });

  document.addEventListener("pointerleave", () => {
    clearTimeout(hintTimer);
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
  }, true);

  document.addEventListener("pointerdown", () => {
    clearTimeout(hintTimer);
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
  });
}
