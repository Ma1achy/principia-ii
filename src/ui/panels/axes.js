import { state, AXIS_NAMES } from '../../state.js';
import { dot10 } from '../../math.js';
import { $ } from '../utils.js';

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
