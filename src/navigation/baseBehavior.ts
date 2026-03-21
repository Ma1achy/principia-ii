/**
 * Base behavior generator - creates behavior implementations from capabilities
 * Handles common patterns automatically without manual coding
 */

import type { UINode } from '../ui/semantic-tree/store.ts';
import type { ResolvedCapabilities, Direction } from './capabilities.ts';
import { BEHAVIOR_RESULT, type BehaviorResultType, type Behavior } from './behaviors.ts';

// ── Interaction State Management ───────────────────────────────────────────

/**
 * Create a shared interaction state manager for interactive controls
 */
export function createInteractionStateManager() {
  let isInteracting = false;
  
  return {
    enter() {
      isInteracting = true;
    },
    exit() {
      isInteracting = false;
    },
    toggle() {
      isInteracting = !isInteracting;
    },
    get() {
      return isInteracting;
    }
  };
}

// ── Default Activation ─────────────────────────────────────────────────────

/**
 * Standard activation behavior - click the element
 */
export function defaultActivation(element: HTMLElement | null): BehaviorResultType {
  if (element) {
    const isDisabled = (element as HTMLButtonElement).disabled || 
                      (element as HTMLInputElement).disabled;
    if (!isDisabled) {
      element.click();
    }
  }
  return BEHAVIOR_RESULT.HANDLED;
}

/**
 * Interactive control activation - enter interaction mode on first press
 */
export function interactiveActivation(
  element: HTMLElement | null,
  stateManager: ReturnType<typeof createInteractionStateManager>
): BehaviorResultType {
  if (!stateManager.get() && element) {
    const isDisabled = (element as HTMLInputElement).disabled;
    if (!isDisabled) {
      stateManager.enter();
      (element as HTMLInputElement).focus();
      // Select text if it's an input
      if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'text') {
        (element as HTMLInputElement).select();
      }
      return BEHAVIOR_RESULT.HANDLED;
    }
  } else if (stateManager.get()) {
    // Already interacting - don't exit on Enter for text controls
    // Let the control handle it (e.g., textarea needs Enter for new lines)
    return BEHAVIOR_RESULT.IGNORED;
  }
  return BEHAVIOR_RESULT.IGNORED;
}

/**
 * Toggle-style activation - for analog controls (sliders)
 * Toggles between navigation mode and interaction mode
 */
export function toggleActivation(
  stateManager: ReturnType<typeof createInteractionStateManager>
): BehaviorResultType {
  if (!stateManager.get()) {
    stateManager.enter();
    console.log('[toggleActivation] Entered interaction mode (cyan)');
  } else {
    stateManager.exit();
    console.log('[toggleActivation] Exited interaction mode (Enter)');
  }
  return BEHAVIOR_RESULT.HANDLED;
}

// ── Escape Handling ────────────────────────────────────────────────────────

/**
 * Handle escape for interactive controls (two-level: exit interaction, then exit scope)
 */
export function handleInteractiveEscape(
  element: HTMLElement | null,
  stateManager: ReturnType<typeof createInteractionStateManager>
): BehaviorResultType {
  if (stateManager.get()) {
    // First escape: exit interaction mode
    stateManager.exit();
    if (element) {
      (element as HTMLInputElement).blur();
    }
    console.log('[BaseBehavior] Exited interaction mode (Escape)');
    return BEHAVIOR_RESULT.HANDLED;
  }
  // Second escape: let navigation handle (exit scope)
  return BEHAVIOR_RESULT.IGNORED;
}

/**
 * Handle escape for non-interactive controls (just bubble up)
 */
export function handleBubbleEscape(): BehaviorResultType {
  return BEHAVIOR_RESULT.IGNORED;
}

// ── Arrow Key Handling ─────────────────────────────────────────────────────

/**
 * Apply arrow key policy
 */
export function handleArrowKeyPolicy(
  policy: ResolvedCapabilities['arrowPolicy'],
  direction: Direction,
  isInteracting: boolean
): BehaviorResultType {
  // When interacting, always let the control handle arrows (for cursor movement)
  if (isInteracting) {
    return BEHAVIOR_RESULT.IGNORED;
  }
  
  // When not interacting, apply policy
  switch (policy) {
    case 'navigate':
      // Let navigation system handle all arrows
      return BEHAVIOR_RESULT.IGNORED;
      
    case 'escape-vertical':
      // Escape on vertical arrows, navigate on horizontal
      if (direction === 'ArrowUp' || direction === 'ArrowDown') {
        return BEHAVIOR_RESULT.ESCAPE_SCOPE;
      }
      return BEHAVIOR_RESULT.IGNORED;
      
    case 'escape-horizontal':
      // Escape on horizontal arrows, navigate on vertical
      if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
        return BEHAVIOR_RESULT.ESCAPE_SCOPE;
      }
      return BEHAVIOR_RESULT.IGNORED;
      
    case 'escape-all':
      // Escape on any arrow
      return BEHAVIOR_RESULT.ESCAPE_SCOPE;
      
    case 'custom':
      // Custom handler should be provided
      return BEHAVIOR_RESULT.IGNORED;
      
    default:
      return BEHAVIOR_RESULT.IGNORED;
  }
}

// ── Base Behavior Generation ───────────────────────────────────────────────

/**
 * Generate a complete behavior implementation from capabilities
 */
export function createBaseBehavior(
  capabilities: ResolvedCapabilities,
  node: UINode,
  element: HTMLElement | null,
  deps: any = {}
): Behavior {
  // Create interaction state manager for interactive controls
  const stateManager = capabilities.interactive ? createInteractionStateManager() : null;
  
  return {
    /**
     * Handle activation (Enter/Space key)
     */
    onActivate(): BehaviorResultType {
      // Check for custom handler first
      if (capabilities.onActivate) {
        return capabilities.onActivate(node, element, deps);
      }
      
      // Use default behavior based on capabilities
      if (!capabilities.activatable) {
        return BEHAVIOR_RESULT.IGNORED;
      }
      
      if (capabilities.interactive && stateManager) {
        // For analog controls (sliders), just toggle state without focusing
        // For text inputs, focus and select
        if (element && (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'range')) {
          // Analog control - toggle interaction state only
          return toggleActivation(stateManager);
        }
        // Text input - enter interaction and focus/select
        return interactiveActivation(element, stateManager);
      }
      
      return defaultActivation(element);
    },
    
    /**
     * Handle arrow keys
     */
    onArrowKey(direction: string): BehaviorResultType {
      const arrowDir = direction as Direction;
      const isInteracting = stateManager?.get() || false;
      
      // Check for custom handler first
      if (capabilities.onArrowKey) {
        return capabilities.onArrowKey(node, element, arrowDir, isInteracting, deps);
      }
      
      // Apply arrow key policy
      return handleArrowKeyPolicy(capabilities.arrowPolicy, arrowDir, isInteracting);
    },
    
    /**
     * Handle mouse interaction (same as activate for most controls)
     */
    onInteract(): BehaviorResultType {
      const isInteracting = stateManager?.get() || false;
      
      // Check for custom handler first
      if (capabilities.onInteract) {
        const result = capabilities.onInteract(node, element, isInteracting, deps);
        // If custom handler returns HANDLED, we still need to toggle the state for interactive controls
        if (result === BEHAVIOR_RESULT.HANDLED && capabilities.interactive && stateManager) {
          stateManager.toggle();
        }
        return result;
      }
      
      // Default: For interactive controls, mouse click should enter interaction mode
      if (capabilities.interactive && stateManager && !stateManager.get()) {
        return this.onActivate();
      }
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    /**
     * Handle escape key
     */
    onEscape(): BehaviorResultType {
      const isInteracting = stateManager?.get() || false;
      
      // Check for custom handler first
      if (capabilities.onEscape) {
        return capabilities.onEscape(node, element, isInteracting, deps);
      }
      
      // Apply escape policy
      if (capabilities.escapePolicy === 'auto' && capabilities.interactive && stateManager) {
        return handleInteractiveEscape(element, stateManager);
      }
      
      if (capabilities.escapePolicy === 'bubble') {
        return handleBubbleEscape();
      }
      
      if (capabilities.escapePolicy === 'modal') {
        // Modal controls don't respond to escape
        return BEHAVIOR_RESULT.PREVENT;
      }
      
      // Custom policy handled by custom handler
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    /**
     * Check if currently in interaction mode
     */
    isInteracting(): boolean {
      return stateManager?.get() || false;
    },
    
    /**
     * Handle increment (+/= keys)
     */
    onIncrement(): BehaviorResultType {
      if (capabilities.onIncrement) {
        return capabilities.onIncrement(node, element, deps);
      }
      return BEHAVIOR_RESULT.IGNORED;
    },
    
    /**
     * Handle decrement (-/_ keys)
     */
    onDecrement(): BehaviorResultType {
      if (capabilities.onDecrement) {
        return capabilities.onDecrement(node, element, deps);
      }
      return BEHAVIOR_RESULT.IGNORED;
    }
  };
}
