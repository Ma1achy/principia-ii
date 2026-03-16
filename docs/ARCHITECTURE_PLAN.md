# Modular Architecture Redesign — Semantic UI Tree + Keyboard Navigation

## Context

The IMPLEMENTATION_GUIDE.md describes a 5-phase system: UITreeStore, builders, element binding, a navigation layer (SemanticTreeAdapter, KeyboardNavigationManager, TreeNavigationBridge), and eventually migration of existing factories. The guide is functionally correct after recent bug fixes, but several modules mix concerns, hardcode DOM access, and cannot be tested in isolation. This plan restructures the architecture for clean separation of concerns, dependency injection, and testability — without changing what the system does.

---

## Key Architectural Changes

### 1. Split UITreeStore into focused modules

**Current:** One 15-method class spanning node CRUD, element binding, queries, and overlay management.

**New:**

| Module | File | Responsibility |
|---|---|---|
| `NodeStore` | `src/ui/semantic-tree/NodeStore.js` | Node CRUD, tree queries, event emission |
| `ElementRegistry` | `src/ui/semantic-tree/ElementRegistry.js` | DOM element binding + reverse lookup map |
| `OverlayManager` | `src/ui/semantic-tree/OverlayManager.js` | Transient overlay register/remove (delegates to NodeStore) |
| `UITreeStore` | `src/ui/semantic-tree/UITreeStore.js` | **Facade** composing the three above; re-exports unified API |

`UITreeStore` remains the public entry point — callers don't need to know about the split. But each sub-module can be instantiated and tested in isolation.

```javascript
// UITreeStore.js — facade
export class UITreeStore {
  constructor() {
    this._events = new EventEmitter();
    this.nodes = new NodeStore(this._events);
    this.elements = new ElementRegistry(this.nodes);
    this.overlays = new OverlayManager(this.nodes, this._events);
  }
  // Convenience delegates:
  addNode(n)              { return this.nodes.addNode(n); }
  addNodes(ns)            { return this.nodes.addNodes(ns); }
  getNode(id)             { return this.nodes.getNode(id); }
  getRoot()               { return this.nodes.getRoot(); }
  getChildren(id)         { return this.nodes.getChildren(id); }
  updateNode(id, updates) { return this.nodes.updateNode(id, updates); }
  attachElement(id, el)   { return this.elements.attach(id, el); }
  getElement(id)          { return this.elements.get(id); }
  on(event, handler)      { return this._events.on(event, handler); }
  off(event, handler)     { return this._events.off(event, handler); }
  // ... etc
}
```

`ElementRegistry` now owns the reverse lookup map (`Map<Element, nodeId>`) built-in — no more linear scan in `_findNodeIdForElement`.

---

### 2. Split KNM into pure traversal + injectable effects

**Current:** KNM stub that will mix traversal algorithms, DOM focus management, tabindex manipulation, scrolling, and keyboard event handling in one class.

**New:**

| Module | File | Responsibility | Testable without DOM? |
|---|---|---|---|
| `NavTraversal` | `src/navigation/NavTraversal.js` | Pure traversal logic: "given position + action → next position" | **Yes** |
| `FocusEffects` | `src/navigation/FocusEffects.js` | DOM operations: focus, blur, tabindex, scrollIntoView, overlay show/hide | No (real DOM) |
| `FocusVisualizer` | `src/navigation/FocusVisualizer.js` | Visual cursor element positioning + animation | No (real DOM) |
| `KeyboardNavigationManager` | `src/navigation/KeyboardNavigationManager.js` | Orchestrator: scope stack, keydown listener, composes the above | Integration |

**NavTraversal (the core — pure, fully testable):**

```javascript
export class NavTraversal {
  constructor(nodeIndex) {
    this._nodeIndex = nodeIndex; // Map<id, NavNode>
  }

  // Pure functions: input → output, no side effects
  getNextNode(currentId, direction, wrap)  → nodeId | null
  getEntryChild(parentId, policy, memory)  → nodeId | null
  getParentScope(nodeId)                   → nodeId | null
  findPrimaryChild(parentId)               → nodeId | null
  isLeaf(nodeId)                           → boolean
  isVisible(nodeId)                        → boolean
  getVisibleChildren(parentId)             → nodeId[]
}
```

**FocusEffects (injectable contract):**

```javascript
// Default: DOMFocusEffects — real DOM operations
// Testing: NullFocusEffects — records calls, does nothing
export class DOMFocusEffects {
  applyFocus(nodeId, element)   { element?.focus(); }
  removeFocus(nodeId, element)  { /* remove visual indicator */ }
  setTabindex(element, value)   { element?.setAttribute('tabindex', String(value)); }
  scrollIntoView(element, fast) {
    element?.scrollIntoView({ block: 'nearest', behavior: fast ? 'instant' : 'smooth' });
  }
}

export class NullFocusEffects {
  constructor() { this.calls = []; }
  applyFocus(id, el)         { this.calls.push(['applyFocus', id]); }
  removeFocus(id, el)        { this.calls.push(['removeFocus', id]); }
  setTabindex(el, val)       { this.calls.push(['setTabindex', val]); }
  scrollIntoView(el, fast)   { this.calls.push(['scrollIntoView']); }
}
```

**KNM orchestrator (thin — delegates everything):**

```javascript
export class KeyboardNavigationManager {
  constructor({ traversal, effects, visualizer, uiTree }) {
    this._traversal = traversal;
    this._effects = effects;
    this._visualizer = visualizer;
    this._uiTree = uiTree;
    this._scopeStack = [];
    this._currentNodeId = null;
    this._rememberedPositions = new Map();
    this._lastKeystrokeTime = 0;
  }
  // Public API
  setRootNode(navTree) { ... }
  enterScope(nodeId, triggerId) { ... }
  exitScope() { ... }
  restoreFocusToId(nodeId) { ... }
  handleKeyDown(event) { ... }  // dispatches to _traversal, applies via _effects
}
```

---

### 3. Extract behaviors into standalone testable functions

**Current:** Behavior factories are anonymous closures registered inline in the SemanticTreeAdapter constructor, capturing `uiTreeStore` and `navigationManager` in closure scope.

**New:** Each behavior is an exported named function in `src/navigation/behaviors.js`. Dependencies passed explicitly as a `deps` object.

```javascript
// src/navigation/behaviors.js — every function independently importable & testable

export function buttonBehavior(node, el) {
  return { activate: () => el?.click() };
}

export function checkboxBehavior(node, el) {
  return { activate: () => el?.click() };
}

export function valueEditorBehavior(node, el) {
  return { activate: () => el?.focus() };
}

export function analogControlBehavior(node, el) {
  return {
    activate:  () => el?.focus(),
    increment: () => { el.stepUp();   el.dispatchEvent(new Event('input', { bubbles: true })); },
    decrement: () => { el.stepDown(); el.dispatchEvent(new Event('input', { bubbles: true })); }
  };
}

export function paramTriggerBehavior(node, el, { uiTree, navManager }) {
  return {
    activate: () => {
      const pickerId = node.meta.overlayId;
      const pickerNode = uiTree.getNode(pickerId);
      if (!pickerNode) return;
      pickerNode.hidden
        ? navManager.enterScope(pickerId, node.id)
        : navManager.exitScope();
    }
  };
}

export function panelTriggerBehavior(node, el, { uiTree, navManager }) {
  return {
    activate: () => {
      const panelId = node.meta.panelId;
      const panelNode = uiTree.getNode(panelId);
      if (!panelNode) return;
      panelNode.hidden
        ? navManager.enterScope(panelId, node.id)
        : navManager.exitScope();
    }
  };
}

export function canvasBehavior(node, el, { dispatchCanvasAction, PAN_STEP, ZOOM_STEP }) {
  return {
    activate: () => el?.focus(),
    scopeKeyHandlers: {
      'ArrowLeft':  () => dispatchCanvasAction('pan', { dx: -PAN_STEP, dy: 0 }),
      'ArrowRight': () => dispatchCanvasAction('pan', { dx:  PAN_STEP, dy: 0 }),
      'ArrowUp':    () => dispatchCanvasAction('pan', { dx: 0, dy: -PAN_STEP }),
      'ArrowDown':  () => dispatchCanvasAction('pan', { dx: 0, dy:  PAN_STEP }),
      '+': () => dispatchCanvasAction('zoom', { delta:  ZOOM_STEP }),
      '-': () => dispatchCanvasAction('zoom', { delta: -ZOOM_STEP }),
      'r': () => dispatchCanvasAction('resetView', {})
    }
  };
}
```

**BehaviorRegistry** (`src/navigation/BehaviorRegistry.js`) is a thin `Map<kind, factory>`:

```javascript
export class BehaviorRegistry {
  constructor() { this._factories = new Map(); }
  register(kind, factory) { this._factories.set(kind, factory); }
  create(kind, node, el, deps) {
    const factory = this._factories.get(kind) ?? this._factories.get('button');
    return factory(node, el, deps);
  }
}
```

**SemanticTreeAdapter** becomes simpler — delegates behavior creation:

```javascript
export class SemanticTreeAdapter {
  constructor(uiTree, behaviorRegistry, behaviorDeps) {
    this._uiTree = uiTree;
    this._behaviors = behaviorRegistry;
    this._deps = behaviorDeps;
  }
  _createBehavior(uiNode) {
    if (uiNode.disabled) return { activate: () => {} };
    const el = this._uiTree.getElement(uiNode.id);
    return this._behaviors.create(uiNode.kind, uiNode, el, this._deps);
  }
}
```

---

### 4. Declarative element binding (replace hardcoded attach.js)

**Current:** `attachPrincipiaElements()` is a 100-line function with hardcoded `document.getElementById` calls.

**New:** Split into **data** (pure, testable) and **execution** (generic, injectable):

**`src/ui/semantic-tree/binding-map.js`** — pure data, zero imports:

```javascript
export const ELEMENT_BINDINGS = {
  'canvas':       '#glCanvas',
  'infoBtn':      '#infoBtn',
  'settingsBtn':  '#settingsBtn',
  'renderBtn':    '#renderBtn',
  // ... every static binding as nodeId → CSS selector
};

export const SLIDER_BINDINGS = [
  { nodePrefix: 'slider-gamma',     inputId: 'gamma' },
  { nodePrefix: 'slider-tiltAmt1',  inputId: 'tiltAmt1' },
  // ...
];

export const SECTION_IDS = [
  'sec-mode', 'sec-presets', 'sec-z0', 'sec-orient', 'sec-sim', 'sec-state'
];

export const CSS_CLASSES = {
  expanded: 'open',
  sectionHead: 'section-head',
  sectionBody: 'section-body',
  sliderRow: 'sl-row',
};
```

**`src/ui/semantic-tree/attach.js`** — generic binder with injectable resolver:

```javascript
import { ELEMENT_BINDINGS, SLIDER_BINDINGS, SECTION_IDS, CSS_CLASSES } from './binding-map.js';

export function attachElements(uiTree, resolve = (sel) => document.querySelector(sel)) {
  for (const [nodeId, selector] of Object.entries(ELEMENT_BINDINGS)) {
    const el = resolve(selector);
    if (el) uiTree.attachElement(nodeId, el);
  }
  for (const { nodePrefix, inputId } of SLIDER_BINDINGS) {
    const rangeEl = resolve(`#${inputId}`);
    if (!rangeEl) continue;
    uiTree.attachElement(nodePrefix,             rangeEl.closest(`.${CSS_CLASSES.sliderRow}`));
    uiTree.attachElement(`${nodePrefix}:analog`, rangeEl);
    uiTree.attachElement(`${nodePrefix}:value`,  resolve(`#${inputId}Val`));
  }
  // ... sections similarly
}

export function syncCollapseState(uiTree) {
  for (const id of SECTION_IDS) {
    const node = uiTree.getNode(id);
    const el = uiTree.getElement(id);
    if (!node || !el) continue;
    const head = el.querySelector(`.${CSS_CLASSES.sectionHead}`);
    const body = el.querySelector(`.${CSS_CLASSES.sectionBody}`);
    const expanded = !node.meta?.collapsed;
    head?.classList.toggle(CSS_CLASSES.expanded, expanded);
    body?.classList.toggle(CSS_CLASSES.expanded, expanded);
    uiTree.getChildren(id).forEach(child =>
      uiTree.updateNode(child.id, { hidden: !!node.meta?.collapsed })
    );
  }
}

export function initTabindexes(uiTree) {
  uiTree.forEachBinding((id, el) => {
    const node = uiTree.getNode(id);
    if (node?.focusMode === 'leaf' || node?.focusMode === 'entry-node') {
      el?.setAttribute('tabindex', '-1');
    }
  });
}
```

---

### 5. DI wiring in main.js

```javascript
// ─── Phase 1: Tree ───────────────────────────────────
import { UITreeStore } from './ui/semantic-tree/UITreeStore.js';
import { buildPrincipiaUITree } from './ui/semantic-tree/principia-tree.js';

const uiTree = new UITreeStore();
uiTree.addNodes(buildPrincipiaUITree());

// ─── Phase 2: Element binding ────────────────────────
import { attachElements, syncCollapseState, initTabindexes } from './ui/semantic-tree/attach.js';

attachElements(uiTree);
syncCollapseState(uiTree);
initTabindexes(uiTree);

// ─── Phase 3: Navigation ────────────────────────────
import { BehaviorRegistry } from './navigation/BehaviorRegistry.js';
import { SemanticTreeAdapter } from './navigation/SemanticTreeAdapter.js';
import { NavTraversal } from './navigation/NavTraversal.js';
import { DOMFocusEffects } from './navigation/FocusEffects.js';
import { FocusVisualizer } from './navigation/FocusVisualizer.js';
import { KeyboardNavigationManager } from './navigation/KeyboardNavigationManager.js';
import { TreeNavigationBridge } from './navigation/TreeNavigationBridge.js';
import * as behaviors from './navigation/behaviors.js';

const behaviorRegistry = new BehaviorRegistry();
behaviorRegistry.register('button',         behaviors.buttonBehavior);
behaviorRegistry.register('checkbox',       behaviors.checkboxBehavior);
behaviorRegistry.register('value-editor',   behaviors.valueEditorBehavior);
behaviorRegistry.register('analog-control', behaviors.analogControlBehavior);
behaviorRegistry.register('canvas',         behaviors.canvasBehavior);

const effects = new DOMFocusEffects();
const visualizer = new FocusVisualizer(document.body);
const navManager = new KeyboardNavigationManager({
  effects, visualizer, uiTree
});

// Register behaviors that need navManager (deferred to break circular dep)
const triggerDeps = { uiTree, navManager };
behaviorRegistry.register('param-trigger', (n, el, deps) =>
  behaviors.paramTriggerBehavior(n, el, { ...deps, ...triggerDeps }));
behaviorRegistry.register('panel-trigger', (n, el, deps) =>
  behaviors.panelTriggerBehavior(n, el, { ...deps, ...triggerDeps }));

const behaviorDeps = { uiTree, dispatchCanvasAction, PAN_STEP: 20, ZOOM_STEP: 0.1 };
const adapter = new SemanticTreeAdapter(uiTree, behaviorRegistry, behaviorDeps);
const navTree = adapter.buildNavigationTree();
navManager.setRootNode(navTree);

const bridge = new TreeNavigationBridge(uiTree, adapter, navManager);
```

---

### 6. Test infrastructure (minimal, browser-native)

No npm, no bundler. A simple browser-based test harness:

```
test/
  runner.html              ← open in browser to run tests
  harness.js               ← describe/it/assert (~60 lines)
  unit/
    node-store.test.js     ← NodeStore CRUD, event emission, parentId inference
    nav-traversal.test.js  ← Pure traversal: next/prev, wrap, entry policies, hidden skipping
    behaviors.test.js      ← Each behavior with mock node + mock element + mock deps
    builders.test.js       ← Output shape validation for every builder
    binding-map.test.js    ← Verify all selectors are strings, all nodeIds valid
    element-registry.test.js
    overlay-manager.test.js
  integration/
    adapter.test.js        ← Build nav tree from small test UITree
    bridge.test.js         ← Fire UITree events, verify KNM methods called
```

**Tier 1 (pure logic, no DOM):** `node-store`, `nav-traversal`, `builders`, `binding-map` — ~70% of code
**Tier 2 (mock elements):** `behaviors`, `element-registry` — mock `{ click: spy, focus: spy }`
**Tier 3 (integration):** `adapter`, `bridge` — mock both sides, verify wiring

---

## Module Dependency Diagram

```
                    ┌─────────────────┐
                    │   main.js       │  (wiring / boot)
                    └────┬──────┬─────┘
                         │      │
          ┌──────────────┘      └──────────────────┐
          ▼                                         ▼
   ┌──────────────┐                        ┌────────────────┐
   │ UITreeStore   │  (facade)             │  KNM            │
   │  .nodes       │──────────────────────►│  ._traversal    │
   │  .elements    │                       │  ._effects      │
   │  .overlays    │                       │  ._visualizer   │
   └──┬───┬───┬────┘                       └───┬────┬───┬───┘
      │   │   │                                │    │   │
      ▼   │   ▼                                ▼    │   ▼
  NodeStore│  OverlayManager               NavTraversal│  FocusVisualizer
      │   ▼                                     │   ▼
      │  ElementRegistry                        │  FocusEffects
      │                                         │
      ▼                                         ▼
  EventEmitter                           BehaviorRegistry
                                               │
                                               ▼
                                          behaviors.js
                                         (standalone fns)

  SemanticTreeAdapter ◄── UITreeStore (reads nodes + elements)
       │                  BehaviorRegistry (creates behaviors)
       ▼
  NavTree (plain object tree -- input to KNM)

  TreeNavigationBridge ◄── UITreeStore.on(events)
       │                    KNM (calls rebuild/restore/remove)
       ▼
  (event wiring only -- no owned state)

  principia-tree.js ──► builders.js (pure functions)
  binding-map.js ──────► (pure data, no imports)
  attach.js ───────────► binding-map.js + UITreeStore.elements
```

---

## Complete File Layout

```
src/
  ui/
    semantic-tree/
      EventEmitter.js            ← Unchanged (pure utility)
      NodeStore.js               ← NEW: tree CRUD + queries + events
      ElementRegistry.js         ← NEW: element binding + reverse lookup
      OverlayManager.js          ← NEW: transient overlay lifecycle
      UITreeStore.js             ← REWRITTEN: facade composing the 3 above
      builders.js                ← Unchanged (pure functions)
      principia-tree.js          ← Unchanged (calls builders)
      binding-map.js             ← NEW: declarative nodeId → selector data
      attach.js                  ← REWRITTEN: generic binder with injectable resolver
      index.js                   ← Unchanged (exports singleton)

  navigation/
    NavTraversal.js              ← NEW: pure traversal logic
    FocusEffects.js              ← NEW: DOMFocusEffects + NullFocusEffects
    FocusVisualizer.js           ← NEW: cursor element
    KeyboardNavigationManager.js ← REWRITTEN: thin orchestrator
    SemanticTreeAdapter.js       ← SIMPLIFIED: delegates to BehaviorRegistry
    BehaviorRegistry.js          ← NEW: Map<kind, factory>
    behaviors.js                 ← NEW: standalone behavior functions
    TreeNavigationBridge.js      ← Unchanged (event wiring)

test/
  runner.html
  harness.js
  unit/
    node-store.test.js
    nav-traversal.test.js
    behaviors.test.js
    builders.test.js
    binding-map.test.js
    element-registry.test.js
    overlay-manager.test.js
  integration/
    adapter.test.js
    bridge.test.js
```

---

## What Changes in IMPLEMENTATION_GUIDE.md

The guide needs to be updated to reflect this architecture:

1. **§1.1 UITreeStore** → Split into NodeStore + ElementRegistry + OverlayManager + facade
2. **§2.1 attachPrincipiaElements** → Replace with binding-map.js + generic attach.js
3. **§3.1 KNM Stub** → Replace with NavTraversal + FocusEffects + KNM orchestrator
4. **§3.2 SemanticTreeAdapter** → Simplify constructor (accept BehaviorRegistry + deps), remove inline behaviors
5. **§3.2 behavior code** → Move to behaviors.js, reference from §3.2
6. **Boot sequence** → Update to show full DI wiring with deferred trigger registration
7. **File Checklist** → Update with new file list
8. **New section: Testing** → Describe test infrastructure and strategy

---

## Verification

1. **Static check:** Every module's constructor params are explicit (no hidden globals)
2. **Testability check:** `NavTraversal`, `NodeStore`, `builders`, `binding-map`, `behaviors` can all be instantiated with zero DOM — verify by writing tests first
3. **Integration check:** Boot sequence in main.js compiles and runs (open app in browser, verify sidebar renders, console shows boot messages)
4. **Keyboard check:** After full implementation, Tab/arrow/Enter/Escape navigates the sidebar correctly
5. **Visual parity:** After Phase 4 migration, DOM output matches existing factories (screenshot comparison)
