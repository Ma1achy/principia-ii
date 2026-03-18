import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';

// ─── Tilt dimension picker overlay ───────────────────────────────────────────

let _tiltPickerCallback: ((dim: number) => void) | null = null;

export function bindTiltPicker(onPick1: (dim: number) => void, onPick2: (dim: number) => void): void {
  const overlay = $("tiltPickerOverlay");
  const list    = $("tiltPickerList");
  const closeBtn = $("tiltPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[tilt] Required elements not found');
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
        if (_tiltPickerCallback) _tiltPickerCallback(i);
        closeTiltPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeTiltPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _tiltPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTiltPicker(); });
  closeBtn.addEventListener("click", closeTiltPicker);
  document.addEventListener("keydown", (e) => {
    if (overlay && e.key === "Escape" && overlay.classList.contains("open")) closeTiltPicker();
  });

  const tiltDim1Label = $("tiltDim1Label");
  const tiltDim2Label = $("tiltDim2Label");
  const tiltPickerTitle = $("tiltPickerTitle");

  if (tiltDim1Label) {
    tiltDim1Label.addEventListener("click", () => {
      if (tiltPickerTitle) tiltPickerTitle.textContent = "Tilt q₁ into";
      buildList(state.tiltDim1);
      _tiltPickerCallback = onPick1;
      if (overlay) overlay.classList.add("open");
    });
  }

  if (tiltDim2Label) {
    tiltDim2Label.addEventListener("click", () => {
      if (tiltPickerTitle) tiltPickerTitle.textContent = "Tilt q₂ into";
      buildList(state.tiltDim2);
      _tiltPickerCallback = onPick2;
      if (overlay) overlay.classList.add("open");
    });
  }
}

export function syncTiltDimLabels(): void {
  const n1 = $("tiltDim1Name");
  const n2 = $("tiltDim2Name");
  if (n1) n1.textContent = AXIS_NAMES[state.tiltDim1] || `z${state.tiltDim1}`;
  if (n2) n2.textContent = AXIS_NAMES[state.tiltDim2] || `z${state.tiltDim2}`;
}
