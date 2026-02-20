import { state, navPrefs, canonicalState, applyCanonical, applyPackedHash, encodeStateHash, decodeStateHash, PRESETS, AXIS_NAMES, AXIS_NAMES_SHORT, MODE_INFO, QUALITY_PRESETS } from './state.js';
import { decodeICParamsFromZ, dot10 } from './math.js';

const $ = id => document.getElementById(id);

// ─── Render state ─────────────────────────────────────────────────────────────

let _isRendering = false;

export function setRenderingState(active) {
  _isRendering = active;
  const btn = $("renderBtn");
  if (!btn) return;
  if (active) {
    btn.textContent = "Stop";
    btn.classList.remove("primary");
    btn.classList.add("danger");
  } else {
    btn.textContent = "Render";
    btn.classList.remove("danger");
    btn.classList.add("primary");
  }
}

// ─── Canvas visibility ───────────────────────────────────────────────────────

export function showGL(glCanvas, outCanvas, resizeUiCanvasToMatch) {
  glCanvas.style.display = "";
  outCanvas.style.display = "none";
  resizeUiCanvasToMatch();
}

export function showOut(glCanvas, outCanvas, resizeUiCanvasToMatch) {
  glCanvas.style.display = "none";
  outCanvas.style.display = "";
  resizeUiCanvasToMatch();
}

// ─── Overlay / status ────────────────────────────────────────────────────────

export function setOverlay(show, msg = "", pct = 0) {
  const statusEl = $("status");
  const textEl   = $("statusText");
  const barEl    = $("statusProgress");
  if (show) {
    if (msg) textEl.textContent = msg;
    barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    statusEl.classList.add("progress-active");
  } else {
    statusEl.classList.remove("progress-active");
    barEl.style.width = "0%";
  }
}

export function setStatus(msg) {
  $("statusText").textContent = msg;
}

// ─── Axis rulers ─────────────────────────────────────────────────────────────

export function buildDOMAxes(rect, renderer) {
  const W = rect.width, H = rect.height;
  const view = renderer.fullViewTile(state);
  const { q1, q2 } = renderer.computeSliceDirs(state);

  function axisTitle(q, topN = 2) {
    const comps = q
      .map((v, i) => ({ i, v, a: Math.abs(v) }))
      .filter(c => c.a > 0.05)
      .sort((a, b) => b.a - a.a)
      .slice(0, topN);
    if (comps.length === 0) return "—";
    return comps.map(c => {
      const sign = c.v >= 0 ? "" : "−";
      const weight = comps.length > 1 ? `${(c.a).toFixed(2)}·` : "";
      return `${sign}${weight}${AXIS_NAMES[c.i]}`;
    }).join("  +  ");
  }

  function zValueAt(t, axis) {
    let wu, wv;
    if (axis === "h") {
      wu = view.offX + t * view.scX;
      wv = view.offY + 0.5 * view.scY;
    } else {
      wu = view.offX + 0.5 * view.scX;
      wv = view.offY + t * view.scY;
    }
    const uu = 2 * wu - 1;
    const vv = 2 * wv - 1;
    const q = axis === "h" ? q1 : q2;
    const z = state.z0.map((z0i, i) => z0i + uu * q1[i] + vv * q2[i]);
    return dot10(z, q);
  }

  function fmtZ(v) {
    const range = Math.abs(view.scX);
    const decimals = range < 0.2 ? 3 : range < 1.0 ? 2 : 1;
    return v.toFixed(decimals);
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1.0];

  // Bottom axis
  const axBot = $("axis-bottom");
  [...axBot.querySelectorAll('.tick-label, .axis-tick-line, .axis-label-u')].forEach(el => el.remove());
  const botTitle = document.createElement("span");
  botTitle.className = "axis-label-u";
  botTitle.textContent = axisTitle(q1);
  axBot.appendChild(botTitle);
  for (const t of ticks) {
    const px = t * W;
    const zv = zValueAt(t, "h");
    const line = document.createElement("div");
    line.className = "axis-tick-line";
    line.style.left = px + "px";
    axBot.appendChild(line);
    const lbl = document.createElement("span");
    lbl.className = "tick-label";
    lbl.style.left = px + "px";
    lbl.textContent = fmtZ(zv);
    axBot.appendChild(lbl);
  }

  // Left axis
  const axLeft = $("axis-left");
  [...axLeft.querySelectorAll('.tick-label, .axis-tick-line, .axis-label-v')].forEach(el => el.remove());
  const leftTitle = document.createElement("span");
  leftTitle.className = "axis-label-v";
  leftTitle.textContent = axisTitle(q2);
  axLeft.appendChild(leftTitle);
  for (const t of ticks) {
    const py = (1 - t) * H;
    const zv = zValueAt(t, "v");
    const line = document.createElement("div");
    line.className = "axis-tick-line";
    line.style.top = py + "px";
    line.style.bottom = "auto";
    axLeft.appendChild(line);
    const lbl = document.createElement("span");
    lbl.className = "tick-label";
    lbl.style.top = py + "px";
    lbl.style.bottom = "auto";
    lbl.textContent = fmtZ(zv);
    axLeft.appendChild(lbl);
  }
  axLeft.style.height = H + "px";
}

// ─── Legend ──────────────────────────────────────────────────────────────────

export function updateLegendPanel() {
  const panel = $("legend-panel");
  panel.style.display = "flex";
  panel.innerHTML = "";
  const mode = state.mode;

  function addTitle(t) {
    const el = document.createElement("span");
    el.className = "leg-title";
    el.textContent = t;
    panel.appendChild(el);
  }
  function addSwatch(color, label) {
    const item = document.createElement("div");
    item.className = "leg-item";
    const sw = document.createElement("div");
    sw.className = "leg-swatch";
    sw.style.background = color;
    item.appendChild(sw);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    item.appendChild(lbl);
    panel.appendChild(item);
  }
  function addGradBar(css, labelLeft, labelRight) {
    const wrap = document.createElement("div");
    wrap.className = "leg-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "leg-bar";
    bar.style.background = css;
    const labels = document.createElement("div");
    labels.className = "leg-bar-labels";
    labels.innerHTML = `<span>${labelLeft}</span><span>${labelRight}</span>`;
    wrap.appendChild(bar);
    wrap.appendChild(labels);
    panel.appendChild(wrap);
  }

  if (mode === 0) {
    addTitle("event");
    addSwatch("rgba(255,255,255,0.95)", "degenerate");
    addSwatch("rgba(240,130,30,0.9)", "coll t₀");
    addSwatch("rgba(180,40,40,0.9)", "coll 01");
    addSwatch("rgba(40,160,80,0.9)", "coll 02");
    addSwatch("rgba(40,80,180,0.9)", "coll 12");
    addSwatch("rgba(180,175,30,0.9)", "esc 0");
    addSwatch("rgba(160,40,160,0.9)", "esc 1");
    addSwatch("rgba(30,160,160,0.9)", "esc 2");
    addSwatch("rgba(0,0,0,0.9)", "bounded");
  } else if (mode === 1) {
    addTitle("θ");
    addGradBar(
      "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
      "0", "2π"
    );
    addTitle("stability");
    addGradBar("linear-gradient(to right, #e8e6e0, #1a1816)", "unstable", "stable");
  } else if (mode === 2) {
    addTitle("shape phase θ");
    addGradBar(
      "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
      "0", "2π"
    );
  } else if (mode === 3) {
    addTitle("diffusion");
    addGradBar("linear-gradient(to right, #e8e6e0, #1a1816)", "unstable", "stable");
  } else if (mode === 4) {
    addTitle("shape sphere n");
    addSwatch("rgba(200,50,50,0.9)", "R = nₓ");
    addSwatch("rgba(50,180,80,0.9)", "G = nᵧ");
    addSwatch("rgba(50,80,200,0.9)", "B = n_z");
  }
}

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
    fitTitle();
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

// ─── Probe ───────────────────────────────────────────────────────────────────

export function uvFromClientXY(clientX, clientY, glCanvas, outCanvas) {
  const rect = (outCanvas.style.display !== "none" ? outCanvas : glCanvas).getBoundingClientRect();
  return {
    u: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    v: Math.max(0, Math.min(1, 1.0 - (clientY - rect.top) / rect.height)),
    rect
  };
}

export function zAtUV(u, v, renderer) {
  const view = renderer.fullViewTile(state);
  const uw = view.offX + u * view.scX;
  const vw = view.offY + v * view.scY;
  const uu = 2 * uw - 1, vv = 2 * vw - 1;
  const { q1, q2 } = renderer.computeSliceDirs(state);
  return state.z0.map((z0i, i) => z0i + uu * q1[i] + vv * q2[i]);
}

export function showProbeAtEvent(e, probeTooltip, glCanvas, outCanvas, renderer) {
  if (!$("showHud").checked) return;
  const { u, v } = uvFromClientXY(e.clientX, e.clientY, glCanvas, outCanvas);
  const z = zAtUV(u, v, renderer);
  const p = decodeICParamsFromZ(z);
  const topZ = z.map((val, i) => ({ i, val, a: Math.abs(val) })).sort((a, b) => b.a - a.a).slice(0, 4);
  const view = renderer.fullViewTile(state);
  const wx = view.offX + u * view.scX;
  const wy = view.offY + v * view.scY;
  const lines = [
    { type: "row", label: "world", val: `(${wx.toFixed(5)}, ${wy.toFixed(5)})` },
    { type: "row", label: "m",     val: `[${p.m.map(x => x.toFixed(5)).join(", ")}]` },
    { type: "row", label: "α, β",  val: `${p.alpha.toFixed(5)}, ${p.beta.toFixed(5)}` },
    { type: "row", label: "pρ",    val: `[${p.pRho.map(x => x.toFixed(5)).join(", ")}]` },
    { type: "row", label: "pλ",    val: `[${p.pLam.map(x => x.toFixed(5)).join(", ")}]` },
    ...topZ.map(t => ({ type: "row", label: AXIS_NAMES[t.i], val: t.val.toFixed(5) }))
  ];
  const rowCount = lines.length;
  const PW = 230, PH = rowCount * 13 + 18;
  const vw = window.innerWidth, vh = window.innerHeight;
  let sx = e.clientX + 14, sy = e.clientY + 14;
  if (sx + PW > vw - 8) sx = e.clientX - PW - 8;
  if (sy + PH > vh - 8) sy = e.clientY - PH - 8;
  const activeCanvas = outCanvas.style.display !== "none" ? outCanvas : glCanvas;
  probeTooltip.render(lines, sx, sy, PW, PH, activeCanvas);
}

// ─── Value-edit dialog ────────────────────────────────────────────────────────

let _valEditCallback = null;

function openValEditDialog(title, desc, currentVal, min, max, step, unit, onSubmit) {
  _valEditCallback = onSubmit;
  $("valEditTitle").textContent = title;
  $("valEditDesc").textContent = desc || "";
  const inp = $("valEditInput");
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(currentVal);
  $("valEditOverlay").classList.add("open");
  requestAnimationFrame(() => { inp.select(); inp.focus(); });
}

function closeValEditDialog() {
  $("valEditOverlay").classList.remove("open");
  _valEditCallback = null;
}

export function bindValEditDialog() {
  $("valEditCancel").addEventListener("click", closeValEditDialog);
  $("valEditOverlay").addEventListener("click", (e) => { if (e.target === $("valEditOverlay")) closeValEditDialog(); });
  $("valEditSubmit").addEventListener("click", () => {
    if (_valEditCallback) {
      const inp = $("valEditInput");
      _valEditCallback(+inp.value);
    }
    closeValEditDialog();
  });
  $("valEditInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { $("valEditSubmit").click(); e.preventDefault(); }
    if (e.key === "Escape") { closeValEditDialog(); e.preventDefault(); }
  });

  // Wire all .slider-num inputs to open the dialog on double-click
  document.addEventListener("dblclick", (e) => {
    const ni = e.target.closest(".slider-num");
    if (!ni) return;
    const title = ni.dataset.title || "Value";
    const desc  = ni.dataset.tip   || "";
    const min   = +ni.min; const max = +ni.max; const step = +ni.step;
    const cur   = +ni.value;
    const unit  = ni.closest(".sl-val-wrap")?.querySelector(".sl-unit")?.textContent || "";
    const fullTitle = unit ? `${title} (${unit.trim()})` : title;
    openValEditDialog(fullTitle, desc, cur, min, max, step, unit, (v) => {
      const clamped = Math.max(min, Math.min(max, v));
      ni.value = clamped.toFixed(step < 0.001 ? 4 : step < 0.01 ? 3 : 2);
      ni.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

// ─── Tilt dimension picker overlay ───────────────────────────────────────────

let _tiltPickerDim = 0; // which dim slot: 1 or 2
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

// ─── UI builder helpers ───────────────────────────────────────────────────────

export function buildResolutions(renderer) {
  const sel = $("resolution");
  sel.innerHTML = "";
  const max2D = renderer.getMax2DCanvasSize();
  const ladder = [512,1024,2048,3072,4096,8192,16384,24576,32768].filter(x => x <= max2D);
  const def = ladder.includes(1024) ? 1024 : ladder[0];
  for (const r of ladder) {
    const opt = document.createElement("option");
    opt.value = String(r);
    opt.textContent = `${r} × ${r}`;
    sel.appendChild(opt);
  }
  state.res = def;
  sel.value = String(def);
  $("resName").textContent = `${def} × ${def}`;
}

let _resPickerCallback = null;

export function bindResPicker(onPick) {
  const overlay  = $("resPickerOverlay");
  const list     = $("resPickerList");
  const closeBtn = $("resPickerClose");

  // Large-res warning dialog elements
  const warnOverlay    = $("largeResOverlay");
  const warnMsg        = $("largeResMsg");
  const warnConfirm    = $("largeResConfirm");
  const warnCancel     = $("largeResCancel");
  const warnAutoChk    = $("largeResDisableAutoRender");
  const warnSuppressChk = $("largeResSuppressWarn");
  let _pendingLargeRes = null;

  // Load persisted suppress set from localStorage
  const _suppressedRes = new Set(JSON.parse(localStorage.getItem("principia_suppressedRes") || "[]"));

  function saveSuppressed() {
    localStorage.setItem("principia_suppressedRes", JSON.stringify([..._suppressedRes]));
  }

  function showLargeResWarning(r) {
    // Skip dialog if user previously suppressed this resolution
    if (_suppressedRes.has(r)) { onPick(r); return; }
    _pendingLargeRes = r;
    const tiled = r >= 8192;
    warnMsg.textContent = `${r} × ${r} is a ${tiled ? "tiled" : "large"} render (${tiled ? "≥8192 uses multi-pass tiling" : "high memory usage"}). This can be very slow, especially with auto-render enabled.`;
    // Always pre-tick disable auto-render (smart default)
    warnAutoChk.checked = true;
    warnSuppressChk.checked = false;
    warnOverlay.classList.add("open");
  }

  warnConfirm.addEventListener("click", () => {
    if (warnAutoChk.checked) $("autoRender").checked = false;
    if (warnSuppressChk.checked && _pendingLargeRes !== null) {
      _suppressedRes.add(_pendingLargeRes);
      saveSuppressed();
    }
    warnOverlay.classList.remove("open");
    if (_pendingLargeRes !== null) { onPick(_pendingLargeRes); _pendingLargeRes = null; }
  });
  warnCancel.addEventListener("click", () => {
    warnOverlay.classList.remove("open");
    _pendingLargeRes = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && warnOverlay.classList.contains("open")) {
      warnOverlay.classList.remove("open"); _pendingLargeRes = null;
    }
  });

  function buildList(activeRes) {
    list.innerHTML = "";
    const sel = $("resolution");
    for (const opt of sel.options) {
      const r = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (r === activeRes ? " active" : "");
      btn.textContent = opt.textContent + (r >= 8192 ? " ⚠" : "");
      btn.addEventListener("click", () => {
        closeResPicker();
        if (r >= 4096) {
          showLargeResWarning(r);
        } else {
          onPick(r);
        }
      });
      list.appendChild(btn);
    }
  }

  function closeResPicker() {
    overlay.classList.remove("open");
    _resPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeResPicker(); });
  closeBtn.addEventListener("click", closeResPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeResPicker();
  });

  $("resLabel").addEventListener("click", () => {
    buildList(state.res);
    _resPickerCallback = onPick;
    overlay.classList.add("open");
  });
}

let _qualityPickerCallback = null;

export function bindQualityPicker(onPick) {
  const overlay  = $("qualityPickerOverlay");
  const list     = $("qualityPickerList");
  const closeBtn = $("qualityPickerClose");

  function buildList(activeVal) {
    list.innerHTML = "";
    const sel = $("quality");
    for (const opt of sel.options) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (opt.value === activeVal ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_qualityPickerCallback) _qualityPickerCallback(opt.value);
        closeQualityPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeQualityPicker() {
    overlay.classList.remove("open");
    _qualityPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeQualityPicker(); });
  closeBtn.addEventListener("click", closeQualityPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeQualityPicker();
  });

  $("qualityLabel").addEventListener("click", () => {
    buildList($("quality").value);
    _qualityPickerCallback = onPick;
    overlay.classList.add("open");
  });
}

let _modePickerCallback = null;

export function bindModePicker(onPick) {
  const overlay  = $("modePickerOverlay");
  const list     = $("modePickerList");
  const closeBtn = $("modePickerClose");

  function buildList(activeMode) {
    list.innerHTML = "";
    const sel = $("mode");
    for (const opt of sel.options) {
      const m = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (m === activeMode ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_modePickerCallback) _modePickerCallback(m);
        closeModePicker();
      });
      list.appendChild(btn);
    }
  }

  function closeModePicker() {
    overlay.classList.remove("open");
    _modePickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModePicker(); });
  closeBtn.addEventListener("click", closeModePicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModePicker();
  });

  $("modeLabel").addEventListener("click", () => {
    buildList(state.mode);
    _modePickerCallback = onPick;
    overlay.classList.add("open");
  });
}

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

export function buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const wrap = $("z0Sliders");
  wrap.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    // .sl-row  →  label  +  .sl-track-row [ range | .sl-val-wrap [ num ] ]
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

export function updateStateBox() {
  $("stateBox").value = JSON.stringify(canonicalState(state), null, 2);
}

export function syncUIFromState(renderer, scheduleRender, writeHash, drawOverlayHUD) {
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
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    const idx = +inp.dataset.idx;
    inp.value = String(state.z0[idx]);
    $(`z0v_${idx}`).value = state.z0[idx].toFixed(2);
  });
  const grid = $("presetGrid");
  const name = PRESETS.find(p => p.id === state.presetId)?.name;
  [...grid.children].forEach(child => {
    child.classList.toggle("active", child.textContent === name);
  });
  updateCustomPanelVisibility();
  const cH = $("customDimH"), cV = $("customDimV"), cM = $("customMag");
  if (cH) { cH.value = String(state.customDimH); const hn = $("customDimHName"); if (hn) hn.textContent = AXIS_NAMES[state.customDimH]; }
  if (cV) { cV.value = String(state.customDimV); const vn = $("customDimVName"); if (vn) vn.textContent = AXIS_NAMES[state.customDimV]; }
  if (cM) { cM.value = String(state.customMag); $("customMagVal").value = state.customMag.toFixed(2); }
  syncTiltDimLabels();
  updateStateBox();
  setStatus("Ready.");
  drawOverlayHUD();
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

let _customDimPickerCallback = null;

export function bindCustomDimPicker(onPickH, onPickV) {
  const overlay  = $("customDimPickerOverlay");
  const list     = $("customDimPickerList");
  const closeBtn = $("customDimPickerClose");

  function buildList(activeDim) {
    list.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (i === activeDim ? " active" : "");
      btn.textContent = AXIS_NAMES[i];
      btn.addEventListener("click", () => {
        if (_customDimPickerCallback) _customDimPickerCallback(i);
        closeCustomDimPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeCustomDimPicker() {
    overlay.classList.remove("open");
    _customDimPickerCallback = null;
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCustomDimPicker(); });
  closeBtn.addEventListener("click", closeCustomDimPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeCustomDimPicker();
  });

  $("customDimHLabel").addEventListener("click", () => {
    $("customDimPickerTitle").textContent = "H-axis (→) dimension";
    buildList(state.customDimH);
    _customDimPickerCallback = onPickH;
    overlay.classList.add("open");
  });
  $("customDimVLabel").addEventListener("click", () => {
    $("customDimPickerTitle").textContent = "V-axis (↑) dimension";
    buildList(state.customDimV);
    _customDimPickerCallback = onPickV;
    overlay.classList.add("open");
  });
}

// ─── All control bindings ─────────────────────────────────────────────────────

export function bindUI(renderer, glCanvas, outCanvas, uiCanvas, ui2d, probeTooltip, doRender, scheduleRender, writeHash, resizeUiCanvasToMatch) {
  const stopBtn = $("stopBtn");

  function updateStateBox_() { updateStateBox(); }
  function drawHUD() { drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch); }
  function buildPresets_() { buildPresets(scheduleRender, writeHash, updateStateBox_, drawHUD); }

  // Value-edit dialog
  bindValEditDialog();

  // Render mode picker
  bindModePicker((m) => {
    state.mode = m;
    $("mode").value = String(m);
    $("modeName").textContent = MODE_INFO[m]?.name || "";
    scheduleRender("mode"); writeHash(); updateStateBox_(); drawHUD();
  });

  // Tilt dimension picker
  bindTiltPicker(
    (i) => { state.tiltDim1 = i; $("tiltDim1").value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); },
    (i) => { state.tiltDim2 = i; $("tiltDim2").value = String(i); syncTiltDimLabels(); scheduleRender("tilt dim"); writeHash(); updateStateBox_(); drawHUD(); }
  );

  // Custom dim picker
  bindCustomDimPicker(
    (i) => { state.customDimH = i; $("customDimH").value = String(i); $("customDimHName").textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-h"); writeHash(); updateStateBox_(); drawHUD(); } },
    (i) => { state.customDimV = i; $("customDimV").value = String(i); $("customDimVName").textContent = AXIS_NAMES[i]; if (state.presetId === "custom") { applyCustomBasis(); scheduleRender("custom-v"); writeHash(); updateStateBox_(); drawHUD(); } }
  );

  // Resolution picker
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
    if (_isRendering) {
      renderer.setAbort(true); setStatus("Stopping…");
      return;
    }
    doRender(state.res).catch(err => {
      setOverlay(false);
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
    // Update spans that syncUIFromState doesn't cover
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

  // Settings side panel
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

  // Info side panel
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

  // Collapsible sections
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

// ─── Canvas title dynamic sizing ─────────────────────────────────────────────
let _fitTitleFontsPending = false;

export function fitTitle() {
  // Wait for fonts (bbox measurements are wrong otherwise)
  if (document.fonts && document.fonts.status !== "loaded") {
    if (_fitTitleFontsPending) return;
    _fitTitleFontsPending = true;
    document.fonts.ready.then(() => {
      _fitTitleFontsPending = false;
      fitTitle();
    });
    return;
  }

  const canvasOuter = document.getElementById("canvas-outer");
  const canvasWrap  = document.getElementById("canvas-wrap");
  const titleEl     = document.getElementById("canvas-title");
  const nameEl      = document.getElementById("canvas-title-name");
  const subEl       = document.getElementById("canvas-title-sub");
  const axisLeft    = document.getElementById("axis-left");

  const glCanvas  = document.getElementById("glCanvas") || document.querySelector("#canvas-wrap canvas");
  const outCanvas = document.getElementById("outCanvas");
  const plotEl    = (outCanvas && outCanvas.style.display !== "none") ? outCanvas : glCanvas;

  if (!canvasOuter || !canvasWrap || !titleEl || !nameEl || !subEl || !plotEl) return;

  // ---- Layout forcing: subtitle ALWAYS below title ----
  // (prevents "subtitle next to title" regardless of CSS)
  titleEl.style.display = "flex";
  titleEl.style.flexDirection = "column";
  titleEl.style.alignItems = "flex-start";
  titleEl.style.justifyContent = "flex-start";

  nameEl.style.display = "block";
  nameEl.style.whiteSpace = "nowrap";

  subEl.style.display = "block";
  subEl.style.whiteSpace = "nowrap";

  // ---- Tunables ----
  const TITLE_LEFT_PX = 20; // matches CSS
  const TITLE_TOP_PX  = 20; // matches CSS
  const MARGIN_PX     = 14; // padding away from obstacles
  const RAY_PAD_PX    = 0;  // extra inflate obstacles (optional)
  const MAX_CAP_PX    = 260; // cap title size (optional)

  const SUB_RATIO      = 0.115;
  const TITLE_LINEH    = 0.90;
  const SUB_LINEH      = 1.00;
  const GAP_EM         = 0.18; // title-to-sub gap scales with size

  nameEl.style.lineHeight = String(TITLE_LINEH);
  subEl.style.lineHeight  = String(SUB_LINEH);

  function setSizes(px) {
    nameEl.style.fontSize = `${px}px`;
    subEl.style.fontSize  = `${px * SUB_RATIO}px`;
    const gapPx = Math.round(px * GAP_EM);
    subEl.style.marginTop = `${gapPx}px`;
    return gapPx;
  }

  function measureBlock(px) {
    const gapPx = setSizes(px);
    const n = nameEl.getBoundingClientRect();
    const s = subEl.getBoundingClientRect();
    return { titleW: n.width, blockH: n.height + gapPx + s.height };
  }

  function fitTrackingToWidth(el, targetW) {
    // subtitle is IBM Plex Mono-ish: tracking works well
    const widthAt = (em) => {
      el.style.letterSpacing = `${em}em`;
      return el.getBoundingClientRect().width;
    };

    // Quick early-outs
    let w0 = widthAt(0.10);
    if (w0 <= 0) return;

    if (widthAt(0.00) > targetW) { el.style.letterSpacing = "0em"; return; }
    if (widthAt(0.50) < targetW) { el.style.letterSpacing = "0.50em"; return; }

    let lo = 0.00, hi = 0.50;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (widthAt(mid) > targetW) hi = mid;
      else lo = mid;
    }
    el.style.letterSpacing = `${lo}em`;
  }

  // ---- Raycast-based bounding box (diagonal) ----

  // Build obstacle rects (add/remove as you like)
  function rectOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  function inflateRect(r, pad) {
    return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
  }

  // Pick what the title should avoid.
  const hudEl    = document.getElementById("hud-panel");
  const legendEl = document.getElementById("legend-panel");
  const sidebar  = document.getElementById("sidebar");
  const axisBot  = document.getElementById("axis-bottom");

  // Calculate gap between canvas and sidebar to use as sidebar padding
  let sidebarPad = 12; // default
  if (sidebar && plotEl) {
    const sidebarRect = sidebar.getBoundingClientRect();
    const canvasRect = plotEl.getBoundingClientRect();
    const gap = sidebarRect.left - canvasRect.right;
    if (gap > 0) sidebarPad = gap;
  }

  // Build obstacles with specific padding for each
  const SIDEBAR_PAD = sidebarPad;  // Match canvas-to-sidebar gap
  const CANVAS_PAD  = 8;           // Extra padding around canvas
  const AXIS_PAD    = 4;           // Small padding for axis elements
  
  const obstacles = [
    rectOf(plotEl) ? inflateRect(rectOf(plotEl), CANVAS_PAD) : null,
    rectOf(sidebar) ? inflateRect(rectOf(sidebar), SIDEBAR_PAD) : null,
    rectOf(axisLeft) ? inflateRect(rectOf(axisLeft), AXIS_PAD) : null,
    rectOf(axisBot) ? inflateRect(rectOf(axisBot), AXIS_PAD) : null,
    rectOf(hudEl),
    rectOf(legendEl),
  ].filter(Boolean);

  // Ray vs AABB intersection (returns smallest positive t, and hit point)
  function rayHitAABB(ox, oy, dx, dy, r) {
    // slab method
    const invDx = dx !== 0 ? 1 / dx : Infinity;
    const invDy = dy !== 0 ? 1 / dy : Infinity;

    let t1 = (r.left   - ox) * invDx;
    let t2 = (r.right  - ox) * invDx;
    let t3 = (r.top    - oy) * invDy;
    let t4 = (r.bottom - oy) * invDy;

    let tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    let tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));

    if (tmax < 0) return null;      // box is behind ray
    if (tmin > tmax) return null;   // no intersection
    const t = tmin >= 0 ? tmin : tmax; // if starting inside, take exit
    if (t < 0) return null;

    return { t, x: ox + t * dx, y: oy + t * dy };
  }

  // Cast diagonal ray and use hit point to define maximal rectangle
  function diagonalBounds(ox, oy) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Direction from anchor to bottom-right viewport corner
    const toCornerX = vw - ox;
    const toCornerY = vh - oy;
    const len = Math.hypot(toCornerX, toCornerY);
    const dx = toCornerX / len;
    const dy = toCornerY / len;

    // Default "hit" is viewport corner
    let best = {
      t: len,
      x: vw,
      y: vh
    };

    // Find closest intersection along diagonal
    for (const r of obstacles) {
      const hit = rayHitAABB(ox, oy, dx, dy, r);
      if (hit && hit.t < best.t) {
        best = hit;
      }
    }

    // Debug logging (can remove later)
    console.log('Diagonal bounds:', {
      anchor: [ox, oy],
      viewport: [vw, vh],
      hit: [best.x, best.y],
      obstacles: obstacles.length
    });

    // Clamp to viewport
    best.x = Math.max(ox, Math.min(vw, best.x));
    best.y = Math.max(oy, Math.min(vh, best.y));
    return best;
  }

  // Anchor (viewport coords)
  const anchorX = TITLE_LEFT_PX;
  const anchorY = TITLE_TOP_PX;

  // Step 1: Find diagonal intersection to get vertical constraint
  const diagonalHit = diagonalBounds(anchorX, anchorY);
  
  // Step 2: From that Y level, cast horizontal ray to find max width
  const vw = window.innerWidth;
  let maxX = vw;
  
  // Cast horizontal ray from (anchorX, diagonalHit.y) going right
  const EDGE_EPSILON = 0.5; // tolerance for parallel/grazing hits
  for (const r of obstacles) {
    // Skip obstacles that the ray only grazes (parallel to top/bottom edge)
    if (Math.abs(r.top - diagonalHit.y) < EDGE_EPSILON || 
        Math.abs(r.bottom - diagonalHit.y) < EDGE_EPSILON) {
      continue;
    }
    const hit = rayHitAABB(anchorX, diagonalHit.y, 1, 0, r);
    if (hit && hit.x < maxX) maxX = hit.x;
  }

  const maxW = Math.max(1, (maxX - anchorX - MARGIN_PX));
  const maxH = Math.max(1, (diagonalHit.y - anchorY - MARGIN_PX));

  console.log('Title constraints:', {
    maxW,
    maxH,
    margin: MARGIN_PX,
    diagonalHit: [diagonalHit.x, diagonalHit.y],
    horizontalExtent: maxX
  });

  // Apply container width; DO NOT translate (stays truly anchored)
  titleEl.style.left = `${TITLE_LEFT_PX}px`;
  titleEl.style.top  = `${TITLE_TOP_PX}px`;
  titleEl.style.transform = "none";
  titleEl.style.transition = "none";
  titleEl.style.width = `${maxW}px`;

  // Fit font size to BOTH width and height
  let lo = 10, hi = 260;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const m = measureBlock(mid);
    if (m.titleW > maxW || m.blockH > maxH) hi = mid;
    else lo = mid;
  }
  const size = Math.min(lo, MAX_CAP_PX);
  const final = measureBlock(size); // applies final sizes

  console.log('Title sizing:', {
    finalSize: size,
    finalWidth: final.titleW,
    finalHeight: final.blockH,
    constrainedBy: final.titleW / maxW > final.blockH / maxH ? 'width' : 'height'
  });

  // Subtitle tracking to match title width
  const titleWidth = nameEl.getBoundingClientRect().width;
  
  // Reset subtitle to measure natural width with default tracking
  subEl.style.letterSpacing = "0em";
  subEl.style.transform = "translateX(0px)";
  const naturalWidth = subEl.getBoundingClientRect().width;
  
  // Optical alignment offset (matches the visual weight of the first characters)
  const leftOffset = size * 0.077; // 7.5% of title font size
  
  // Target width slightly shorter to account for optical overhang
  const targetWidth = titleWidth * 0.99; // 98% of title width
  
  // If natural width is less than title, expand with letter-spacing
  if (naturalWidth < targetWidth) {
    fitTrackingToWidth(subEl, targetWidth);
    subEl.style.transform = `translateX(${leftOffset}px)`;
  } else {
    // If natural width is more, we need to shrink it
    // Use negative letter-spacing or just set to 0
    subEl.style.letterSpacing = "0em";
    subEl.style.transform = `translateX(${leftOffset}px)`;
  }
}
