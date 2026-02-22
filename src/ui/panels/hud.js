import { state, MODE_INFO, PRESETS, AXIS_NAMES_SHORT } from '../../state.js';
import { $ } from '../utils.js';
import { buildDOMAxes } from './axes.js';
import { updateLegendPanel } from './legend.js';

// ─── HUD ─────────────────────────────────────────────────────────────────────

function fmt(n, k = 3) { return Number.isFinite(n) ? n.toFixed(k) : "—"; }
function topComponents(vec, k = 3) {
  return vec.map((v, i) => ({ i, v, a: Math.abs(v) }))
    .sort((x, y) => y.a - x.a).slice(0, k);
}

export function drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch) {
  updateLegendPanel();
  const activeCanvas = outCanvas.style.display !== "none" ? outCanvas : glCanvas;
  const rect = activeCanvas.getBoundingClientRect();
  if (rect.width > 0) {
    buildDOMAxes(rect, renderer);
  }
  ui2d.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  const hudPanel = $("hud-panel");
  hudPanel.style.display = "flex";
  const { q1, q2 } = renderer.computeSliceDirs(state);
  const top1 = topComponents(q1, 3);
  const top2 = topComponents(q2, 3);
  const mode_name   = MODE_INFO[state.mode]?.name || "";
  const preset_name = PRESETS.find(p => p.id === state.presetId)?.name || state.presetId;
  const rows = [
    { label: "mode",    val: mode_name },
    { label: "preset",  val: preset_name },
    { label: "γ",       val: `${state.gammaDeg.toFixed(1)}°` },
    { label: "zoom",    val: fmt(state.viewZoom, 3) },
    { label: "pan",     val: `(${fmt(state.viewPanX,3)}, ${fmt(state.viewPanY,3)})` },
    { label: "horizon", val: `${state.horizon}` },
    { label: "dt",      val: fmt(state.dtMacro, 4) },
    { label: "q₁",      val: top1.map(t => `${t.v>=0?"+":""}${t.v.toFixed(2)}·${AXIS_NAMES_SHORT[t.i]}`).join(" ") },
    { label: "q₂",      val: top2.map(t => `${t.v>=0?"+":""}${t.v.toFixed(2)}·${AXIS_NAMES_SHORT[t.i]}`).join(" ") },
  ];
  hudPanel.innerHTML = rows.map(r =>
    `<div class="hud-row"><span class="hud-label">${r.label}</span><span class="hud-val">${r.val}</span></div>`
  ).join("");
}
