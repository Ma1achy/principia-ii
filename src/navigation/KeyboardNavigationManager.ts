/**
 * KeyboardNavigationManager - Grid-based keyboard navigation
 * Single unified manager for all keyboard navigation using coordinate arithmetic
 */

import { KeyRepeatManager } from './KeyRepeatManager.js';
import type { RepeatProfile } from './KeyRepeatManager.js';
import { NavigationStack, type NavigationFrame, type OverlayKind } from './NavigationStack.js';
import { StackRenderer } from './StackRenderer.js';
import { ZIndex } from '../ui/core/z-index.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SessionState {
  active: boolean;
  activationState: 'off' | 'awakened' | 'fading' | 'activated';
  currentFocusId: string | null;
  confirmationTimer: ReturnType<typeof setTimeout> | null;
  fadeTimer: ReturnType<typeof setTimeout> | null;
  heldKeyDuringAwakening: string | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
}

interface KeyboardNavigationOptions {
  effects?: any;
  visualizer?: any;
  uiTree?: any;
  behaviorRegistry?: any;
  behaviorDeps?: Record<string, any>;
}

interface InitOptions {
  setInitialFocus?: boolean;
}

type NavEvent = 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right' | 'nav-enter' | 'nav-escape' | 'nav-tab' | 'increment' | 'decrement';
type Direction = 'up' | 'down' | 'left' | 'right';
type BehaviorResult = 'handled' | 'ignored' | 'escape_scope' | undefined;

// ─── KeyboardNavigationManager Class ───────────────────────────────────────

export class KeyboardNavigationManager {
  effects: any;
  visualizer: any;
  uiTree: any;
  behaviorRegistry: any;
  behaviorDeps: Record<string, any>;
  behaviorCache: Map<string, any>;
  repeatManager: KeyRepeatManager;
  navStack: NavigationStack;
  stackRenderer: StackRenderer;
  gridMemory: Map<string, [number, number]>;
  sessionState: SessionState;
  _boundKeyHandler: ((e: KeyboardEvent) => void) | null;
  _boundKeyUpHandler: ((e: KeyboardEvent) => void) | null;
  _boundMouseHandler: ((e: PointerEvent) => void) | null;
  
  constructor(options: KeyboardNavigationOptions = {}) {
    const { effects, visualizer, uiTree, behaviorRegistry, behaviorDeps = {} } = options;
    
    this.effects = effects;
    this.visualizer = visualizer;
    this.uiTree = uiTree;
    this.behaviorRegistry = behaviorRegistry;
    this.behaviorDeps = behaviorDeps;
    
    this.behaviorCache = new Map();
    this.repeatManager = new KeyRepeatManager();
    
    // Initialize stack with automatic rendering
    this.stackRenderer = new StackRenderer({
      uiTree: this.uiTree,
      visualizer: this.visualizer,
      navManager: this  // Pass reference so StackRenderer can check active state
    });
    
    // If visualizer exists, give it access to stack depth
    if (this.visualizer && typeof this.visualizer === 'object') {
      (this.visualizer as any).getStackDepth = () => this.navStack.depth();
    }
    
    this.navStack = new NavigationStack((frame) => {
      // Auto-render on stack changes
      this.stackRenderer.render(frame);
      
      // Update global z-index system with new stack depth
      ZIndex.setStackDepth(this.navStack.depth());
      ZIndex.updateCSSVariables();
    });
    
    this.gridMemory = new Map();
    
    this.sessionState = {
      active: false,
      activationState: 'off',
      currentFocusId: null,
      confirmationTimer: null,
      fadeTimer: null,
      heldKeyDuringAwakening: null,
      inactivityTimer: null
    };
    
    this._boundKeyHandler = null;
    this._boundKeyUpHandler = null;
    this._boundMouseHandler = null;
    
    console.log('[KNM] Initialized with stack-based navigation');
  }
  
  // ── Computed Properties ────────────────────────────────────────────────────
  
  get currentFrame(): NavigationFrame | null {
    return this.navStack.peek();
  }
  
  get isInteracting(): boolean {
    const frame = this.currentFrame;
    return frame?.type === 'interaction';
  }
  
  get interactingNodeId(): string | null {
    const frame = this.currentFrame;
    return frame?.type === 'interaction' ? (frame.interactingNodeId || null) : null;
  }
  
  // ── Initialization ─────────────────────────────────────────────────────────
  
  init(rootId: string = 'root', options: InitOptions = {}): void {
    const { setInitialFocus = false } = options;
    
    this._boundKeyHandler = this._handleKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);
    
    this._boundKeyUpHandler = this._handleKeyUp.bind(this);
    document.addEventListener('keyup', this._boundKeyUpHandler);
    
    this._boundMouseHandler = this._handleMouseInteraction.bind(this);
    document.addEventListener('pointerdown', this._boundMouseHandler, true);
    
    // Set up backdrop click handler for overlays
    this._setupBackdropClickHandler();

    this._setupTreeListeners();
    
    const cellId = this.enterGrid(rootId, 'explicit');
    
    if (setInitialFocus && cellId) {
      this._setFocus(cellId);
    }
    
    console.log('[KNM] Initialized (setInitialFocus:', setInitialFocus, 'rootGrid:', rootId, 'initialCell:', cellId, ')');
  }
  
  // ── Event Handlers ─────────────────────────────────────────────────────────
  
  private _mapKeyToNavEvent(key: string): NavEvent | null {
    const keyMap: Record<string, NavEvent> = {
      'ArrowUp': 'nav-up',
      'w': 'nav-up',
      'W': 'nav-up',
      'ArrowDown': 'nav-down',
      's': 'nav-down',
      'S': 'nav-down',
      'ArrowLeft': 'nav-left',
      'a': 'nav-left',
      'A': 'nav-left',
      'ArrowRight': 'nav-right',
      'd': 'nav-right',
      'D': 'nav-right',
      '+': 'increment',
      '=': 'increment',
      'e': 'increment',
      'E': 'increment',
      '-': 'decrement',
      '_': 'decrement',
      'q': 'decrement',
      'Q': 'decrement',
      'Enter': 'nav-enter',
      ' ': 'nav-enter',
      'Escape': 'nav-escape',
      'r': 'nav-escape',
      'R': 'nav-escape',
      'Tab': 'nav-tab'
    };
    
    return keyMap[key] || null;
  }
  
  // ── FSM State Transitions ──────────────────────────────────────────────────
  
  private _transitionToActivated(): void {
    console.log('[KNM] Transitioning to ACTIVATED');
    this.sessionState.activationState = 'activated';
    this._clearActivationTimers();
    
    // Cancel any fade animation
    if (this.visualizer) {
      this.visualizer.cancelFade?.();
    }
    
    // Start inactivity timer
    this._startInactivityTimer();
  }
  
  private _transitionToFading(): void {
    console.log('[KNM] Transitioning to FADING');
    this.sessionState.activationState = 'fading';
    this._clearActivationTimers();
    
    // Start fade animation
    if (this.visualizer && this.visualizer.startFadeOut) {
      this.visualizer.startFadeOut(1000); // 1 second fade
    }
    
    this.sessionState.fadeTimer = setTimeout(() => {
      if (this.sessionState.activationState === 'fading') {
        this._transitionToOff();
      }
    }, 1000);
  }
  
  private _transitionToOff(): void {
    console.log('[KNM] Transitioning to OFF');
    this.sessionState.activationState = 'off';
    this.sessionState.active = false;
    this.sessionState.heldKeyDuringAwakening = null;
    this._clearActivationTimers();
    document.body.classList.remove('nav-active');
    if (this.visualizer) {
      this.visualizer.hide();
    }
  }
  
  private _clearActivationTimers(): void {
    if (this.sessionState.confirmationTimer) {
      clearTimeout(this.sessionState.confirmationTimer);
      this.sessionState.confirmationTimer = null;
    }
    if (this.sessionState.fadeTimer) {
      clearTimeout(this.sessionState.fadeTimer);
      this.sessionState.fadeTimer = null;
    }
    if (this.sessionState.inactivityTimer) {
      clearTimeout(this.sessionState.inactivityTimer);
      this.sessionState.inactivityTimer = null;
    }
  }
  
  private _startInactivityTimer(): void {
    // Clear existing timer
    if (this.sessionState.inactivityTimer) {
      clearTimeout(this.sessionState.inactivityTimer);
    }
    
    // Only start inactivity timer if activated and not in interaction mode
    if (this.sessionState.activationState === 'activated' && !this.interactingNodeId) {
      this.sessionState.inactivityTimer = setTimeout(() => {
        console.log('[KNM] Inactivity timeout (30s) - starting fade');
        this._transitionToFading();
      }, 30000);
    }
  }
  
  // ── Key Event Handlers ──────────────────────────────────────────────────────

  private _handleKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    
    // Early prevention: If we're in an overlay and this is a navigation key, prevent default immediately
    // to stop background scrolling before any other logic runs
    const isNavigationKey = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
                           key === 'w' || key === 'W' || key === 's' || key === 'S' ||
                           key === 'a' || key === 'A' || key === 'd' || key === 'D';
    if (isNavigationKey && this.isInsideOverlay()) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    // If interacting with a text input element (textarea, value-editor, code-editor), 
    // let ALL keys through except Escape (and Enter for value-editor)
    const interactingId = this.interactingNodeId;
    if (interactingId) {
      const interactingNode = this.uiTree.getNode(interactingId);
      if (interactingNode && (interactingNode.kind === 'textarea' || interactingNode.kind === 'value-editor' || interactingNode.kind === 'code-editor')) {
        const isTextarea = interactingNode.kind === 'textarea';
        const isValueEditor = interactingNode.kind === 'value-editor';
        const isCodeEditor = interactingNode.kind === 'code-editor';
        
        // Escape always exits interaction mode
        if (key === 'Escape') {
          const behavior = this._getBehavior(interactingNode);
          if (behavior?.onEscape) {
            const result = behavior.onEscape();
            if (result === 'handled') {
              event.preventDefault();
              this._exitInteractionMode();
            }
          }
          return;
        }
        
        // For value-editor, Enter also exits interaction mode (confirms the value)
        if (isValueEditor && key === 'Enter') {
          const behavior = this._getBehavior(interactingNode);
          if (behavior?.onActivate) {
            const result = behavior.onActivate();
            if (result === 'handled') {
              event.preventDefault();
              // Exit interaction mode in navigation manager
              this._exitInteractionMode();
            }
          }
          return;
        }
        
        // Let all other keys pass through to the text input
        return;
      }
    }
    
    const navEvent = this._mapKeyToNavEvent(key);
    if (!navEvent) return;
    
    // Track if nav was active before this keydown for Enter/Escape handling
    const wasActive = this.sessionState.activationState === 'activated';
    
    // ── FSM State Handling ──────────────────────────────────────────────────
    
    // If in AWAKENED or FADING, any input activates
    if (this.sessionState.activationState === 'awakened' || 
        this.sessionState.activationState === 'fading') {
      console.log('[KNM] Input during', this.sessionState.activationState, '- transitioning to ACTIVATED');
      this._transitionToActivated();
      // Fall through to process this input normally
    }
    
    // If OFF, enter AWAKENED state
    if (this.sessionState.activationState === 'off') {
      console.log('[KNM] Entering AWAKENED state on first nav event:', navEvent);
      this.sessionState.activationState = 'awakened';
      this.sessionState.active = true;
      this.sessionState.heldKeyDuringAwakening = event.key;
      document.body.classList.add('nav-active');
      
      // Show cursor immediately
      const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
      if (currentNode && this.visualizer) {
        const element = this.uiTree.getElement(this.sessionState.currentFocusId);
        if (element) {
          const isEnterable = currentNode.focusMode === 'entry-node' || currentNode.kind === 'grid';
          const isInteracting = this.sessionState.interactingNodeId === currentNode.id;
          
          this.visualizer.render({
            element,
            isEnterable,
            isInteracting
          });
        }
      }
      
      // Start hold detection timer (0.5 seconds) - if key held, activate and execute
      this.sessionState.confirmationTimer = setTimeout(() => {
        if (this.sessionState.activationState === 'awakened') {
          // Key held for 0.5s - activate and execute the held direction
          console.log('[KNM] Key held for 0.5s - activating and executing');
          this._transitionToActivated();
          // Execute the navigation action for the held key and start DAS/ARR
          if (navEvent === 'nav-up' || navEvent === 'nav-down' || navEvent === 'nav-left' || navEvent === 'nav-right') {
            this._executeNavigationAction(navEvent);
            // Start repeat for continued holding
            this.repeatManager.startRepeat(event.key, () => {
              this._executeNavigationAction(navEvent);
            });
          } else if (navEvent === 'increment' || navEvent === 'decrement') {
            this._executeIncrementAction(navEvent);
            // Start repeat for continued holding
            this.repeatManager.startRepeat(event.key, () => {
              this._executeIncrementAction(navEvent);
            });
          }
        }
      }, 500);
      
      // Start automatic fade timer (5 seconds) - if no activity, start fading
      this.sessionState.fadeTimer = setTimeout(() => {
        if (this.sessionState.activationState === 'awakened') {
          // No activity for 5s - start fading
          console.log('[KNM] No activity for 5s - starting fade');
          this._transitionToFading();
        }
      }, 5000);
      
      // Special positioning for Enter/Escape on first press
      if (navEvent === 'nav-enter' && this.isInsideOverlay()) {
        console.log('[KNM] First Enter - positioning cursor to primary button');
        const primaryButton = this._findPrimaryButton();
        if (primaryButton) {
          this._setFocus(primaryButton);
        }
      } else if (navEvent === 'nav-escape' && this.isInsideOverlay()) {
        console.log('[KNM] First Escape - positioning cursor to cancel/close button');
        // Look for cancel button first (dialogs), then close button (panels/pickers)
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          this._setFocus(cancelButton);
        } else {
          // Look for panel close button
          const panelCloseButton = this._findPanelCloseButton();
          if (panelCloseButton) {
            this._setFocus(panelCloseButton);
          } else {
            // Look for picker close button
            const pickerCloseButton = this._findPickerCloseButton();
            if (pickerCloseButton) {
              this._setFocus(pickerCloseButton);
            }
          }
        }
      }
      
      // Consume first press - only show cursor (don't execute)
      console.log('[KNM] First press consumed - only showing cursor');
      event.preventDefault();
      return;
    }
    
    // ── Normal Event Handling (ACTIVATED state) ─────────────────────────────
    // Only start DAS/ARR when in ACTIVATED state
    if (this.sessionState.activationState === 'activated') {
      // Restart inactivity timer on any input
      this._startInactivityTimer();
      
      if (navEvent === 'increment' || navEvent === 'decrement') {
        this._handleIncrement(event, navEvent);
      } else if (navEvent === 'nav-up' || navEvent === 'nav-down' || navEvent === 'nav-left' || navEvent === 'nav-right') {
        this._handleNavigation(event, navEvent);
      } else if (navEvent === 'nav-enter') {
        this._handleEnter(event, wasActive);
      } else if (navEvent === 'nav-escape') {
        this._handleEscape(event, wasActive);
      } else if (navEvent === 'nav-tab') {
        // Tab - ignore for now (browser default)
      }
    }
  }
  
  private _handleIncrement(event: KeyboardEvent, navEvent: 'increment' | 'decrement'): void {
    if (event.repeat) return;
    const interactingId = this.interactingNodeId;
    if (!interactingId) return;
    
    event.preventDefault();
    
    this._executeIncrementAction(navEvent);
    
    this.repeatManager.startRepeat(event.key, () => {
      this._executeIncrementAction(navEvent);
    });
  }
  
  private _executeIncrementAction(navEvent: 'increment' | 'decrement'): void {
    const interactingId = this.interactingNodeId;
    if (!interactingId) return;
    
    const currentNode = this.uiTree.getNode(interactingId);
    if (currentNode) {
      const behavior = this._getBehavior(currentNode);
      
      if (navEvent === 'increment' && behavior?.onIncrement) {
        const result = behavior.onIncrement();
        if (result === 'handled') {
          console.log('[KNM] Increment handled by behavior');
          return;
        }
      } else if (navEvent === 'decrement' && behavior?.onDecrement) {
        const result = behavior.onDecrement();
        if (result === 'handled') {
          console.log('[KNM] Decrement handled by behavior');
          return;
        }
      }
      
      if (behavior?.onArrowKey) {
        const mappedKey = navEvent === 'increment' ? 'ArrowUp' : 'ArrowDown';
        const result = behavior.onArrowKey(mappedKey);
        if (result === 'handled') {
          console.log('[KNM] Increment/decrement mapped to arrow, handled by behavior');
          return;
        }
      }
    }
  }
  
  private _handleNavigation(event: KeyboardEvent, navEvent: 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right'): void {
    if (event.repeat) return;
    
    // Check with behavior first before preventing default
    // If behavior returns 'ignored', we should let browser handle it (e.g., cursor movement in inputs)
    // Note: preventDefault is already called early in _handleKeyDown for overlay cases
    const result = this._executeNavigationAction(navEvent);
    
    // Only prevent default if behavior didn't ignore the event and we're not in an overlay
    // (overlay case is handled early in _handleKeyDown)
    if (!this.isInsideOverlay() && result !== 'ignored') {
      event.preventDefault();
    }
    
    if (result !== 'escape_scope' && result !== 'ignored') {
      this.repeatManager.startRepeat(event.key, () => {
        this._executeNavigationAction(navEvent);
      });
    }
  }
  
  private _executeNavigationAction(navEvent: 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right'): BehaviorResult {
    const arrowKeyMap: Record<string, string> = {
      'nav-up': 'ArrowUp',
      'nav-down': 'ArrowDown',
      'nav-left': 'ArrowLeft',
      'nav-right': 'ArrowRight'
    };
    const arrowKey = arrowKeyMap[navEvent];
    
    console.log('[KNM] === NAVIGATION:', navEvent, '===');
    console.log('[KNM] Current focus:', this.sessionState.currentFocusId);
    console.log('[KNM] Stack depth:', this.navStack.depth());
    console.log(this.navStack.toDebugString());
    
    const interactingId = this.interactingNodeId;
    if (interactingId) {
      const currentNode = this.uiTree.getNode(interactingId);
      if (currentNode) {
        const behavior = this._getBehavior(currentNode);
        if (behavior?.onArrowKey) {
          const result = behavior.onArrowKey(arrowKey);
          if (result === 'handled') {
            console.log('[KNM] Navigation handled by interacting behavior:', navEvent);
            return 'handled';
          } else if (result === 'ignored') {
            console.log('[KNM] Navigation ignored by interacting behavior (native input):', navEvent);
            return 'ignored';
          } else if (result === 'escape_scope') {
            console.log('[KNM] Navigation escape requested by behavior:', navEvent);
            const parentCellId = this.exitScope();
            if (parentCellId) {
              this._setFocus(parentCellId);
            }
            return 'escape_scope';
          }
        }
      }
    }
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    if (currentNode) {
      console.log('[KNM] Current node kind:', currentNode.kind);
      const behavior = this._getBehavior(currentNode);
      if (behavior?.onArrowKey) {
        console.log('[KNM] Calling behavior.onArrowKey');
        const result = behavior.onArrowKey(arrowKey);
        console.log('[KNM] Behavior returned:', result);
        if (result === 'escape_scope') {
          console.log('[KNM] ✓ Escape scope requested by behavior:', navEvent);
          const parentCellId = this.exitScope();
          console.log('[KNM] exitScope returned:', parentCellId);
          if (parentCellId) {
            this._setFocus(parentCellId);
          }
          return 'escape_scope';
        }
      }
    }
    
    const directionMap: Record<string, Direction> = {
      'nav-up': 'up',
      'nav-down': 'down',
      'nav-left': 'left',
      'nav-right': 'right'
    };
    
    const newCellId = this.handleArrowKey(directionMap[navEvent]);
    if (newCellId) {
      this._setFocus(newCellId);
    }
    
    return 'handled';
  }
  
  private _handleEnter(event: KeyboardEvent, wasActive: boolean): void {
    event.preventDefault();
    
    // Special behavior for AWAKENED state (first Enter after activation)
    if (this.sessionState.activationState === 'awakened') {
      console.log('[KNM] First Enter in AWAKENED - showing cursor and moving to primary');
      
      if (this.isInsideOverlay()) {
        const primaryButton = this._findPrimaryButton();
        if (primaryButton) {
          this._setFocus(primaryButton);
          // Transition to ACTIVATED for next press
          this._transitionToActivated();
          return;
        }
      }
      
      // Transition to ACTIVATED
      this._transitionToActivated();
      return;
    }
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    
    if (!currentNode) return;
    
    console.log('[KNM] Enter pressed on:', currentNode.id, 'kind:', currentNode.kind, 'focusMode:', currentNode.focusMode);
    
    const behavior = this._getBehavior(currentNode);
    console.log('[KNM] Behavior found:', !!behavior, 'has onActivate:', !!behavior?.onActivate);
    
    if (behavior?.onActivate) {
      const wasInteracting = behavior.isInteracting && behavior.isInteracting();
      const result = behavior.onActivate();
      console.log('[KNM] onActivate returned:', result);
      
      if (result === 'handled') {
        console.log('[KNM] Enter handled by behavior');
        
        const nowInteracting = behavior.isInteracting && behavior.isInteracting();
        console.log('[KNM] Behavior isInteracting:', nowInteracting);
        
        // Only enter interaction mode if we weren't already interacting
        if (nowInteracting && !wasInteracting) {
          this._enterInteractionMode(currentNode.id);
        } else if (!nowInteracting && wasInteracting) {
          // Exited interaction mode
          this._exitInteractionMode();
        }
        
        return;
      }
    }
    
    if ((currentNode.kind === 'grid' || currentNode.focusMode === 'entry-node') && 
        currentNode.focusMode !== 'leaf') {
      console.log('[KNM] Attempting to enter grid:', currentNode.id);
      const cellId = this.enterGrid(currentNode.id, currentNode.entryPolicy);
      if (cellId) {
        this._setFocus(cellId);
      } else {
        console.warn('[KNM] Failed to enter grid:', currentNode.id);
      }
    } else {
      console.log('[KNM] Not entering grid - kind:', currentNode.kind, 'focusMode:', currentNode.focusMode);
    }
  }
  
  private _handleEscape(event: KeyboardEvent, wasActive: boolean): void {
    // Ignore browser key repeat events - only process discrete key presses
    if (event.repeat) {
      console.log('[KNM] Ignoring repeated Escape key event');
      event.preventDefault();
      return;
    }
    
    event.preventDefault();
    
    // Special behavior for AWAKENED state (first Escape after activation)
    if (this.sessionState.activationState === 'awakened') {
      console.log('[KNM] First Escape in AWAKENED - showing cursor and moving to cancel/close button');
      
      if (this.isInsideOverlay()) {
        // Look for cancel button first (dialogs), then close button (panels/pickers)
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          this._setFocus(cancelButton);
          // Transition to ACTIVATED for next press
          this._transitionToActivated();
          return;
        }
        
        // Look for panel close button
        const panelCloseButton = this._findPanelCloseButton();
        if (panelCloseButton) {
          this._setFocus(panelCloseButton);
          // Transition to ACTIVATED for next press
          this._transitionToActivated();
          return;
        }
        
        // Look for picker close button
        const pickerCloseButton = this._findPickerCloseButton();
        if (pickerCloseButton) {
          this._setFocus(pickerCloseButton);
          // Transition to ACTIVATED for next press
          this._transitionToActivated();
          return;
        }
      }
      
      // Transition to ACTIVATED
      this._transitionToActivated();
      return;
    }
    
    // Check if we're in interaction mode
    const interactingId = this.interactingNodeId;
    if (interactingId) {
      const currentNode = this.uiTree.getNode(interactingId);
      if (currentNode) {
        const behavior = this._getBehavior(currentNode);
        if (behavior?.onEscape) {
          // Behavior's onEscape is auto-generated from capabilities
          // Interactive controls use 'auto' escape policy (two-level: exit interaction, then scope)
          // Non-interactive controls use 'bubble' policy (pass through to navigation)
          // Modal controls can use 'modal' policy (prevent escape)
          const result = behavior.onEscape();
          if (result === 'handled') {
            console.log('[KNM] Escape handled by behavior');
            if (behavior.isInteracting && !behavior.isInteracting()) {
              this._exitInteractionMode();
            }
            return;
          }
        }
      }
      
      this._exitInteractionMode();
      return;
    }
    
    // Check if we're in an overlay
    const overlayFrame = this.navStack.getCurrentOverlay();
    if (overlayFrame && overlayFrame.overlayId) {
      const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
      
      if (overlayNode?.closeOnEscape === false) {
        console.log('[KNM] Escape pressed - overlay does not allow escape:', overlayFrame.overlayId);
        return;
      }
      
      // FIRST: Check if we're on a close button (any kind) or cancel button
      // This check must come BEFORE the nested scope check, so that if we're on a close button
      // (even if it's in a nested grid like a button grid), we can close the overlay
      const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
      
      console.log('[KNM] ESC in overlay - checking if on close button');
      console.log('[KNM]   Current focus:', this.sessionState.currentFocusId);
      console.log('[KNM]   Current node:', {
        id: currentNode?.id,
        kind: currentNode?.kind,
        role: currentNode?.role,
        buttonRole: currentNode?.meta?.buttonRole,
        intent: currentNode?.meta?.intent
      });
      
      const isOnCloseButton = currentNode?.kind === 'picker-close-button' ||
                             currentNode?.role === 'picker-close-button' ||
                             currentNode?.role === 'panel-close-button' ||
                             currentNode?.kind === 'button' && (
                               currentNode?.meta?.buttonRole === 'danger' ||
                               currentNode?.meta?.buttonRole === 'secondary' ||
                               currentNode?.meta?.intent === 'cancel' ||
                               currentNode?.meta?.intent === 'escape'
                             );
      
      console.log('[KNM]   Is on close button?', isOnCloseButton);
      
      if (isOnCloseButton) {
        // Already on close button - close the overlay
        console.log('[KNM] On close button, closing overlay:', overlayFrame.overlayId);
        this.closeOverlay(overlayFrame.overlayId);
        return;
      }
      
      // SECOND: Check if we're in a nested scope within the overlay
      // If stack depth > overlay depth + 1, we're in a nested scope and should exit it first
      // (unless we were on a close button, which we already handled above)
      const overlayDepth = this.navStack.findFrameIndex(f => f.type === 'overlay' && f.overlayId === overlayFrame.overlayId);
      const currentDepth = this.navStack.depth();
      
      if (currentDepth > overlayDepth + 1) {
        // We're in a nested scope (e.g., inside a slider within the panel)
        // Exit the nested scope first
        console.log('[KNM] In nested scope within overlay, exiting scope first');
        const parentCellId = this.exitScope();
        if (parentCellId) {
          this._setFocus(parentCellId);
        }
        return;
      }
      
      // We're at the top level of the overlay (not on close button, not in nested scope)
      
      // THIRD: Try to find and move to a close button
      // Try cancel button first (for dialogs), then panel/picker close buttons
      console.log('[KNM] Searching for close button to move to...');
      
      let closeButton = this._findCancelButton();
      console.log('[KNM]   _findCancelButton() returned:', closeButton);
      
      if (!closeButton) {
        closeButton = this._findPanelCloseButton();
        console.log('[KNM]   _findPanelCloseButton() returned:', closeButton);
      }
      if (!closeButton) {
        // Try picker close button
        closeButton = this._findPickerCloseButton();
        console.log('[KNM]   _findPickerCloseButton() returned:', closeButton);
      }
      
      if (closeButton) {
        console.log('[KNM] Moving to close button:', closeButton);
        this._setFocus(closeButton);
        return;
      }
      
      // No close button found - just close the overlay
      console.log('[KNM] No close button found, closing overlay directly');
      this.closeOverlay(overlayFrame.overlayId);
      return;
    }
    
    // Otherwise, exit current scope
    const parentCellId = this.exitScope();
    if (parentCellId) {
      this._setFocus(parentCellId);
    }
  }
  
  private _handleKeyUp(event: KeyboardEvent): void {
    this.repeatManager.stopRepeat(event.key);
    
    // If we're in AWAKENED and the held key is released, cancel the hold detection timer
    if (this.sessionState.activationState === 'awakened' && 
        this.sessionState.heldKeyDuringAwakening === event.key) {
      console.log('[KNM] Key released during AWAKENED - canceling hold detection');
      if (this.sessionState.confirmationTimer) {
        clearTimeout(this.sessionState.confirmationTimer);
        this.sessionState.confirmationTimer = null;
      }
      this.sessionState.heldKeyDuringAwakening = null;
    }
  }
  
  private _getBehavior(node: any): any {
    if (!node) return null;
    
    if (this.behaviorCache.has(node.id)) {
      return this.behaviorCache.get(node.id);
    }
    
    const element = this.uiTree.getElement(node.id);
    const deps = {
      uiTree: this.uiTree,
      navManager: this,
      ...this.behaviorDeps
    };
    
    const behaviorType = node.role || node.kind;
    console.log('[KNM] Getting behavior for node:', node.id, 'behaviorType:', behaviorType, 'kind:', node.kind, 'role:', node.role);
    
    const behavior = this.behaviorRegistry.create(behaviorType, node, element, deps);
    
    if (behavior) {
      this.behaviorCache.set(node.id, behavior);
      console.log('[KNM] Created and cached behavior for:', node.id);
    } else {
      console.warn('[KNM] No behavior found for type:', behaviorType);
    }
    
    return behavior;
  }
  
  private _handleMouseInteraction(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    
    console.log('[KNM] Mouse click detected on:', target.tagName, target.className, target.id);
    console.log('[KNM] Current state - active:', this.sessionState.active, 'focus:', this.sessionState.currentFocusId, 'interacting:', this.interactingNodeId);
    console.log('[KNM] Stack depth:', this.navStack.depth());
    
    // Check if clicking on an interactive element (value-editor or code-editor)
    const isValueEditor = target.classList.contains('slider-num');
    const isCodeEditor = target.closest('.cm-editor, .cm-content, .cm-scroller, #stateBox-wrap');
    
    console.log('[KNM] Element type - isValueEditor:', isValueEditor, 'isCodeEditor:', !!isCodeEditor);
    
    if (isValueEditor || isCodeEditor) {
      console.log('[KNM] === INTERACTIVE ELEMENT CLICKED ===');
      
      // Find the node for this element
      let nodeId: string | null = null;
      
      if (isValueEditor) {
        console.log('[KNM] Searching for value-editor node...');
        // For value editors, find by element match
        const bindings = (this.uiTree as any)._elementBindings as Map<string, HTMLElement>;
        if (bindings) {
          console.log('[KNM] Element bindings count:', bindings.size);
          for (const [id, element] of bindings.entries()) {
            if (element === target) {
              const node = this.uiTree.getNode(id);
              console.log('[KNM] Found binding:', id, 'node kind:', node?.kind);
              if (node && node.kind === 'value-editor') {
                nodeId = id;
                console.log('[KNM] ✓ Matched value-editor node:', nodeId);
                break;
              }
            }
          }
        }
      } else if (isCodeEditor) {
        console.log('[KNM] Using stateBox node for code editor');
        nodeId = 'stateBox';
      }
      
      if (!nodeId) {
        console.warn('[KNM] ✗ Could not find node for clicked interactive element');
        return;
      }
      
      console.log('[KNM] Target node:', nodeId);
      
      // Activate keyboard nav if not active
      if (!this.sessionState.active) {
        console.log('[KNM] Activating keyboard nav');
        this.sessionState.active = true;
        document.body.classList.add('nav-active');
        console.log('[KNM] ✓ Keyboard nav activated');
      } else {
        console.log('[KNM] Keyboard nav already active');
      }
      
      // Ensure stack is initialized
      console.log('[KNM] Checking stack...');
      if (this.navStack.depth() === 0) {
        console.log('[KNM] Stack empty, entering root');
        const rootNode = this.uiTree.getRoot();
        console.log('[KNM] Root node:', rootNode?.id, rootNode?.kind);
        if (rootNode && rootNode.kind === 'grid') {
          const cellId = this.enterGrid(rootNode.id, 'first');
          console.log('[KNM] ✓ Entered root grid, cellId:', cellId);
          console.log('[KNM] Stack depth after root entry:', this.navStack.depth());
        }
      } else {
        console.log('[KNM] Stack already initialized, depth:', this.navStack.depth());
        const currentFrame = this.currentFrame;
        console.log('[KNM] Current frame:', currentFrame?.gridId, 'coords:', currentFrame?.coords);
      }
      
      // Navigate to the element
      console.log('[KNM] Calling _setFocus to navigate to:', nodeId);
      this._setFocus(nodeId);
      console.log('[KNM] ✓ _setFocus completed');
      console.log('[KNM] State after _setFocus - focus:', this.sessionState.currentFocusId);
      console.log('[KNM] Stack depth after _setFocus:', this.navStack.depth());
      console.log(this.navStack.toDebugString());
      
      // Enter interaction mode
      const node = this.uiTree.getNode(nodeId);
      console.log('[KNM] Getting node for interaction:', nodeId, 'found:', !!node);
      if (node) {
        console.log('[KNM] Node kind:', node.kind, 'parentId:', node.parentId);
        const behavior = this._getBehavior(node);
        console.log('[KNM] Behavior found:', !!behavior, 'has onActivate:', !!behavior?.onActivate);
        if (behavior?.onActivate) {
          console.log('[KNM] Calling behavior.onActivate()');
          const result = behavior.onActivate();
          console.log('[KNM] onActivate returned:', result);
          if (result === 'handled') {
            const nowInteracting = behavior.isInteracting && behavior.isInteracting();
            console.log('[KNM] behavior.isInteracting():', nowInteracting);
            if (nowInteracting) {
              console.log('[KNM] Calling _enterInteractionMode');
              this._enterInteractionMode(nodeId);
              console.log('[KNM] ✓ Entered interaction mode');
              console.log('[KNM] Final state - interacting:', this.interactingNodeId);
            }
          }
        }
      }
      
      console.log('[KNM] === INTERACTIVE ELEMENT HANDLING COMPLETE ===');
      console.log('[KNM] Final state - active:', this.sessionState.active, 'focus:', this.sessionState.currentFocusId, 'interacting:', this.interactingNodeId);
      
      return;
    }
    
    // Clicking elsewhere: deactivate keyboard nav if active (instant off, no fade)
    if (this.sessionState.active) {
      console.log('[KNM] Deactivating keyboard navigation due to mouse click elsewhere');
      
      this.repeatManager.stopAll();
      
      if (this.interactingNodeId) {
        this._exitInteractionMode();
      }
      
      // Use instant off transition (no fade for mouse clicks)
      this._transitionToOff();
      
      console.log('[KNM] ✓ Keyboard nav deactivated');
    }
  }
  
  // ── Grid Navigation ────────────────────────────────────────────────────────
  
  handleArrowKey(direction: Direction): string | null {
    const currentFrame = this.currentFrame;
    if (!currentFrame) {
      console.warn('[KNM] No active frame');
      return null;
    }
    
    const grid = this.uiTree.getNode(currentFrame.gridId);
    
    if (!grid || grid.kind !== 'grid') {
      console.error('[KNM] Current frame is not a grid:', currentFrame.gridId);
      return null;
    }
    
    let [row, col] = currentFrame.coords;
    console.log('[KNM] Arrow:', direction, 'from [', row, col, '] in', grid.id);
    
    let targetRow = row, targetCol = col;
    
    if (direction === 'up') targetRow--;
    else if (direction === 'down') targetRow++;
    else if (direction === 'left') targetCol--;
    else if (direction === 'right') targetCol++;
    
    if (grid.wrapRows) {
      if (targetRow < 0) targetRow = grid.rows - 1;
      if (targetRow >= grid.rows) targetRow = 0;
    }
    
    if (grid.wrapCols) {
      if (targetCol < 0) targetCol = grid.cols - 1;
      if (targetCol >= grid.cols) targetCol = 0;
    }
    
    if (this.uiTree.hasVisibleCellAt(grid.id, targetRow, targetCol)) {
      return this.moveToCellInScope(grid.id, targetRow, targetCol);
    } else {
      if (direction === 'down' || direction === 'up') {
        const cellsInRow = this.uiTree.getVisibleCellsInRow(grid.id, targetRow);
        if (cellsInRow.length > 0) {
          const closest = cellsInRow.reduce((best: any, cell: any) => {
            const colDist = Math.abs(cell.col - col);
            const bestDist = Math.abs(best.col - col);
            return colDist < bestDist ? cell : best;
          });
          console.log('[KNM] Found cell in irregular row:', closest.cellId, 'at [', closest.row, closest.col, ']');
          return this.moveToCellInScope(grid.id, closest.row, closest.col);
        }
      } else if (direction === 'left' || direction === 'right') {
        const cellsInCol = this.uiTree.getVisibleCellsInColumn(grid.id, targetCol);
        if (cellsInCol.length > 0) {
          const closest = cellsInCol.reduce((best: any, cell: any) => {
            const rowDist = Math.abs(cell.row - row);
            const bestDist = Math.abs(best.row - row);
            return rowDist < bestDist ? cell : best;
          });
          console.log('[KNM] Found cell in irregular column:', closest.cellId, 'at [', closest.row, closest.col, ']');
          return this.moveToCellInScope(grid.id, closest.row, closest.col);
        }
      }
      
      const escapeTarget = this.getEscapeTarget(grid, direction);
      
      if (escapeTarget) {
        console.log('[KNM] Escaping to:', escapeTarget);
        return this.exitScopeAndFocus(escapeTarget);
      } else {
        console.log('[KNM] No escape, staying at boundary');
        return null;
      }
    }
  }

  moveToCellInScope(gridId: string, row: number, col: number): string | null {
    const cell = this.uiTree.getGridCell(gridId, row, col);
    
    if (!cell || this.uiTree.isNodeHidden(cell.id)) {
      return null;
    }
    
    // Update the current frame's coordinates
    const currentFrame = this.currentFrame;
    if (currentFrame && currentFrame.gridId === gridId) {
      currentFrame.coords = [row, col];
      currentFrame.cellId = cell.id;
      this.gridMemory.set(gridId, [row, col]);
      
      console.log('[KNM] Moved to', cell.id, 'at [', row, col, ']');
      return cell.id;
    }
    
    return null;
  }

  getEscapeTarget(grid: any, direction: Direction): string | null {
    const escapeMap: Record<string, any> = {
      'up': grid.escapeUp,
      'down': grid.escapeDown,
      'left': grid.escapeLeft,
      'right': grid.escapeRight
    };
    return escapeMap[direction] || null;
  }
  
  // ── Scope Management ───────────────────────────────────────────────────────
  
  enterGrid(gridId: string, policy: string = 'remembered'): string | null {
    const grid = this.uiTree.getNode(gridId);
    
    if (!grid || grid.kind !== 'grid') {
      console.error('[KNM] Cannot enter non-grid:', gridId);
      return null;
    }
    
    console.log('[KNM] enterGrid:', gridId, 'rows:', grid.rows, 'cols:', grid.cols, 'cells:', grid.cells?.length);
    
    if (grid.hidden || grid.collapsed) {
      console.log('[KNM] Cannot enter hidden/collapsed grid');
      return null;
    }
    
    let row = 0, col = 0;
    
    if (policy === 'remembered' && this.gridMemory.has(gridId)) {
      [row, col] = this.gridMemory.get(gridId)!;
      console.log('[KNM] Using remembered position:', row, col);
    } else if (policy === 'primary') {
      const primaryChild = grid.children?.find((childId: string) => {
        const child = this.uiTree.getNode(childId);
        return child?.primary === true;
      });
      
      if (primaryChild) {
        const coords = this.uiTree.getCellCoords(gridId, primaryChild);
        if (coords) {
          [row, col] = coords;
          console.log('[KNM] Using primary child:', primaryChild, '→ [', row, col, ']');
        } else {
          const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
          if (firstVisible) {
            [row, col] = firstVisible;
          }
        }
      } else {
        const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
        if (firstVisible) {
          [row, col] = firstVisible;
        }
      }
    } else if (grid.entryCell !== undefined) {
      row = Math.floor(grid.entryCell / grid.cols);
      col = grid.entryCell % grid.cols;
      console.log('[KNM] Using entryCell:', grid.entryCell, '→ [', row, col, ']');
    } else {
      const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
      console.log('[KNM] Looking for first visible cell:', firstVisible);
      if (firstVisible) {
        [row, col] = firstVisible;
      } else {
        console.warn('[KNM] No visible cells in grid');
        return null;
      }
    }
    
    if (!this.uiTree.hasVisibleCellAt(gridId, row, col)) {
      console.log('[KNM] Cell at [', row, col, '] not visible, looking for first visible');
      const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
      if (!firstVisible) {
        console.warn('[KNM] No visible cells found');
        return null;
      }
      [row, col] = firstVisible;
    }
    
    const cell = this.uiTree.getGridCell(gridId, row, col);
    console.log('[KNM] Entering cell:', cell?.id, 'at [', row, col, ']');
    
    // Push grid frame onto stack
    this.navStack.push({
      type: 'grid',
      gridId,
      cellId: cell.id,
      coords: [row, col],
      readonly: false
    });
    
    this.gridMemory.set(gridId, [row, col]);
    
    console.log('[KNM] Entered', gridId, 'at', cell.id, '- depth:', this.navStack.depth());
    return cell.id;
  }
  
  exitScope(): string | null {
    if (this.navStack.depth() <= 1) {
      console.log('[KNM] Cannot exit root');
      return null;
    }
    
    const currentFrame = this.currentFrame;
    if (!currentFrame) return null;
    
    const currentGrid = this.uiTree.getNode(currentFrame.gridId);
    
    // Don't allow exiting from overlays via exitScope
    if (currentFrame.type === 'overlay' || currentGrid?.isOverlay) {
      console.log('[KNM] Cannot exit overlay via exitScope - use closeOverlay() or Escape');
      return null;
    }
    
    const exited = this.navStack.pop();
    if (!exited) return null;
    
    this.gridMemory.set(exited.gridId, exited.coords);
    
    const parent = this.currentFrame;
    if (!parent) return null;
    
    console.log('[KNM] Exited', exited.gridId, '-> returned to', parent.cellId);
    
    return parent.cellId;
  }

  exitScopeAndFocus(targetId: string): string | null {
    while (this.navStack.depth() > 1) {
      const frame = this.currentFrame;
      if (!frame) break;
      
      // If target is the current grid itself, pop frame first before looking for it
      if (frame.gridId === targetId) {
        console.log('[KNM] Escape target is current grid, popping frame first');
        const exited = this.navStack.pop();
        if (exited) {
          this.gridMemory.set(exited.gridId, exited.coords);
        }
        continue; // Continue to look for targetId in parent frame
      }
      
      const coords = this.uiTree.getCellCoords(frame.gridId, targetId);
      
      if (coords) {
        return this.moveToCellInScope(frame.gridId, coords[0], coords[1]);
      }
      
      const currentGrid = this.uiTree.getNode(frame.gridId);
      if (currentGrid?.isOverlay) {
        console.log('[KNM] Cannot exit overlay to reach escape target');
        return null;
      }
      
      const exited = this.navStack.pop();
      if (exited) {
        this.gridMemory.set(exited.gridId, exited.coords);
      }
    }
    
    const rootFrame = this.currentFrame;
    if (!rootFrame) return null;
    
    const coords = this.uiTree.getCellCoords(rootFrame.gridId, targetId);
    
    if (coords) {
      return this.moveToCellInScope(rootFrame.gridId, coords[0], coords[1]);
    }
    
    const targetNode = this.uiTree.getNode(targetId);
    if (targetNode && targetNode.kind === 'grid') {
      return this.enterGrid(targetId, targetNode.entryPolicy);
    }
    
    console.warn('[KNM] Could not reach target:', targetId);
    return null;
  }
  
  validateCurrentFocus(preferredTargetId: string | null = null): void {
    if (!this.sessionState.currentFocusId) return;
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    if (!currentNode || this.uiTree.isNodeHidden(this.sessionState.currentFocusId)) {
      console.log('[KNM] Current focus is hidden, finding safe location...');
      
      if (preferredTargetId) {
        const targetNode = this.uiTree.getNode(preferredTargetId);
        if (targetNode && !this.uiTree.isNodeHidden(preferredTargetId)) {
          console.log('[KNM] Returning focus to trigger:', preferredTargetId);
          
          // Try to find target in current stack
          while (this.navStack.depth() > 1) {
            const frame = this.currentFrame;
            if (!frame) break;
            
            const coords = this.uiTree.getCellCoords(frame.gridId, preferredTargetId);
            
            if (coords) {
              this.moveToCellInScope(frame.gridId, coords[0], coords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
            
            this.navStack.pop();
          }
          
          const rootFrame = this.currentFrame;
          if (rootFrame) {
            const rootCoords = this.uiTree.getCellCoords(rootFrame.gridId, preferredTargetId);
            if (rootCoords) {
              this.moveToCellInScope(rootFrame.gridId, rootCoords[0], rootCoords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
          }
        }
      }
      
      // Find any visible cell in current frame
      while (this.navStack.depth() > 1) {
        const frame = this.currentFrame;
        if (!frame) break;
        
        const visibleCells = this.uiTree.getVisibleCells(frame.gridId);
        if (visibleCells.length > 0) {
          this._setFocus(visibleCells[0].cellId);
          console.log('[KNM] Recovered focus to:', visibleCells[0].cellId);
          return;
        }
        
        console.log('[KNM] No visible cells in', frame.gridId, 'exiting...');
        this.navStack.pop();
      }
      
      const rootFrame = this.currentFrame;
      if (rootFrame) {
        const cellId = this.enterGrid(rootFrame.gridId, 'remembered');
        if (cellId) {
          this._setFocus(cellId);
          console.log('[KNM] Recovered focus to root:', cellId);
        }
      }
    }
  }
  
  // ── Overlay Management ─────────────────────────────────────────────────────
  
  isInsideOverlay(): boolean {
    return this.navStack.isInsideOverlay();
  }
  
  private _findPrimaryButton(): string | null {
    const overlayFrame = this.navStack.getCurrentOverlay();
    if (!overlayFrame?.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
    if (!overlayNode) return null;
    
    const findPrimary = (nodeId: string): string | null => {
      const node = this.uiTree.getNode(nodeId);
      if (!node) return null;
      
      if (node.kind === 'button' && node.primary === true) {
        return node.id;
      }
      
      if (node.children) {
        for (const childId of node.children) {
          const result = findPrimary(childId);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    return findPrimary(overlayFrame.overlayId);
  }

  private _findCancelButton(): string | null {
    const overlayFrame = this.navStack.getCurrentOverlay();
    if (!overlayFrame?.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
    if (!overlayNode) return null;
    
    const findCancel = (nodeId: string): string | null => {
      const node = this.uiTree.getNode(nodeId);
      if (!node) return null;
      
      if (node.kind === 'button') {
        if (node.meta?.buttonRole === 'danger' || 
            node.meta?.buttonRole === 'secondary' ||
            node.meta?.intent === 'cancel' || 
            node.meta?.intent === 'escape') {
          return node.id;
        }
      }
      
      if (node.children) {
        for (const childId of node.children) {
          const result = findCancel(childId);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    return findCancel(overlayFrame.overlayId);
  }
  
  private _findPickerCloseButton(): string | null {
    const overlayFrame = this.navStack.getCurrentOverlay();
    if (!overlayFrame?.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
    if (!overlayNode) return null;
    
    const findCloseButton = (nodeId: string): string | null => {
      const node = this.uiTree.getNode(nodeId);
      if (!node) return null;
      
      if (node.kind === 'picker-close-button') {
        return node.id;
      }
      
      if (node.children) {
        for (const childId of node.children) {
          const result = findCloseButton(childId);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    return findCloseButton(overlayFrame.overlayId);
  }

  private _findPanelCloseButton(): string | null {
    const overlayFrame = this.navStack.getCurrentOverlay();
    if (!overlayFrame?.overlayId) {
      console.log('[KNM] _findPanelCloseButton: No overlay frame');
      return null;
    }
    
    const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
    if (!overlayNode) {
      console.log('[KNM] _findPanelCloseButton: No overlay node found for:', overlayFrame.overlayId);
      return null;
    }
    
    console.log('[KNM] _findPanelCloseButton: Searching in overlay:', overlayFrame.overlayId);
    console.log('[KNM] _findPanelCloseButton: Overlay has children:', overlayNode.children);
    
    const findCloseButton = (nodeId: string): string | null => {
      const node = this.uiTree.getNode(nodeId);
      if (!node) return null;
      
      console.log('[KNM] _findPanelCloseButton: Checking node:', nodeId, 'role:', node.role, 'kind:', node.kind);
      
      if (node.role === 'panel-close-button') {
        console.log('[KNM] _findPanelCloseButton: FOUND panel close button:', nodeId);
        return node.id;
      }
      
      if (node.children) {
        for (const childId of node.children) {
          const result = findCloseButton(childId);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    const result = findCloseButton(overlayFrame.overlayId);
    console.log('[KNM] _findPanelCloseButton: Final result:', result);
    return result;
  }
  
  /**
   * Open an overlay (dialog, panel, dropdown, picker)
   */
  openOverlay(overlayId: string, triggerId: string | null = null, kind?: OverlayKind): void {
    console.log('[KNM] Opening overlay:', overlayId, 'trigger:', triggerId, 'kind:', kind);
    
    const wasActive = this.sessionState.active;
    
    // Enter the overlay grid and push as overlay frame
    const grid = this.uiTree.getNode(overlayId);
    if (!grid || grid.kind !== 'grid') {
      console.error('[KNM] Overlay is not a grid:', overlayId);
      return;
    }
    
    // Determine entry coordinates
    // 'explicit' means use entryCell or first visible (fallthrough in _resolveEntryCoords)
    // 'remembered' means use memory if available, otherwise fallthrough
    // 'primary' means find primary child
    let policy = grid.entryPolicy || 'first';
    if (policy === 'explicit') {
      policy = 'first';  // explicit just means use default behavior (entryCell or first visible)
    }
    const [row, col] = this._resolveEntryCoords(overlayId, policy);
    const cell = this.uiTree.getGridCell(overlayId, row, col);
    if (!cell) {
      console.error('[KNM] No cell found in overlay:', overlayId);
      return;
    }
    
    // Push overlay frame onto stack
    this.navStack.push({
      type: 'overlay',
      gridId: overlayId,
      cellId: cell.id,
      coords: [row, col],
      overlayId,
      triggerId,
      overlayKind: kind,
      readonly: true  // Can only close via closeOverlay()
    });
    
    this.gridMemory.set(overlayId, [row, col]);
    
    // Only set focus if keyboard nav was already active
    // Don't activate keyboard nav just because overlay opened
    if (wasActive) {
      this._setFocus(cell.id);
      console.log('[KNM] Overlay opened while nav active - maintaining active state');
      this.sessionState.active = true;
      // Keep current activation state (don't reset to off)
      document.body.classList.add('nav-active');
    } else {
      // Just update internal state without showing visualizer
      this.sessionState.currentFocusId = cell.id;
      console.log('[KNM] Overlay opened while nav inactive - focus set but visualizer hidden');
    }
  }
  
  /**
   * Backward compatibility - same as openOverlay
   */
  openOverlayById(overlayId: string, triggerId: string | null = null): void {
    this.openOverlay(overlayId, triggerId);
  }

  closeOverlay(overlayId: string): void {
    console.log('[KNM] Closing overlay:', overlayId);

    // Find the overlay frame in the stack
    const overlayFrameIndex = this.navStack.findFrameIndex(
      f => f.type === 'overlay' && f.overlayId === overlayId
    );

    if (overlayFrameIndex === -1) {
      console.warn('[KNM] Attempted to close overlay not in stack:', overlayId);
      return;
    }

    // Get the trigger ID before we pop the frame
    const overlayFrame = this.navStack.peekAt(overlayFrameIndex);
    const triggerId = overlayFrame?.triggerId;

    // Emit before-close event
    if (this.uiTree?._events) {
      console.log('[KNM] Emitting overlay:before-close event for:', overlayId);
      this.uiTree._events.emit('overlay:before-close', {
        id: overlayId,
        triggerId: triggerId || null
      });
    }

    // Pop all frames above and including the overlay
    const poppedFrames: NavigationFrame[] = [];
    while (this.navStack.depth() > overlayFrameIndex) {
      const frame = this.navStack.pop();
      if (frame) {
        poppedFrames.push(frame);
        // Hide overlay when we pop its frame
        if (frame.overlayId) {
          this.stackRenderer.hideOverlay(frame.overlayId);
        }
      }
    }

    // Restore focus to the trigger button if available
    const currentFrame = this.currentFrame;
    if (triggerId) {
      console.log('[KNM] Restoring focus to trigger button:', triggerId);
      this._setFocus(triggerId);
    } else if (currentFrame) {
      console.log('[KNM] No trigger found, restoring to current frame:', currentFrame.cellId);
      this._setFocus(currentFrame.cellId);
    }

    console.log('[KNM] Closed overlay:', overlayId, '- restored focus to:', triggerId || currentFrame?.cellId);
  }

  completeOverlayClose(overlayId: string): void {
    console.log('[KNM] completeOverlayClose called for:', overlayId);
    // This is now a no-op since closing is handled immediately in closeOverlay()
    // Kept for backward compatibility
  }
  
  /**
   * Helper to resolve entry coordinates for a grid
   */
  private _resolveEntryCoords(gridId: string, policy: string): [number, number] {
    const grid = this.uiTree.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return [0, 0];
    }
    
    if (policy === 'remembered' && this.gridMemory.has(gridId)) {
      return this.gridMemory.get(gridId)!;
    }
    
    if (policy === 'primary') {
      const primaryChild = grid.children?.find((childId: string) => {
        const child = this.uiTree.getNode(childId);
        return child?.primary === true;
      });
      
      if (primaryChild) {
        const coords = this.uiTree.getCellCoords(gridId, primaryChild);
        if (coords) {
          return coords;
        }
      }
    }
    
    if (grid.entryCell !== undefined) {
      const row = Math.floor(grid.entryCell / grid.cols);
      const col = grid.entryCell % grid.cols;
      return [row, col];
    }
    
    const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
    return firstVisible || [0, 0];
  }
  
  // ── Focus Management ───────────────────────────────────────────────────────
  
  private _ensureNavigationPath(gridId: string): void {
    const grid = this.uiTree.getNode(gridId);
    if (!grid || grid.kind !== 'grid') return;

    // Find which grid contains this grid as a cell (navigation parent, not semantic parent)
    const containingGridId = this.uiTree.getContainingGrid(gridId);
    if (containingGridId) {
      const currentFrame = this.currentFrame;
      if (!currentFrame || currentFrame.gridId !== containingGridId) {
        // Recursively ensure the containing grid's path is built first
        this._ensureNavigationPath(containingGridId);

        // Enter the containing grid and navigate to this grid as a cell
        const coords = this.uiTree.getCellCoords(containingGridId, gridId);
        if (coords) {
          this.enterGrid(containingGridId, 'first');
          const frame = this.currentFrame;
          if (frame) {
            frame.coords = coords;
            frame.cellId = gridId;
          }
        }
      }
    }
  }

  private _setFocus(nodeId: string): void {
    if (!nodeId) return;

    const node = this.uiTree.getNode(nodeId);
    if (!node) {
      console.warn('[KNM] Node not found:', nodeId);
      return;
    }

    console.log('[KNM] Focus:', nodeId, 'kind:', node.kind);

    const element = this.uiTree.getElement(nodeId);

    if (node.kind === 'grid' && !element &&
        node.focusMode !== 'leaf' &&
        node.children && node.children.length > 0) {
      console.log('[KNM] Auto-entering transparent grid:', nodeId);
      const enteredCell = this.enterGrid(nodeId, node.entryPolicy || 'first');
      if (enteredCell) {
        this._setFocus(enteredCell);
        return;
      }
    }

    // Build the full navigation path from root to this node
    // Use getContainingGrid instead of parentId to find the actual navigation parent
    if (node.focusMode === 'leaf' || node.kind !== 'grid') {
      const containingGridId = this.uiTree.getContainingGrid(nodeId);
      if (containingGridId) {
        const currentFrame = this.currentFrame;
        if (!currentFrame || currentFrame.gridId !== containingGridId) {
          console.log('[KNM] Not in containing grid frame, entering:', containingGridId);
          
          // Recursively ensure all ancestor grids are entered first
          this._ensureNavigationPath(containingGridId);
          
          // Now enter the immediate containing grid with this cell
          const coords = this.uiTree.getCellCoords(containingGridId, nodeId);
          if (coords) {
            this.enterGrid(containingGridId, 'first');
            const frame = this.currentFrame;
            if (frame) {
              frame.coords = coords;
              frame.cellId = nodeId;
              console.log('[KNM] Set frame coordinates to [', coords[0], coords[1], '] for cell:', nodeId);
            }
          }
        }
      }
    }

    this.sessionState.currentFocusId = nodeId;

    if (!element) {
      if (node.kind !== 'grid') {
        console.warn('[KNM] No element for:', nodeId);
      }
      return;
    }
    
    const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
    if (this.effects && !isInput) {
      this.effects.applyFocus(element);
    } else if (isInput && this.effects) {
      this.effects.removeFocus(element);
    }
    
    if (this.sessionState.active && this.visualizer) {
      const isEnterable = node.focusMode === 'entry-node' || node.kind === 'grid';
      const isInteracting = this.isInteracting;
      
      this.visualizer.render({
        element,
        isEnterable,
        isInteracting
      });
    }
  }
  
  private _enterInteractionMode(nodeId: string): void {
    const currentFrame = this.currentFrame;
    if (!currentFrame) {
      console.warn('[KNM] Cannot enter interaction mode - no current frame');
      return;
    }
    
    console.log('[KNM] Entering interaction mode:', nodeId);
    
    // Clear inactivity timer when entering interaction mode
    if (this.sessionState.inactivityTimer) {
      clearTimeout(this.sessionState.inactivityTimer);
      this.sessionState.inactivityTimer = null;
    }
    
    // Push interaction frame onto stack
    this.navStack.push({
      type: 'interaction',
      gridId: currentFrame.gridId,
      cellId: nodeId,
      coords: currentFrame.coords,
      interactingNodeId: nodeId,
      readonly: false
    });
  }
  
  private _exitInteractionMode(): void {
    console.log('[KNM] Exiting interaction mode');
    
    this.repeatManager.stopAll();
    
    const interactingId = this.interactingNodeId;
    if (interactingId) {
      const node = this.uiTree.getNode(interactingId);
      if (node) {
        const behavior = this._getBehavior(node);
        if (behavior?.onEscape) {
          console.log('[KNM] Notifying behavior to exit interaction mode');
          behavior.onEscape();
        }
      }
    }
    
    // Pop interaction frame from stack
    const frame = this.currentFrame;
    if (frame?.type === 'interaction') {
      this.navStack.pop();
      
      // Don't call _setFocus - the parent frame already has the correct cellId
      // Just update the visualizer for the current state
      const parentFrame = this.currentFrame;
      if (parentFrame && this.visualizer && this.sessionState.active) {
        const cellNode = this.uiTree.getNode(parentFrame.cellId);
        const element = this.uiTree.getElement(parentFrame.cellId);
        
        if (cellNode && element) {
          const isEnterable = cellNode.focusMode === 'entry-node' || cellNode.kind === 'grid';
          
          this.visualizer.render({
            element,
            isEnterable,
            isInteracting: false
          });
        }
      }
      
      // Update session state to reflect we're no longer interacting
      this.sessionState.currentFocusId = parentFrame?.cellId || this.sessionState.currentFocusId;
      
      // Restart inactivity timer now that we're out of interaction mode
      this._startInactivityTimer();
    }
  }
  
  // ── UITree Event Listeners ─────────────────────────────────────────────────
  
  /**
   * Set up backdrop click handler for all overlays (panels, pickers, dialogs)
   * Closes overlay when clicking on backdrop if closeOnEscape is enabled
   */
  private _setupBackdropClickHandler(): void {
    document.addEventListener('click', (e: MouseEvent) => {
      // Get current overlay if any
      const overlayFrame = this.navStack.getCurrentOverlay();
      if (!overlayFrame) return;
      
      const overlayNode = this.uiTree.getNode(overlayFrame.overlayId);
      if (!overlayNode) return;
      
      // Check if overlay allows closing (respects closeOnEscape setting)
      if (overlayNode.closeOnEscape === false) return;
      
      // Get the overlay element
      const overlayElement = this.uiTree.getElement(overlayFrame.overlayId);
      if (!overlayElement) return;
      
      // Check if click was on the backdrop (overlay element itself, not its children)
      if (e.target === overlayElement) {
        console.log('[KNM] Backdrop click detected, closing overlay:', overlayFrame.overlayId);
        this.closeOverlay(overlayFrame.overlayId);
      }
    });
  }

  private _setupTreeListeners(): void {
    if (!this.uiTree?._events) {
      console.warn('[KNM] UITree events not available');
      return;
    }
    
    this.uiTree._events.on('node:updated', (event: any) => {
      console.log('[KNM] Node updated:', event.id);
    });
    
    this.uiTree._events.on('nodes:added', (event: any) => {
      console.log('[KNM] Nodes added:', event.ids);
    });
    
    this.uiTree._events.on('node:removed', (event: any) => {
      const { id, parentId } = event;
      
      if (this.sessionState.currentFocusId === id && parentId) {
        this._setFocus(parentId);
      }
      
      console.log('[KNM] Node removed:', id);
    });
    
    this.uiTree._events.on('subtree:removed', (event: any) => {
      const { rootId, removedIds } = event;
      
      if (removedIds.includes(this.sessionState.currentFocusId)) {
        const ancestorId = this.uiTree.getNearestAncestor(rootId);
        if (ancestorId) {
          this._setFocus(ancestorId);
        }
      }
      
      console.log('[KNM] Subtree removed:', rootId, removedIds.length, 'nodes');
    });
    
    this.uiTree._events.on('overlay:registered', (event: any) => {
      const { id, triggerId } = event;
      console.log('[KNM] Overlay registered:', id, 'trigger:', triggerId);
      this.openOverlayById(id, triggerId);
    });
    
    this.uiTree._events.on('overlay:removed', (event: any) => {
      const { id } = event;
      console.log('[KNM] Overlay removed:', id);
      // Only close if it's still in the stack
      // (it may have already been closed via closeOverlay)
      const overlayFrame = this.navStack.findFrame(f => f.type === 'overlay' && f.overlayId === id);
      if (overlayFrame) {
        this.closeOverlay(id);
      } else {
        console.log('[KNM] Overlay already closed, skipping closeOverlay');
      }
    });
  }
  
  // ── Cleanup ────────────────────────────────────────────────────────────────
  
  destroy(): void {
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
    }
    if (this._boundKeyUpHandler) {
      document.removeEventListener('keyup', this._boundKeyUpHandler);
    }
    if (this._boundMouseHandler) {
      document.removeEventListener('pointerdown', this._boundMouseHandler, true);
    }
    
    if (this.uiTree?._events) {
      this.uiTree._events.off('node:updated');
      this.uiTree._events.off('nodes:added');
      this.uiTree._events.off('node:removed');
      this.uiTree._events.off('subtree:removed');
      this.uiTree._events.off('overlay:registered');
      this.uiTree._events.off('overlay:removed');
    }
    
    if (this.repeatManager) {
      this.repeatManager.destroy();
    }
    
    // Clear navigation stack
    this.navStack.clear();
    
    this.gridMemory.clear();
    
    console.log('[KNM] Destroyed');
  }
}

console.log('[KNM] Grid-based KeyboardNavigationManager loaded');
