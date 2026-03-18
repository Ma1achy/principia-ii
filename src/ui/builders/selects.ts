import { state, AXIS_NAMES } from '../../state.ts';
import { $ } from '../utils.ts';
import { syncTiltDimLabels } from '../pickers/tilt.ts';

// ─── Axis selects builder ────────────────────────────────────────────────────

export function buildAxisSelects(): void {
  const s1 = $("tiltDim1") as HTMLSelectElement | null;
  const s2 = $("tiltDim2") as HTMLSelectElement | null;
  
  if (!s1 || !s2) return;
  
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

export function buildCustomDimSelects(): void {
  const cH = $("customDimH") as HTMLSelectElement | null;
  const cV = $("customDimV") as HTMLSelectElement | null;
  
  if (!cH || !cV) return;
  
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
  
  const cHName = $("customDimHName");
  const cVName = $("customDimVName");
  if (cHName) cHName.textContent = AXIS_NAMES[state.customDimH];
  if (cVName) cVName.textContent = AXIS_NAMES[state.customDimV];
}
