# Semantic Tree Refactoring - Summary

**Quick reference for the Principia GUI refactoring to semantic UI tree architecture**

---

## Documents

1. **`SEMANTIC_UI_TREE_SPEC.md`** (v1.5.3 - FROZEN)
   - Complete technical specification
   - Type definitions, interfaces, API contracts
   - 2556 lines, implementation-ready

2. **`SEMANTIC_TREE_REFACTOR_PLAN.md`** (THIS PLAN)
   - Phase-by-phase migration strategy
   - Code examples for each phase
   - 6-week timeline with success criteria

3. **`PRINCIPIA_UI_TREE_MAPPING.md`** (REFERENCE)
   - Maps existing codebase to tree structure
   - Shows current factories and sections
   - Identifies dynamic content patterns

---

## Core Concept

**Current:** Imperative DOM construction with factories
```javascript
const slider = createSlider({ id: 'gamma', min: 0, max: 360, ... });
container.appendChild(slider);
document.getElementById('gamma').addEventListener('input', handler);
```

**Target:** Semantic tree as source of truth
```javascript
// Define structure
const gammaNode = slider("slider-gamma", { min: 0, max: 360, ... });
uiTree.addNodes(gammaNode.nodes);

// Render from tree
const sliderProjection = new SliderProjection(uiTree);
const element = sliderProjection.render("slider-gamma");

// Navigation reads tree
const adapter = new SemanticTreeAdapter(uiTree, navManager);
const navTree = adapter.buildNavigationTree();
```

---

## 6-Phase Migration

### Phase 1: Foundation (Week 1)
**Goal:** Build tree alongside existing UI, no behavior changes

**Deliverables:**
- `UITreeStore` implementation
- Builder functions (slider, section, picker, button, buttonGroup)
- `buildPrincipiaUITree()` defining complete structure
- Tree initialized in `main.js`, exposed as `window.uiTree`

**Verification:** `window.uiTree.toJSON()` shows complete hierarchy

---

### Phase 2: Element Binding (Week 2)
**Goal:** Connect DOM elements to tree nodes

**Deliverables:**
- `attachPrincipiaElements()` binds all static elements
- Dynamic builders (z0 sliders, presets) register nodes
- All elements retrievable via `uiTree.getElement(id)`

**Verification:** Click any element, find its tree node via ID

---

### Phase 3: Navigation Integration (Week 3)
**Goal:** Keyboard navigation driven by semantic tree

**Deliverables:**
- `KeyboardNavigationManager` (from KEYBOARD_NAVIGATION_SPEC.md)
- `SemanticTreeAdapter` converts UITree → NavTree
- `TreeNavigationBridge` syncs tree mutations with navigation
- Basic keyboard nav (Tab, arrow keys) works

**Verification:** Tab through UI, focus follows tree structure

---

### Phase 4: Render Projection (Week 4)
**Goal:** Replace factories with tree-driven rendering

**Deliverables:**
- `SliderProjection` renders sliders from tree nodes
- One section (e.g., Orientation) fully tree-rendered
- Old factory code removable for converted sections

**Verification:** Converted section looks/works identical to factory version

---

### Phase 5: Event Handler Migration (Week 5)
**Goal:** Events update tree, not DOM directly

**Deliverables:**
- `UpdateBridge` mediates between events and tree
- Event handlers call `uiTree.updateNode()` instead of DOM manipulation
- Tree mutations trigger nav reconciliation automatically

**Verification:** Change slider → tree updates → nav updates → DOM updates

---

### Phase 6: State Integration (Week 6)
**Goal:** Tree becomes source of truth for UI state

**Deliverables:**
- `syncUIFromState()` updates tree only
- Application state reads from tree
- All imperative DOM manipulation removed

**Verification:** `state.gammaDeg = 90` → tree updates → UI reflects change

---

## Key Architecture Principles

### 1. Tree Defines Interaction Topology (Not Visual Layout)

**Tree cares about:**
- Navigation order (Tab traversal)
- Focus behavior (leaf vs container)
- Semantic relationships (param-trigger → dropdown)
- Overlay boundaries (modal dialogs)
- Widget composition (slider = analog-control + value-editor)

**Tree doesn't care about:**
- CSS layout (flexbox, grid, pixels)
- Visual styling (colors, fonts, spacing)
- Responsive design (breakpoints, media queries)
- Decorative wrappers (`.sl-row`, `.section-body`)

### 2. Separation of Concerns

```
┌─────────────────────────────────────────────┐
│  Semantic UI Tree (UITreeStore)             │  ← Source of truth
│  - Structure (sections, sliders, buttons)   │
│  - IDs (stable, for focus restoration)      │
│  - Metadata (min/max, labels, tips)         │
└────────────┬────────────────────────────────┘
             │
             ├──► Render Projection ──────► DOM
             │    (SliderProjection,        (HTML elements)
             │     SectionProjection)
             │
             └──► Navigation Projection ───► NavTree
                  (SemanticTreeAdapter)     (KeyboardNavigationManager)
```

### 3. Single Highlight Invariant

Only one visual cursor/highlight on screen at any time. The navigation manager maintains `currentNodeId`, and the render layer shows highlight for that node only.

### 4. Overlay Independence

Overlays (pickers, dialogs) have `parentId: null` in tree. They use:
- `triggerId`: Who opened this overlay (for breadcrumbs, restoration)
- `returnFocusId`: Explicit restoration target (optional override)

### 5. Stable IDs for Focus Restoration

Child IDs are canonical derivatives of parent IDs:
```javascript
slider("slider-gamma", ...) creates:
- "slider-gamma" (scope)
- "slider-gamma:analog" (analog-control)
- "slider-gamma:value" (value-editor)
```

---

## Critical Migration Rules

### DO

✅ Build tree first, verify structure  
✅ Keep old factories working during transition  
✅ Test after each phase  
✅ Use feature flags for tree-rendered sections  
✅ Profile performance (tree ops should be <1ms)  
✅ Document state flow changes  
✅ Expose `window.uiTree` for debugging  

### DON'T

❌ Delete working factory code before replacement proven  
❌ Change UI behavior during migration (except keyboard nav)  
❌ Mix imperative DOM + tree updates in same component  
❌ Put visual layout (CSS properties) in tree  
❌ Mutate tree nodes directly (always use `updateNode()`)  
❌ Skip phases (each builds on previous)  
❌ Rush - 1 week per phase is realistic  

---

## Rollback Strategy

If anything breaks:

1. Comment out tree initialization in `main.js`
2. Remove tree imports from `ui.js`
3. Delete `src/ui/semantic-tree/` directory
4. Delete `src/navigation/SemanticTreeAdapter.js`, `TreeNavigationBridge.js`
5. Verify existing factories still work
6. Git: `git revert <migration-commits>`

**Keep old factories until Phase 4+ proves stable.**

---

## Testing Checklist (After Each Phase)

- [ ] All buttons clickable
- [ ] All sliders draggable + number inputs work
- [ ] All pickers open and close
- [ ] Sections collapse/expand
- [ ] State sync works (URL hash, JSON import/export)
- [ ] No console errors
- [ ] No visual regressions
- [ ] Keyboard navigation works (if Phase 3+)
- [ ] Performance no worse than before

---

## Quick Start (Phase 1)

```bash
# 1. Create directory structure
mkdir -p src/ui/semantic-tree src/navigation

# 2. Copy spec interfaces to types.js
# (Extract TypeScript interfaces from SEMANTIC_UI_TREE_SPEC.md)

# 3. Implement UITreeStore
touch src/ui/semantic-tree/store.js

# 4. Implement builders
touch src/ui/semantic-tree/builders.js

# 5. Define Principia tree
touch src/ui/semantic-tree/principia-tree.js

# 6. Initialize in main.js
# Add: import { UITreeStore } from './ui/semantic-tree/store.js';
#      const uiTree = new UITreeStore();
#      uiTree.addNodes(buildPrincipiaUITree());
#      window.uiTree = uiTree;

# 7. Test
# Open console: window.uiTree.toJSON()
# Should show complete tree structure
```

---

## File Checklist

### To Create

- [ ] `src/ui/semantic-tree/store.js` - UITreeStore
- [ ] `src/ui/semantic-tree/builders.js` - Builder functions
- [ ] `src/ui/semantic-tree/principia-tree.js` - Tree definition
- [ ] `src/ui/semantic-tree/attach.js` - Element binding
- [ ] `src/ui/semantic-tree/update-bridge.js` - Event → tree updates
- [ ] `src/ui/projections/SliderProjection.js` - Slider renderer
- [ ] `src/ui/projections/SectionProjection.js` - Section renderer
- [ ] `src/ui/projections/PickerProjection.js` - Picker renderer
- [ ] `src/navigation/KeyboardNavigationManager.js` - Nav engine
- [ ] `src/navigation/SemanticTreeAdapter.js` - UITree → NavTree
- [ ] `src/navigation/TreeNavigationBridge.js` - Reactive reconciliation

### To Modify

- [ ] `src/main.js` - Initialize tree + navigation
- [ ] `src/ui.js` - Export tree utilities
- [ ] `src/ui/sidebar/initSections.js` - Use tree rendering
- [ ] `src/ui/builders/presets.js` - Register dynamic nodes
- [ ] `src/ui/components/slider/slider.js` - Register z0 sliders
- [ ] `src/ui/sync.js` - Update tree instead of DOM

### To Eventually Remove

- [ ] `src/ui/components/slider/SliderFactory.js` - Replace with projection
- [ ] `src/ui/components/section/SectionFactory.js` - Replace with projection
- [ ] Most of `src/ui/pickers/` - Replace with tree overlays

---

## Success Criteria (End of Phase 6)

- ✅ Semantic tree is single source of truth
- ✅ Keyboard navigation fully functional
- ✅ Focus restoration works after overlay close
- ✅ All event handlers update tree, not DOM
- ✅ State sync flows through tree
- ✅ Dynamic content (presets, z0) managed via tree
- ✅ No imperative DOM manipulation remaining
- ✅ Tree serializable to JSON for debugging
- ✅ Performance equal to or better than current
- ✅ Zero UI regressions

---

## Resources

**Specs:**
- `docs/SEMANTIC_UI_TREE_SPEC.md` - Complete type definitions and API
- `docs/KEYBOARD_NAVIGATION_SPEC.md` - Navigation system details

**Reference:**
- `docs/PRINCIPIA_UI_TREE_MAPPING.md` - Current codebase mapping
- `docs/SEMANTIC_UI_TREE_INTEGRATION_PLAN.md` - High-level strategy

**Plan:**
- `docs/SEMANTIC_TREE_REFACTOR_PLAN.md` - Detailed phase-by-phase guide (this doc)

---

## Contact Points

**Questions about:**
- Tree structure → See SEMANTIC_UI_TREE_SPEC.md Section "Tree Structure"
- Navigation → See SEMANTIC_UI_TREE_SPEC.md Section "Navigation Bridge API"
- Rendering → See SEMANTIC_TREE_REFACTOR_PLAN.md Phase 4
- Migration strategy → See SEMANTIC_TREE_REFACTOR_PLAN.md "Migration Timeline"

**Debugging:**
- `window.uiTree.toJSON()` - Full tree structure
- `window.uiTree.getElement(id)` - Get DOM element for node
- `window.navManager.sessionState` - Current navigation state
- `window.navBridge` - Tree/nav synchronization

---

**Status:** Phase 0 (Planning Complete) → Ready for Phase 1

**Timeline:** 6 weeks (March-April 2026)

**Risk:** Low (incremental approach, no breaking changes until Phase 4)

**Impact:** High (enables keyboard nav, focus restoration, better maintainability)

---

## Design Assessment

### Is the architecture well-suited to the current GUI?

**Yes, for Phases 1–3.** The semantic tree maps cleanly to Principia's sidebar structure.
The existing factory pattern (SliderFactory, SectionFactory, PickerFactory) already
implies a widget model — the tree just makes it explicit and queryable. Phases 1–3
give the keyboard navigation system everything it needs.

**Phases 4–6 are over-scope.** Converting the render path (factories → projections)
and the event/state system is significant rearchitecting with real regression risk,
for zero user-visible benefit beyond what Phase 3 delivers. The existing factories are
small, well-tested, and already working. The slider DOM in particular is more complex
than the spec anticipates: `enhanceSlider()` adds track fill, markers, and a wrapping
element hierarchy that `SliderProjection` would need to replicate exactly.

**Recommendation:** Treat Phase 3 as the delivery milestone. Phases 4–6 should be
a separate project decision, not part of the keyboard navigation work.

### How difficult is the implementation?

| Phase | Effort | Notes |
|---|---|---|
| 1. Foundation | ~3 days | Mechanical: tree store, builders, tree definition. Main risk: getting principia-tree.js complete and correct for dynamic content. |
| 2. Element Binding | ~2 days | Mostly mechanical. Z0 slider attachment and preset registration require care. |
| 3. Navigation | ~2–3 weeks | The hard phase. Full KNM per spec (LinearTraversalPolicy, FocusVisualizer, behavior modules per widget type), section enter/exit flow, overlay stack, visual cursor (CSS + JS). Dialog integration adds a day. |
| 4. Render Projection | ~1–2 weeks | Must replicate enhanced slider DOM exactly. Risk of regressions. |
| 5. Event Migration | ~1 week | Refactoring event handlers to be tree-mediated. Low regression risk if done incrementally. |
| 6. State Integration | ~1 week | Making syncUIFromState tree-driven. Low-risk mechanical work. |

**Phase 3 is the implementation.** The spec (KEYBOARD_NAVIGATION_SPEC.md v2.4) is
detailed and well thought-out but it describes real complexity: the traversal engine,
entry/exit policies, overlay stack, animated brackets, and per-widget behaviors for
analog controls, value editors, param triggers, and checkboxes. Budget accordingly.

### Known issues fixed in plan (since initial planning)

1. `UITreeStore.addNodes()` now infers parentId from children arrays (builders can't
   set parentId at construction time since the parent isn't built yet)
2. `slider()` builder cleaned up (removed confusing self-push to childIds)
3. `SliderProjection.render()` fixed: `getChildren()` returns node objects, not IDs
4. Z0 slider attachment fixed: range inputs have no `id` — use container row index
5. `buildZ0Sliders` updated to accept `uiTree` parameter instead of `window.uiTree`
6. `principia-tree.js` now includes `customDimH/V-picker` and `preset-grid` container
7. Dialog system conflict documented with integration approach (Phase 3.5)
8. `slider()` builder sets `focusMode: 'entry-node'` (sliders are focusable before entering)
