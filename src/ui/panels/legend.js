import { state } from '../../state.js';
import { $ } from '../utils.js';

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
