import { $ } from '../utils.js';

// ─── Quality picker overlay ──────────────────────────────────────────────────

let _qualityPickerCallback: ((value: string) => void) | null = null;

export function bindQualityPicker(onPick: (value: string) => void): void {
  const overlay  = $("qualityPickerOverlay");
  const list     = $("qualityPickerList");
  const closeBtn = $("qualityPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[quality] Required elements not found');
    return;
  }

  function buildList(activeVal: string): void {
    if (!list) return;
    
    list.innerHTML = "";
    const sel = $("quality") as HTMLSelectElement | null;
    if (!sel) return;
    
    for (const opt of sel.options) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (opt.value === activeVal ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_qualityPickerCallback) _qualityPickerCallback(opt.value);
        closeQualityPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeQualityPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _qualityPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeQualityPicker(); });
  closeBtn.addEventListener("click", closeQualityPicker);
  document.addEventListener("keydown", (e) => {
    if (overlay && e.key === "Escape" && overlay.classList.contains("open")) closeQualityPicker();
  });

  const qualityLabel = $("qualityLabel");
  if (qualityLabel) {
    qualityLabel.addEventListener("click", () => {
      const sel = $("quality") as HTMLSelectElement | null;
      if (sel) buildList(sel.value);
      _qualityPickerCallback = onPick;
      if (overlay) overlay.classList.add("open");
    });
  }
}
