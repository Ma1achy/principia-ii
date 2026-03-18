/**
 * Behavior implementations for different node kinds
 * Standalone functions with explicit dependency injection
 */

import type { UINode } from '../ui/semantic-tree/store.ts';

// ── Behavior Results ───────────────────────────────────────────────────────

export const BEHAVIOR_RESULT = {
  HANDLED: 'handled',       // Behavior handled the action
  IGNORED: 'ignored',       // Behavior ignored (let navigation handle it)
  PREVENT: 'prevent',       // Prevent default navigation
  ESCAPE_SCOPE: 'escape_scope'  // Exit to parent scope
} as const;

export type BehaviorResultType = typeof BEHAVIOR_RESULT[keyof typeof BEHAVIOR_RESULT];

// ── Behavior Interface ─────────────────────────────────────────────────────

export interface Behavior {
  onActivate(): BehaviorResultType;
  onArrowKey(direction: string): BehaviorResultType;
  onInteract(): BehaviorResultType;
  onEscape(): BehaviorResultType;
  isInteracting?(): boolean;
  onIncrement?(): BehaviorResultType;
  onDecrement?(): BehaviorResultType;
  onScopeKey?(key: string): BehaviorResultType;
}

// ── Dependencies ───────────────────────────────────────────────────────────

interface BaseDeps {
  uiTree?: any;
  navManager?: any;
}

interface CanvasDeps extends BaseDeps {
  dispatchCanvasAction?: (action: string, data: any) => void;
  PAN_STEP?: number;
  ZOOM_STEP?: number;
}

// ── Section Header Behavior ────────────────────────────────────────────────

export function sectionHeaderBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  const { uiTree } = deps;
  
  return {
    onActivate() {
      if (element) {
        element.click();
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate();
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Button Behavior ────────────────────────────────────────────────────────

export function buttonBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  return {
    onActivate() {
      if (element && !(element as HTMLButtonElement).disabled) {
        element.click();
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Checkbox Behavior ──────────────────────────────────────────────────────

export function checkboxBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  return {
    onActivate() {
      if (element && !(element as HTMLInputElement).disabled) {
        const checkbox = element as HTMLInputElement;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Value Editor Behavior ──────────────────────────────────────────────────

export function valueEditorBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  let isInteracting = false;
  
  return {
    onActivate() {
      if (!isInteracting && element && !(element as HTMLInputElement).disabled) {
        isInteracting = true;
        (element as HTMLInputElement).focus();
        (element as HTMLInputElement).select();
        console.log('[valueEditorBehavior] Entered edit mode');
        return BEHAVIOR_RESULT.HANDLED;
      } else if (isInteracting) {
        isInteracting = false;
        (element as HTMLInputElement).blur();
        console.log('[valueEditorBehavior] Exited edit mode (Enter)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    onArrowKey(direction: string) {
      if (isInteracting) {
        console.log('[valueEditorBehavior] Arrow key ignored while editing:', direction);
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      const parentNode = deps.uiTree?.getNode(node.parentId);
      const hasParamTrigger = parentNode?.children?.some((childId: string) => {
        const child = deps.uiTree?.getNode(childId);
        return child?.kind === 'param-trigger';
      });
      
      if (hasParamTrigger) {
        if (direction === 'ArrowDown' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      } else {
        if (direction === 'ArrowUp' || direction === 'ArrowDown' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      }
      
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate();
    },

    onEscape() {
      if (isInteracting) {
        isInteracting = false;
        (element as HTMLInputElement).blur();
        console.log('[valueEditorBehavior] Exited edit mode (Escape)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    isInteracting() {
      return isInteracting;
    }
  };
}

// ── Analog Control Behavior ────────────────────────────────────────────────

export function analogControlBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  let isInteracting = false;

  return {
    onActivate() {
      if (!isInteracting) {
        isInteracting = true;
        console.log('[analogControlBehavior] Entered interaction mode (cyan)');
      } else {
        isInteracting = false;
        console.log('[analogControlBehavior] Exited interaction mode (Enter)');
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      if (!isInteracting) {
        const parentNode = deps.uiTree?.getNode(node.parentId);
        const hasParamTrigger = parentNode?.children?.some((childId: string) => {
          const child = deps.uiTree?.getNode(childId);
          return child?.kind === 'param-trigger';
        });
        
        if (hasParamTrigger) {
          if (direction === 'ArrowLeft' || direction === 'ArrowDown') {
            return BEHAVIOR_RESULT.ESCAPE_SCOPE;
          }
        } else {
          if (direction === 'ArrowUp' || direction === 'ArrowDown' || direction === 'ArrowLeft') {
            return BEHAVIOR_RESULT.ESCAPE_SCOPE;
          }
        }
        
        return BEHAVIOR_RESULT.IGNORED;
      }

      if (!element || (element as HTMLInputElement).disabled) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      const input = element as HTMLInputElement;
      const step = parseFloat(input.step) || 1;
      const currentValue = parseFloat(input.value);
      let newValue = currentValue;

      if (direction === 'ArrowLeft' || direction === 'ArrowDown') {
        newValue = currentValue - step;
      } else if (direction === 'ArrowRight' || direction === 'ArrowUp') {
        newValue = currentValue + step;
      } else {
        return BEHAVIOR_RESULT.IGNORED;
      }

      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      newValue = Math.max(min, Math.min(max, newValue));

      input.value = String(newValue);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      console.log('[analogControlBehavior] Adjusted value:', direction, '→', newValue);

      return BEHAVIOR_RESULT.HANDLED;
    },

    onInteract() {
      isInteracting = !isInteracting;
      return BEHAVIOR_RESULT.HANDLED;
    },

    onEscape() {
      if (isInteracting) {
        isInteracting = false;
        console.log('[analogControlBehavior] Exited interaction mode (Escape)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    isInteracting() {
      return isInteracting;
    }
  };
}

// ── Param Trigger Behavior ─────────────────────────────────────────────────

export function paramTriggerBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  const { uiTree, navManager } = deps;

  return {
    onActivate() {
      const overlayId = node.meta?.overlayId;
      if (!overlayId || !uiTree || !navManager) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      navManager.openOverlayById(overlayId, node.id);
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      const parentNode = deps.uiTree?.getNode(node.parentId);
      const isInSlider = parentNode?.role === 'slider';
      
      if (isInSlider) {
        if (direction === 'ArrowUp' || direction === 'ArrowLeft' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      }
      
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate();
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Canvas Behavior ────────────────────────────────────────────────────────

export function canvasBehavior(node: UINode, element: HTMLElement | null, deps: CanvasDeps = {}): Behavior {
  const { dispatchCanvasAction, PAN_STEP = 20, ZOOM_STEP = 0.1 } = deps;
  let isInteracting = false;

  return {
    onActivate() {
      console.log('[canvasBehavior] onActivate called, current isInteracting:', isInteracting);
      isInteracting = !isInteracting;
      console.log('[canvasBehavior] Toggled interaction mode to:', isInteracting ? 'ACTIVE (cyan)' : 'INACTIVE (orange)');
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      console.log('[canvasBehavior] onArrowKey called:', direction, 'isInteracting:', isInteracting, 'hasDispatcher:', !!dispatchCanvasAction);
      if (!isInteracting || !dispatchCanvasAction) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      const panMap: Record<string, { x: number; y: number }> = {
        ArrowUp: { x: 0, y: PAN_STEP },
        ArrowDown: { x: 0, y: -PAN_STEP },
        ArrowLeft: { x: PAN_STEP, y: 0 },
        ArrowRight: { x: -PAN_STEP, y: 0 }
      };

      const pan = panMap[direction];
      if (pan) {
        console.log('[canvasBehavior] Panning:', pan);
        dispatchCanvasAction('pan', pan);
        return BEHAVIOR_RESULT.HANDLED;
      }

      return BEHAVIOR_RESULT.IGNORED;
    },
    
    onIncrement() {
      console.log('[canvasBehavior] onIncrement called, isInteracting:', isInteracting, 'hasDispatcher:', !!dispatchCanvasAction);
      if (!isInteracting || !dispatchCanvasAction) {
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      dispatchCanvasAction('zoom', { delta: ZOOM_STEP });
      console.log('[canvasBehavior] Zoom in:', ZOOM_STEP);
      return BEHAVIOR_RESULT.HANDLED;
    },
    
    onDecrement() {
      console.log('[canvasBehavior] onDecrement called, isInteracting:', isInteracting, 'hasDispatcher:', !!dispatchCanvasAction);
      if (!isInteracting || !dispatchCanvasAction) {
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      dispatchCanvasAction('zoom', { delta: -ZOOM_STEP });
      console.log('[canvasBehavior] Zoom out:', -ZOOM_STEP);
      return BEHAVIOR_RESULT.HANDLED;
    },

    onEscape() {
      console.log('[canvasBehavior] onEscape called, isInteracting:', isInteracting);
      if (isInteracting) {
        isInteracting = false;
        console.log('[canvasBehavior] Exited interaction mode');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    isInteracting() {
      return isInteracting;
    },

    onScopeKey(key: string) {
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    onInteract() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Native Select Behavior ─────────────────────────────────────────────────

export function nativeSelectBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  return {
    onActivate() {
      if (element && !(element as HTMLSelectElement).disabled) {
        (element as HTMLSelectElement).focus();
        if ((element as any).showPicker) {
          (element as any).showPicker();
        }
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction: string) {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return BEHAVIOR_RESULT.IGNORED;
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}
