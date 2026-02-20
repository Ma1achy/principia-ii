export const PRESETS = [
  { id: "shape",    name: "Config β×α",   q1: [1,0,0,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0,0,0] },
  { id: "prho",     name: "Inner pρ",      q1: [0,0,0,0,1,0,0,0,0,0], q2: [0,0,0,0,0,1,0,0,0,0] },
  { id: "plambda",  name: "Outer pλ",      q1: [0,0,0,0,0,0,1,0,0,0], q2: [0,0,0,0,0,0,0,1,0,0] },
  { id: "shape_pl", name: "Config + pλ",   q1: [1,0,0,0,0,0,1,0,0,0], q2: [0,1,0,0,0,0,0,1,0,0] },
  { id: "custom",   name: "Custom",         q1: [1,0,0,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0,0,0] },
];

export const AXIS_NAMES = [
  "z₀ (β)", "z₁ (α)", "z₂", "z₃",
  "z₄ (pρ.x)", "z₅ (pρ.y)", "z₆ (pλ.x)", "z₇ (pλ.y)",
  "z₈ (μ₁)", "z₉ (μ₂)"
];

export const AXIS_NAMES_SHORT = ["z0","z1","z2","z3","z4","z5","z6","z7","z8","z9"];

export const MODE_INFO = {
  0: { name: "Event classification", desc: "Discrete outcomes: collision, escape, bounded (includes timeout)." },
  1: { name: "Phase + Diffusion",    desc: "Hue = shape phase θ; lightness encodes diffusion (dark = stable)." },
  2: { name: "Shape sphere phase",   desc: "Hue = shape phase θ at constant lightness." },
  3: { name: "Diffusion",            desc: "Greyscale = diffusion proxy; dark = stable." },
  4: { name: "Shape sphere RGB",     desc: "RGB ← n = (nₓ,nᵧ,n_z) mapped from [−1,1] to [0,1]." },
};

export const QUALITY_PRESETS = {
  fast:     { dtMacro: 0.0040, maxSteps:  8000 },
  balanced: { dtMacro: 0.0020, maxSteps: 20000 },
  accurate: { dtMacro: 0.0010, maxSteps: 20000 },
};

export const navPrefs = {
  invertScroll: false,
  invertPanX: false,
  invertPanY: false,
  zoomSpeed: 1.0,
  panSpeed: 1.0,
};

export const state = {
  mode: 0, res: 1024,
  viewZoom: 1.0, viewPanX: 0.0, viewPanY: 0.0,
  presetId: "shape",
  dir1Base: PRESETS[0].q1.slice(),
  dir2Base: PRESETS[0].q2.slice(),
  z0: new Array(10).fill(0.0),
  gammaDeg: 0.0,
  tiltDim1: 8, tiltDim2: 9,
  tiltAmt1: 0.0, tiltAmt2: 0.0,
  customDimH: 0, customDimV: 1, customMag: 1.0,
  doOrtho: true,
  horizon: 50, maxSteps: 20000, dtMacro: 0.002, rColl: 0.02, rEsc: 5.0,
};

export function canonicalState(st) {
  return {
    v: 1,
    render: { mode: st.mode, res: st.res },
    view: { zoom: st.viewZoom, panX: st.viewPanX, panY: st.viewPanY },
    slice: {
      preset: st.presetId,
      z0: st.z0.slice(),
      gammaDeg: st.gammaDeg,
      tilt: { dim1: st.tiltDim1, amt1: st.tiltAmt1, dim2: st.tiltDim2, amt2: st.tiltAmt2, ortho: !!st.doOrtho },
      custom: { dimH: st.customDimH, dimV: st.customDimV, mag: st.customMag },
    },
    sim: { horizon: st.horizon, maxSteps: st.maxSteps, dtMacro: st.dtMacro, rColl: st.rColl, rEsc: st.rEsc }
  };
}

export function applyCanonical(obj, applyCustomBasisFn) {
  if (!obj || obj.v !== 1) throw new Error("Unsupported state JSON (expected v=1).");
  const r = obj.render || {}, v = obj.view || {}, sl = obj.slice || {}, sim = obj.sim || {};
  if (typeof r.mode === "number") state.mode = r.mode | 0;
  if (typeof r.res === "number") state.res = r.res | 0;
  if (typeof v.zoom === "number") state.viewZoom = v.zoom;
  if (typeof v.panX === "number") state.viewPanX = v.panX;
  if (typeof v.panY === "number") state.viewPanY = v.panY;
  if (typeof sl.preset === "string" && PRESETS.some(x => x.id === sl.preset)) {
    state.presetId = sl.preset;
    if (sl.preset === "custom") {
      applyCustomBasisFn();
    } else {
      const pr = PRESETS.find(x => x.id === sl.preset);
      state.dir1Base = pr.q1.slice();
      state.dir2Base = pr.q2.slice();
    }
  }
  if (Array.isArray(sl.z0) && sl.z0.length === 10) for (let i = 0; i < 10; i++) state.z0[i] = +sl.z0[i];
  if (typeof sl.gammaDeg === "number") state.gammaDeg = sl.gammaDeg;
  if (sl.custom) {
    if (typeof sl.custom.dimH === "number") state.customDimH = sl.custom.dimH | 0;
    if (typeof sl.custom.dimV === "number") state.customDimV = sl.custom.dimV | 0;
    if (typeof sl.custom.mag  === "number") state.customMag  = sl.custom.mag;
  }
  if (sl.tilt) {
    if (typeof sl.tilt.dim1 === "number") state.tiltDim1 = sl.tilt.dim1 | 0;
    if (typeof sl.tilt.dim2 === "number") state.tiltDim2 = sl.tilt.dim2 | 0;
    if (typeof sl.tilt.amt1 === "number") state.tiltAmt1 = sl.tilt.amt1;
    if (typeof sl.tilt.amt2 === "number") state.tiltAmt2 = sl.tilt.amt2;
    if (typeof sl.tilt.ortho === "boolean") state.doOrtho = sl.tilt.ortho;
  }
  if (typeof sim.horizon === "number") state.horizon = sim.horizon;
  if (typeof sim.maxSteps === "number") state.maxSteps = sim.maxSteps | 0;
  if (typeof sim.dtMacro === "number") state.dtMacro = sim.dtMacro;
  if (typeof sim.rColl === "number") state.rColl = sim.rColl;
  if (typeof sim.rEsc === "number") state.rEsc = sim.rEsc;
}

export function encodeStateHash(st) {
  const packed = {
    m: st.mode, r: st.res,
    vz: +st.viewZoom.toFixed(5), vx: +st.viewPanX.toFixed(5), vy: +st.viewPanY.toFixed(5),
    p: st.presetId,
    z: st.z0.map(x => +x.toFixed(3)),
    g: +st.gammaDeg.toFixed(2),
    d1: st.tiltDim1, d2: st.tiltDim2,
    a1: +st.tiltAmt1.toFixed(3), a2: +st.tiltAmt2.toFixed(3),
    o: st.doOrtho ? 1 : 0,
    h: st.horizon, ms: st.maxSteps,
    dt: +st.dtMacro.toFixed(5), rc: +st.rColl.toFixed(4), re: +st.rEsc.toFixed(3),
    ch: st.customDimH, cv: st.customDimV, cm: +st.customMag.toFixed(3),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(packed))));
}

export function decodeStateHash(hash) {
  try { return JSON.parse(decodeURIComponent(escape(atob(hash)))); }
  catch { return null; }
}

export function applyPackedHash(p, applyCustomBasisFn) {
  if (!p) return;
  if (typeof p.m === "number") state.mode = p.m | 0;
  if (typeof p.r === "number") state.res = p.r | 0;
  if (typeof p.vz === "number") state.viewZoom = p.vz;
  if (typeof p.vx === "number") state.viewPanX = p.vx;
  if (typeof p.vy === "number") state.viewPanY = p.vy;
  if (typeof p.p === "string" && PRESETS.some(x => x.id === p.p)) {
    state.presetId = p.p;
    if (p.p === "custom") {
      applyCustomBasisFn();
    } else {
      const pr = PRESETS.find(x => x.id === p.p);
      state.dir1Base = pr.q1.slice();
      state.dir2Base = pr.q2.slice();
    }
  }
  if (Array.isArray(p.z) && p.z.length === 10) for (let i = 0; i < 10; i++) state.z0[i] = +p.z[i];
  if (typeof p.g === "number") state.gammaDeg = p.g;
  if (typeof p.d1 === "number") state.tiltDim1 = p.d1 | 0;
  if (typeof p.d2 === "number") state.tiltDim2 = p.d2 | 0;
  if (typeof p.a1 === "number") state.tiltAmt1 = p.a1;
  if (typeof p.a2 === "number") state.tiltAmt2 = p.a2;
  if (typeof p.o === "number") state.doOrtho = !!p.o;
  if (typeof p.h === "number") state.horizon = p.h;
  if (typeof p.ms === "number") state.maxSteps = p.ms | 0;
  if (typeof p.dt === "number") state.dtMacro = p.dt;
  if (typeof p.rc === "number") state.rColl = p.rc;
  if (typeof p.re === "number") state.rEsc = p.re;
  if (typeof p.ch === "number") state.customDimH = p.ch | 0;
  if (typeof p.cv === "number") state.customDimV = p.cv | 0;
  if (typeof p.cm === "number") state.customMag  = p.cm;
}
