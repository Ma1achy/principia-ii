import { state, PRESETS } from '../../state.js';
import { $ } from '../utils.js';

// ─── Preset builder ──────────────────────────────────────────────────────────

export function applyCustomBasis() {
  const q1 = new Array(10).fill(0); q1[state.customDimH] = state.customMag;
  const q2 = new Array(10).fill(0); q2[state.customDimV] = state.customMag;
  state.dir1Base = q1;
  state.dir2Base = q2;
}

export function updateCustomPanelVisibility() {
  const panel = $("customBasisPanel");
  if (panel) panel.style.display = state.presetId === "custom" ? "block" : "none";
}

export function buildPresets(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const grid = $("presetGrid");
  grid.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "btn preset" + (p.id === state.presetId ? " active" : "");
    if (p.id === "custom") b.style.gridColumn = "span 2";
    b.textContent = p.name;
    b.addEventListener("click", () => {
      state.presetId = p.id;
      if (p.id === "custom") {
        applyCustomBasis();
      } else {
        state.dir1Base = p.q1.slice();
        state.dir2Base = p.q2.slice();
      }
      [...grid.children].forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      updateCustomPanelVisibility();
      scheduleRender("preset");
      writeHash(); updateStateBox(); drawOverlayHUD();
    });
    grid.appendChild(b);
  }
}
