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
