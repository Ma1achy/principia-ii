import { state, canonicalState, MODE_INFO, PRESETS, AXIS_NAMES } from '../state.ts';
import { $ } from './utils.ts';
import { setStatus } from './panels/overlay.ts';
import { updateCustomPanelVisibility } from './builders/presets.ts';
import { syncTiltDimLabels } from './pickers/tilt.ts';
import type { UINode } from './semantic-tree/store.ts';
import { setStateBoxValue } from './editors/stateBoxEditor.ts';

export function updateStateBox(): void {
  setStateBoxValue(JSON.stringify(canonicalState(state), null, 2));
}

export function syncUIFromState(
  renderer: any,
  scheduleRender: (reason?: string) => void,
  writeHash: () => void,
  drawOverlayHUD: () => void,
  uiTree: UINode | null = null
): void {
  $("mode").value = String(state.mode);
  $("modeName").textContent = MODE_INFO[state.mode]?.name || "";
  $("resolution").value = String(state.res);
  $("resName").textContent = `${state.res} × ${state.res}`;
  $("gamma").value = String(state.gammaDeg);
  $("gammaVal").value = state.gammaDeg.toFixed(2);
  $("tiltDim1").value = String(state.tiltDim1);
  $("tiltDim2").value = String(state.tiltDim2);
  $("tiltAmt1").value = String(state.tiltAmt1);
  $("tiltAmt2").value = String(state.tiltAmt2);
  $("tiltAmt1Val").value = state.tiltAmt1.toFixed(2);
  $("tiltAmt2Val").value = state.tiltAmt2.toFixed(2);
  $("doOrtho").checked = state.doOrtho;
  $("horizon").value = String(state.horizon);
  $("horizonVal").value = String(state.horizon);
  $("maxSteps").value = String(state.maxSteps);
  $("maxStepsVal").value = String(state.maxSteps);
  $("dtMacro").value = String(state.dtMacro);
  $("dtMacroVal").value = state.dtMacro.toFixed(4);
  $("rColl").value = String(state.rColl);
  $("rCollVal").value = state.rColl.toFixed(3);
  $("rEsc").value = String(state.rEsc);
  $("rEscVal").value = state.rEsc.toFixed(2);
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach((inp) => {
    const input = inp as HTMLInputElement & { _updateTrackFill?: () => void; dataset: DOMStringMap };
    const idx = Number(input.dataset.idx);
    input.value = String(state.z0[idx]);
    $(`z0v_${idx}`).value = state.z0[idx].toFixed(2);
    if (input._updateTrackFill) {
      input._updateTrackFill();
    }
  });
  const grid = $("presetGrid");
  const name = PRESETS.find(p => p.id === state.presetId)?.name;
  [...grid.children].forEach(child => {
    child.classList.toggle("active", child.textContent === name);
  });
  updateCustomPanelVisibility(uiTree);
  const cH = $("customDimH"), cV = $("customDimV"), cM = $("customMag");
  if (cH) { cH.value = String(state.customDimH); const hn = $("customDimHName"); if (hn) hn.textContent = AXIS_NAMES[state.customDimH]; }
  if (cV) { cV.value = String(state.customDimV); const vn = $("customDimVName"); if (vn) vn.textContent = AXIS_NAMES[state.customDimV]; }
  if (cM) { cM.value = String(state.customMag); $("customMagVal").value = state.customMag.toFixed(2); }
  syncTiltDimLabels();
  
  updateAllSliderTrackFills();
  
  updateStateBox();
  setStatus("Ready.");
  drawOverlayHUD();
}

function updateAllSliderTrackFills(): void {
  document.querySelectorAll('input[type="range"]').forEach((inp) => {
    const input = inp as HTMLInputElement & { _updateTrackFill?: () => void };
    if (input._updateTrackFill) {
      input._updateTrackFill();
    }
  });
}
