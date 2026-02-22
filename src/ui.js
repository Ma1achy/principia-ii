// Consolidated UI module - re-exports from refactored modules

// Core
export { setRenderingState } from './ui/core/state.js';
export { showGL, showOut } from './ui/core/canvas.js';

// Panels
export { setOverlay, setStatus } from './ui/panels/overlay.js';
export { buildDOMAxes } from './ui/panels/axes.js';
export { updateLegendPanel } from './ui/panels/legend.js';
export { drawOverlayHUD } from './ui/panels/hud.js';

// Components
export { uvFromClientXY, zAtUV, showProbeAtEvent } from './ui/components/probe.js';

// Dialogs
export { bindValEditDialog } from './ui/dialogs/value-edit.js';

// Pickers
export { bindModePicker } from './ui/pickers/mode.js';
export { bindResPicker } from './ui/pickers/resolution.js';
export { bindQualityPicker } from './ui/pickers/quality.js';
export { bindTiltPicker, syncTiltDimLabels } from './ui/pickers/tilt.js';
export { bindCustomDimPicker } from './ui/pickers/custom-dim.js';

// Builders
export { buildResolutions } from './ui/builders/resolutions.js';
export { buildPresets, applyCustomBasis, updateCustomPanelVisibility } from './ui/builders/presets.js';
export { buildZ0Sliders, setZ0Range, zeroZ0, smallRandomZ0, applyQualityPreset } from './ui/builders/sliders.js';
export { buildAxisSelects, buildCustomDimSelects } from './ui/builders/selects.js';

// Sync
export { updateStateBox, syncUIFromState } from './ui/sync.js';

// Main controls - bindUI function
import { state, navPrefs, canonicalState, applyCanonical, PRESETS, AXIS_NAMES, MODE_INFO } from './state.js';
import { $ } from './ui/utils.js';
import { setStatus, setOverlay } from './ui/panels/overlay.js';
import { setRenderingState } from './ui/core/state.js';
import { drawOverlayHUD } from './ui/panels/hud.js';
import { updateStateBox, syncUIFromState } from './ui/sync.js';
import { bindValEditDialog } from './ui/dialogs/value-edit.js';
import { bindModePicker } from './ui/pickers/mode.js';
import { bindTiltPicker, syncTiltDimLabels } from './ui/pickers/tilt.js';
import { bindCustomDimPicker } from './ui/pickers/custom-dim.js';
import { bindResPicker } from './ui/pickers/resolution.js';
import { applyCustomBasis } from './ui/builders/presets.js';
import { buildPresets } from './ui/builders/presets.js';
import { setZ0Range, zeroZ0, smallRandomZ0 } from './ui/builders/sliders.js';
import { buildCustomDimSelects } from './ui/builders/selects.js';

export function bindUI(renderer, glCanvas, outCanvas, uiCanvas, ui2d, probeTooltip, doRender, scheduleRender, writeHash, resizeUiCanvasToMatch) {
  function updateStateBox_() { updateStateBox(); }
  function drawHUD() { drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch); }
  function buildPresets_() { buildPresets(scheduleRender, writeHash, updateStateBox_, drawHUD); }

  bindValEditDialog();

  bindModePicker((m) => {
    state.mode = m;
    $("mode").value = String(m);
    $("modeName").textContent = MODE_INFO[m]?.name || "";
    scheduleRender("mode"); writeHash(); updateStateBox_(); drawHUD();
  });

  bindTiltPicker(
    (i) => { state.tiltDim1 = i; $("tiltDim1").value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); },
    (i) => { state.tiltDim2 = i; $("tiltDim2").value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); }
  );

  bindCustomDimPicker(
    (i) => { state.customDimH = i; $("customDimH").value = String(i); $("customDimHName").textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-h"); writeHash(); updateStateBox_(); drawHUD(); } },
    (i) => { state.customDimV = i; $("customDimV").value = String(i); $("customDimVName").textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-v"); writeHash(); updateStateBox_(); drawHUD(); } }
  );

  bindResPicker((r) => {
    state.res = r;
    $("resolution").value = String(r);
    $("resName").textContent = `${r} × ${r}`;
    scheduleRender("res"); writeHash(); updateStateBox_(); drawHUD();
  });

  async function copyJson() {
    const txt = $("stateBox").value || JSON.stringify(canonicalState(state), null, 2);
    try { await navigator.clipboard.writeText(txt); setStatus("JSON copied."); }
    catch { prompt("Copy JSON:", txt); }
  }

  async function pasteJsonApply() {
    const txt = $("stateBox").value.trim();
    if (!txt) { setStatus("Paste JSON into the box first."); return; }
    try {
      applyCanonical(JSON.parse(txt), applyCustomBasis);
      buildPresets_(); syncUIFromState(renderer, scheduleRender, writeHash, drawHUD); writeHash(); updateStateBox_();
      scheduleRender("json apply");
      setStatus("State applied.");
    } catch (e) {
      setStatus("Invalid JSON: " + (e?.message || e));
    }
  }

  function downloadJson() {
    const txt = $("stateBox").value || JSON.stringify(canonicalState(state), null, 2);
    const blob = new Blob([txt], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "three-body-state.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    setStatus("Downloaded JSON.");
  }

  $("renderBtn").addEventListener("click", () => {
    doRender(state.res).catch(err => {
      setOverlay(false);
      setRenderingState(false);
      setStatus(String(err?.message || err)); console.error(err); drawHUD();
    });
  });

  $("resetAllBtn").addEventListener("click", () => {
    state.mode = 0; state.res = 1024;
    state.viewZoom = 1.0; state.viewPanX = 0.0; state.viewPanY = 0.0;
    const p0 = PRESETS[0];
    state.presetId = p0.id; state.dir1Base = p0.q1.slice(); state.dir2Base = p0.q2.slice();
    state.z0.fill(0.0);
    state.gammaDeg = 0.0; state.tiltDim1 = 8; state.tiltDim2 = 9;
    state.tiltAmt1 = 0.0; state.tiltAmt2 = 0.0; state.doOrtho = true;
    state.horizon = 50; state.maxSteps = 20000; state.dtMacro = 0.002;
    state.rColl = 0.02; state.rEsc = 5.0;
    state.customMag = 1.0; state.customDimH = 0; state.customDimV = 1;
    const resNameEl = $("resName"); if (resNameEl) resNameEl.textContent = "1024 × 1024";
    setZ0Range(2.0); $("z0Range").value = "2.0"; $("z0RangeVal").value = "2.0";
    buildPresets_(); syncUIFromState(renderer, scheduleRender, writeHash, drawHUD); writeHash(); scheduleRender("reset");
  });

  $("copyLinkBtn").addEventListener("click", async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); setStatus("URL copied."); }
    catch { prompt("Copy this link:", location.href); }
  });

  $("copyJsonBtn").addEventListener("click", () => copyJson());
  $("pasteJsonBtn").addEventListener("click", () => pasteJsonApply());
  $("downloadJsonBtn").addEventListener("click", () => downloadJson());

  $("savePngBtn").addEventListener("click", () => {
    const c = (outCanvas.style.display !== "none") ? outCanvas : glCanvas;
    c.toBlob((blob) => {
      if (!blob) { setStatus("Export failed."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "three-body.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2500);
      setStatus("PNG saved.");
    }, "image/png");
  });

  $("showHud").addEventListener("change", () => { drawHUD(); if (!$("showHud").checked) probeTooltip.hide(); });

  buildCustomDimSelects();

  $("customMag").addEventListener("input", (e) => {
    state.customMag = +e.target.value;
    const ni = $("customMagVal");
    if (document.activeElement !== ni) ni.value = state.customMag.toFixed(2);
    if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-mag"); writeHash(); updateStateBox_(); drawHUD(); }
  });
  $("customMagVal").addEventListener("change", (e) => {
    const v = Math.max(0.1, Math.min(4.0, +e.target.value));
    state.customMag = v; $("customMag").value = v; e.target.value = v.toFixed(2);
    if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-mag"); writeHash(); updateStateBox_(); drawHUD(); }
  });

  $("gamma").addEventListener("input", (e) => {
    state.gammaDeg = +e.target.value;
    const ni = $("gammaVal");
    if (document.activeElement !== ni) ni.value = state.gammaDeg.toFixed(2);
    scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("gammaVal").addEventListener("change", (e) => {
    const v = Math.max(0, Math.min(360, +e.target.value));
    state.gammaDeg = v; $("gamma").value = v; e.target.value = v.toFixed(2);
    scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltDim1").addEventListener("change", (e) => {
    state.tiltDim1 = +e.target.value;
    syncTiltDimLabels();
    scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltDim2").addEventListener("change", (e) => {
    state.tiltDim2 = +e.target.value;
    syncTiltDimLabels();
    scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltAmt1").addEventListener("input", (e) => {
    state.tiltAmt1 = +e.target.value;
    const ni = $("tiltAmt1Val");
    if (document.activeElement !== ni) ni.value = state.tiltAmt1.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltAmt1Val").addEventListener("change", (e) => {
    const v = Math.max(-2.0, Math.min(2.0, +e.target.value));
    state.tiltAmt1 = v; $("tiltAmt1").value = v; e.target.value = v.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltAmt2").addEventListener("input", (e) => {
    state.tiltAmt2 = +e.target.value;
    const ni = $("tiltAmt2Val");
    if (document.activeElement !== ni) ni.value = state.tiltAmt2.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("tiltAmt2Val").addEventListener("change", (e) => {
    const v = Math.max(-2.0, Math.min(2.0, +e.target.value));
    state.tiltAmt2 = v; $("tiltAmt2").value = v; e.target.value = v.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("doOrtho").addEventListener("change", (e) => {
    state.doOrtho = !!e.target.checked;
    scheduleRender("ortho"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rotReset").addEventListener("click", () => {
    state.gammaDeg = 0.0; state.tiltAmt1 = 0.0; state.tiltAmt2 = 0.0;
    ["gamma","tiltAmt1","tiltAmt2"].forEach(id => { $(id).value = "0"; });
    $("gammaVal").value = "0.00";
    $("tiltAmt1Val").value = "0.00";
    $("tiltAmt2Val").value = "0.00";
    scheduleRender("rot reset"); writeHash(); updateStateBox_(); drawHUD();
  });

  $("z0Zero").addEventListener("click", () => zeroZ0(scheduleRender, writeHash, updateStateBox_, drawHUD));
  $("z0SmallRand").addEventListener("click", () => smallRandomZ0(scheduleRender, writeHash, updateStateBox_, drawHUD));
  $("z0Range").addEventListener("input", (e) => setZ0Range(+e.target.value));
  $("z0RangeVal").addEventListener("change", (e) => {
    const v = Math.max(0.25, Math.min(8.0, +e.target.value));
    $("z0Range").value = v; e.target.value = v.toFixed(1);
    setZ0Range(v);
  });

  $("horizon").addEventListener("input", (e) => {
    state.horizon = +e.target.value;
    const ni = $("horizonVal");
    if (document.activeElement !== ni) ni.value = String(state.horizon);
    scheduleRender("horizon"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("horizonVal").addEventListener("change", (e) => {
    const v = Math.max(10, Math.min(200, Math.round(+e.target.value / 10) * 10));
    state.horizon = v; $("horizon").value = v; e.target.value = v;
    scheduleRender("horizon"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("maxSteps").addEventListener("input", (e) => {
    state.maxSteps = +e.target.value;
    const ni = $("maxStepsVal");
    if (document.activeElement !== ni) ni.value = String(state.maxSteps);
    scheduleRender("steps"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("maxStepsVal").addEventListener("change", (e) => {
    const v = Math.max(1000, Math.min(40000, Math.round(+e.target.value / 1000) * 1000));
    state.maxSteps = v; $("maxSteps").value = v; e.target.value = v;
    scheduleRender("steps"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("dtMacro").addEventListener("input", (e) => {
    state.dtMacro = +e.target.value;
    const ni = $("dtMacroVal");
    if (document.activeElement !== ni) ni.value = state.dtMacro.toFixed(4);
    scheduleRender("dt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("dtMacroVal").addEventListener("change", (e) => {
    const v = Math.max(0.0005, Math.min(0.01, +e.target.value));
    state.dtMacro = v; $("dtMacro").value = v; e.target.value = v.toFixed(4);
    scheduleRender("dt"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rColl").addEventListener("input", (e) => {
    state.rColl = +e.target.value;
    const ni = $("rCollVal");
    if (document.activeElement !== ni) ni.value = state.rColl.toFixed(3);
    scheduleRender("rColl"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rCollVal").addEventListener("change", (e) => {
    const v = Math.max(0.005, Math.min(0.06, +e.target.value));
    state.rColl = v; $("rColl").value = v; e.target.value = v.toFixed(3);
    scheduleRender("rColl"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rEsc").addEventListener("input", (e) => {
    state.rEsc = +e.target.value;
    const ni = $("rEscVal");
    if (document.activeElement !== ni) ni.value = state.rEsc.toFixed(2);
    scheduleRender("rEsc"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rEscVal").addEventListener("change", (e) => {
    const v = Math.max(1.0, Math.min(12.0, +e.target.value));
    state.rEsc = v; $("rEsc").value = v; e.target.value = v.toFixed(2);
    scheduleRender("rEsc"); writeHash(); updateStateBox_(); drawHUD();
  });

  function openSettingsPanel()  { $("settingsPanelOverlay").classList.add("open"); }
  function closeSettingsPanel() { $("settingsPanelOverlay").classList.remove("open"); }
  $("settingsBtn").addEventListener("click", openSettingsPanel);
  $("settingsPanelClose").addEventListener("click", closeSettingsPanel);
  $("settingsPanelOverlay").addEventListener("click", (e) => { if (e.target === $("settingsPanelOverlay")) closeSettingsPanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("settingsPanelOverlay").classList.contains("open")) closeSettingsPanel(); });

  function syncSettingsUI() {
    $("stgInvertScroll").checked = navPrefs.invertScroll;
    $("stgInvertPanX").checked   = navPrefs.invertPanX;
    $("stgInvertPanY").checked   = navPrefs.invertPanY;
    $("stgZoomSpeed").value      = String(navPrefs.zoomSpeed);
    $("stgZoomSpeedVal").value   = navPrefs.zoomSpeed.toFixed(1);
    $("stgPanSpeed").value       = String(navPrefs.panSpeed);
    $("stgPanSpeedVal").value    = navPrefs.panSpeed.toFixed(1);
  }
  syncSettingsUI();

  $("stgInvertScroll").addEventListener("change", (e) => { navPrefs.invertScroll = e.target.checked; });
  $("stgInvertPanX").addEventListener("change",   (e) => { navPrefs.invertPanX   = e.target.checked; });
  $("stgInvertPanY").addEventListener("change",   (e) => { navPrefs.invertPanY   = e.target.checked; });
  $("stgZoomSpeed").addEventListener("input",     (e) => { navPrefs.zoomSpeed    = +e.target.value; $("stgZoomSpeedVal").value = navPrefs.zoomSpeed.toFixed(1); });
  $("stgZoomSpeedVal").addEventListener("change", (e) => { navPrefs.zoomSpeed    = Math.min(4.0, Math.max(0.2, +e.target.value || 1.0)); $("stgZoomSpeed").value = String(navPrefs.zoomSpeed); $("stgZoomSpeedVal").value = navPrefs.zoomSpeed.toFixed(1); });
  $("stgPanSpeed").addEventListener("input",      (e) => { navPrefs.panSpeed     = +e.target.value; $("stgPanSpeedVal").value  = navPrefs.panSpeed.toFixed(1); });
  $("stgPanSpeedVal").addEventListener("change",  (e) => { navPrefs.panSpeed     = Math.min(4.0, Math.max(0.2, +e.target.value || 1.0)); $("stgPanSpeed").value  = String(navPrefs.panSpeed);  $("stgPanSpeedVal").value  = navPrefs.panSpeed.toFixed(1); });

  function openInfoPanel()  { $("infoPanelOverlay").classList.add("open"); }
  function closeInfoPanel() { $("infoPanelOverlay").classList.remove("open"); }
  $("infoBtn").addEventListener("click", openInfoPanel);
  $("infoPanelClose").addEventListener("click", closeInfoPanel);
  $("infoPanelOverlay").addEventListener("click", (e) => { if (e.target === $("infoPanelOverlay")) closeInfoPanel(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInfoPanel();
      closeSettingsPanel();
    }
  });

  document.querySelectorAll('.section-head').forEach(head => {
    head.addEventListener('click', () => {
      const target = head.dataset.target;
      const body = $(target);
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      head.classList.toggle('open', !isOpen);
    });
    const target = head.dataset.target;
    if ($(target).classList.contains('open')) head.classList.add('open');
  });
}
