import { $ } from '../utils.js';

/**
 * Render state management
 */

let _isRendering = false;

/**
 * Set rendering state and update button UI
 * @param active - Whether rendering is active
 */
export function setRenderingState(active: boolean): void {
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

/**
 * Get current rendering state
 * @returns Whether rendering is active
 */
export function isRendering(): boolean {
  return _isRendering;
}
