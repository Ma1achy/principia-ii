import { $ } from '../utils.js';

// ─── Overlay / status ────────────────────────────────────────────────────────

export function setOverlay(show: boolean, msg: string = "", pct: number = 0): void {
  const statusEl = $("status");
  const textEl = $("statusText");
  const barEl = $("statusProgress");
  
  if (!statusEl || !textEl || !barEl) return;
  
  if (show) {
    if (msg) textEl.textContent = msg;
    barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    statusEl.classList.add("progress-active");
  } else {
    statusEl.classList.remove("progress-active");
    barEl.style.width = "0%";
  }
}

export function setStatus(msg: string): void {
  const textEl = $("statusText");
  if (textEl) {
    textEl.textContent = msg;
  }
}
