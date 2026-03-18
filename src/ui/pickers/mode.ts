import { state } from '../../state.js';
import { $ } from '../utils.js';

// ─── Mode picker overlay ─────────────────────────────────────────────────────

let _modePickerCallback: ((mode: number) => void) | null = null;

export function bindModePicker(onPick: (mode: number) => void): void {
  const overlay  = $("modePickerOverlay");
  const list     = $("modePickerList");
  const closeBtn = $("modePickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[mode] Required elements not found');
    return;
  }

  function buildList(activeMode: number): void {
    if (!list) return;
    
    list.innerHTML = "";
    const sel = $("mode") as HTMLSelectElement | null;
    if (!sel) return;
    
    for (const opt of sel.options) {
      const m = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (m === activeMode ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_modePickerCallback) _modePickerCallback(m);
        closeModePicker();
      });
      list.appendChild(btn);
    }
  }

  function closeModePicker(): void {
    if (overlay) overlay.classList.remove("open");
    _modePickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModePicker(); });
  closeBtn.addEventListener("click", closeModePicker);
  document.addEventListener("keydown", (e) => {
    if (overlay && e.key === "Escape" && overlay.classList.contains("open")) closeModePicker();
  });

  const modeLabel = $("modeLabel");
  if (modeLabel) {
    modeLabel.addEventListener("click", () => {
      buildList(state.mode);
      _modePickerCallback = onPick;
      if (overlay) overlay.classList.add("open");
    });
  }
}
