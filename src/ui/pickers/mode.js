import { state, MODE_INFO } from '../../state.js';
import { $ } from '../utils.js';

// ─── Mode picker overlay ─────────────────────────────────────────────────────

let _modePickerCallback = null;

export function bindModePicker(onPick) {
  const overlay  = $("modePickerOverlay");
  const list     = $("modePickerList");
  const closeBtn = $("modePickerClose");

  function buildList(activeMode) {
    list.innerHTML = "";
    const sel = $("mode");
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

  function closeModePicker() {
    overlay.classList.remove("open");
    _modePickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModePicker(); });
  closeBtn.addEventListener("click", closeModePicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModePicker();
  });

  $("modeLabel").addEventListener("click", () => {
    buildList(state.mode);
    _modePickerCallback = onPick;
    overlay.classList.add("open");
  });
}
