# KeyboardNavigationManager Refactor Guide

## Changes Summary

### Import Changes
```javascript
// OLD
import { getNextNode, getEntryChild, getParentScope, resolveToFocusable } from './NavTraversal.js';

// NEW
import { GridNavigationManager } from './GridNavigationManager.js';
```

### Constructor Changes
```javascript
constructor(options = {}) {
  const { effects, visualizer, uiTree } = options;
  
  this.effects = effects;
  this.visualizer = visualizer;
  this.uiTree = uiTree;
  
  // NEW: Create grid navigation manager
  this.gridNav = new GridNavigationManager(uiTree);
  
  // Navigation tree (keep for now, but grid nav uses uiTree directly)
  this.tree = {};
  
  // Simplified session state
  this.sessionState = {
    active: false,
    currentFocusId: null,
    interactingNodeId: null,
    overlayStack: [] // Grid nav has its own scope stack
  };
  
  this._boundKeyHandler = null;
  this._boundMouseHandler = null;
}
```

### init() Changes
```javascript
init(navTree, options = {}) {
  this.tree = navTree; // Keep for behavior lookups
  
  const { setInitialFocus = false } = options;
  
  if (setInitialFocus) {
    // Use grid nav to initialize
    const cellId = this.gridNav.initializeAtRoot('root');
    if (cellId) {
      this._setFocus(cellId);
    }
  }
  
  // ... rest of init (keyboard/mouse listeners)
}
```

### _handleKeyDown() Arrow Key Section - COMPLETE REPLACEMENT

Replace lines ~110-280 with:

```javascript
// Arrow key navigation - delegate to grid nav
if (key === 'ArrowUp' || key === 'Arrow Down' || key === 'ArrowLeft' || key === 'ArrowRight') {
  // Check if current node's behavior wants to handle it
  const currentNode = this.tree[this.sessionState.currentFocusId];
  if (currentNode?.behavior?.onArrowKey) {
    const result = currentNode.behavior.onArrowKey(key);
    if (result === 'handled') {
      console.log('[KNM] Arrow key handled by behavior');
      event.preventDefault();
      return;
    }
  }
  
  event.preventDefault();
  
  // Map arrow keys to directions
  const directionMap = {
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right'
  };
  
  const direction = directionMap[key];
  const newCellId = this.gridNav.handleArrowKey(direction);
  
  if (newCellId) {
    this._setFocus(newCellId);
  }
  
  return;
}
```

### _setFocus() Changes
Keep mostly as-is, but update scope handling to use gridNav:

```javascript
_setFocus(nodeId) {
  if (!nodeId) return;
  
  const node = this.tree[nodeId];
  if (!node) {
    console.warn('[KNM] Node not found:', nodeId);
    return;
  }
  
  console.log('[KNM] Setting focus to:', nodeId, 'kind:', node.kind);
  
  // Update session state
  this.sessionState.currentFocusId = nodeId;
  
  // Get element from uiTree
  const element = this.uiTree.getElement(nodeId);
  
  if (!element) {
    console.warn('[KNM] No element bound to:', nodeId);
    return;
  }
  
  // Apply DOM focus
  if (this.effects) {
    this.effects.applyFocus(element);
  }
  
  // Update visualizer if active
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
```

### Enter Key Handling Changes

Replace scope entry logic with grid nav:

```javascript
// Enter key - try to enter scope or activate
if (key === 'Enter') {
  event.preventDefault();
  const currentNode = this.tree[this.sessionState.currentFocusId];
  
  if (!currentNode) return;
  
  // Check if node has behavior
  if (currentNode.behavior?.onActivate) {
    const result = currentNode.behavior.onActivate();
    if (result === 'handled') {
      console.log('[KNM] Enter handled by behavior');
      return;
    }
  }
  
  // Check if node is enterable (a grid)
  if (currentNode.kind === 'grid' || currentNode.focusMode === 'entry-node') {
    const cellId = this.gridNav.enterGrid(currentNode.id, currentNode.entryPolicy);
    if (cellId) {
      this._setFocus(cellId);
    }
  }
  
  return;
}
```

### Escape Key Handling Changes

Replace scope exit logic with grid nav:

```javascript
// Escape key - exit scope or close overlay
if (key === 'Escape') {
  event.preventDefault();
  
  // Check for overlay first
  const currentScope = this.gridNav.getCurrentScope();
  if (currentScope) {
    const gridNode = this.uiTree.getNode(currentScope.gridId);
    
    if (gridNode?.isOverlay) {
      // Close overlay
      this.closeOverlay(gridNode.id);
      return;
    }
  }
  
  // Check for interaction mode
  if (this.sessionState.interactingNodeId) {
    this._exitInteractionMode();
    return;
  }
  
  // Try to exit current scope
  const parentCellId = this.gridNav.exitScope();
  if (parentCellId) {
    this._setFocus(parentCellId);
  }
  
  return;
}
```

### Overlay Management

Update to work with grid nav:

```javascript
openOverlayById(overlayId, triggerId = null) {
  console.log('[KNM] Opening overlay:', overlayId, 'trigger:', triggerId);
  
  // Add to overlay stack
  this.sessionState.overlayStack.push({ overlayId, triggerId });
  
  // Enter overlay grid
  const cellId = this.gridNav.enterGrid(overlayId, 'explicit');
  if (cellId) {
    this._setFocus(cellId);
  }
}

closeOverlay(overlayId) {
  console.log('[KNM] Closing overlay:', overlayId);
  
  // Find overlay in stack
  const overlayIndex = this.sessionState.overlayStack.findIndex(o => o.overlayId === overlayId);
  if (overlayIndex === -1) {
    console.warn('[KNM] Overlay not in stack:', overlayId);
    return;
  }
  
  const overlay = this.sessionState.overlayStack[overlayIndex];
  
  // Exit overlay scope (grid nav will pop scopes)
  while (this.gridNav.getCurrentScope()?.gridId !== overlayId) {
    this.gridNav.exitScope();
  }
  this.gridNav.exitScope(); // Exit the overlay itself
  
  // Remove from overlay stack
  this.sessionState.overlayStack.splice(overlayIndex, 1);
  
  // Restore focus to trigger or parent
  if (overlay.triggerId) {
    const trigger = this.tree[overlay.triggerId];
    if (trigger) {
      this._setFocus(overlay.triggerId);
    }
  } else {
    // Use grid nav to get current cell
    const currentCellId = this.gridNav.getCurrentCellId();
    if (currentCellId) {
      this._setFocus(currentCellId);
    }
  }
}
```

## What Gets Deleted

- All navigate() functions
- All navigateHorizontal() logic  
- All column memory hacks (Map is in gridNav now)
- All horizontal/vertical special case logic (lines 137-280)
- All getNextNode/resolveToFocusable calls

## What Stays

- Behavior system (onArrowKey, onActivate)
- Mouse interaction handler
- Lazy activation
- Visualizer integration
- Effects integration
- Overlay stack management (simplified)
- Session state (simplified)

## Net Result

- ~400 lines deleted (complex navigation)
- ~100 lines added (grid nav integration)
- ~300 lines net reduction
- Much cleaner, easier to understand
