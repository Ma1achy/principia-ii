/**
 * KeyboardNavigationManager - Grid-based keyboard navigation
 * Single unified manager for all keyboard navigation using coordinate arithmetic
 */

export class KeyboardNavigationManager {
  constructor(options = {}) {
    const { effects, visualizer, uiTree, behaviorRegistry } = options;
    
    this.effects = effects;
    this.visualizer = visualizer;
    this.uiTree = uiTree;
    this.behaviorRegistry = behaviorRegistry;
    
    // Behavior cache (nodeId -> behavior instance)
    // Behaviors are stateful, so we need to reuse the same instance
    this.behaviorCache = new Map();
    
    // Scope stack (each entry is a grid context with coordinates)
    this.scopeStack = [];
    
    // Grid memory (remembers last position in each grid)
    this.gridMemory = new Map();
    
    // Session state
    this.sessionState = {
      active: false, // Lazy activation on first nav key
      currentFocusId: null,
      interactingNodeId: null,
      overlayStack: [] // {overlayId, triggerId}
    };
    
    // Bound handlers
    this._boundKeyHandler = null;
    this._boundMouseHandler = null;
    
    console.log('[KNM] Initialized with grid navigation');
  }
  
  // ── Initialization ─────────────────────────────────────────────────────────
  
  /**
   * Initialize navigation at root
   * @param {string} rootId - Root grid ID (default 'root')
   * @param {Object} options - {setInitialFocus: boolean}
   */
  init(rootIdOrTree = 'root', options = {}) {
    const { setInitialFocus = false } = options;
    
    // Handle legacy API: if passed an object (nav tree), ignore it and use 'root'
    const rootId = typeof rootIdOrTree === 'string' ? rootIdOrTree : 'root';
    
    // Attach keyboard listener
    this._boundKeyHandler = this._handleKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);
    
    // Attach mouse interaction handler
    this._boundMouseHandler = this._handleMouseInteraction.bind(this);
    document.addEventListener('pointerdown', this._boundMouseHandler, true);
    
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
    
    // Lazy activation: only activate on navigation events
    if (!this.sessionState.active) {
      // Activate on first navigation event
      console.log('[KNM] Activating navigation on first nav event:', navEvent);
      this.sessionState.active = true;
      document.body.classList.add('nav-active');
    }
    
    // Route to appropriate handler based on nav event type
    if (navEvent === 'increment' || navEvent === 'decrement') {
      this._handleIncrement(event, navEvent);
    } else if (navEvent === 'nav-up' || navEvent === 'nav-down' || navEvent === 'nav-left' || navEvent === 'nav-right') {
      this._handleNavigation(event, navEvent);
    } else if (navEvent === 'nav-enter') {
      this._handleEnter(event);
    } else if (navEvent === 'nav-escape') {
      this._handleEscape(event);
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
    if (!this.sessionState.interactingNodeId) return;
    
    event.preventDefault();
    const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
    if (currentNode) {
      const behavior = this._getBehavior(currentNode);
      if (behavior?.onArrowKey) {
        // Map increment/decrement to arrow directions for analog controls
        const mappedKey = navEvent === 'increment' ? 'ArrowUp' : 'ArrowDown';
        const result = behavior.onArrowKey(mappedKey);
        if (result === 'handled') {
          console.log('[KNM] Increment/decrement handled by behavior:', navEvent);
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
    event.preventDefault();
    
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
            return;
          } else if (result === 'ignored') {
            // Behavior says "ignore" - let native input handle, don't navigate
            console.log('[KNM] Navigation ignored by interacting behavior (native input):', navEvent);
            return;
          } else if (result === 'escape_scope') {
            // Behavior requests escape to parent scope
            console.log('[KNM] Navigation escape requested by behavior:', navEvent);
            const parentCellId = this.exitScope();
            if (parentCellId) {
              this._setFocus(parentCellId);
            }
            return;
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
          return;
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
  }
  
  /**
   * Handle enter/activate events (Enter/Space)
   * @param {KeyboardEvent} event
   */
  _handleEnter(event) {
    event.preventDefault();
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    
    if (!currentNode) return;
    
    console.log('[KNM] Enter pressed on:', currentNode.id, 'kind:', currentNode.kind);
    
    // Get behavior from cache (stateful)
    const behavior = this._getBehavior(currentNode);
    if (behavior?.onActivate) {
      const result = behavior.onActivate();
      if (result === 'handled') {
        console.log('[KNM] Enter handled by behavior');
        
        // Check if behavior toggled interaction mode
        if (behavior.isInteracting && behavior.isInteracting()) {
          this._enterInteractionMode(currentNode.id);
        } else if (this.sessionState.interactingNodeId === currentNode.id) {
          this._exitInteractionMode();
        }
        
        return;
      }
    }
    
    // Try to enter if it's a grid
    if (currentNode.kind === 'grid' || currentNode.focusMode === 'entry-node') {
      console.log('[KNM] Attempting to enter grid:', currentNode.id);
      const cellId = this.enterGrid(currentNode.id, currentNode.entryPolicy);
      if (cellId) {
        this._setFocus(cellId);
      } else {
        console.warn('[KNM] Failed to enter grid:', currentNode.id);
      }
    }
  }
  
  /**
   * Handle escape/back events (Escape/R)
   * @param {KeyboardEvent} event
   */
  _handleEscape(event) {
    event.preventDefault();
    
    // Check for overlay first
    const currentScope = this.getCurrentScope();
    if (currentScope) {
      const gridNode = this.uiTree.getNode(currentScope.gridId);
      
      if (gridNode?.isOverlay) {
        // Check if overlay allows escape
        if (gridNode.closeOnEscape !== false) {
          this.closeOverlay(gridNode.id);
        }
        return;
      }
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
      navManager: this
    };
    const behavior = this.behaviorRegistry.create(node.kind, node, element, deps);
    
    if (behavior) {
      this.behaviorCache.set(node.id, behavior);
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
    if (this.scopeStack.length === 0) {
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
    this.scopeStack.push({
      gridId,
      cellId: cell.id,
      coords: [row, col]
    });
    
    this.gridMemory.set(gridId, [row, col]);
    
    console.log('[KNM] Entered', gridId, 'at', cell.id, '- depth:', this.scopeStack.length);
    return cell.id;
  }
  
  /**
   * Exit current scope
   * @returns {string|null} Parent cell ID
   */
  exitScope() {
    if (this.scopeStack.length <= 1) {
      console.log('[KNM] Cannot exit root');
      return null;
    }
    
    const exited = this.scopeStack.pop();
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
    // Try to find target in scope chain
    while (this.scopeStack.length > 1) {
      const scope = this.getCurrentScope();
      const coords = this.uiTree.getCellCoords(scope.gridId, targetId);
      
      if (coords) {
        return this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
      }
      
      // Pop and try parent
      const exited = this.scopeStack.pop();
      this.gridMemory.set(exited.gridId, exited.coords);
    }
    
    // At root - try to find target
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
    return this.scopeStack.length > 0 ? this.scopeStack[this.scopeStack.length - 1] : null;
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
          while (this.scopeStack.length > 1) {
            const scope = this.getCurrentScope();
            const coords = this.uiTree.getCellCoords(scope.gridId, preferredTargetId);
            
            if (coords) {
              // Found target in this scope
              this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
            
            // Not in this scope, exit to parent
            this.scopeStack.pop();
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
      while (this.scopeStack.length > 1) {
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
        this.scopeStack.pop();
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
   * Open overlay
   * @param {string} overlayId - Overlay grid ID
   * @param {string} triggerId - Trigger element ID
   */
  openOverlayById(overlayId, triggerId = null) {
    console.log('[KNM] Opening overlay:', overlayId, 'trigger:', triggerId);
    
    this.sessionState.overlayStack.push({ overlayId, triggerId });
    
    // Enter the overlay grid
    const cellId = this.enterGrid(overlayId, 'explicit');
    if (cellId) {
      this._setFocus(cellId);
    }
  }
  
  /**
   * Close overlay
   * @param {string} overlayId - Overlay to close
   */
  closeOverlay(overlayId) {
    console.log('[KNM] Closing overlay:', overlayId);
    
    const index = this.sessionState.overlayStack.findIndex(o => o.overlayId === overlayId);
    if (index === -1) {
      console.warn('[KNM] Overlay not in stack');
      return;
    }
    
    const overlay = this.sessionState.overlayStack[index];
    
    // Pop scopes until overlay is exited
    while (this.scopeStack.length > 0) {
      const scope = this.getCurrentScope();
      if (scope.gridId === overlayId) {
        this.scopeStack.pop();
        break;
      }
      this.scopeStack.pop();
    }
    
    this.sessionState.overlayStack.splice(index, 1);
    
    // Restore focus
    if (overlay.triggerId) {
      this._setFocus(overlay.triggerId);
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
    this.sessionState.interactingNodeId = null;
    
    if (this.sessionState.currentFocusId) {
      this._setFocus(this.sessionState.currentFocusId);
    }
  }
  
  // ── Cleanup ────────────────────────────────────────────────────────────────
  
  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
    }
    if (this._boundMouseHandler) {
      document.removeEventListener('pointerdown', this._boundMouseHandler, true);
    }
    
    this.scopeStack = [];
    this.gridMemory.clear();
    
    console.log('[KNM] Destroyed');
  }
}

console.log('[KNM] Grid-based KeyboardNavigationManager loaded');
