# Grid-Based Navigation System - Implementation Plan

## Overview

Replace the current spaghetti navigation with a unified **grid-based system** where all navigable containers are grids with rows and columns.

## Core Principles

1. **Everything is a grid** - Even a single button is a 1×1 grid
2. **One navigation algorithm** - No special cases for horizontal/vertical
3. **Automatic memory** - Always remember last position when leaving a grid
4. **Explicit boundaries** - Clear escape targets at edges
5. **Cell spanning** - Support multi-column/multi-row cells

---

## Grid Node Structure

```javascript
{
  id: 'sec-z0',
  kind: 'grid',
  
  // Grid dimensions (auto = calculate from cells)
  rows: 12,      // number or 'auto'
  cols: 2,       // number or 'auto'
  
  // Grid cells (flat array, row-major order)
  // [row0col0, row0col1, row1col0, row1col1, ...]
  cells: [
    { id: 'z0-buttons', rowSpan: 1, colSpan: 2 },  // Button group spans 2 cols
    { id: 'slider-z0Range:analog', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z0Range:value', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z0:analog', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z0:value', rowSpan: 1, colSpan: 1 },
    // ... more sliders
  ],
  
  // Wrapping behavior
  wrapRows: false,    // Wrap vertically (top ↔ bottom)
  wrapCols: false,    // Wrap horizontally (left ↔ right)
  
  // Escape targets (when hitting boundary)
  escapeUp: 'sec-presets',      // What to focus when pressing Up at top edge
  escapeDown: 'sec-orient',     // What to focus when pressing Down at bottom edge
  escapeLeft: 'canvas',         // What to focus when pressing Left at left edge
  escapeRight: null,            // null = no escape
  
  // Entry behavior
  entryCell: 0,                 // Default cell index when entering grid (0 = first)
  entryPolicy: 'remembered',    // 'remembered' | 'first' | 'explicit'
  
  // Focus behavior
  focusMode: 'entry-node',      // Can be focused as a whole + entered
  
  // Visibility
  hidden: false,                // If true, skip this grid entirely
  collapsed: false,             // If true, grid body is collapsed (header still visible)
  
  // Overlay metadata
  isOverlay: false,             // Is this an overlay (dialog/picker/panel)?
  closeOnEscape: true,          // Close overlay on Escape key?
  modal: true,                  // Block interaction with parent scopes?
  
  meta: {
    label: 'Slice Offset z₀ (10D)'
  }
}
```

---

## Navigation Algorithm

### Core State

```javascript
sessionState: {
  active: boolean,
  
  // Scope Stack (each scope is a grid context)
  scopeStack: [
    {
      gridId: 'root',
      cellId: 'sidebar',
      coords: [0, 1],              // Row, Col in grid
      memory: [0, 1]               // Last position in this grid
    },
    {
      gridId: 'sidebar',
      cellId: 'sec-z0',
      coords: [7, 0],
      memory: [7, 0]
    },
    {
      gridId: 'sec-z0',
      cellId: 'slider-z0:analog',
      coords: [2, 0],
      memory: [2, 0]
    }
  ],
  
  // Global grid memory (persists across scope changes)
  gridMemory: Map<gridId, [row, col]>,
  
  // Overlay tracking (dialogs, pickers, panels)
  overlayStack: [
    { overlayId: 'dialog-welcome', triggerId: null }
  ]
}
```

**Stack Semantics**:
- **Bottom of stack**: Always root grid
- **Each level**: Represents entering a grid (becoming active scope)
- **Top of stack**: Current navigation context
- **Enter**: Push new scope
- **Exit**: Pop scope, restore parent
- **Overlays**: Push scope + add to overlayStack

### Arrow Key Handling

```javascript
function handleArrowKey(key) {
  const scope = getCurrentScope();  // Top of stack
  const grid = getGrid(scope.gridId);
  const [row, col] = scope.coords;
  
  // Calculate target cell
  let targetRow = row, targetCol = col;
  
  if (key === 'ArrowUp') targetRow--;
  else if (key === 'ArrowDown') targetRow++;
  else if (key === 'ArrowLeft') targetCol--;
  else if (key === 'ArrowRight') targetCol++;
  
  // Find target cell, skipping hidden/collapsed
  const targetCell = findVisibleCell(grid, targetRow, targetCol);
  
  if (targetCell) {
    // Move to target cell within current scope
    focusCellInScope(scope.gridId, targetRow, targetCol);
    updateScopeMemory(scope.gridId, targetRow, targetCol);
  } else {
    // Hit boundary - check escape
    const escapeTarget = getEscapeTarget(grid, key);
    
    if (escapeTarget) {
      // Exit current scope and move to escape target
      exitScopeAndFocus(escapeTarget);
    } else {
      // No escape - stay at boundary (do nothing)
    }
  }
}
```

### Enter Key Handling (Scope Entry)

```javascript
function handleEnter() {
  const scope = getCurrentScope();
  const grid = getGrid(scope.gridId);
  const [row, col] = scope.coords;
  const cell = grid.getCell(row, col);
  const cellNode = getNode(cell.id);
  
  // Check if cell is enterable (is itself a grid)
  if (cellNode.kind === 'grid') {
    // Push new scope
    enterGrid(cell.id, cellNode.entryPolicy);
  } else {
    // Execute cell action (activate behavior)
    executeCellAction(cell.id);
  }
}
```

### Escape Key Handling (Scope Exit)

```javascript
function handleEscape() {
  const scope = getCurrentScope();
  
  // Check if we're in an overlay
  if (isOverlay(scope.gridId)) {
    // Close overlay
    closeOverlay(scope.gridId);
    return;
  }
  
  // Check if scope allows escape
  if (scope.gridId !== 'root') {
    // Exit to parent scope
    exitScope();
  }
}
```

### Scope Management

```javascript
// Enter a grid (push scope)
function enterGrid(gridId, policy = 'remembered') {
  const grid = getGrid(gridId);
  
  // Skip if grid is hidden/collapsed
  if (isHidden(grid) || isCollapsed(grid)) {
    return false;
  }
  
  let [row, col] = [0, 0];
  
  // 1. Check memory (highest priority)
  if (policy === 'remembered' && gridMemory.has(gridId)) {
    [row, col] = gridMemory.get(gridId);
  }
  // 2. Use explicit entry cell
  else if (grid.entryCell !== undefined) {
    [row, col] = indexToRowCol(grid.entryCell, grid.cols);
  }
  // 3. Fallback to first visible cell
  else {
    [row, col] = findFirstVisibleCell(grid);
  }
  
  // Validate cell exists and is visible
  const cell = findVisibleCell(grid, row, col);
  if (!cell) {
    return false; // Grid has no visible cells
  }
  
  // Push scope
  scopeStack.push({
    gridId: gridId,
    cellId: cell.id,
    coords: [row, col],
    memory: [row, col]
  });
  
  focusCellInScope(gridId, row, col);
  return true;
}

// Exit grid (pop scope)
function exitScope() {
  if (scopeStack.length <= 1) {
    return; // Can't exit root
  }
  
  // Save memory before popping
  const currentScope = scopeStack.pop();
  saveGridMemory(currentScope.gridId, currentScope.coords);
  
  // Restore parent scope
  const parentScope = getCurrentScope();
  focusCellInScope(parentScope.gridId, parentScope.coords[0], parentScope.coords[1]);
}

// Exit and move to specific target
function exitScopeAndFocus(targetId) {
  // Pop scopes until we find the grid containing target
  while (scopeStack.length > 1) {
    const currentScope = getCurrentScope();
    const currentGrid = getGrid(currentScope.gridId);
    
    // Check if target is a sibling in current grid
    if (currentGrid.hasCell(targetId)) {
      // Focus the target cell
      const [row, col] = currentGrid.getCellCoords(targetId);
      focusCellInScope(currentScope.gridId, row, col);
      return;
    }
    
    // Not found, pop and check parent
    saveGridMemory(currentScope.gridId, currentScope.coords);
    scopeStack.pop();
  }
  
  // If we reach here, target is in a different branch - go to root and navigate
  // (This shouldn't happen with proper escape targets)
  console.warn('[Grid] Could not find target in scope chain:', targetId);
}
```

### Overlay Management

```javascript
// Open overlay (dialog, picker, panel)
function openOverlay(overlayId, triggerId = null) {
  const overlayGrid = getGrid(overlayId);
  
  if (!overlayGrid) {
    console.error('[Grid] Overlay not found:', overlayId);
    return;
  }
  
  // Add to overlay stack
  overlayStack.push({ overlayId, triggerId });
  
  // Enter overlay grid
  enterGrid(overlayId, overlayGrid.entryPolicy);
}

// Close overlay
function closeOverlay(overlayId) {
  const overlay = overlayStack.find(o => o.overlayId === overlayId);
  
  if (!overlay) {
    console.error('[Grid] Overlay not in stack:', overlayId);
    return;
  }
  
  // Pop scopes until we exit the overlay
  while (scopeStack.length > 0) {
    const currentScope = getCurrentScope();
    if (currentScope.gridId === overlayId) {
      scopeStack.pop();
      break;
    }
    scopeStack.pop();
  }
  
  // Remove from overlay stack
  overlayStack = overlayStack.filter(o => o.overlayId !== overlayId);
  
  // Restore focus to trigger or parent
  if (overlay.triggerId) {
    // Find trigger in scope stack and focus it
    focusTrigger(overlay.triggerId);
  } else {
    // Restore to parent scope
    const parentScope = getCurrentScope();
    focusCellInScope(parentScope.gridId, parentScope.coords[0], parentScope.coords[1]);
  }
}
```

### Visibility Handling

```javascript
// Find visible cell at coordinates
function findVisibleCell(grid, row, col) {
  const cell = grid.getCell(row, col);
  
  if (!cell) return null;
  
  const node = getNode(cell.id);
  
  // Check if node is hidden
  if (node.hidden === true) {
    return null;
  }
  
  // Check if node is in a collapsed section
  if (isInCollapsedSection(node)) {
    return null;
  }
  
  return cell;
}

// Find first visible cell in grid
function findFirstVisibleCell(grid) {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = findVisibleCell(grid, row, col);
      if (cell) {
        return [row, col];
      }
    }
  }
  return null;
}

// Check if node is in collapsed section
function isInCollapsedSection(node) {
  let current = node;
  
  // Walk up parent chain
  while (current) {
    if (current.kind === 'section' && current.meta?.collapsed === true) {
      return true;
    }
    current = current.parentId ? getNode(current.parentId) : null;
  }
  
  return false;
}

// Skip to next visible cell in direction
function skipToVisibleCell(grid, startRow, startCol, direction) {
  let row = startRow, col = startCol;
  
  // Move in direction until we find visible cell or hit boundary
  while (true) {
    if (direction === 'up') row--;
    else if (direction === 'down') row++;
    else if (direction === 'left') col--;
    else if (direction === 'right') col++;
    
    const cell = findVisibleCell(grid, row, col);
    
    if (cell) {
      return [row, col];
    }
    
    // Check if we hit boundary
    if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
      return null;
    }
  }
}
```

### Cell Spanning

```javascript
function getCell(grid, row, col) {
  // Find cell that occupies this grid coordinate
  for (const cell of grid.cells) {
    const [cellRow, cellCol] = getCellPosition(cell);
    const inRowSpan = row >= cellRow && row < cellRow + cell.rowSpan;
    const inColSpan = col >= cellCol && col < cellCol + cell.colSpan;
    
    if (inRowSpan && inColSpan) {
      return cell;
    }
  }
  return null;
}
```

---

## Examples of Each UI Element as Grid

### 1. Root Level (Horizontal Navigation)

```javascript
{
  id: 'root',
  kind: 'grid',
  rows: 1,
  cols: 3,
  cells: [
    { id: 'canvas', rowSpan: 1, colSpan: 1 },
    { id: 'sidebar', rowSpan: 1, colSpan: 1 },
    { id: 'canvas-controls', rowSpan: 1, colSpan: 1 }
  ],
  wrapRows: false,
  wrapCols: true,  // Wrap around horizontally
  entryCell: 0,
  entryPolicy: 'explicit'
}
```

### 2. Sidebar (Vertical List)

```javascript
{
  id: 'sidebar',
  kind: 'grid',
  rows: 'auto',  // Calculate from number of sections
  cols: 1,
  cells: [
    { id: 'renderBtn', rowSpan: 1, colSpan: 1 },
    { id: 'ctrl-icons', rowSpan: 1, colSpan: 1 },
    { id: 'sec-mode:header', rowSpan: 1, colSpan: 1 },
    { id: 'sec-mode', rowSpan: 1, colSpan: 1 },
    { id: 'sec-presets:header', rowSpan: 1, colSpan: 1 },
    { id: 'sec-presets', rowSpan: 1, colSpan: 1 },
    { id: 'sec-z0:header', rowSpan: 1, colSpan: 1 },
    { id: 'sec-z0', rowSpan: 1, colSpan: 1 },
    // ...
  ],
  wrapRows: false,
  wrapCols: false,
  escapeLeft: 'canvas',
  entryCell: 0,
  entryPolicy: 'remembered'
}
```

### 3. Button Row (Horizontal)

```javascript
{
  id: 'ctrl-icons',
  kind: 'grid',
  rows: 1,
  cols: 4,
  cells: [
    { id: 'copyLinkBtn', rowSpan: 1, colSpan: 1 },
    { id: 'copyJsonBtn', rowSpan: 1, colSpan: 1 },
    { id: 'savePngBtn', rowSpan: 1, colSpan: 1 },
    { id: 'resetAllBtn', rowSpan: 1, colSpan: 1 }
  ],
  wrapRows: false,
  wrapCols: false,
  escapeUp: 'renderBtn',
  escapeDown: 'sec-mode:header',
  escapeLeft: 'canvas',
  entryCell: 0,
  entryPolicy: 'remembered'
}
```

### 4. Preset Grid (2D Grid)

```javascript
{
  id: 'preset-grid',
  kind: 'grid',
  rows: 3,
  cols: 2,
  cells: [
    { id: 'preset-shape', rowSpan: 1, colSpan: 1 },    // Row 0, Col 0
    { id: 'preset-prho', rowSpan: 1, colSpan: 1 },     // Row 0, Col 1
    { id: 'preset-plambda', rowSpan: 1, colSpan: 1 },  // Row 1, Col 0
    { id: 'preset-shape_pl', rowSpan: 1, colSpan: 1 }, // Row 1, Col 1
    { id: 'preset-custom', rowSpan: 1, colSpan: 2 }    // Row 2, Col 0-1 (spans 2)
  ],
  wrapRows: false,
  wrapCols: false,
  escapeUp: null,
  escapeDown: null,
  entryCell: 0,
  entryPolicy: 'remembered'
}
```

### 5. Slice Offset Section (Grid with Spanning)

```javascript
{
  id: 'sec-z0',
  kind: 'grid',
  rows: 12,
  cols: 2,
  cells: [
    // Row 0: Button group spans both columns
    { id: 'z0-buttons', rowSpan: 1, colSpan: 2 },
    
    // Row 1: Range slider (analog + value)
    { id: 'slider-z0Range:analog', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z0Range:value', rowSpan: 1, colSpan: 1 },
    
    // Row 2-11: z0-z9 sliders (analog + value each)
    { id: 'slider-z0:analog', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z0:value', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z1:analog', rowSpan: 1, colSpan: 1 },
    { id: 'slider-z1:value', rowSpan: 1, colSpan: 1 },
    // ... z2-z9
  ],
  wrapRows: false,
  wrapCols: false,
  escapeUp: null,
  escapeDown: null,
  escapeLeft: 'canvas',
  entryCell: 0,
  entryPolicy: 'remembered'
}
```

**Navigation behavior**:
- **ZERO** → Right → can't move (col 0, but spans 2)
- **ZERO** → Down → **±range analog** (row 1, col 0)
- **±range value** → Down → **z₀ value** (row 2, col 1) - column preserved!
- **z₀ analog** → Up → **±range analog** (row 1, col 0) - column preserved!

### 6. Button Group Inside Grid

```javascript
// z0-buttons is itself a mini-grid nested in sec-z0
{
  id: 'z0-buttons',
  kind: 'grid',
  rows: 1,
  cols: 2,
  cells: [
    { id: 'z0Zero', rowSpan: 1, colSpan: 1 },
    { id: 'z0SmallRand', rowSpan: 1, colSpan: 1 }
  ],
  wrapRows: false,
  wrapCols: false,
  escapeUp: null,    // Parent grid handles this
  escapeDown: null,  // Parent grid handles this
  entryCell: 0,
  entryPolicy: 'remembered'
}
```

### 7. Dialog (Vertical List with Overlay)

```javascript
{
  id: 'dialog-welcome',
  kind: 'grid',
  rows: 3,
  cols: 1,
  cells: [
    { id: 'dialog-welcome:check-disableAutoRender', rowSpan: 1, colSpan: 1 },
    { id: 'dialog-welcome:check-dontShowAgain', rowSpan: 1, colSpan: 1 },
    { id: 'dialog-welcome:btn-confirm', rowSpan: 1, colSpan: 1 }
  ],
  wrapRows: true,       // Wrap around in dialogs
  wrapCols: false,
  entryCell: 2,         // Focus button first
  entryPolicy: 'explicit',
  
  // Overlay properties
  isOverlay: true,
  closeOnEscape: false, // Welcome dialog doesn't close on Escape
  modal: true
}
```

### 8. Section with Collapsed State

```javascript
// Section header (always visible)
{
  id: 'sec-z0:header',
  kind: 'leaf',        // Not a grid, just a button
  action: 'toggle-collapse',
  meta: {
    sectionId: 'sec-z0',
    label: 'Slice Offset z₀ (10D)'
  }
}

// Section body (grid that can be collapsed)
{
  id: 'sec-z0',
  kind: 'grid',
  rows: 12,
  cols: 2,
  cells: [...],
  collapsed: false,    // When true, this grid is hidden
  
  // Sidebar includes both header and body
  // When collapsed=true, navigation skips from header to next section header
}
```

**Collapsed Navigation Behavior**:
- **Header** → Down → Next **visible** section (skip collapsed body)
- **Header** → Enter → Toggle collapse, enter if now open
- **Inside section** → Escape → Exit to header (don't skip to sidebar)

### 9. Picker Overlay

```javascript
// Picker trigger (in parent grid)
{
  id: 'modePicker:trigger',
  kind: 'leaf',
  action: 'open-picker',
  meta: {
    pickerId: 'modePicker:overlay'
  }
}

// Picker overlay (separate grid, opened on trigger)
{
  id: 'modePicker:overlay',
  kind: 'grid',
  rows: 3,
  cols: 1,
  cells: [
    { id: 'modePicker:option-quality', rowSpan: 1, colSpan: 1 },
    { id: 'modePicker:option-linear', rowSpan: 1, colSpan: 1 },
    { id: 'modePicker:option-exp', rowSpan: 1, colSpan: 1 }
  ],
  wrapRows: false,
  wrapCols: false,
  entryCell: 0,
  entryPolicy: 'explicit',
  
  // Overlay properties
  isOverlay: true,
  closeOnEscape: true,  // Close on Escape
  modal: true
}
```

**Picker Navigation**:
- **Trigger** → Enter → Open overlay, enter picker grid
- **In picker** → Escape → Close overlay, return to trigger
- **In picker** → Enter on option → Select, close overlay, return to trigger

---

## Auto-Scroll & Resize Handling

### Cursor Position Updates

The `FocusVisualizer` must track and update cursor position when:
1. **Window resize** - Element position changes
2. **Scroll events** - Element moves relative to viewport
3. **Focus changes** - New element focused

### Scroll-into-View Behavior

When focusing an element that's off-screen or partially visible:

```javascript
function scrollIntoView(element) {
  const rect = element.getBoundingClientRect();
  const viewport = {
    top: 0,
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth
  };
  
  // Check if element is off-screen or partially visible
  const isOffScreen = 
    rect.bottom < viewport.top ||
    rect.top > viewport.bottom ||
    rect.right < viewport.left ||
    rect.left > viewport.right;
  
  const isPartiallyVisible = 
    rect.top < viewport.top ||
    rect.bottom > viewport.bottom ||
    rect.left < viewport.left ||
    rect.right > viewport.right;
  
  if (isOffScreen || isPartiallyVisible) {
    // Calculate scroll to center element in viewport
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const scrollX = centerX - viewport.right / 2;
    const scrollY = centerY - viewport.bottom / 2;
    
    // Smooth scroll to center
    window.scrollTo({
      left: window.scrollX + scrollX,
      top: window.scrollY + scrollY,
      behavior: 'smooth'
    });
    
    // For sidebar elements, scroll the sidebar container
    const sidebar = element.closest('.sidebar');
    if (sidebar) {
      const sidebarRect = sidebar.getBoundingClientRect();
      const elementRelativeTop = rect.top - sidebarRect.top;
      const scrollCenter = elementRelativeTop - sidebar.clientHeight / 2 + rect.height / 2;
      
      sidebar.scrollTo({
        top: sidebar.scrollTop + scrollCenter,
        behavior: 'smooth'
      });
    }
  }
}
```

### FocusVisualizer Updates

```javascript
class FocusVisualizer {
  constructor() {
    this.cursor = null;
    this.currentElement = null;
    
    // Bind event listeners
    window.addEventListener('resize', () => this._updateCursorPosition());
    window.addEventListener('scroll', () => this._updateCursorPosition(), true); // Capture phase
    
    // Use ResizeObserver for element size changes
    this.resizeObserver = new ResizeObserver(() => this._updateCursorPosition());
  }
  
  render(element, isInteracting) {
    this.currentElement = element;
    
    // Observe element for size changes
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(element);
    }
    
    // Scroll into view if needed
    scrollIntoView(element);
    
    // Update cursor position
    this._updateCursorPosition();
    this._updateCursorStyle(isInteracting);
    this.show();
  }
  
  _updateCursorPosition() {
    if (!this.currentElement) return;
    
    const rect = this.currentElement.getBoundingClientRect();
    const gap = 4;
    
    this.cursor.style.left = `${rect.left - gap}px`;
    this.cursor.style.top = `${rect.top - gap}px`;
    this.cursor.style.width = `${rect.width + gap * 2}px`;
    this.cursor.style.height = `${rect.height + gap * 2}px`;
  }
  
  hide() {
    this.cursor.style.display = 'none';
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}
```

### Sidebar Scroll Handling

Since the sidebar is a scrollable container, we need special handling:

```javascript
function scrollSidebarIntoView(element) {
  const sidebar = document.querySelector('.sidebar-content');
  if (!sidebar) return;
  
  const sidebarRect = sidebar.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  
  // Calculate position relative to sidebar
  const relativeTop = elementRect.top - sidebarRect.top;
  const relativeBottom = elementRect.bottom - sidebarRect.top;
  
  // Check if element is outside visible area of sidebar
  const isAbove = relativeTop < 0;
  const isBelow = relativeBottom > sidebar.clientHeight;
  
  if (isAbove || isBelow) {
    // Scroll to center element in sidebar
    const scrollCenter = sidebar.scrollTop + relativeTop - sidebar.clientHeight / 2 + elementRect.height / 2;
    
    sidebar.scrollTo({
      top: scrollCenter,
      behavior: 'smooth'
    });
  }
}
```

---

## Implementation Steps

### Phase 1: Core Grid System (4-6 hours)

1. **Create `GridNavigationManager.js`**
   - Grid state tracking
   - Arrow key handler
   - Cell coordinate logic
   - Memory system

2. **Create `GridBuilder.js`**
   - Helper functions to build grid nodes
   - Auto-calculate rows/cols from cells
   - Validate grid structure

3. **Update `UITreeStore.js`**
   - Support grid nodes
   - Grid query methods (`getCell`, `getCellCoords`)

### Phase 2: Convert Tree to Grids (6-8 hours)

4. **Update `principia-tree.js`**
   - Rebuild root as grid
   - Rebuild sidebar as grid
   - Rebuild all sections as grids
   - Add cell coordinates

5. **Update builders**
   - `button()` → leaf node
   - `buttonGroup()` → grid
   - `section()` → grid
   - `slider()` → grid with 2 cells

### Phase 3: Integration (4-6 hours)

6. **Update `KeyboardNavigationManager.js`**
   - Replace arrow key logic with `GridNavigationManager`
   - Keep overlay/scope stack logic
   - Keep Enter/Escape/Tab handling

7. **Update `attach.js`**
   - Attach elements to grid cells

8. **Update behaviors**
   - Simplify (no more special horizontal/vertical logic)

### Phase 4: Testing & Polish (2-4 hours)

9. **Test all navigation patterns**
   - Root level horizontal nav
   - Sidebar vertical nav
   - 2D preset grid
   - Slider section with column memory
   - Dialogs
   - Section entry/exit

10. **Debug & refine**

---

## Migration Strategy

### Option A: Big Bang (Faster, Riskier)
Replace everything at once, test thoroughly.

### Option B: Incremental (Safer, Slower)
1. Implement GridNavigationManager alongside existing system
2. Convert one section at a time (start with preset grid)
3. Gradually replace all sections
4. Remove old navigation code

**Recommendation**: Option A (Big Bang) - the current system is already buggy, and the grid system is simpler.

---

## Benefits Summary

✅ **Simpler code** - One algorithm vs many special cases  
✅ **Easier to debug** - Just coordinates, no complex traversal  
✅ **Automatic memory** - Track (row, col) per grid  
✅ **Clear boundaries** - Explicit escape targets  
✅ **Supports spanning** - Multi-column/row cells  
✅ **Consistent behavior** - Everything works the same way  

---

## Next Steps

1. Review and approve this plan
2. Start Phase 1: Core Grid System
3. Build incrementally with frequent testing
