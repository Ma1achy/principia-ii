import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';

// ─── Tilt dimension picker overlay ───────────────────────────────────────────

let _tiltPickerCallback = null;

export function bindTiltPicker(onPick1, onPick2) {
  const overlay = $("tiltPickerOverlay");
  const list    = $("tiltPickerList");
  const closeBtn = $("tiltPickerClose");

  function buildList(activeDim) {
    list.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (i === activeDim ? " active" : "");
      btn.textContent = AXIS_NAMES[i];
      btn.addEventListener("click", () => {
        if (_tiltPickerCallback) _tiltPickerCallback(i);
        closeTiltPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeTiltPicker() {
    overlay.classList.remove("open");
    _tiltPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTiltPicker(); });
  closeBtn.addEventListener("click", closeTiltPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeTiltPicker();
  });

  $("tiltDim1Label").addEventListener("click", () => {
    $("tiltPickerTitle").textContent = "Tilt q₁ into";
    buildList(state.tiltDim1);
    _tiltPickerCallback = onPick1;
    overlay.classList.add("open");
  });
  $("tiltDim2Label").addEventListener("click", () => {
    $("tiltPickerTitle").textContent = "Tilt q₂ into";
    buildList(state.tiltDim2);
    _tiltPickerCallback = onPick2;
    overlay.classList.add("open");
  });
}

export function syncTiltDimLabels() {
  const n1 = $("tiltDim1Name");
  const n2 = $("tiltDim2Name");
  if (n1) n1.textContent = AXIS_NAMES[state.tiltDim1] || `z${state.tiltDim1}`;
  if (n2) n2.textContent = AXIS_NAMES[state.tiltDim2] || `z${state.tiltDim2}`;
}
