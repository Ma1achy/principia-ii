import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';

// ─── Custom dimension picker overlay ─────────────────────────────────────────

let _customDimPickerCallback: ((dim: number) => void) | null = null;

export function bindCustomDimPicker(onPickH: (dim: number) => void, onPickV: (dim: number) => void): void {
  const overlay  = $("customDimPickerOverlay");
  const list     = $("customDimPickerList");
  const closeBtn = $("customDimPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[custom-dim] Required elements not found');
    return;
  }

  function buildList(activeDim: number): void {
    if (!list) return;
    
    list.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (i === activeDim ? " active" : "");
      btn.textContent = AXIS_NAMES[i];
      btn.addEventListener("click", () => {
        if (_customDimPickerCallback) _customDimPickerCallback(i);
        closeCustomDimPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeCustomDimPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _customDimPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCustomDimPicker(); });
  closeBtn.addEventListener("click", closeCustomDimPicker);
  document.addEventListener("keydown", (e) => {
    if (overlay && e.key === "Escape" && overlay.classList.contains("open")) closeCustomDimPicker();
  });

  const customDimHLabel = $("customDimHLabel");
  const customDimVLabel = $("customDimVLabel");
  const customDimPickerTitle = $("customDimPickerTitle");

  if (customDimHLabel) {
    customDimHLabel.addEventListener("click", () => {
      if (customDimPickerTitle) customDimPickerTitle.textContent = "H-axis (→) dimension";
      buildList(state.customDimH);
      _customDimPickerCallback = onPickH;
      if (overlay) overlay.classList.add("open");
    });
  }

  if (customDimVLabel) {
    customDimVLabel.addEventListener("click", () => {
      if (customDimPickerTitle) customDimPickerTitle.textContent = "V-axis (↑) dimension";
      buildList(state.customDimV);
      _customDimPickerCallback = onPickV;
      if (overlay) overlay.classList.add("open");
    });
  }
}
