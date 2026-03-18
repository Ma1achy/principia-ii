/**
 * Canvas visibility management
 */

/**
 * Show WebGL canvas (hide output canvas)
 * @param glCanvas - WebGL canvas element
 * @param outCanvas - Output canvas element
 * @param resizeUiCanvasToMatch - Callback to resize UI canvas
 */
export function showGL(
  glCanvas: HTMLCanvasElement,
  outCanvas: HTMLCanvasElement,
  resizeUiCanvasToMatch: () => void
): void {
  glCanvas.style.display = "";
  outCanvas.style.display = "none";
  resizeUiCanvasToMatch();
}

/**
 * Show output canvas (hide WebGL canvas)
 * @param glCanvas - WebGL canvas element
 * @param outCanvas - Output canvas element
 * @param resizeUiCanvasToMatch - Callback to resize UI canvas
 */
export function showOut(
  glCanvas: HTMLCanvasElement,
  outCanvas: HTMLCanvasElement,
  resizeUiCanvasToMatch: () => void
): void {
  glCanvas.style.display = "none";
  outCanvas.style.display = "";
  resizeUiCanvasToMatch();
}
