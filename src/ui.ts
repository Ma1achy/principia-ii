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
export { buildZ0Sliders, setZ0Range, zeroZ0, smallRandomZ0, applyQualityPreset, enhanceAllSliders } from './ui/builders/sliders.js';
export { buildAxisSelects, buildCustomDimSelects } from './ui/builders/selects.js';

// Sync
export { updateStateBox, syncUIFromState } from './ui/sync.js';
export { getStateBoxValue } from './ui/editors/stateBoxEditor.js';

// Main controls - bindUI function
import { state, navPrefs, canonicalState, applyCanonical, PRESETS, AXIS_NAMES, MODE_INFO } from './state.js';
import { $ } from './ui/utils.js';
import { setStatus, setOverlay } from './ui/panels/overlay.js';
import { setRenderingState } from './ui/core/state.js';
import { drawOverlayHUD } from './ui/panels/hud.js';
import { updateStateBox, syncUIFromState } from './ui/sync.ts';
import { getStateBoxValue } from './ui/editors/stateBoxEditor.ts';
import { bindValEditDialog } from './ui/dialogs/value-edit.js';
import { bindModePicker } from './ui/pickers/mode.js';
import { bindTiltPicker, syncTiltDimLabels } from './ui/pickers/tilt.js';
import { bindCustomDimPicker } from './ui/pickers/custom-dim.js';
import { bindResPicker } from './ui/pickers/resolution.js';
import { applyCustomBasis } from './ui/builders/presets.js';
import { buildPresets } from './ui/builders/presets.js';
import { setZ0Range, zeroZ0, smallRandomZ0, enhanceAllSliders } from './ui/components/slider/slider.js';
import { buildCustomDimSelects } from './ui/builders/selects.js';
import { initializePickerLabels, attachDynamicBehaviorBatch as refitPickerLabel } from './ui/components/picker/PickerLabel.js';

export function bindUI(
  renderer: any,
  glCanvas: HTMLCanvasElement,
  outCanvas: HTMLCanvasElement,
  uiCanvas: HTMLCanvasElement,
  ui2d: CanvasRenderingContext2D | null,
  probeTooltip: any,
  doRender: (res: number) => Promise<void>,
  scheduleRender: (reason: string) => void,
  writeHash: () => void,
  resizeUiCanvasToMatch: () => void,
  uiTree: any = null
): void {
  function updateStateBox_() { updateStateBox(); }
  function drawHUD() { drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch); }
  function buildPresets_() { buildPresets(scheduleRender, writeHash, updateStateBox_, drawHUD, uiTree); }

  enhanceAllSliders();
  initializePickerLabels();

  bindValEditDialog();

  bindModePicker((m: number) => {
    state.mode = m;
    ($("mode") as HTMLSelectElement).value = String(m);
    $("modeName")!.textContent = MODE_INFO[m]?.name || "";
    refitPickerLabel([$("modeLabel")!]);
    scheduleRender("mode"); writeHash(); updateStateBox_(); drawHUD();
  });

  bindTiltPicker(
    (i: number) => { state.tiltDim1 = i; ($("tiltDim1") as HTMLSelectElement).value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); },
    (i: number) => { state.tiltDim2 = i; ($("tiltDim2") as HTMLSelectElement).value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); }
  );

  bindCustomDimPicker(
    (i: number) => { state.customDimH = i; ($("customDimH") as HTMLSelectElement).value = String(i); $("customDimHName")!.textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-h"); writeHash(); updateStateBox_(); drawHUD(); } },
    (i: number) => { state.customDimV = i; ($("customDimV") as HTMLSelectElement).value = String(i); $("customDimVName")!.textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-v"); writeHash(); updateStateBox_(); drawHUD(); } }
  );

  bindResPicker((r: number) => {
    console.log(`[UI] bindResPicker callback called with r=${r}`);
    console.log(`[UI] Setting state.res from ${state.res} to ${r}`);
    state.res = r;
    ($("resolution") as HTMLSelectElement).value = String(r);
    $("resName")!.textContent = `${r} × ${r}`;
    refitPickerLabel([$("resLabel")!]);
    console.log(`[UI] Updated resolution UI elements`);
    writeHash(); 
    updateStateBox_(); 
    drawHUD();
    
    console.log(`[UI] Triggering render at resolution ${r}`);
    doRender(r).catch(err => {
      setOverlay(false);
      setRenderingState(false);
      setStatus(String(err?.message || err));
      console.error(err);
      drawHUD();
    });
  });

  async function copyJson() {
    const txt = getStateBoxValue() || JSON.stringify(canonicalState(state), null, 2);
    try { await navigator.clipboard.writeText(txt); setStatus("JSON copied."); }
    catch { prompt("Copy JSON:", txt); }
  }

  async function pasteJsonApply() {
    const txt = getStateBoxValue().trim();
    if (!txt) { setStatus("Paste JSON into the box first."); return; }
    try {
      applyCanonical(JSON.parse(txt), applyCustomBasis);
      buildPresets_(); syncUIFromState(renderer, scheduleRender, writeHash, drawHUD, uiTree); writeHash(); updateStateBox_();
      scheduleRender("json apply");
      setStatus("State applied.");
    } catch (e: any) {
      setStatus("Invalid JSON: " + (e?.message || e));
    }
  }

  async function downloadJson() {
    const txt = getStateBoxValue() || JSON.stringify(canonicalState(state), null, 2);
    const blob = new Blob([txt], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "three-body-state.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    setStatus("Downloaded JSON.");
  }

  $("renderBtn")!.addEventListener("click", () => {
    doRender(state.res).catch(err => {
      setOverlay(false);
      setRenderingState(false);
      setStatus(String(err?.message || err)); console.error(err); drawHUD();
    });
  });

  $("resetAllBtn")!.addEventListener("click", () => {
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
    setZ0Range(2.0); ($("z0Range") as HTMLInputElement).value = "2.0"; ($("z0RangeVal") as HTMLInputElement).value = "2.0";
    buildPresets_(); syncUIFromState(renderer, scheduleRender, writeHash, drawHUD, uiTree); writeHash(); scheduleRender("reset");
  });

  $("copyLinkBtn")!.addEventListener("click", async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); setStatus("URL copied."); }
    catch { prompt("Copy this link:", location.href); }
  });

  $("copyJsonBtn")!.addEventListener("click", () => copyJson());
  $("pasteJsonBtn")!.addEventListener("click", () => pasteJsonApply());
  $("downloadJsonBtn")!.addEventListener("click", () => downloadJson());

  $("savePngBtn")!.addEventListener("click", () => {
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

  ($("showHud") as HTMLInputElement).addEventListener("change", () => { drawHUD(); if (!($("showHud") as HTMLInputElement).checked) probeTooltip.hide(); });

  buildCustomDimSelects();

  ($("customMag") as HTMLInputElement).addEventListener("input", (e) => {
    state.customMag = +(e.target as HTMLInputElement).value;
    const ni = $("customMagVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.customMag.toFixed(2);
    if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-mag"); writeHash(); updateStateBox_(); drawHUD(); }
  });
  ($("customMagVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(0.1, Math.min(4.0, +(e.target as HTMLInputElement).value));
    state.customMag = v; ($("customMag") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(2);
    if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-mag"); writeHash(); updateStateBox_(); drawHUD(); }
  });

  ($("gamma") as HTMLInputElement).addEventListener("input", (e) => {
    state.gammaDeg = +(e.target as HTMLInputElement).value;
    const ni = $("gammaVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.gammaDeg.toFixed(2);
    scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("gammaVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(0, Math.min(360, +(e.target as HTMLInputElement).value));
    state.gammaDeg = v; ($("gamma") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(2);
    scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltDim1") as HTMLSelectElement).addEventListener("change", (e) => {
    state.tiltDim1 = +(e.target as HTMLSelectElement).value;
    syncTiltDimLabels();
    scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltDim2") as HTMLSelectElement).addEventListener("change", (e) => {
    state.tiltDim2 = +(e.target as HTMLSelectElement).value;
    syncTiltDimLabels();
    scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltAmt1") as HTMLInputElement).addEventListener("input", (e) => {
    state.tiltAmt1 = +(e.target as HTMLInputElement).value;
    const ni = $("tiltAmt1Val") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.tiltAmt1.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltAmt1Val") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(-2.0, Math.min(2.0, +(e.target as HTMLInputElement).value));
    state.tiltAmt1 = v; ($("tiltAmt1") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltAmt2") as HTMLInputElement).addEventListener("input", (e) => {
    state.tiltAmt2 = +(e.target as HTMLInputElement).value;
    const ni = $("tiltAmt2Val") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.tiltAmt2.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("tiltAmt2Val") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(-2.0, Math.min(2.0, +(e.target as HTMLInputElement).value));
    state.tiltAmt2 = v; ($("tiltAmt2") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(2);
    scheduleRender("tilt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("doOrtho") as HTMLInputElement).addEventListener("change", (e) => {
    state.doOrtho = !!(e.target as HTMLInputElement).checked;
    scheduleRender("ortho"); writeHash(); updateStateBox_(); drawHUD();
  });
  $("rotReset")!.addEventListener("click", () => {
    state.gammaDeg = 0.0; state.tiltAmt1 = 0.0; state.tiltAmt2 = 0.0;
    ["gamma","tiltAmt1","tiltAmt2"].forEach(id => { ($(id) as HTMLInputElement)!.value = "0"; });
    ($("gammaVal") as HTMLInputElement).value = "0.00";
    ($("tiltAmt1Val") as HTMLInputElement).value = "0.00";
    ($("tiltAmt2Val") as HTMLInputElement).value = "0.00";
    scheduleRender("rot reset"); writeHash(); updateStateBox_(); drawHUD();
  });

  $("z0Zero")!.addEventListener("click", () => zeroZ0(scheduleRender, writeHash, updateStateBox_, drawHUD));
  $("z0SmallRand")!.addEventListener("click", () => smallRandomZ0(scheduleRender, writeHash, updateStateBox_, drawHUD));
  ($("z0Range") as HTMLInputElement).addEventListener("input", (e) => setZ0Range(+(e.target as HTMLInputElement).value));
  ($("z0RangeVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(0.25, Math.min(8.0, +(e.target as HTMLInputElement).value));
    ($("z0Range") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(1);
    setZ0Range(v);
  });

  ($("horizon") as HTMLInputElement).addEventListener("input", (e) => {
    state.horizon = +(e.target as HTMLInputElement).value;
    const ni = $("horizonVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = String(state.horizon);
    scheduleRender("horizon"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("horizonVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(10, Math.min(200, Math.round(+(e.target as HTMLInputElement).value / 10) * 10));
    state.horizon = v; ($("horizon") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = String(v);
    scheduleRender("horizon"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("maxSteps") as HTMLInputElement).addEventListener("input", (e) => {
    state.maxSteps = +(e.target as HTMLInputElement).value;
    const ni = $("maxStepsVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = String(state.maxSteps);
    scheduleRender("steps"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("maxStepsVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(1000, Math.min(40000, Math.round(+(e.target as HTMLInputElement).value / 1000) * 1000));
    state.maxSteps = v; ($("maxSteps") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = String(v);
    scheduleRender("steps"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("dtMacro") as HTMLInputElement).addEventListener("input", (e) => {
    state.dtMacro = +(e.target as HTMLInputElement).value;
    const ni = $("dtMacroVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.dtMacro.toFixed(4);
    scheduleRender("dt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("dtMacroVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(0.0005, Math.min(0.01, +(e.target as HTMLInputElement).value));
    state.dtMacro = v; ($("dtMacro") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(4);
    scheduleRender("dt"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("rColl") as HTMLInputElement).addEventListener("input", (e) => {
    state.rColl = +(e.target as HTMLInputElement).value;
    const ni = $("rCollVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.rColl.toFixed(3);
    scheduleRender("rColl"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("rCollVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(0.005, Math.min(0.06, +(e.target as HTMLInputElement).value));
    state.rColl = v; ($("rColl") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(3);
    scheduleRender("rColl"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("rEsc") as HTMLInputElement).addEventListener("input", (e) => {
    state.rEsc = +(e.target as HTMLInputElement).value;
    const ni = $("rEscVal") as HTMLInputElement;
    if (document.activeElement !== ni) ni.value = state.rEsc.toFixed(2);
    scheduleRender("rEsc"); writeHash(); updateStateBox_(); drawHUD();
  });
  ($("rEscVal") as HTMLInputElement).addEventListener("change", (e) => {
    const v = Math.max(1.0, Math.min(12.0, +(e.target as HTMLInputElement).value));
    state.rEsc = v; ($("rEsc") as HTMLInputElement).value = String(v); (e.target as HTMLInputElement).value = v.toFixed(2);
    scheduleRender("rEsc"); writeHash(); updateStateBox_(); drawHUD();
  });

  function openSettingsPanel()  { $("settingsPanelOverlay")!.classList.add("open"); }
  function closeSettingsPanel() { $("settingsPanelOverlay")!.classList.remove("open"); }
  $("settingsBtn")!.addEventListener("click", openSettingsPanel);
  $("settingsPanelClose")!.addEventListener("click", closeSettingsPanel);
  $("settingsPanelOverlay")!.addEventListener("click", (e) => { if (e.target === $("settingsPanelOverlay")) closeSettingsPanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("settingsPanelOverlay")!.classList.contains("open")) closeSettingsPanel(); });

  function syncSettingsUI() {
    ($("stgInvertScroll") as HTMLInputElement).checked = navPrefs.invertScroll;
    ($("stgInvertPanX") as HTMLInputElement).checked   = navPrefs.invertPanX;
    ($("stgInvertPanY") as HTMLInputElement).checked   = navPrefs.invertPanY;
    ($("stgZoomSpeed") as HTMLInputElement).value      = String(navPrefs.zoomSpeed);
    ($("stgZoomSpeedVal") as HTMLInputElement).value   = navPrefs.zoomSpeed.toFixed(1);
    ($("stgPanSpeed") as HTMLInputElement).value       = String(navPrefs.panSpeed);
    ($("stgPanSpeedVal") as HTMLInputElement).value    = navPrefs.panSpeed.toFixed(1);
  }
  syncSettingsUI();

  ($("stgInvertScroll") as HTMLInputElement).addEventListener("change", (e) => { navPrefs.invertScroll = (e.target as HTMLInputElement).checked; });
  ($("stgInvertPanX") as HTMLInputElement).addEventListener("change",   (e) => { navPrefs.invertPanX   = (e.target as HTMLInputElement).checked; });
  ($("stgInvertPanY") as HTMLInputElement).addEventListener("change",   (e) => { navPrefs.invertPanY   = (e.target as HTMLInputElement).checked; });
  ($("stgZoomSpeed") as HTMLInputElement).addEventListener("input",     (e) => { navPrefs.zoomSpeed    = +(e.target as HTMLInputElement).value; ($("stgZoomSpeedVal") as HTMLInputElement).value = navPrefs.zoomSpeed.toFixed(1); });
  ($("stgZoomSpeedVal") as HTMLInputElement).addEventListener("change", (e) => { navPrefs.zoomSpeed    = Math.min(4.0, Math.max(0.2, +(e.target as HTMLInputElement).value || 1.0)); ($("stgZoomSpeed") as HTMLInputElement).value = String(navPrefs.zoomSpeed); ($("stgZoomSpeedVal") as HTMLInputElement).value = navPrefs.zoomSpeed.toFixed(1); });
  ($("stgPanSpeed") as HTMLInputElement).addEventListener("input",      (e) => { navPrefs.panSpeed     = +(e.target as HTMLInputElement).value; ($("stgPanSpeedVal") as HTMLInputElement).value  = navPrefs.panSpeed.toFixed(1); });
  ($("stgPanSpeedVal") as HTMLInputElement).addEventListener("change",  (e) => { navPrefs.panSpeed     = Math.min(4.0, Math.max(0.2, +(e.target as HTMLInputElement).value || 1.0)); ($("stgPanSpeed") as HTMLInputElement).value  = String(navPrefs.panSpeed);  ($("stgPanSpeedVal") as HTMLInputElement).value  = navPrefs.panSpeed.toFixed(1); });

  function openInfoPanel()  { $("infoPanelOverlay")!.classList.add("open"); }
  function closeInfoPanel() { $("infoPanelOverlay")!.classList.remove("open"); }
  $("infoBtn")!.addEventListener("click", openInfoPanel);
  $("infoPanelClose")!.addEventListener("click", closeInfoPanel);
  $("infoPanelOverlay")!.addEventListener("click", (e) => { if (e.target === $("infoPanelOverlay")) closeInfoPanel(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInfoPanel();
      closeSettingsPanel();
    }
  });

  document.querySelectorAll('.section-head').forEach(head => {
    head.addEventListener('click', async () => {
      const target = (head as HTMLElement).dataset.target;
      if (!target) return;
      const body = $(target);
      if (!body) return;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      head.classList.toggle('open', !isOpen);
      
      if ((window as any).uiTree) {
        try {
          const bodyGridId = `${target}-body`;
          const bodyGrid = (window as any).uiTree.getNode(bodyGridId);
          
          if (bodyGrid && bodyGrid.kind === 'grid') {
            (window as any).uiTree.updateNode(bodyGridId, {
              hidden: isOpen
            });
            console.log('[UI] Section', target, isOpen ? 'collapsed' : 'expanded', '- body grid', bodyGridId, 'hidden:', isOpen);
            
            const { rebuildSidebarGrid } = await import('./ui/semantic-tree/grid-rebuilder.js');
            rebuildSidebarGrid((window as any).uiTree);
          } else {
            console.warn('[UI] Body grid not found:', bodyGridId);
          }
        } catch (err) {
          console.warn('[UI] Failed to update section collapse state:', err);
        }
      }
    });
    const target = (head as HTMLElement).dataset.target;
    if (target && $(target)?.classList.contains('open')) head.classList.add('open');
  });
}
