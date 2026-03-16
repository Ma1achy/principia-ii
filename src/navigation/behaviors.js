/**
 * Behavior implementations for different node kinds
 * Standalone functions with explicit dependency injection
 */

// ── Behavior Results ───────────────────────────────────────────────────────

export const BEHAVIOR_RESULT = {
  HANDLED: 'handled',       // Behavior handled the action
  IGNORED: 'ignored',       // Behavior ignored (let navigation handle it)
  PREVENT: 'prevent',       // Prevent default navigation
  ESCAPE_SCOPE: 'escape_scope'  // Exit to parent scope
};

// ── Section Header Behavior ────────────────────────────────────────────────

/**
 * Section header behavior - Enter toggles collapse/expand
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (section head)
 * @param {Object} deps - { uiTree }
 * @returns {Object} Behavior interface
 */
export function sectionHeaderBehavior(node, element, deps = {}) {
  const { uiTree } = deps;
  
  return {
    onActivate() {
      // Click the header to toggle collapse
      if (element) {
        element.click();
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
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

/**
 * Button behavior - activates on Enter/Space
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element
 * @param {Object} deps - Dependencies (empty for buttons)
 * @returns {Object} Behavior interface
 */
export function buttonBehavior(node, element, deps = {}) {
  return {
    onActivate() {
      if (element && !element.disabled) {
        element.click();
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
      return BEHAVIOR_RESULT.IGNORED; // Let navigation handle
    },

    onInteract() {
      return BEHAVIOR_RESULT.IGNORED; // Buttons don't have interaction mode
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Checkbox Behavior ──────────────────────────────────────────────────────

/**
 * Checkbox behavior - toggles on Enter/Space
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (checkbox input)
 * @param {Object} deps - Dependencies (empty for checkboxes)
 * @returns {Object} Behavior interface
 */
export function checkboxBehavior(node, element, deps = {}) {
  return {
    onActivate() {
      if (element && !element.disabled) {
        element.checked = !element.checked;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
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

/**
 * Value editor behavior - enters edit mode on Enter
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (number input)
 * @param {Object} deps - Dependencies (empty for value editors)
 * @returns {Object} Behavior interface
 */
export function valueEditorBehavior(node, element, deps = {}) {
  let isInteracting = false;
  
  return {
    onActivate() {
      // Enter toggles edit mode
      if (!isInteracting && element && !element.disabled) {
        isInteracting = true;
        element.focus();
        element.select();
        console.log('[valueEditorBehavior] Entered edit mode');
        return BEHAVIOR_RESULT.HANDLED;
      } else if (isInteracting) {
        // Enter while editing exits edit mode
        isInteracting = false;
        element.blur();
        console.log('[valueEditorBehavior] Exited edit mode (Enter)');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    onArrowKey(direction) {
      if (isInteracting) {
        // While editing, ignore all arrow keys (let native input handle cursor)
        console.log('[valueEditorBehavior] Arrow key ignored while editing:', direction);
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      // Check if this slider has a param trigger
      const parentNode = deps.uiTree?.getNode(node.parentId);
      const hasParamTrigger = parentNode?.children?.some(childId => {
        const child = deps.uiTree?.getNode(childId);
        return child?.kind === 'param-trigger';
      });
      
      if (hasParamTrigger) {
        // Slider WITH param trigger: Down and Right escape, Up goes to param, Left goes to analog
        if (direction === 'ArrowDown' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      } else {
        // Slider WITHOUT param trigger: Up, Down, Right escape, Left goes to analog
        if (direction === 'ArrowUp' || direction === 'ArrowDown' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      }
      
      return BEHAVIOR_RESULT.IGNORED;  // Let grid handle remaining directions
    },

    onInteract() {
      // Same as activate
      return this.onActivate();
    },

    onEscape() {
      // Exit edit mode (blur input)
      if (isInteracting) {
        isInteracting = false;
        element.blur();
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

/**
 * Analog control behavior - range slider with interaction mode
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (range input)
 * @param {Object} deps - Dependencies (empty for analog controls)
 * @returns {Object} Behavior interface
 */
export function analogControlBehavior(node, element, deps = {}) {
  let isInteracting = false;

  return {
    onActivate() {
      // Enter toggles interaction mode
      if (!isInteracting) {
        isInteracting = true;
        console.log('[analogControlBehavior] Entered interaction mode (cyan)');
      } else {
        isInteracting = false;
        console.log('[analogControlBehavior] Exited interaction mode (Enter)');
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
      if (!isInteracting) {
        // Check if this slider has a param trigger
        const parentNode = deps.uiTree?.getNode(node.parentId);
        const hasParamTrigger = parentNode?.children?.some(childId => {
          const child = deps.uiTree?.getNode(childId);
          return child?.kind === 'param-trigger';
        });
        
        if (hasParamTrigger) {
          // Slider WITH param trigger: Left and Down escape, Up goes to param, Right goes to value
          if (direction === 'ArrowLeft' || direction === 'ArrowDown') {
            return BEHAVIOR_RESULT.ESCAPE_SCOPE;
          }
        } else {
          // Slider WITHOUT param trigger: Up, Down, Left escape, Right goes to value
          if (direction === 'ArrowUp' || direction === 'ArrowDown' || direction === 'ArrowLeft') {
            return BEHAVIOR_RESULT.ESCAPE_SCOPE;
          }
        }
        
        return BEHAVIOR_RESULT.IGNORED;  // Let grid handle remaining directions
      }

      // In interaction mode: adjust value
      if (!element || element.disabled) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      const step = parseFloat(element.step) || 1;
      const currentValue = parseFloat(element.value);
      let newValue = currentValue;

      // Left/Right and +/- adjust the value
      if (direction === 'ArrowLeft' || direction === 'ArrowDown') {
        newValue = currentValue - step;
      } else if (direction === 'ArrowRight' || direction === 'ArrowUp') {
        newValue = currentValue + step;
      } else {
        return BEHAVIOR_RESULT.IGNORED;
      }

      // Clamp to min/max
      const min = parseFloat(element.min);
      const max = parseFloat(element.max);
      newValue = Math.max(min, Math.min(max, newValue));

      element.value = String(newValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      
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

/**
 * Param trigger behavior - opens dropdown overlay
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (label)
 * @param {Object} deps - { uiTree, navManager }
 * @returns {Object} Behavior interface
 */
export function paramTriggerBehavior(node, element, deps = {}) {
  const { uiTree, navManager } = deps;

  return {
    onActivate() {
      // Find associated overlay
      const overlayId = node.meta?.overlayId;
      if (!overlayId || !uiTree || !navManager) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      // Open overlay
      navManager.openOverlayById(overlayId, node.id);
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
      // Check if this param trigger is inside a slider
      const parentNode = deps.uiTree?.getNode(node.parentId);
      const isInSlider = parentNode?.role === 'slider';
      
      if (isInSlider) {
        // Inside slider: Up, Left, Right escape to slider scope
        if (direction === 'ArrowUp' || direction === 'ArrowLeft' || direction === 'ArrowRight') {
          return BEHAVIOR_RESULT.ESCAPE_SCOPE;
        }
      }
      // Not in slider: use normal grid navigation in all directions
      
      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      return this.onActivate(); // Same as activate
    },

    onEscape() {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Canvas Behavior ────────────────────────────────────────────────────────

/**
 * Canvas behavior - leaf node with interaction mode for pan/zoom
 * Like analog-control: Enter activates (cyan), Escape exits (orange)
 * While interacting: arrows pan, +/- zoom, ArrowUp/Down can exit
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (canvas)
 * @param {Object} deps - { dispatchCanvasAction, PAN_STEP, ZOOM_STEP }
 * @returns {Object} Behavior interface
 */
export function canvasBehavior(node, element, deps = {}) {
  const { dispatchCanvasAction, PAN_STEP = 20, ZOOM_STEP = 0.1 } = deps;
  let isInteracting = false;

  return {
    onActivate() {
      return BEHAVIOR_RESULT.IGNORED; // Not a button, use onInteract
    },

    onArrowKey(direction) {
      if (!isInteracting || !dispatchCanvasAction) {
        return BEHAVIOR_RESULT.IGNORED;
      }

      // While interacting: arrows pan
      const panMap = {
        ArrowUp: { x: 0, y: PAN_STEP },
        ArrowDown: { x: 0, y: -PAN_STEP },
        ArrowLeft: { x: PAN_STEP, y: 0 },
        ArrowRight: { x: -PAN_STEP, y: 0 }
      };

      const pan = panMap[direction];
      if (pan) {
        dispatchCanvasAction('pan', pan);
        return BEHAVIOR_RESULT.HANDLED;
      }

      return BEHAVIOR_RESULT.IGNORED;
    },

    onInteract() {
      // Toggle interaction mode
      isInteracting = !isInteracting;
      console.log('[canvasBehavior] Interaction mode:', isInteracting ? 'ACTIVE (cyan)' : 'INACTIVE (orange)');
      return BEHAVIOR_RESULT.HANDLED;
    },

    onEscape() {
      if (isInteracting) {
        // Exit interaction mode, stay focused on canvas
        isInteracting = false;
        console.log('[canvasBehavior] Exited interaction mode');
        return BEHAVIOR_RESULT.HANDLED;
      }
      return BEHAVIOR_RESULT.IGNORED;
    },

    isInteracting() {
      return isInteracting;
    },

    // Scope key handlers (unused since canvas is now a leaf)
    onScopeKey(key) {
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}

// ── Native Select Behavior ─────────────────────────────────────────────────

/**
 * Native select behavior - for hidden <select> elements
 * @param {Object} node - Navigation node
 * @param {HTMLElement} element - DOM element (select)
 * @param {Object} deps - Dependencies (empty)
 * @returns {Object} Behavior interface
 */
export function nativeSelectBehavior(node, element, deps = {}) {
  return {
    onActivate() {
      if (element && !element.disabled) {
        element.focus();
        // Try to open dropdown (browser-dependent)
        if (element.showPicker) {
          element.showPicker();
        }
      }
      return BEHAVIOR_RESULT.HANDLED;
    },

    onArrowKey(direction) {
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
