import { state, AXIS_NAMES, QUALITY_PRESETS } from '../../state.js';
import { $ } from '../utils.js';

// ─── Z0 sliders builder ──────────────────────────────────────────────────────

export function buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const wrap = $("z0Sliders");
  wrap.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const row = document.createElement("div");
    row.className = "sl-row";

    const lab = document.createElement("label");
    lab.textContent = AXIS_NAMES[i];
    row.appendChild(lab);

    const trackRow = document.createElement("div");
    trackRow.className = "sl-track-row";

    const input = document.createElement("input");
    input.type = "range";
    input.min = "-2.0"; input.max = "2.0"; input.step = "0.01"; input.value = "0.0";
    input.dataset.idx = String(i);
    trackRow.appendChild(input);

    const valWrap = document.createElement("div");
    valWrap.className = "sl-val-wrap";

    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.id = `z0v_${i}`;
    numInput.className = "slider-num";
    numInput.value = "0.00";
    numInput.step = "0.01";
    numInput.min = input.min;
    numInput.max = input.max;
    numInput.dataset.title = AXIS_NAMES[i];
    numInput.dataset.tip = `z${i} offset component.`;
    valWrap.appendChild(numInput);
    trackRow.appendChild(valWrap);
    row.appendChild(trackRow);

    input.addEventListener("input", () => {
      const idx = +input.dataset.idx;
      state.z0[idx] = +input.value;
      const ni = $(`z0v_${idx}`);
      if (document.activeElement !== ni) ni.value = state.z0[idx].toFixed(2);
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });
    numInput.addEventListener("change", () => {
      const idx = +input.dataset.idx;
      const clamped = Math.max(+input.min, Math.min(+input.max, +numInput.value));
      state.z0[idx] = clamped;
      input.value = clamped;
      numInput.value = clamped.toFixed(2);
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });

    wrap.appendChild(row);
  }
}

export function setZ0Range(r) {
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    inp.min = (-r).toFixed(2);
    inp.max = r.toFixed(2);
  });
  const ni = $("z0RangeVal");
  if (document.activeElement !== ni) ni.value = r.toFixed(1);
}

export function zeroZ0(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  state.z0.fill(0.0);
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    inp.value = "0.0";
    $(`z0v_${inp.dataset.idx}`).value = "0.00";
  });
  scheduleRender("z0-zero"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function smallRandomZ0(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  for (let i = 0; i < 10; i++) state.z0[i] = (Math.random() * 2 - 1) * 0.15;
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    const idx = +inp.dataset.idx;
    inp.value = String(state.z0[idx]);
    $(`z0v_${idx}`).value = state.z0[idx].toFixed(2);
  });
  scheduleRender("z0-rand"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function applyQualityPreset(name, scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const q = QUALITY_PRESETS[name] || QUALITY_PRESETS.balanced;
  state.dtMacro = q.dtMacro;
  state.maxSteps = q.maxSteps;
  $("dtMacro").value = String(state.dtMacro);
  $("dtMacroVal").value = state.dtMacro.toFixed(4);
  $("maxSteps").value = String(state.maxSteps);
  $("maxStepsVal").value = String(state.maxSteps);
  scheduleRender("quality"); writeHash(); updateStateBox(); drawOverlayHUD();
}
