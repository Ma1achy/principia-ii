// ─── Hint tooltips ───────────────────────────────────────────────────────────

export function attachHintTooltips(hintTooltip) {
  let hintTimer = null;
  let hintActive = false;

  function showHint(text, x, y) {
    const FONT_SIZE = 10, LINE_H = 13, PAD_X = 10, PAD_Y = 7;
    const approxCharsPerLine = 28;
    const words = text.split(" ");
    let lineW = 0, maxW = 0, lines = 1;
    for (const w of words) {
      if (lineW + w.length > approxCharsPerLine && lineW > 0) {
        maxW = Math.max(maxW, lineW);
        lineW = w.length; lines++;
      } else {
        lineW += w.length + 1;
      }
    }
    maxW = Math.max(maxW, lineW);
    const PW = Math.min(220, Math.max(120, maxW * 6.2 + PAD_X * 2));
    const PH = lines * LINE_H + PAD_Y * 2;
    const vw = window.innerWidth, vh = window.innerHeight;
    let sx = x + 12, sy = y + 12;
    if (sx + PW > vw - 8) sx = x - PW - 8;
    if (sy + PH > vh - 8) sy = y - PH - 8;
    hintTooltip.render([{ type: "hint", text }], sx, sy, Math.round(PW), Math.round(PH), null);
    hintActive = true;
  }

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest("[data-tip]");
    clearTimeout(hintTimer);
    if (!el) {
      if (hintActive) { hintTooltip.hide(); hintActive = false; }
      return;
    }
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
    const tip = el.dataset.tip;
    hintTimer = setTimeout(() => showHint(tip, e.clientX, e.clientY), 600);
  });

  document.addEventListener("pointerleave", () => {
    clearTimeout(hintTimer);
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
  }, true);

  document.addEventListener("pointerdown", () => {
    clearTimeout(hintTimer);
    if (hintActive) { hintTooltip.hide(); hintActive = false; }
  });
}
