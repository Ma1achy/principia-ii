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

// ── Menu Item Behavior ─────────────────────────────────────────────────────

export function menuItemBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  const { navManager, uiTree } = deps;
  
  return {
    onActivate() {
      console.log('[menuItemBehavior] onActivate called for:', node.id);
      
      // First, trigger the button's click to do its work (change state, etc.)
      if (element && !(element as HTMLButtonElement).disabled) {
        console.log('[menuItemBehavior] Clicking element');
        element.click();
      }
      
      // Then, close the picker overlay through KNM
      // Find the picker overlay ID from the node's parent
      const pickerId = node.parentId;
      console.log('[menuItemBehavior] Picker overlay ID:', pickerId);
      
      if (navManager && pickerId) {
        // Small delay to let the click handler complete first
        console.log('[menuItemBehavior] Closing overlay via KNM:', pickerId);
        setTimeout(() => {
          navManager.closeOverlay(pickerId);
        }, 0);
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

// ── Picker Close Button Behavior ──────────────────────────────────────────

export function pickerCloseButtonBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  const { navManager } = deps;
  
  return {
    onActivate() {
      // Find the picker overlay ID from the node's parent
      const pickerId = node.parentId;
      
      console.log('[pickerCloseButtonBehavior] onActivate called');
      console.log('[pickerCloseButtonBehavior]   node.id:', node.id);
      console.log('[pickerCloseButtonBehavior]   node.parentId (pickerId):', pickerId);
      console.log('[pickerCloseButtonBehavior]   has navManager:', !!navManager);
      
      if (navManager && pickerId) {
        console.log('[pickerCloseButtonBehavior] Closing overlay via KNM:', pickerId);
        navManager.closeOverlay(pickerId);
      } else {
        console.warn('[pickerCloseButtonBehavior] No navManager or pickerId');
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
  
  console.log('[paramTriggerBehavior] Creating behavior for:', node.id, 'has navManager:', !!navManager, 'has element:', !!element);

  return {
    onActivate() {
      console.log('[paramTriggerBehavior] onActivate called for:', node.id);
      
      // For now, just trigger a click on the element to open the existing picker overlay
      // The old picker system handles the overlay display
      if (element) {
        console.log('[paramTriggerBehavior] Triggering click on element');
        element.click();
        return BEHAVIOR_RESULT.HANDLED;
      }
      
      console.warn('[paramTriggerBehavior] No element to click for:', node.id);
      return BEHAVIOR_RESULT.IGNORED;
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

// ── Textarea Behavior ──────────────────────────────────────────────────────

export function textareaBehavior(node: UINode, element: HTMLElement | null, deps: BaseDeps = {}): Behavior {
  let isInteracting = false;
  
  return {
    onActivate() {
      if (!isInteracting && element && !(element as HTMLTextAreaElement).disabled) {
        isInteracting = true;
        (element as HTMLTextAreaElement).focus();
        console.log('[textareaBehavior] Entered edit mode');
        return BEHAVIOR_RESULT.HANDLED;
      } else if (isInteracting) {
        // Don't exit on Enter - Enter creates new lines in textarea
        console.log('[textareaBehavior] Enter key creates new line (staying in edit mode)');
        return BEHAVIOR_RESULT.IGNORED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    onArrowKey(direction: string) {
      if (isInteracting) {
        // While editing, arrow keys move cursor within textarea - don't intercept
        console.log('[textareaBehavior] Arrow key used for cursor movement:', direction);
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      // When not editing, arrows navigate out of the textarea
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate();
    },

    onEscape() {
      if (isInteracting) {
        isInteracting = false;
        (element as HTMLTextAreaElement).blur();
        console.log('[textareaBehavior] Exited edit mode (Escape)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    isInteracting() {
      return isInteracting;
    }
  };
}

// ── Code Editor Behavior ───────────────────────────────────────────────────

interface CodeEditorDeps extends BaseDeps {
  editorRegistry?: any;
  editors?: Map<string, any>;  // Map of nodeId -> CodeEditor instance
}

export function codeEditorBehavior(node: UINode, element: HTMLElement | null, deps: CodeEditorDeps = {}): Behavior {
  const { editorRegistry, editors } = deps;
  let isInteracting = false;
  let editor: any = null;
  
  // Initialize editor on first access
  const getEditor = () => {
    if (editor) return editor;
    
    if (!editorRegistry || !editors) {
      console.warn('[codeEditorBehavior] No editor registry or editors map provided');
      return null;
    }
    
    // Check if editor already exists (shared instance created in main.ts)
    if (editors.has(node.id)) {
      editor = editors.get(node.id);
      console.log('[codeEditorBehavior] Using existing editor for', node.id);
      return editor;
    }
    
    // Create new editor instance (fallback, usually created in main.ts)
    const language = node.meta?.editorLanguage || 'json';
    editor = editorRegistry.create(language, {
      lineNumbers: true,
      linting: true,
      autoFormat: true,
      autocompletion: true
    });
    
    if (editor && element) {
      // Clear any existing content in container
      element.innerHTML = '';
      editor.mount(element);
      editors.set(node.id, editor);
      console.log('[codeEditorBehavior] Created', language, 'editor for', node.id);
    }
    
    return editor;
  };
  
  return {
    onActivate() {
      const ed = getEditor();
      if (!ed) return BEHAVIOR_RESULT.IGNORED;
      
      if (!isInteracting) {
        isInteracting = true;
        ed.focus();
        console.log('[codeEditorBehavior] Entered edit mode');
        return BEHAVIOR_RESULT.HANDLED;
      } else {
        // Don't exit on Enter - Enter creates new lines
        console.log('[codeEditorBehavior] Enter key creates new line (staying in edit mode)');
        return BEHAVIOR_RESULT.IGNORED;
      }
    },

    onArrowKey(direction: string) {
      if (isInteracting) {
        // While editing, arrow keys work within editor - don't intercept
        console.log('[codeEditorBehavior] Arrow key used for cursor movement:', direction);
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      // When not editing, arrows navigate away
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate();
    },

    onEscape() {
      const ed = getEditor();
      if (!ed) return BEHAVIOR_RESULT.IGNORED;
      
      if (isInteracting) {
        isInteracting = false;
        ed.blur();
        console.log('[codeEditorBehavior] Exited edit mode (Escape)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    isInteracting() {
      return isInteracting;
    }
  };
}
