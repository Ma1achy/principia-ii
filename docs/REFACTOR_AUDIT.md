# Grid Navigation Refactor - Codebase Audit

## Current Files Overview

### Navigation Files (src/navigation/)
1. `KeyboardNavigationManager.js` (870 lines)
2. `FocusVisualizer.js` (254 lines)
3. `FocusEffects.js` (151 lines)
4. `NavTraversal.js`
5. `BehaviorRegistry.js`
6. `behaviors.js`
7. `TreeNavigationBridge.js`
8. `SemanticTreeAdapter.js`

### Semantic Tree Files (src/ui/semantic-tree/)
1. `UITreeStore.js` (356 lines)
2. `principia-tree.js` (494 lines)
3. `builders.js`
4. `attach.js` (235 lines)
5. `EventEmitter.js`
6. `index.js`

---

## File-by-File Analysis

### ✅ KEEP (With Minor Updates)

#### 1. `FocusVisualizer.js`
**Current functionality:**
- Creates and positions navigation cursor
- Updates cursor style (orange/cyan, glow)
- Shows/hides cursor

**Why keep:**
- Core cursor rendering logic is solid
- Visual styling works well
- Just needs scroll/resize handling added

**Changes needed:**
- ✏️ Add window resize listener
- ✏️ Add scroll listeners (window + sidebar)
- ✏️ Add ResizeObserver for element tracking
- ✏️ Add `scrollIntoView()` logic

**Status:** ~80% reusable, needs enhancements

---

#### 2. `FocusEffects.js`
**Current functionality:**
- DOM focus operations
- Tabindex management
- Focus restoration

**Why keep:**
- Abstracts browser focus APIs cleanly
- No navigation logic (pure DOM utilities)
- Well-tested, no known issues

**Changes needed:**
- ✏️ None (maybe add grid-specific tabindex helpers)

**Status:** 100% reusable as-is

---

#### 3. `UITreeStore.js`
**Current functionality:**
- Node storage (Map-based)
- Parent/child relationships
- Element attachment
- Node queries (getNode, getChildren, etc.)
- Event emission (add/update/remove)

**Why keep:**
- Core data structure is sound
- Event system useful for debugging
- Query methods are generic

**Changes needed:**
- ✏️ Add grid-specific query methods:
  - `getGridCell(gridId, row, col)` - Get cell at coordinates
  - `getCellCoords(gridId, cellId)` - Get coordinates of cell
  - `getVisibleCells(gridId)` - Get non-hidden/collapsed cells
  - `isInCollapsedSection(nodeId)` - Check visibility
- ✏️ Keep existing queries (still useful)

**Status:** 90% reusable, needs grid methods

---

#### 4. `EventEmitter.js`
**Current functionality:**
- Simple event bus (on/off/emit)

**Why keep:**
- Generic utility, no navigation logic
- Used by UITreeStore for debugging

**Changes needed:**
- ✏️ None

**Status:** 100% reusable as-is

---

#### 5. `index.js` (semantic-tree)
**Current functionality:**
- Exports singleton UITreeStore instance

**Why keep:**
- Simple barrel export, no logic

**Changes needed:**
- ✏️ None

**Status:** 100% reusable as-is

---

#### 6. `BehaviorRegistry.js`
**Current functionality:**
- Maps node kinds to behavior factories

**Why keep:**
- Decouples behaviors from navigation
- Extensible pattern

**Changes needed:**
- ✏️ Update behavior signatures for grid system
- ✏️ Simplify behavior API (no more enter/exit scope logic)

**Status:** 80% reusable, needs API update

---

#### 7. `behaviors.js`
**Current functionality:**
- Behavior implementations (button, canvas, slider, etc.)
- onActivate, onEnter, onExit handlers

**Why keep:**
- Domain logic for each node type
- Button clicks, slider adjustments, etc. still needed

**Changes needed:**
- ✏️ Simplify API - remove scope enter/exit logic
- ✏️ Update to work with grid coordinates
- ✏️ Keep core actions (click, adjust, toggle)

**Status:** 60% reusable, needs refactoring

---

### ♻️ REFACTOR (Partial Rewrite)

#### 8. `KeyboardNavigationManager.js`
**Current functionality:**
- Arrow key handling (lots of special cases)
- Enter/Escape handling
- Scope stack management
- Overlay management
- Session state tracking
- Mouse interaction handling

**What to keep:**
- ✅ Session state structure (active, overlayStack)
- ✅ Overlay management logic (openOverlay, closeOverlay)
- ✅ Mouse interaction handler (deactivate on click)
- ✅ Lazy activation (first key press)
- ✅ Basic Enter/Escape handling

**What to replace:**
- ❌ Arrow key logic (replace with grid navigation)
- ❌ navigate() function (too complex)
- ❌ navigateHorizontal() (not needed)
- ❌ All horizontal/vertical special cases
- ❌ Column memory hacks (Map-based approach is fine, but logic needs simplification)

**Refactor plan:**
1. Keep the class structure
2. Replace arrow key handler with grid-based logic
3. Simplify scope stack (use grid coordinates)
4. Keep overlay/activation/mouse logic

**Status:** 40% reusable, major refactor needed

---

#### 9. `principia-tree.js`
**Current functionality:**
- Defines static UI tree structure
- Creates all nodes (canvas, sidebar, sections, etc.)
- Sets up parent/child relationships

**What to keep:**
- ✅ Overall structure (root → sidebar → sections)
- ✅ Node IDs (keep naming)
- ✅ Element creation approach

**What to replace:**
- ❌ Node definitions (convert to grid format)
- ❌ Current focus modes (replace with grid properties)
- ❌ Section structure (use grid + collapsed state)

**Refactor plan:**
1. Convert each container to grid format
2. Define cells with row/col/span
3. Set escape targets explicitly
4. Keep leaf nodes (buttons, inputs) mostly as-is

**Status:** 30% reusable, major restructure needed

---

#### 10. `builders.js`
**Current functionality:**
- Factory functions for creating nodes
- root(), section(), button(), buttonGroup(), slider(), picker(), etc.

**What to keep:**
- ✅ Factory pattern
- ✅ Leaf node builders (button, checkbox, etc.)

**What to replace:**
- ❌ Container builders (root, section, buttonGroup, etc.)
- ❌ focusMode concept (replace with grid properties)
- ❌ entryPolicy (keep but adapt for grids)

**Refactor plan:**
1. Create `grid()` builder (main container type)
2. Create `cell()` builder (grid cell with span)
3. Keep leaf builders (button, checkbox, slider parts)
4. Remove old container types

**Status:** 50% reusable, needs new grid builders

---

#### 11. `attach.js`
**Current functionality:**
- Attaches DOM elements to tree nodes
- Section-specific attachment logic
- Slider/picker attachment
- Tabindex initialization

**What to keep:**
- ✅ Element attachment pattern
- ✅ attachSlider() helper
- ✅ Tabindex initialization logic

**What to replace:**
- ❌ Section attachment (adapt for grid structure)
- ❌ Some special case logic (simplify)

**Refactor plan:**
1. Adapt for grid structure
2. Keep leaf node attachment logic
3. Simplify section handling

**Status:** 70% reusable, minor refactoring

---

### ❌ DELETE (No Longer Needed)

#### 12. `NavTraversal.js`
**Current functionality:**
- Navigation algorithms (getNextNode, resolveToFocusable)
- Tree traversal logic
- Sibling/parent navigation

**Why delete:**
- ❌ Entire tree traversal approach replaced by grid coordinates
- ❌ getNextNode() not needed (just increment row/col)
- ❌ resolveToFocusable() not needed (grid cells are already focusable)

**Status:** 0% reusable, DELETE

---

#### 13. `SemanticTreeAdapter.js`
**Current functionality:**
- Adapter between tree and navigation

**Why delete:**
- ❌ Adapter pattern not needed with direct grid access
- ❌ Adds unnecessary abstraction layer

**Status:** 0% reusable, DELETE

---

#### 14. `TreeNavigationBridge.js`
**Current functionality:**
- Bridges tree operations with navigation manager

**Why delete:**
- ❌ Bridge pattern not needed with simplified architecture
- ❌ Overlay registration can be done directly in KNM

**Status:** 0% reusable, DELETE

---

### 🆕 NEW FILES NEEDED

#### 15. `GridNavigationManager.js` (NEW)
**Purpose:**
- Pure grid navigation logic
- Coordinate arithmetic
- Cell lookup
- Visibility filtering
- Memory management

**Core methods:**
```javascript
- handleArrowKey(direction)
- moveToCell(gridId, row, col)
- findVisibleCell(grid, row, col)
- getEscapeTarget(grid, direction)
- enterGrid(gridId, policy)
- exitScope()
```

**Why needed:**
- Core of new navigation system
- Replaces complex tree traversal
- Clean separation of concerns

**Estimated size:** ~300-400 lines

---

#### 16. `GridBuilder.js` (NEW)
**Purpose:**
- Helper functions for building grids
- Cell layout calculation
- Auto-dimension calculation
- Grid validation

**Core methods:**
```javascript
- grid(id, config)
- cell(id, rowSpan, colSpan)
- autoCalculateDimensions(cells)
- validateGridStructure(grid)
- flattenToRowMajor(cells)
```

**Why needed:**
- Makes tree building easier
- Validates grid structure
- Calculates dimensions automatically

**Estimated size:** ~200-300 lines

---

## Summary Statistics

### Files to Keep (8 files)
1. ✅ FocusVisualizer.js (minor updates)
2. ✅ FocusEffects.js (as-is)
3. ✅ UITreeStore.js (add grid methods)
4. ✅ EventEmitter.js (as-is)
5. ✅ index.js (as-is)
6. ✅ BehaviorRegistry.js (API update)
7. ✅ behaviors.js (refactor)
8. ✅ attach.js (adapt)

### Files to Refactor (3 files)
1. ♻️ KeyboardNavigationManager.js (40% keep, major refactor)
2. ♻️ principia-tree.js (30% keep, restructure)
3. ♻️ builders.js (50% keep, new grid builders)

### Files to Delete (3 files)
1. ❌ NavTraversal.js
2. ❌ SemanticTreeAdapter.js
3. ❌ TreeNavigationBridge.js

### New Files (2 files)
1. 🆕 GridNavigationManager.js
2. 🆕 GridBuilder.js

---

## Code Reusability Estimate

**Total current codebase:** ~2500-3000 lines

**Reusable as-is:** ~1000 lines (33%)
- FocusEffects, EventEmitter, parts of UITreeStore, attach

**Reusable with refactoring:** ~800 lines (27%)
- behaviors, parts of KNM, parts of builders

**Delete:** ~700 lines (23%)
- NavTraversal, adapters, bridges

**New code needed:** ~500-700 lines (17%)
- GridNavigationManager, GridBuilder

**Net change:** Similar size, much cleaner architecture

---

## Implementation Priority

### Phase 1: Foundation (Keep existing system working)
1. Create `GridBuilder.js` (new utilities)
2. Add grid methods to `UITreeStore.js`
3. Update `FocusVisualizer.js` (scroll/resize)

### Phase 2: Core Navigation (Replace navigation engine)
4. Create `GridNavigationManager.js`
5. Refactor `KeyboardNavigationManager.js` (use GridNavigationManager)
6. Update `behaviors.js` (simplify API)

### Phase 3: Tree Conversion (Convert data)
7. Update `builders.js` (add grid builders)
8. Refactor `principia-tree.js` (convert to grids)
9. Update `attach.js` (adapt for grids)

### Phase 4: Cleanup (Remove old code)
10. Delete `NavTraversal.js`
11. Delete `SemanticTreeAdapter.js`
12. Delete `TreeNavigationBridge.js`
13. Remove unused code from `KeyboardNavigationManager.js`

---

## Risk Assessment

**Low Risk (Can keep existing):**
- ✅ FocusVisualizer (just enhancements)
- ✅ UITreeStore (additive changes)
- ✅ Behaviors (refactor but keep structure)

**Medium Risk (Major refactor):**
- ⚠️ KeyboardNavigationManager (keep skeleton, new logic)
- ⚠️ principia-tree (data transformation)

**High Risk (Complete rewrite):**
- ⛔ Navigation algorithms (complete paradigm shift)

**Mitigation:**
- Incremental approach (add before removing)
- Test each phase thoroughly
- Keep old code until new code proven

---

## Next Steps

1. ✅ Review and approve this audit
2. Start Phase 1 (Foundation) - Low risk, additive changes
3. Test Phase 1 with existing system
4. Proceed to Phase 2 only when Phase 1 is stable
