/**
 * KeyboardNavigationManager - Grid-based keyboard navigation
 * Single unified manager for all keyboard navigation using coordinate arithmetic
 */

import { KeyRepeatManager } from './KeyRepeatManager.js';
import type { RepeatProfile } from './KeyRepeatManager.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface GridScope {
  gridId: string;
  cellId: string;
  coords: [number, number];
}

interface NavigationContext {
  scopeStack: GridScope[];
  parentContext: NavigationContext | null;
  overlayId: string | null;
  triggerId: string | null;
  _pendingClose?: boolean;
  _restoreTriggerId?: string | null;
}

interface SessionState {
  active: boolean;
  currentFocusId: string | null;
  interactingNodeId: string | null;
  justActivated?: boolean;
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
  currentContext: NavigationContext;
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
    
    this.currentContext = {
      scopeStack: [],
      parentContext: null,
      overlayId: null,
      triggerId: null
    };
    
    this.gridMemory = new Map();
    
    this.sessionState = {
      active: false,
      currentFocusId: null,
      interactingNodeId: null
    };
    
    this._boundKeyHandler = null;
    this._boundKeyUpHandler = null;
    this._boundMouseHandler = null;
    
    console.log('[KNM] Initialized with context-isolated navigation');
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
  
  private _handleKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    
    const navEvent = this._mapKeyToNavEvent(key);
    if (!navEvent) return;
    
    const wasActive = this.sessionState.active;
    
    if (!this.sessionState.active) {
      console.log('[KNM] Activating navigation on first nav event:', navEvent);
      this.sessionState.active = true;
      this.sessionState.justActivated = true;
      document.body.classList.add('nav-active');
      
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
      
      if (navEvent === 'nav-enter' || navEvent === 'nav-escape') {
        // Let these through
      } else {
        console.log('[KNM] First press consumed - only showing cursor');
        this.sessionState.justActivated = false;
        event.preventDefault();
        return;
      }
    }
    
    if (wasActive && this.sessionState.justActivated) {
      console.log('[KNM] Clearing justActivated flag from previous activation');
      this.sessionState.justActivated = false;
    }
    
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
  
  private _handleIncrement(event: KeyboardEvent, navEvent: 'increment' | 'decrement'): void {
    if (event.repeat) return;
    if (!this.sessionState.interactingNodeId) return;
    
    event.preventDefault();
    
    this._executeIncrementAction(navEvent);
    
    const profile = this._getRepeatProfile();
    this.repeatManager.startRepeat(event.key, () => {
      this._executeIncrementAction(navEvent);
    }, profile);
  }
  
  private _executeIncrementAction(navEvent: 'increment' | 'decrement'): void {
    if (!this.sessionState.interactingNodeId) return;
    
    const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
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
    
    event.preventDefault();
    
    const result = this._executeNavigationAction(navEvent);
    
    if (result !== 'escape_scope' && result !== 'ignored') {
      const profile = this._getRepeatProfile();
      this.repeatManager.startRepeat(event.key, () => {
        this._executeNavigationAction(navEvent);
      }, profile);
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
    
    if (!wasActive) {
      console.log('[KNM] First Enter - showing cursor and moving to primary');
      
      if (this.isInsideOverlay()) {
        const primaryButton = this._findPrimaryButton();
        if (primaryButton) {
          this._setFocus(primaryButton);
          return;
        }
      }
      
      return;
    }
    
    const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
    
    if (!currentNode) return;
    
    console.log('[KNM] Enter pressed on:', currentNode.id, 'kind:', currentNode.kind, 'focusMode:', currentNode.focusMode);
    
    const behavior = this._getBehavior(currentNode);
    console.log('[KNM] Behavior found:', !!behavior, 'has onActivate:', !!behavior?.onActivate);
    
    if (behavior?.onActivate) {
      const result = behavior.onActivate();
      console.log('[KNM] onActivate returned:', result);
      
      if (result === 'handled') {
        console.log('[KNM] Enter handled by behavior');
        
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
    event.preventDefault();
    
    if (!wasActive) {
      console.log('[KNM] First Escape - showing cursor and moving to cancel button');
      
      if (this.isInsideOverlay()) {
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          this._setFocus(cancelButton);
          return;
        }
      }
      
      return;
    }
    
    if (this.isInsideOverlay()) {
      const overlayId = this.currentContext.overlayId;
      const overlayNode = this.uiTree.getNode(overlayId);
      
      if (overlayNode?.closeOnEscape === false) {
        console.log('[KNM] Escape pressed - overlay does not allow escape:', overlayId);
        return;
      }
      
      const currentNode = this.uiTree.getNode(this.sessionState.currentFocusId);
      const isOnCancelButton = currentNode?.kind === 'button' && 
                               (currentNode.meta?.buttonRole === 'danger' ||
                                currentNode.meta?.buttonRole === 'secondary' ||
                                currentNode.meta?.intent === 'cancel' ||
                                currentNode.meta?.intent === 'escape');
      
      if (!isOnCancelButton) {
        const cancelButton = this._findCancelButton();
        if (cancelButton) {
          console.log('[KNM] Escape stage 1 - moving to cancel button');
          this._setFocus(cancelButton);
          return;
        }
      }
      
      console.log('[KNM] Escape stage 2 - closing overlay:', overlayId);
      this.closeOverlay(overlayId!);
      return;
    }
    
    if (this.sessionState.interactingNodeId) {
      const currentNode = this.uiTree.getNode(this.sessionState.interactingNodeId);
      if (currentNode) {
        const behavior = this._getBehavior(currentNode);
        if (behavior?.onEscape) {
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
    
    const parentCellId = this.exitScope();
    if (parentCellId) {
      this._setFocus(parentCellId);
    }
  }
  
  private _handleKeyUp(event: KeyboardEvent): void {
    this.repeatManager.stopRepeat(event.key);
  }
  
  private _getRepeatProfile(): string {
    if (!this.sessionState.interactingNodeId) {
      return 'navigation';
    }
    
    const node = this.uiTree.getNode(this.sessionState.interactingNodeId);
    if (!node) {
      return 'navigation';
    }
    
    if (node.kind === 'canvas' || node.role === 'canvas') {
      return 'canvas';
    }
    
    if (node.kind === 'analog-control' || node.role === 'slider') {
      return 'slider';
    }
    
    return 'navigation';
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
    if (this.sessionState.active) {
      console.log('[KNM] Deactivating keyboard navigation due to mouse click');
      
      this.repeatManager.stopAll();
      
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
  
  handleArrowKey(direction: Direction): string | null {
    if (this.currentContext.scopeStack.length === 0) {
      console.warn('[KNM] No active scope');
      return null;
    }
    
    const scope = this.getCurrentScope();
    if (!scope) return null;
    
    const grid = this.uiTree.getNode(scope.gridId);
    
    if (!grid || grid.kind !== 'grid') {
      console.error('[KNM] Current scope is not a grid:', scope.gridId);
      return null;
    }
    
    let [row, col] = scope.coords;
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
    
    this.currentContext.scopeStack.push({
      gridId,
      cellId: cell.id,
      coords: [row, col]
    });
    
    this.gridMemory.set(gridId, [row, col]);
    
    console.log('[KNM] Entered', gridId, 'at', cell.id, '- depth:', this.currentContext.scopeStack.length);
    return cell.id;
  }
  
  exitScope(): string | null {
    if (this.currentContext.scopeStack.length <= 1) {
      console.log('[KNM] Cannot exit root');
      return null;
    }
    
    const currentScope = this.getCurrentScope();
    if (!currentScope) return null;
    
    const currentGrid = this.uiTree.getNode(currentScope.gridId);
    
    if (currentGrid?.isOverlay) {
      console.log('[KNM] Cannot exit overlay via exitScope - use closeOverlay() or Escape');
      return null;
    }
    
    const exited = this.currentContext.scopeStack.pop()!;
    this.gridMemory.set(exited.gridId, exited.coords);
    
    const parent = this.getCurrentScope();
    if (!parent) return null;
    
    console.log('[KNM] Exited', exited.gridId, '-> returned to', parent.cellId);
    
    return parent.cellId;
  }

  exitScopeAndFocus(targetId: string): string | null {
    while (this.currentContext.scopeStack.length > 1) {
      const scope = this.getCurrentScope();
      if (!scope) break;
      
      const coords = this.uiTree.getCellCoords(scope.gridId, targetId);
      
      if (coords) {
        return this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
      }
      
      const currentGrid = this.uiTree.getNode(scope.gridId);
      if (currentGrid?.isOverlay) {
        console.log('[KNM] Cannot exit overlay to reach escape target');
        return null;
      }
      
      const exited = this.currentContext.scopeStack.pop()!;
      this.gridMemory.set(exited.gridId, exited.coords);
    }
    
    const rootScope = this.getCurrentScope();
    if (!rootScope) return null;
    
    const coords = this.uiTree.getCellCoords(rootScope.gridId, targetId);
    
    if (coords) {
      return this.moveToCellInScope(rootScope.gridId, coords[0], coords[1]);
    }
    
    const targetNode = this.uiTree.getNode(targetId);
    if (targetNode && targetNode.kind === 'grid') {
      return this.enterGrid(targetId, targetNode.entryPolicy);
    }
    
    console.warn('[KNM] Could not reach target:', targetId);
    return null;
  }

  getCurrentScope(): GridScope | null {
    return this.currentContext.scopeStack.length > 0 
      ? this.currentContext.scopeStack[this.currentContext.scopeStack.length - 1] 
      : null;
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
          
          while (this.currentContext.scopeStack.length > 1) {
            const scope = this.getCurrentScope();
            if (!scope) break;
            
            const coords = this.uiTree.getCellCoords(scope.gridId, preferredTargetId);
            
            if (coords) {
              this.moveToCellInScope(scope.gridId, coords[0], coords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
            
            this.currentContext.scopeStack.pop();
          }
          
          const rootScope = this.getCurrentScope();
          if (rootScope) {
            const rootCoords = this.uiTree.getCellCoords(rootScope.gridId, preferredTargetId);
            if (rootCoords) {
              this.moveToCellInScope(rootScope.gridId, rootCoords[0], rootCoords[1]);
              this._setFocus(preferredTargetId);
              return;
            }
          }
        }
      }
      
      while (this.currentContext.scopeStack.length > 1) {
        const scope = this.getCurrentScope();
        if (!scope) break;
        
        const visibleCells = this.uiTree.getVisibleCells(scope.gridId);
        if (visibleCells.length > 0) {
          this._setFocus(visibleCells[0].cellId);
          console.log('[KNM] Recovered focus to:', visibleCells[0].cellId);
          return;
        }
        
        console.log('[KNM] No visible cells in', scope.gridId, 'exiting...');
        this.currentContext.scopeStack.pop();
      }
      
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
  
  isInsideOverlay(): boolean {
    return this.currentContext.overlayId !== null;
  }
  
  private _findPrimaryButton(): string | null {
    if (!this.currentContext.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(this.currentContext.overlayId);
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
    
    return findPrimary(this.currentContext.overlayId);
  }

  private _findCancelButton(): string | null {
    if (!this.currentContext.overlayId) return null;
    
    const overlayNode = this.uiTree.getNode(this.currentContext.overlayId);
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
    
    return findCancel(this.currentContext.overlayId);
  }
  
  openOverlayById(overlayId: string, triggerId: string | null = null): void {
    console.log('[KNM] Opening overlay:', overlayId, 'trigger:', triggerId);
    
    const wasActive = this.sessionState.active;
    
    const newContext: NavigationContext = {
      scopeStack: [],
      parentContext: this.currentContext,
      overlayId: overlayId,
      triggerId: triggerId
    };
    
    this.currentContext = newContext;
    
    const cellId = this.enterGrid(overlayId, 'explicit');
    if (cellId) {
      this._setFocus(cellId);
      
      if (wasActive) {
        console.log('[KNM] Overlay opened while nav active - maintaining active state');
        this.sessionState.active = true;
        this.sessionState.justActivated = false;
        document.body.classList.add('nav-active');
        
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

  closeOverlay(overlayId: string): void {
    console.log('[KNM] Closing overlay:', overlayId);
    
    if (this.currentContext.overlayId !== overlayId) {
      console.warn('[KNM] Attempted to close overlay that is not current:', overlayId);
      return;
    }
    
    if (!this.currentContext.parentContext) {
      console.warn('[KNM] Cannot close root context');
      return;
    }
    
    if (this.currentContext._pendingClose) {
      console.log('[KNM] Overlay close already pending, ignoring duplicate call');
      return;
    }
    
    const triggerId = this.currentContext.triggerId;
    
    if (this.uiTree?._events) {
      console.log('[KNM] Emitting overlay:before-close event for:', overlayId);
      this.uiTree._events.emit('overlay:before-close', { 
        id: overlayId, 
        triggerId: triggerId 
      });
    }
    
    this.currentContext._pendingClose = true;
    this.currentContext._restoreTriggerId = triggerId;
  }

  completeOverlayClose(overlayId: string): void {
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
    
    this.currentContext = this.currentContext.parentContext;
    
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
    
    if (node.parentId && (node.focusMode === 'leaf' || node.kind !== 'grid')) {
      const parentNode = this.uiTree.getNode(node.parentId);
      if (parentNode && parentNode.kind === 'grid') {
        const currentScope = this.getCurrentScope();
        if (!currentScope || currentScope.gridId !== node.parentId) {
          console.log('[KNM] Not in parent grid scope, entering:', node.parentId);
          const cell = parentNode.cells?.find((c: any) => c.id === nodeId);
          if (cell) {
            this.enterGrid(node.parentId, 'first');
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
      const isInteracting = this.sessionState.interactingNodeId === nodeId;
      
      this.visualizer.render({
        element,
        isEnterable,
        isInteracting
      });
    }
  }
  
  private _enterInteractionMode(nodeId: string): void {
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
  
  private _exitInteractionMode(): void {
    console.log('[KNM] Exited interaction mode');
    
    this.repeatManager.stopAll();
    
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
      this.closeOverlay(id);
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
    
    while (this.currentContext.parentContext) {
      this.currentContext = this.currentContext.parentContext;
    }
    this.currentContext.scopeStack = [];
    
    this.gridMemory.clear();
    
    console.log('[KNM] Destroyed');
  }
}

console.log('[KNM] Grid-based KeyboardNavigationManager loaded');
