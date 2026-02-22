import { $ } from '../utils.js';

// ─── Overlay / status ────────────────────────────────────────────────────────

export function setOverlay(show, msg = "", pct = 0) {
  const statusEl = $("status");
  const textEl   = $("statusText");
  const barEl    = $("statusProgress");
  if (show) {
    if (msg) textEl.textContent = msg;
    barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    statusEl.classList.add("progress-active");
  } else {
    statusEl.classList.remove("progress-active");
    barEl.style.width = "0%";
  }
}

export function setStatus(msg) {
  $("statusText").textContent = msg;
}
