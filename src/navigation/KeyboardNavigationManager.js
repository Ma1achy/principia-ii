/**
 * KeyboardNavigationManager - Grid-based keyboard navigation
 * Single unified manager for all keyboard navigation using coordinate arithmetic
 */

import { KeyRepeatManager } from './KeyRepeatManager.js';

export class KeyboardNavigationManager {
  constructor(options = {}) {
    const { effects, visualizer, uiTree, behaviorRegistry, behaviorDeps = {} } = options;
    
    this.effects = effects;
    this.visualizer = visualizer;
    this.uiTree = uiTree;
    this.behaviorRegistry = behaviorRegistry;
    this.behaviorDeps = behaviorDeps; // Store behavior dependencies
    
    // Behavior cache (nodeId -> behavior instance)
    // Behaviors are stateful, so we need to reuse the same instance
    this.behaviorCache = new Map();
    
    // Key repeat manager (DAS/ARR for keyboard navigation)
    this.repeatManager = new KeyRepeatManager();
    
    // Navigation context system - stack of stacks for overlay isolation
    // Each context represents an isolated navigation scope (main UI or an overlay)
    this.currentContext = {
      scopeStack: [],      // Grid scopes within this context
      parentContext: null, // Link to parent context (null for root)
      overlayId: null,     // ID of overlay grid (null for root context)
      triggerId: null      // ID of element that opened this overlay
    };
    
    // Grid memory (remembers last position in each grid)
    this.gridMemory = new Map();
    
    // Session state
    this.sessionState = {
      active: false, // Lazy activation on first nav key
      currentFocusId: null,
      interactingNodeId: null
    };
    
    // Bound handlers
    this._boundKeyHandler = null;
    this._boundKeyUpHandler = null;
    this._boundMouseHandler = null;
    
    console.log('[KNM] Initialized with context-isolated navigation');
  }
  
  // ── Initialization ─────────────────────────────────────────────────────────
  
  /**
   * Initialize navigation at root
   * @param {string} rootId - Root grid ID (default 'root')
   * @param {Object} options - {setInitialFocus: boolean}
   */
  init(rootId = 'root', options = {}) {
    const { setInitialFocus = false } = options;
    
    // Attach keyboard listeners
    this._boundKeyHandler = this._handleKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);
    
    this._boundKeyUpHandler = this._handleKeyUp.bind(this);
    document.addEventListener('keyup', this._boundKeyUpHandler);
    
    // Attach mouse interaction handler
    this._boundMouseHandler = this._handleMouseInteraction.bind(this);
    document.addEventListener('pointerdown', this._boundMouseHandler, true);
    
    // Setup UITree event listeners for reactive updates
    this._setupTreeListeners();
    
    // Always enter the root grid to set up scope stack
    const cellId = this.enterGrid(rootId, 'explicit');
    
    // Optionally set focus on the initial cell
    if (setInitialFocus && cellId) {
      this._setFocus(cellId);
    }
    
    console.log('[KNM] Initialized (setInitialFocus:', setInitialFocus, 'rootGrid:', rootId, 'initialCell:', cellId, ')');
  }
  
  // ── Event Handlers ─────────────────────────────────────────────────────────
  
  /**
   * Map physical keys to navigation events
   * @param {string} key - Physical key from event
   * @returns {string|null} Navigation event type or null
   */
  _mapKeyToNavEvent(key) {
    const keyMap = {
      // Navigation - Up
      'ArrowUp': 'nav-up',
      'w': 'nav-up',
      'W': 'nav-up',
      
      // Navigation - Down
      'ArrowDown': 'nav-down',
      's': 'nav-down',
      'S': 'nav-down',
      
      // Navigation - Left
      'ArrowLeft': 'nav-left',
      'a': 'nav-left',
      'A': 'nav-left',
      
      // Navigation - Right
      'ArrowRight': 'nav-right',
      'd': 'nav-right',
      'D': 'nav-right',
      
      // Increment
      '+': 'increment',
      '=': 'increment',
      'e': 'increment',
      'E': 'increment',
      
      // Decrement
      '-': 'decrement',
      '_': 'decrement',
      'q': 'decrement',
      'Q': 'decrement',
      
      // Enter/Activate
      'Enter': 'nav-enter',
      ' ': 'nav-enter',
      
      // Escape/Back
      'Escape': 'nav-escape',
      'r': 'nav-escape',
      'R': 'nav-escape',
      
      // Tab (unchanged for now)
      'Tab': 'nav-tab'
    };
    
    return keyMap[key] || null;
  }
  
  /**
   * Handle keyboard events
   * @param {KeyboardEvent} event
   */
  _handleKeyDown(event) {
    const { key } = event;
    
    // Map key to navigation event
    const navEvent = this._mapKeyToNavEvent(key);
    if (!navEvent) return; // Ignore unmapped keys
    
    // Track if we're activating on this keypress
    const wasActive = this.sessionState.active;
    
    // Lazy activation: activate on ANY navigation event (even if it fails)
    if (!this.sessionState.active) {
      console.log('[KNM] Activating navigation on first nav event:', navEvent);
      this.sessionState.active = true;
      this.sessionState.justActivated = true; // Flag for special first-press behavior
      document.body.classList.add('nav-active');
      
      // Show cursor at current focus location
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
      
      // IMPORTANT: Don't process this keypress - just show the cursor
      // Special handling for Enter/Escape happens in their handlers via wasActive check
      if (navEvent === 'nav-enter' || navEvent === 'nav-escape') {
        // Let these through so they can move to primary/cancel button
        // but their handlers will check wasActive and not activate
        // Note: handlers will clear justActivated flag after moving cursor
      } else {
        // For all other keys (arrows, +/-, etc), consume this first press
        console.log('[KNM] First press consumed - only showing cursor');
        this.sessionState.justActivated = false;
        event.preventDefault();
        return;
      }
    }
    
    // Clear justActivated flag at the start of any subsequent keypress
    // (unless we just set it above in activation block)
    if (wasActive && this.sessionState.justActivated) {
      console.log('[KNM] Clearing justActivated flag from previous activation');
      this.sessionState.justActivated = false;
    }
    
    // Route to appropriate handler based on nav event type
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
  
  /**
   * Handle increment/decrement events (+/-/q/e)
   * @param {KeyboardEvent} event
   * @param {string} navEvent - 'increment' or 'decrement'
   */
  _handleIncrement(event, navEvent) {
    // Ignore browser's native key repeat
    if (event.repeat) return;
    
    if (!this.sessionState.interactingNodeId) return;
    
    event.preventDefault();
    
    // Execute action immediately on first press
    this._executeIncrementAction(navEvent);
    
    // Start repeat with appropriate profile
    const profile = this._getRepeatProfile();
    this.repeatManager.startRepeat(event.key, () => {
      this._executeIncrementAction(navEvent);
    }, profile);
  }
  
  /**
   * Execute increment/decrement action (extracted for repeat support)
   * @private
   * @param {string} navEvent - 'increment' or 'decrement'
   */
  _executeIncrementAction(navEvent) {
    if (!this.sessionState.interactingNodeId) return;
    
    const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
    if (currentNode) {
      const behavior = this._getBehavior(currentNode);
      
      // First try dedicated increment/decrement handlers
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
      
      // Fallback: Map increment/decrement to arrow directions for analog controls
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
  
  /**
   * Handle navigation events (arrows/wasd)
   * @param {KeyboardEvent} event
   * @param {string} navEvent - 'nav-up', 'nav-down', 'nav-left', 'nav-right'
   */
  _handleNavigation(event, navEvent) {
    // Ignore browser's native key repeat
    if (event.repeat) return;
    
    event.preventDefault();
    
    // Execute action immediately on first press
    const result = this._executeNavigationAction(navEvent);
    
    // Only start repeat for actions that actually did something
    // (ignore non-repeatable results like 'escape_scope' or 'ignored')
    if (result !== 'escape_scope' && result !== 'ignored') {
      const profile = this._getRepeatProfile();
      this.repeatManager.startRepeat(event.key, () => {
        this._executeNavigationAction(navEvent);
      }, profile);
    }
  }
  
  /**
   * Execute navigation action (extracted for repeat support)
   * @private
   * @param {string} navEvent - 'nav-up', 'nav-down', 'nav-left', 'nav-right'
   * @returns {string} Result indicator ('handled', 'ignored', 'escape_scope', or undefined)
   */
  _executeNavigationAction(navEvent) {
    // Map nav event to arrow key for behavior compatibility
    const arrowKeyMap = {
      'nav-up': 'ArrowUp',
      'nav-down': 'ArrowDown',
      'nav-left': 'ArrowLeft',
      'nav-right': 'ArrowRight'
    };
    const arrowKey = arrowKeyMap[navEvent];
    
    // Check if in interaction mode - let behavior handle it
    if (this.sessionState.interactingNodeId) {
      const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
      if (currentNode) {
        const behavior = this._getBehavior(currentNode);
        if (behavior?.onArrowKey) {
          const result = behavior.onArrowKey(arrowKey);
          if (result === 'handled') {
            console.log('[KNM] Navigation handled by interacting behavior:', navEvent);
            return 'handled';
          } else if (result === 'ignored') {
            // Behavior says "ignore" - let native input handle, don't navigate
            console.log('[KNM] Navigation ignored by interacting behavior (native input):', navEvent);
            return 'ignored';
          } else if (result === 'escape_scope') {
            // Behavior requests escape to parent scope
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
    
    // NOT in interaction mode - check if behavior wants to escape
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    if (currentNode) {
      const behavior = this._getBehavior(currentNode);
      if (behavior?.onArrowKey) {
        const result = behavior.onArrowKey(arrowKey);
        if (result === 'escape_scope') {
          console.log('[KNM] Escape scope requested by behavior:', navEvent);
          const parentCellId = this.exitScope();
          if (parentCellId) {
            this._setFocus(parentCellId);
          }
          return 'escape_scope';
        }
      }
    }
    
    // Map nav event to direction
    const directionMap = {
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
  
  /**
   * Handle enter/activate events (Enter/Space)
   * @param {KeyboardEvent} event
   * @param {boolean} wasActive - Whether nav was active before this keypress
   */
  _handleEnter(event, wasActive) {
    event.preventDefault();
    
    // If we just activated (cursor was hidden), show cursor and move to primary button
    if (!wasActive) {
      console.log('[KNM] First Enter - showing cursor and moving to primary');
      
      // If we're in an overlay (dialog), move to primary button
      if (this.isInsideOverlay()) {
        const primaryButton = this._findPrimaryButton();
        if (primaryButton) {
          this._setFocus(primaryButton);
          return;
        }
      }
      
      // Otherwise, just show the cursor at current location (already done in _handleKeyDown)
      return;
    }
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    
    if (!currentNode) return;
    
    console.log('[KNM] Enter pressed on:', currentNode.id, 'kind:', currentNode.kind, 'focusMode:', currentNode.focusMode);
    
    // Get behavior from cache (stateful)
    const behavior = this._getBehavior(currentNode);
    console.log('[KNM] Behavior found:', !!behavior, 'has onActivate:', !!behavior?.onActivate);
    
    if (behavior?.onActivate) {
      const result = behavior.onActivate();
      console.log('[KNM] onActivate returned:', result);
      
      if (result === 'handled') {
        console.log('[KNM] Enter handled by behavior');
        
        // Check if behavior toggled interaction mode
        const nowInteracting = behavior.isInteracting && behavior.isInteracting();
        console.log('[KNM] Behavior isInteracting:', nowInteracting);
        
        if (nowInteracting) {
          this._enterInteractionMode(currentNode.id);
        } else if (this.sessionState.interactingNodeId === currentNode.id) {
          this._exitInteractionMode();
        }
        
        return;
      }
    }
    
    // Try to enter if it's a grid (but not if it's a leaf or has no cells)
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
  
  /**
   * Handle escape/back events (Escape/R)
   * @param {KeyboardEvent} event
   * @param {boolean} wasActive - Whether nav was active before this keypress
   */
  _handleEscape(event, wasActive) {
    event.preventDefault();
    
    // If we just activated (cursor was hidden), show cursor and move to cancel button
    if (!wasActive) {
      console.log('[KNM] First Escape - showing cursor and moving to cancel button');
      
      // If we're in an overlay (dialog), move to cancel/escape button
      if (this.isInsideOverlay()) {
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          this._setFocus(cancelButton);
          return;
        }
      }
      
      // Otherwise, just show the cursor at current location (already done in _handleKeyDown)
      return;
    }
    
    // Check if we're in an overlay - need to handle two-stage escape
    if (this.isInsideOverlay()) {
      const overlayId = this.currentContext.overlayId;
      const overlayNode = this.uiTree.getNode(overlayId);
      
      // Check if overlay allows escape
      if (overlayNode?.closeOnEscape === false) {
        console.log('[KNM] Escape pressed - overlay does not allow escape:', overlayId);
        return;
      }
      
      // Two-stage escape: if not on cancel button, move to it first
      const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
      const isOnCancelButton = currentNode?.kind === 'button' && 
                               (currentNode.meta?.buttonRole === 'danger' ||
                                currentNode.meta?.buttonRole === 'secondary' ||
                                currentNode.meta?.intent === 'cancel' ||
                                currentNode.meta?.intent === 'escape');
      
      if (!isOnCancelButton) {
        // Stage 1: Move to cancel button (if one exists)
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          console.log('[KNM] Escape stage 1 - moving to cancel button');
          this._setFocus(cancelButton);
          return;
        }
        // No cancel button found - proceed to close
      }
      
      // Stage 2: We're on cancel button (or no cancel button exists) - close overlay
      console.log('[KNM] Escape stage 2 - closing overlay:', overlayId);
      this.closeOverlay(overlayId);
      return;
    }
    
    // Check for interaction mode - let behavior handle first
    if (this.sessionState.interactingNodeId) {
      const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
      if (currentNode) {
        const behavior = this._getBehavior(currentNode);
        if (behavior?.onEscape) {
          const result = behavior.onEscape();
          if (result === 'handled') {
            console.log('[KNM] Escape handled by behavior');
            // Check if behavior exited interaction mode
            if (behavior.isInteracting && !behavior.isInteracting()) {
              this._exitInteractionMode();
            }
            return;
          }
        }
      }
      
      // Fallback: exit interaction mode
      this._exitInteractionMode();
      return;
    }
    
    // Try to exit current scope
    const parentCellId = this.exitScope();
    if (parentCellId) {
      this._setFocus(parentCellId);
    }
  }
  
  /**
   * Handle key release events
   * @param {KeyboardEvent} event
   */
  _handleKeyUp(event) {
    const { key } = event;
    
    // Stop repeat for this key
    this.repeatManager.stopRepeat(key);
  }
  
  /**
   * Get repeat profile based on current interaction context
   * @returns {string} Profile name ('canvas', 'slider', 'navigation')
   */
  _getRepeatProfile() {
    // If not interacting with anything, use fast navigation profile
    if (!this.sessionState.interactingNodeId) {
      return 'navigation';
    }
    
    const node = this.uiTree.getNode(this.sessionState.interactingNodeId);
    if (!node) {
      return 'navigation';
    }
    
    // Canvas interactions use slow profile for precision
    if (node.kind === 'canvas' || node.role === 'canvas') {
      return 'canvas';
    }
    
    // Slider/analog controls use medium profile
    if (node.kind === 'analog-control' || node.role === 'slider') {
      return 'slider';
    }
    
    // Default to navigation profile
    return 'navigation';
  }
  
  /**
   * Get or create a cached behavior instance for a node
   * Behaviors are stateful, so we reuse the same instance
   * @param {Object} node - Navigation node
   * @returns {Object|null} Behavior instance or null
   */
  _getBehavior(node) {
    if (!node) return null;
    
    // Check cache first
    if (this.behaviorCache.has(node.id)) {
      return this.behaviorCache.get(node.id);
    }
    
    // Create new behavior instance with deps
    const element = this.uiTree.getElement(node.id);
    const deps = {
      uiTree: this.uiTree,
      navManager: this,
      ...this.behaviorDeps // Include canvas action dispatcher and other deps
    };
    
    // Try role first (more specific), then fall back to kind
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
  
  /**
   * Handle mouse interactions - deactivate keyboard nav
   * @param {PointerEvent} event
   */
  _handleMouseInteraction(event) {
    if (this.sessionState.active) {
      console.log('[KNM] Deactivating keyboard navigation due to mouse click');
      
      // Stop all key repeats
      this.repeatManager.stopAll();
      
      // Exit interaction mode if active
      if (this.sessionState.interactingNodeId) {
        this._exitInteractionMode();
      }
      
      this.sessionState.active = false;
      document.body.classList.remove('nav-active');
      if (this.visualizer) {
        this.visualizer.hide();
      }
    }
  }
  
  // ── Grid Navigation ────────────────────────────────────────────────────────
  
  /**
   * Handle arrow key navigation
   * @param {string} direction - 'up', 'down', 'left', 'right'
   * @returns {string|null} New cell ID or null
   */
  handleArrowKey(direction) {
    if (this.currentContext.scopeStack.length === 0) {
      console.warn('[KNM] No active scope');
      return null;
    }
    
    const scope = this.getCurrentScope();
    const grid = this.uiTree.getNode(scope.gridId);
    
    if (!grid || grid.kind !== 'grid') {
      console.error('[KNM] Current scope is not a grid:', scope.gridId);
      return null;
    }
    
    let [row, col] = scope.coords;
    console.log('[KNM] Arrow:', direction, 'from [', row, col, '] in', grid.id);
    
    // Calculate target coordinates
    let targetRow = row, targetCol = col;
    
    if (direction === 'up') targetRow--;
    else if (direction === 'down') targetRow++;
    else if (direction === 'left') targetCol--;
    else if (direction === 'right') targetCol++;
    
    // Check for wrapping
    if (grid.wrapRows) {
      if (targetRow < 0) targetRow = grid.rows - 1;
      if (targetRow >= grid.rows) targetRow = 0;
    }
    
    if (grid.wrapCols) {
      if (targetCol < 0) targetCol = grid.cols - 1;
      if (targetCol >= grid.cols) targetCol = 0;
    }
    
    // Try to find visible cell at target
    if (this.uiTree.hasVisibleCellAt(grid.id, targetRow, targetCol)) {
      // Move to cell
      return this.moveToCellInScope(grid.id, targetRow, targetCol);
    } else {
      // Target doesn't exist - try to find any cell in the target row/col for irregular grids
      if (direction === 'down' || direction === 'up') {
        // Vertical movement - search for any cell in target row
        const cellsInRow = this.uiTree.getVisibleCellsInRow(grid.id, targetRow);
        if (cellsInRow.length > 0) {
          // Find closest cell to current column
          const closest = cellsInRow.reduce((best, cell) => {
            const colDist = Math.abs(cell.col - col);
            const bestDist = Math.abs(best.col - col);
            return colDist < bestDist ? cell : best;
          });
          console.log('[KNM] Found cell in irregular row:', closest.cellId, 'at [', closest.row, closest.col, ']');
          return this.moveToCellInScope(grid.id, closest.row, closest.col);
        }
      } else if (direction === 'left' || direction === 'right') {
        // Horizontal movement - search for any cell in target column
        const cellsInCol = this.uiTree.getVisibleCellsInColumn(grid.id, targetCol);
        if (cellsInCol.length > 0) {
          // Find closest cell to current row
          const closest = cellsInCol.reduce((best, cell) => {
            const rowDist = Math.abs(cell.row - row);
            const bestDist = Math.abs(best.row - row);
            return rowDist < bestDist ? cell : best;
          });
          console.log('[KNM] Found cell in irregular column:', closest.cellId, 'at [', closest.row, closest.col, ']');
          return this.moveToCellInScope(grid.id, closest.row, closest.col);
        }
      }
      
      // No cell found - check escape
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
  
  /**
   * Move to cell within current scope
   * @param {string} gridId - Grid ID
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {string|null} Cell ID
   */
  moveToCellInScope(gridId, row, col) {
    const cell = this.uiTree.getGridCell(gridId, row, col);
    
    if (!cell || this.uiTree.isNodeHidden(cell.id)) {
      return null;
    }
    
    // Update scope
    const scope = this.getCurrentScope();
    if (scope && scope.gridId === gridId) {
      scope.coords = [row, col];
      scope.cellId = cell.id;
      this.gridMemory.set(gridId, [row, col]);
      
      console.log('[KNM] Moved to', cell.id, 'at [', row, col, ']');
      return cell.id;
    }
    
    return null;
  }
  
  /**
   * Get escape target for direction
   * @param {Object} grid - Grid node
   * @param {string} direction - Direction
   * @returns {string|null} Target ID
   */
  getEscapeTarget(grid, direction) {
    const escapeMap = {
      'up': grid.escapeUp,
      'down': grid.escapeDown,
      'left': grid.escapeLeft,
      'right': grid.escapeRight
    };
    return escapeMap[direction] || null;
  }
  
  // ── Scope Management ───────────────────────────────────────────────────────
  
  /**
   * Enter a grid
   * @param {string} gridId - Grid to enter
   * @param {string} policy - Entry policy
   * @returns {string|null} Cell ID
   */
  enterGrid(gridId, policy = 'remembered') {
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
    
    // Determine entry coordinates
    if (policy === 'remembered' && this.gridMemory.has(gridId)) {
      [row, col] = this.gridMemory.get(gridId);
      console.log('[KNM] Using remembered position:', row, col);
    } else if (policy === 'primary') {
      // Find the primary child (marked with primary: true)
      const primaryChild = grid.children?.find(childId => {
        const child = this.uiTree.getNode(childId);
        return child?.primary === true;
      });
      
      if (primaryChild) {
        const coords = this.uiTree.getCellCoords(gridId, primaryChild);
        if (coords) {
          [row, col] = coords;
          console.log('[KNM] Using primary child:', primaryChild, '→ [', row, col, ']');
        } else {
          // Fallback to first visible if primary not found in grid
          const firstVisible = this.uiTree.getFirstVisibleCell(gridId);
          if (firstVisible) {
            [row, col] = firstVisible;
          }
        }
      } else {
        // No primary child, fallback to first visible
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
    
    // Validate cell
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
    
    // Push scope
    this.currentContext.scopeStack.push({
      gridId,
      cellId: cell.id,
      coords: [row, col]
    });
    
    this.gridMemory.set(gridId, [row, col]);
    
    console.log('[KNM] Entered', gridId, 'at', cell.id, '- depth:', this.currentContext.scopeStack.length);
    return cell.id;
  }
  
  /**
   * Exit current scope
   * @returns {string|null} Parent cell ID
   */
  exitScope() {
    if (this.currentContext.scopeStack.length <= 1) {
      console.log('[KNM] Cannot exit root');
      return null;
    }
    
    // ENFORCEMENT: Don't allow exiting an overlay scope
    // The only way to exit an overlay should be through closeOverlay()
    const currentScope = this.getCurrentScope();
    const currentGrid = this.uiTree.getNode(currentScope.gridId);
    
    if (currentGrid?.isOverlay) {
      console.log('[KNM] Cannot exit overlay via exitScope - use closeOverlay() or Escape');
      return null;
    }
    
    const exited = this.currentContext.scopeStack.pop();
    this.gridMemory.set(exited.gridId, exited.coords);
    
    const parent = this.getCurrentScope();
    console.log('[KNM] Exited', exited.gridId, '-> returned to', parent.cellId);
    
    return parent.cellId;
  }
  
  /**
   * Exit and move to target
   * @param {string} targetId - Target node ID
   * @returns {string|null} Target cell ID
   */
  exitScopeAndFocus(targetId) {
    // Try to find target in current context's scope chain
    while (this.currentContext.scopeStack.length > 1) {
      const scope = this.getCurrentScope();
      const coords = this.uiTree.getCellCoords(scope.gridId, targetId);
      
      if (coords) {
        return this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
      }
      
      // Check if we can exit this scope
      const currentGrid = this.uiTree.getNode(scope.gridId);
      if (currentGrid?.isOverlay) {
        console.log('[KNM] Cannot exit overlay to reach escape target');
        return null;
      }
      
      // Pop and try parent
      const exited = this.currentContext.scopeStack.pop();
      this.gridMemory.set(exited.gridId, exited.coords);
    }
    
    // At root of current context - try to find target
    const rootScope = this.getCurrentScope();
    const coords = this.uiTree.getCellCoords(rootScope.gridId, targetId);
    
    if (coords) {
      return this.moveToCellInScope(rootScope.gridId, coords[0], coords[1]);
    }
    
    // Try to enter target if it's a grid
    const targetNode = this.uiTree.getNode(targetId);
    if (targetNode && targetNode.kind === 'grid') {
      return this.enterGrid(targetId, targetNode.entryPolicy);
    }
    
    console.warn('[KNM] Could not reach target:', targetId);
    return null;
  }
  
  /**
   * Get current scope
   * @returns {Object|null} Scope
   */
  getCurrentScope() {
    return this.currentContext.scopeStack.length > 0 
      ? this.currentContext.scopeStack[this.currentContext.scopeStack.length - 1] 
      : null;
  }
  
  /**
   * Validate current focus and exit scopes if focused element is hidden
   * Call this after dynamic grid updates
   * @param {string|null} preferredTargetId - If provided and current focus is invalid, return to this node
   */
  validateCurrentFocus(preferredTargetId = null) {
    if (!this.sessionState.currentFocusId) return;
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    if (!currentNode || this.uiTree.isNodeHidden(this.sessionState.currentFocusId)) {
      console.log('[KNM] Current focus is hidden, finding safe location...');
      
      // If a preferred target was provided, try to go there first
      if (preferredTargetId) {
        const targetNode = this.uiTree.getNode(preferredTargetId);
        if (targetNode && !this.uiTree.isNodeHidden(preferredTargetId)) {
          console.log('[KNM] Returning focus to trigger:', preferredTargetId);
          
          // Exit scopes until we find the target or reach root
          while (this.currentContext.scopeStack.length > 1) {
            const scope = this.getCurrentScope();
            const coords = this.uiTree.getCellCoords(scope.gridId, preferredTargetId);
            
            if (coords) {
              // Found target in this scope
              this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
            
            // Not in this scope, exit to parent
            this.currentContext.scopeStack.pop();
          }
          
          // Check root scope
          const rootScope = this.getCurrentScope();
          const rootCoords = this.uiTree.getCellCoords(rootScope.gridId, preferredTargetId);
          if (rootCoords) {
            this.moveToCellInScope(rootScope.gridId, rootCoords[0], rootCoords[1]);
            this._setFocus(preferredTargetId);
            return;
          }
        }
      }
      
      // Fallback: Exit scopes until we find a visible location
      while (this.currentContext.scopeStack.length > 1) {
        const scope = this.getCurrentScope();
        const scopeNode = this.uiTree.getNode(scope.gridId);
        
        // Try to find a visible cell in this scope
        const visibleCells = this.uiTree.getVisibleCells(scope.gridId);
        if (visibleCells.length > 0) {
          // Move to first visible cell
          this._setFocus(visibleCells[0].cellId);
          console.log('[KNM] Recovered focus to:', visibleCells[0].cellId);
          return;
        }
        
        // No visible cells in this scope, exit it
        console.log('[KNM] No visible cells in', scope.gridId, 'exiting...');
        this.currentContext.scopeStack.pop();
      }
      
      // If we're at root and still no focus, try to enter root
      const rootScope = this.getCurrentScope();
      if (rootScope) {
        const cellId = this.enterGrid(rootScope.gridId, 'remembered');
        if (cellId) {
          this._setFocus(cellId);
          console.log('[KNM] Recovered focus to root:', cellId);
        }
      }
    }
  }
  
  // ── Overlay Management ─────────────────────────────────────────────────────
  
  /**
   * Check if we're currently inside an overlay
   * @returns {boolean}
   */
  isInsideOverlay() {
    return this.currentContext.overlayId !== null;
  }
  
  /**
   * Find primary button in current overlay
   * @returns {string|null} Button node ID
   */
  _findPrimaryButton() {
    if (!this.currentContext.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(this.currentContext.overlayId);
    if (!overlayNode) return null;
    
    // Search children recursively for a button with primary: true
    const findPrimary = (nodeId) => {
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
    
    return findPrimary(this.currentContext.overlayId);
  }
  
  /**
   * Find cancel/escape button in current overlay
   * Looks for buttons with buttonRole='danger', 'secondary' or intent='cancel' or 'escape'
   * @returns {string|null} Button node ID
   */
  _findCancelButton() {
    if (!this.currentContext.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(this.currentContext.overlayId);
    if (!overlayNode) return null;
    
    // Search children recursively for a cancel-type button
    const findCancel = (nodeId) => {
      const node = this.uiTree.getNode(nodeId);
      if (!node) return null;
      
      if (node.kind === 'button') {
        // Check meta.buttonRole or meta.intent
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
    
    return findCancel(this.currentContext.overlayId);
  }
  
  /**
   * Open overlay - creates a new isolated navigation context
   * @param {string} overlayId - Overlay grid ID
   * @param {string} triggerId - Trigger element ID
   */
  openOverlayById(overlayId, triggerId = null) {
    console.log('[KNM] Opening overlay:', overlayId, 'trigger:', triggerId);
    
    // Preserve active state when entering overlay
    const wasActive = this.sessionState.active;
    
    // Create new context for the overlay
    const newContext = {
      scopeStack: [],
      parentContext: this.currentContext, // Link to current context
      overlayId: overlayId,
      triggerId: triggerId
    };
    
    // Switch to new context
    this.currentContext = newContext;
    
    // Enter the overlay grid in the new context
    const cellId = this.enterGrid(overlayId, 'explicit');
    if (cellId) {
      this._setFocus(cellId);
      
      // If navigation was active, ensure it stays active and cursor is visible
      if (wasActive) {
        console.log('[KNM] Overlay opened while nav active - maintaining active state');
        this.sessionState.active = true;
        this.sessionState.justActivated = false;
        document.body.classList.add('nav-active');
        
        // Ensure visualizer shows cursor at new focus location
        const node = this.uiTree.getNode(cellId);
        if (node && this.visualizer) {
          const element = this.uiTree.getElement(cellId);
          if (element) {
            const isEnterable = node.focusMode === 'entry-node' || node.kind === 'grid';
            const isInteracting = this.sessionState.interactingNodeId === cellId;
            
            this.visualizer.render({
              element,
              isEnterable,
              isInteracting
            });
          }
        }
      }
    }
  }
  
  /**
   * Close overlay - restores parent navigation context
   * @param {string} overlayId - Overlay to close
   */
  closeOverlay(overlayId) {
    console.log('[KNM] Closing overlay:', overlayId);
    
    // Verify we're actually closing the current overlay
    if (this.currentContext.overlayId !== overlayId) {
      console.warn('[KNM] Attempted to close overlay that is not current:', overlayId);
      return;
    }
    
    if (!this.currentContext.parentContext) {
      console.warn('[KNM] Cannot close root context');
      return;
    }
    
    // Guard against duplicate close attempts
    if (this.currentContext._pendingClose) {
      console.log('[KNM] Overlay close already pending, ignoring duplicate call');
      return;
    }
    
    const triggerId = this.currentContext.triggerId;
    
    // Emit event FIRST - allows overlay content (like dialogs) to intercept
    // The overlay content is responsible for actually removing itself from DOM
    if (this.uiTree?._events) {
      console.log('[KNM] Emitting overlay:before-close event for:', overlayId);
      this.uiTree._events.emit('overlay:before-close', { 
        id: overlayId, 
        triggerId: triggerId 
      });
    }
    
    // DON'T restore parent context yet!
    // The dialog will call back when it's done closing via removeTransientOverlay
    // For now, just mark that we want to close
    this.currentContext._pendingClose = true;
    this.currentContext._restoreTriggerId = triggerId;
  }
  
  /**
   * Complete overlay close - called by overlay content after it finishes cleanup
   * @param {string} overlayId - Overlay that finished closing
   */
  completeOverlayClose(overlayId) {
    console.log('[KNM] Completing overlay close:', overlayId);
    
    if (this.currentContext.overlayId !== overlayId) {
      console.warn('[KNM] Cannot complete close - not current overlay:', overlayId);
      return;
    }
    
    if (!this.currentContext.parentContext) {
      console.warn('[KNM] Cannot complete close - no parent context');
      return;
    }
    
    const triggerId = this.currentContext._restoreTriggerId;
    
    // NOW restore parent context
    this.currentContext = this.currentContext.parentContext;
    
    // Restore focus to trigger or current cell in restored context
    if (triggerId) {
      this._setFocus(triggerId);
    } else {
      const scope = this.getCurrentScope();
      if (scope) {
        this._setFocus(scope.cellId);
      }
    }
  }
  
  // ── Focus Management ───────────────────────────────────────────────────────
  
  /**
   * Set focus to node
   * @param {string} nodeId - Node ID
   */
  _setFocus(nodeId) {
    if (!nodeId) return;
    
    const node = this.uiTree.getNode(nodeId);
    if (!node) {
      console.warn('[KNM] Node not found:', nodeId);
      return;
    }
    
    console.log('[KNM] Focus:', nodeId, 'kind:', node.kind);
    
    const element = this.uiTree.getElement(nodeId);
    
    // Auto-enter grids without DOM elements (transparent navigation containers)
    // These are just logical groupings like root, sidebar, canvas-controls
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
    
    // If focusing a leaf node, ensure we're in the correct parent grid scope
    // This is important when jumping directly to a node (e.g., Enter -> primary button)
    if (node.parentId && (node.focusMode === 'leaf' || node.kind !== 'grid')) {
      const parentNode = this.uiTree.getNode(node.parentId);
      if (parentNode && parentNode.kind === 'grid') {
        // Check if we're already in this parent grid's scope
        const currentScope = this.getCurrentScope();
        if (!currentScope || currentScope.gridId !== node.parentId) {
          console.log('[KNM] Not in parent grid scope, entering:', node.parentId);
          // We need to enter the parent grid and position at this node's cell
          const cell = parentNode.cells?.find(c => c.id === nodeId);
          if (cell) {
            // Enter the parent grid and set our coordinates to this cell
            this.enterGrid(node.parentId, 'first'); // Enter grid (will pick first by default)
            // Override the coordinates to point to our target cell
            const scope = this.getCurrentScope();
            if (scope) {
              scope.coords = [cell.row, cell.col];
              console.log('[KNM] Set scope coordinates to [', cell.row, cell.col, ']');
            }
          }
        }
      }
    }
    
    this.sessionState.currentFocusId = nodeId;
    
    if (!element) {
      // Grids often don't have elements - they're just containers
      if (node.kind !== 'grid') {
        console.warn('[KNM] No element for:', nodeId);
      }
      return;
    }
    
    // Apply DOM focus (but NOT for inputs - they only get focus in interaction mode)
    // This prevents typing in inputs when just navigating over them
    const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
    if (this.effects && !isInput) {
      this.effects.applyFocus(element);
    } else if (isInput && this.effects) {
      // Ensure input is blurred when just navigating over it
      this.effects.removeFocus(element);
    }
    
    // Update visualizer
    if (this.sessionState.active && this.visualizer) {
      const isEnterable = node.focusMode === 'entry-node' || node.kind === 'grid';
      const isInteracting = this.sessionState.interactingNodeId === nodeId;
      
      this.visualizer.render({
        element,
        isEnterable,
        isInteracting
      });
    }
  }
  
  /**
   * Enter interaction mode (for analog controls)
   */
  _enterInteractionMode(nodeId) {
    this.sessionState.interactingNodeId = nodeId;
    console.log('[KNM] Entered interaction mode:', nodeId);
    
    if (this.visualizer) {
      const element = this.uiTree.getElement(nodeId);
      if (element) {
        this.visualizer.render({
          element,
          isEnterable: false,
          isInteracting: true
        });
      }
    }
  }
  
  /**
   * Exit interaction mode
   */
  _exitInteractionMode() {
    console.log('[KNM] Exited interaction mode');
    
    // Stop all key repeats when exiting interaction mode
    this.repeatManager.stopAll();
    
    // Notify the behavior to exit its interaction state
    if (this.sessionState.interactingNodeId) {
      const node = this.uiTree.getNode(this.sessionState.interactingNodeId);
      if (node) {
        const behavior = this._getBehavior(node);
        if (behavior?.onEscape) {
          console.log('[KNM] Notifying behavior to exit interaction mode');
          behavior.onEscape();
        }
      }
    }
    
    this.sessionState.interactingNodeId = null;
    
    if (this.sessionState.currentFocusId) {
      this._setFocus(this.sessionState.currentFocusId);
    }
  }
  
  // ── UITree Event Listeners ─────────────────────────────────────────────────
  
  /**
   * Setup event listeners for UITree mutations
   */
  _setupTreeListeners() {
    if (!this.uiTree?._events) {
      console.warn('[KNM] UITree events not available');
      return;
    }
    
    // Node updated: no action needed (we read directly from UITree)
    this.uiTree._events.on('node:updated', (event) => {
      console.log('[KNM] Node updated:', event.id);
    });
    
    // Nodes added: no action needed (we read directly from UITree)
    this.uiTree._events.on('nodes:added', (event) => {
      console.log('[KNM] Nodes added:', event.ids);
    });
    
    // Node removed: restore focus if needed
    this.uiTree._events.on('node:removed', (event) => {
      const { id, parentId } = event;
      
      // If focused node was removed, restore focus to parent
      if (this.sessionState.currentFocusId === id && parentId) {
        this._setFocus(parentId);
      }
      
      console.log('[KNM] Node removed:', id);
    });
    
    // Subtree removed: restore focus if needed
    this.uiTree._events.on('subtree:removed', (event) => {
      const { rootId, removedIds } = event;
      
      // Check if any removed node was focused
      if (removedIds.includes(this.sessionState.currentFocusId)) {
        // Restore focus to nearest ancestor
        const ancestorId = this.uiTree.getNearestAncestor(rootId);
        if (ancestorId) {
          this._setFocus(ancestorId);
        }
      }
      
      console.log('[KNM] Subtree removed:', rootId, removedIds.length, 'nodes');
    });
    
    // Overlay registered: open overlay in nav manager
    this.uiTree._events.on('overlay:registered', (event) => {
      const { id, triggerId } = event;
      console.log('[KNM] Overlay registered:', id, 'trigger:', triggerId);
      this.openOverlayById(id, triggerId);
    });
    
    // Overlay removed: close overlay in nav manager
    this.uiTree._events.on('overlay:removed', (event) => {
      const { id } = event;
      console.log('[KNM] Overlay removed:', id);
      this.closeOverlay(id);
    });
  }
  
  // ── Cleanup ────────────────────────────────────────────────────────────────
  
  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
    }
    if (this._boundKeyUpHandler) {
      document.removeEventListener('keyup', this._boundKeyUpHandler);
    }
    if (this._boundMouseHandler) {
      document.removeEventListener('pointerdown', this._boundMouseHandler, true);
    }
    
    // Cleanup UITree event listeners
    if (this.uiTree?._events) {
      this.uiTree._events.off('node:updated');
      this.uiTree._events.off('nodes:added');
      this.uiTree._events.off('node:removed');
      this.uiTree._events.off('subtree:removed');
      this.uiTree._events.off('overlay:registered');
      this.uiTree._events.off('overlay:removed');
    }
    
    // Cleanup repeat manager
    if (this.repeatManager) {
      this.repeatManager.destroy();
    }
    
    // Clear all contexts (walk up parent chain)
    while (this.currentContext.parentContext) {
      this.currentContext = this.currentContext.parentContext;
    }
    this.currentContext.scopeStack = [];
    
    this.gridMemory.clear();
    
    console.log('[KNM] Destroyed');
  }
}

console.log('[KNM] Grid-based KeyboardNavigationManager loaded');
