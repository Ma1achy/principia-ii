import { state } from '../../state.js';
import { $ } from '../utils.js';
import { showLargeResWarning } from '../dialogs/resolution-warning.js';

// ─── Resolution picker overlay ───────────────────────────────────────────────

let _resPickerCallback = null;

export function bindResPicker(onPick) {
  const overlay  = $("resPickerOverlay");
  const list     = $("resPickerList");
  const closeBtn = $("resPickerClose");

  function buildList(activeRes) {
    list.innerHTML = "";
    const sel = $("resolution");
    for (const opt of sel.options) {
      const r = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (r === activeRes ? " active" : "");
      btn.textContent = opt.textContent + (r >= 8192 ? " ⚠" : "");
      btn.addEventListener("click", () => {
        closeResPicker();
        if (r >= 4096) {
          showLargeResWarning(r, onPick);
        } else {
          onPick(r);
        }
      });
      list.appendChild(btn);
    }
  }

  function closeResPicker() {
    overlay.classList.remove("open");
    _resPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeResPicker(); });
  closeBtn.addEventListener("click", closeResPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeResPicker();
  });

  $("resLabel").addEventListener("click", () => {
    buildList(state.res);
    _resPickerCallback = onPick;
    overlay.classList.add("open");
  });
}
