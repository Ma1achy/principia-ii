import { $ } from '../utils.js';

// ─── Render state ─────────────────────────────────────────────────────────────

let _isRendering = false;

export function setRenderingState(active) {
  _isRendering = active;
  const btn = $("renderBtn");
  if (!btn) return;
  if (active) {
    btn.textContent = "Stop";
    btn.classList.remove("primary");
    btn.classList.add("danger");
  } else {
    btn.textContent = "Render";
    btn.classList.remove("danger");
    btn.classList.add("primary");
  }
}
