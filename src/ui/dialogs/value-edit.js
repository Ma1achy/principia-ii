import { $ } from '../utils.js';

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
