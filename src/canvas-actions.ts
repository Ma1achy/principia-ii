/**
 * Canvas Actions Dispatcher
 * Maps keyboard navigation actions to canvas operations
 */

import { state } from './state.ts';
import { panByPixels, zoomAt, resetView } from './interaction/gestures.ts';

export interface CanvasActionContext {
  glCanvas: HTMLCanvasElement;
  outCanvas: HTMLCanvasElement;
  scheduleRender?: (reason?: string) => void;
  writeHash?: () => void;
  updateStateBox?: () => void;
  drawHUD?: () => void;
}

export interface PanPayload {
  x?: number;
  y?: number;
}

export interface ZoomPayload {
  delta?: number;
}

export type CanvasActionPayload = PanPayload | ZoomPayload | Record<string, never>;

/**
 * Dispatch canvas action from keyboard navigation
 */
export function dispatchCanvasAction(
  action: string,
  payload: CanvasActionPayload = {},
  context: CanvasActionContext
): void {
  const { glCanvas, outCanvas, scheduleRender, writeHash, updateStateBox, drawHUD } = context;

  if (!glCanvas || !outCanvas) {
    console.warn('[canvas-actions] Missing canvas elements');
    return;
  }

  switch (action) {
    case 'pan': {
      const { x = 0, y = 0 } = payload as PanPayload;
      panByPixels(x, y, glCanvas, outCanvas);
      if (scheduleRender) scheduleRender('pan');
      if (writeHash) writeHash();
      if (updateStateBox) updateStateBox();
      if (drawHUD) drawHUD();
      break;
    }

    case 'zoom': {
      const { delta = 0 } = payload as ZoomPayload;
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
 */
export function createCanvasActionDispatcher(context: CanvasActionContext) {
  return (action: string, payload?: CanvasActionPayload) => 
    dispatchCanvasAction(action, payload, context);
}
