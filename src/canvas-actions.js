/**
 * Canvas Actions Dispatcher
 * Maps keyboard navigation actions to canvas operations
 */

import { state } from './state.js';
import { panByPixels, zoomAt, resetView } from './interaction/gestures.js';

/**
 * Dispatch canvas action from keyboard navigation
 * @param {string} action - Action type ('pan', 'zoom', 'reset')
 * @param {Object} payload - Action payload
 * @param {Object} context - Required context { glCanvas, outCanvas, scheduleRender, writeHash, updateStateBox, drawHUD }
 */
export function dispatchCanvasAction(action, payload = {}, context = {}) {
  const { glCanvas, outCanvas, scheduleRender, writeHash, updateStateBox, drawHUD } = context;

  if (!glCanvas || !outCanvas) {
    console.warn('[canvas-actions] Missing canvas elements');
    return;
  }

  switch (action) {
    case 'pan': {
      const { x = 0, y = 0 } = payload;
      panByPixels(x, y, glCanvas, outCanvas);
      if (scheduleRender) scheduleRender('pan');
      if (writeHash) writeHash();
      if (updateStateBox) updateStateBox();
      if (drawHUD) drawHUD();
      break;
    }

    case 'zoom': {
      const { delta = 0 } = payload;
      // Zoom at center of canvas
      const rect = glCanvas.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const factor = Math.exp(delta);
      zoomAt(centerX, centerY, factor, glCanvas, outCanvas);
      if (scheduleRender) scheduleRender('zoom');
      if (writeHash) writeHash();
      if (updateStateBox) updateStateBox();
      if (drawHUD) drawHUD();
      break;
    }

    case 'reset': {
      resetView(scheduleRender, writeHash, updateStateBox, drawHUD);
      break;
    }

    default:
      console.warn(`[canvas-actions] Unknown action: ${action}`);
  }
}

/**
 * Create a bound dispatcher with context
 * @param {Object} context - Context object with canvas refs and callbacks
 * @returns {Function} Bound dispatcher function
 */
export function createCanvasActionDispatcher(context) {
  return (action, payload) => dispatchCanvasAction(action, payload, context);
}
