import { state } from '../../state.js';
import { $ } from '../utils.js';

// ─── Resolution builder ──────────────────────────────────────────────────────

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
