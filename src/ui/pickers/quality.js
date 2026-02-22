import { $ } from '../utils.js';

// ─── Quality picker overlay ──────────────────────────────────────────────────

let _qualityPickerCallback = null;

export function bindQualityPicker(onPick) {
  const overlay  = $("qualityPickerOverlay");
  const list     = $("qualityPickerList");
  const closeBtn = $("qualityPickerClose");

  function buildList(activeVal) {
    list.innerHTML = "";
    const sel = $("quality");
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

  function closeQualityPicker() {
    overlay.classList.remove("open");
    _qualityPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeQualityPicker(); });
  closeBtn.addEventListener("click", closeQualityPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeQualityPicker();
  });

  $("qualityLabel").addEventListener("click", () => {
    buildList($("quality").value);
    _qualityPickerCallback = onPick;
    overlay.classList.add("open");
  });
}
