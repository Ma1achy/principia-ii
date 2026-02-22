import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';
import { syncTiltDimLabels } from '../pickers/tilt.js';

// ─── Axis selects builder ────────────────────────────────────────────────────

export function buildAxisSelects() {
  const s1 = $("tiltDim1"), s2 = $("tiltDim2");
  s1.innerHTML = ""; s2.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    [s1, s2].forEach(s => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = AXIS_NAMES[i];
      s.appendChild(o);
    });
  }
  s1.value = String(state.tiltDim1);
  s2.value = String(state.tiltDim2);
  syncTiltDimLabels();
}

export function buildCustomDimSelects() {
  const cH = $("customDimH"), cV = $("customDimV");
  cH.innerHTML = ""; cV.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    [cH, cV].forEach(sel => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = AXIS_NAMES[i];
      sel.appendChild(o);
    });
  }
  cH.value = String(state.customDimH);
  cV.value = String(state.customDimV);
  $("customDimHName").textContent = AXIS_NAMES[state.customDimH];
  $("customDimVName").textContent = AXIS_NAMES[state.customDimV];
}
