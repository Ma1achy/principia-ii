import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';

// ─── Custom dimension picker overlay ─────────────────────────────────────────

let _customDimPickerCallback = null;

export function bindCustomDimPicker(onPickH, onPickV) {
  const overlay  = $("customDimPickerOverlay");
  const list     = $("customDimPickerList");
  const closeBtn = $("customDimPickerClose");

  function buildList(activeDim) {
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

  function closeCustomDimPicker() {
    overlay.classList.remove("open");
    _customDimPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCustomDimPicker(); });
  closeBtn.addEventListener("click", closeCustomDimPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeCustomDimPicker();
  });

  $("customDimHLabel").addEventListener("click", () => {
    $("customDimPickerTitle").textContent = "H-axis (→) dimension";
    buildList(state.customDimH);
    _customDimPickerCallback = onPickH;
    overlay.classList.add("open");
  });
  $("customDimVLabel").addEventListener("click", () => {
    $("customDimPickerTitle").textContent = "V-axis (↑) dimension";
    buildList(state.customDimV);
    _customDimPickerCallback = onPickV;
    overlay.classList.add("open");
  });
}
