/**
 * Hint tooltip system
 * Attaches hover tooltips to elements with data-tip attribute
 */

/**
 * Minimal tooltip interface for hints
 */
interface HintTooltip {
  render(lines: any[], x: number, y: number, w: number, h: number, canvas: HTMLCanvasElement | null): void;
  hide(): void;
}

/**
 * Attach hint tooltip behavior to the document
 * Listens for pointer events and shows tooltips for elements with [data-tip]
 * @param hintTooltip - Tooltip instance to use for rendering
 */
export function attachHintTooltips(hintTooltip: HintTooltip): void {
  let hintTimer: number | null = null;
  let hintActive = false;

  function showHint(text: string, x: number, y: number): void {
    const FONT_SIZE = 10, LINE_H = 13, PAD_X = 10, PAD_Y = 7;
    const approxCharsPerLine = 28;
    const words = text.split(" ");
    let lineW = 0, maxW = 0, lines = 1;
    for (const w of words) {
      if (lineW + w.length > approxCharsPerLine && lineW > 0) {
        maxW = Math.max(maxW, lineW);
        lineW = w.length;
        lines++;
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

  document.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element).closest("[data-tip]") as HTMLElement | null;
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
    }
    if (!el) {
      if (hintActive) {
        hintTooltip.hide();
        hintActive = false;
      }
      return;
    }
    if (hintActive) {
      hintTooltip.hide();
      hintActive = false;
    }
    const tip = el.dataset.tip;
    if (tip) {
      hintTimer = window.setTimeout(() => showHint(tip, e.clientX, e.clientY), 600);
    }
  });

  document.addEventListener("pointerleave", () => {
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
    }
    if (hintActive) {
      hintTooltip.hide();
      hintActive = false;
    }
  }, true);

  document.addEventListener("pointerdown", () => {
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
    }
    if (hintActive) {
      hintTooltip.hide();
      hintActive = false;
    }
  });
}
