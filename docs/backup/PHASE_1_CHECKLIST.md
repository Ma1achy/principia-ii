# Phase 1 Implementation Checklist

**Concrete step-by-step tasks for implementing Phase 1 (Foundation)**

**Goal:** Build semantic tree alongside existing UI without breaking anything

**Estimated time:** 1 week

---

## Day 1: Core Infrastructure

### Task 1.1: Create Directory Structure
```bash
mkdir -p src/ui/semantic-tree
mkdir -p src/navigation
mkdir -p src/ui/projections
mkdir -p test/semantic-tree
```

### Task 1.2: Create Event Emitter Utility
**File:** `src/ui/semantic-tree/EventEmitter.js`

```javascript
export class EventEmitter {
  constructor() {
    this._handlers = new Map();
  }
  
  on(event, handler) {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event).push(handler);
  }
  
  off(event, handler) {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event);
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }
  
  emit(event, payload) {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event);
    handlers.forEach(handler => handler(payload));
  }
}
```

**Test:**
```javascript
const emitter = new EventEmitter();
const spy = [];
emitter.on('test', (data) => spy.push(data));
emitter.emit('test', { value: 1 });
console.assert(spy[0].value === 1, 'Event emitter works');
```

---

## Day 2: UITreeStore Implementation

### Task 2.1: Create UITreeStore Class
**File:** `src/ui/semantic-tree/store.js`

```javascript
import { EventEmitter } from './EventEmitter.js';

export class UITreeStore {
  constructor() {
    this._nodes = new Map();
    this._elementBindings = new Map();
    this._events = new EventEmitter();
    this._root = null;
  }
  
  // === CORE NODE OPERATIONS ===
  
  addNode(node) {
    if (this._nodes.has(node.id)) {
      throw new Error(`Node ${node.id} already exists`);
    }
    
    this._nodes.set(node.id, { ...node });
    
    if (node.kind === "root") {
      this._root = node.id;
    }
    
    return node.id;
  }
  
  addNodes(nodes) {
    const ids = nodes.map(node => this.addNode(node));

    // Infer parentId from children arrays.
    // Builders create children with parentId: null because they don't know
    // their parent at construction time. A section's children array is the
    // canonical source of the relationship, so fix it up here.
    for (const node of this._nodes.values()) {
      if (node.children) {
        for (const childId of node.children) {
          const child = this._nodes.get(childId);
          if (child && child.parentId === null) {
            child.parentId = node.id;
          }
        }
      }
    }

    this._events.emit('nodes:added', { ids });
    return ids;
  }
  
  getNode(id) {
    return this._nodes.get(id) || null;
  }
  
  getRoot() {
    return this._root ? this._nodes.get(this._root) : null;
  }
  
  getChildren(id) {
    const node = this._nodes.get(id);
    if (!node || !node.children) return [];
    return node.children
      .map(childId => this._nodes.get(childId))
      .filter(Boolean);
  }
  
  getParent(id) {
    const node = this._nodes.get(id);
    if (!node || !node.parentId) return null;
    return this._nodes.get(node.parentId);
  }
  
  updateNode(id, updates) {
    const node = this._nodes.get(id);
    if (!node) {
      throw new Error(`Node ${id} not found`);
    }
    
    Object.assign(node, updates);
    this._events.emit('node:updated', { id, updates });
  }
  
  removeNode(id, options = {}) {
    const node = this._nodes.get(id);
    if (!node) return;
    
    const { reparent = false } = options;
    
    if (reparent && node.parentId) {
      // Reparent children to grandparent
      const parent = this._nodes.get(node.parentId);
      if (parent) {
        const nodeIndex = parent.children.indexOf(id);
        const newChildren = [
          ...parent.children.slice(0, nodeIndex),
          ...node.children,
          ...parent.children.slice(nodeIndex + 1)
        ];
        
        parent.children = newChildren;
        
        // Update children's parentId
        node.children.forEach(childId => {
          const child = this._nodes.get(childId);
          if (child) {
            child.parentId = node.parentId;
          }
        });
      }
    } else if (node.children.length > 0) {
      // Remove all children first
      node.children.forEach(childId => this.removeNode(childId));
    }
    
    this._nodes.delete(id);
    this._elementBindings.delete(id);
    this._events.emit('node:removed', { id, parentId: node.parentId });
  }
  
  removeSubtree(rootId) {
    const node = this._nodes.get(rootId);
    if (!node) return;
    
    const removedIds = this._collectSubtreeIds(rootId);
    
    // Remove all nodes
    removedIds.forEach(id => {
      this._nodes.delete(id);
      this._elementBindings.delete(id);
    });
    
    this._events.emit('subtree:removed', { rootId, removedIds });
  }
  
  _collectSubtreeIds(rootId) {
    const ids = [rootId];
    const node = this._nodes.get(rootId);
    
    if (node && node.children) {
      node.children.forEach(childId => {
        ids.push(...this._collectSubtreeIds(childId));
      });
    }
    
    return ids;
  }
  
  // === ELEMENT BINDING ===
  
  attachElement(id, element) {
    if (!this._nodes.has(id)) {
      console.warn(`[UITreeStore] Cannot attach element: node ${id} not found`);
      return;
    }
    this._elementBindings.set(id, element);
  }
  
  getElement(id) {
    return this._elementBindings.get(id) || null;
  }
  
  // === QUERY OPERATIONS ===
  
  findNode(predicate) {
    for (const node of this._nodes.values()) {
      if (predicate(node)) {
        return node;
      }
    }
    return null;
  }
  
  getNearestAncestor(id) {
    const node = this._nodes.get(id);
    if (!node || !node.parentId) return null;
    return node.parentId;
  }
  
  findCommonAncestor(ids) {
    if (ids.length === 0) return null;
    if (ids.length === 1) return this.getNearestAncestor(ids[0]);
    
    // Get all ancestor chains
    const ancestorChains = ids.map(id => this._getAncestorChain(id));
    
    // Find common ancestors
    const firstChain = ancestorChains[0];
    for (const ancestorId of firstChain) {
      if (ancestorChains.every(chain => chain.includes(ancestorId))) {
        return ancestorId;
      }
    }
    
    return this._root;
  }
  
  _getAncestorChain(id) {
    const chain = [];
    let current = id;
    
    while (current) {
      chain.push(current);
      const node = this._nodes.get(current);
      current = node?.parentId || null;
    }
    
    return chain;
  }
  
  // === EVENT SYSTEM ===
  
  on(event, handler) {
    this._events.on(event, handler);
  }
  
  off(event, handler) {
    this._events.off(event, handler);
  }
  
  // === SERIALIZATION ===
  
  toJSON() {
    const nodes = Array.from(this._nodes.values());
    return {
      root: this._root,
      nodes: nodes.map(node => ({
        id: node.id,
        kind: node.kind,
        parentId: node.parentId,
        children: node.children,
        focusMode: node.focusMode,
        role: node.role,
        meta: node.meta
      }))
    };
  }
}
```

**Test:**
```javascript
const store = new UITreeStore();
const root = { id: 'root', kind: 'root', children: ['child1'], focusMode: 'container' };
const child = { id: 'child1', kind: 'button', parentId: 'root', children: [], focusMode: 'leaf' };

store.addNodes([root, child]);

console.assert(store.getRoot().id === 'root', 'Root found');
console.assert(store.getChildren('root').length === 1, 'Children retrieved');
console.assert(store.getNode('child1').kind === 'button', 'Child found');
```

---

## Day 3: Builder Functions

### Task 3.1: Create Builder Utilities
**File:** `src/ui/semantic-tree/builders.js`

```javascript
// === UTILITY ===

function buildChildren(nodes) {
  return nodes.map(n => n.id);
}

// === ROOT ===

export function root(children) {
  return {
    id: 'root',
    kind: 'root',
    parentId: null,
    children: buildChildren(children),
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: 'first',
    wrap: false
  };
}

// === STRUCTURAL BUILDERS ===

export function section(id, label, children, config = {}) {
  return {
    id,
    kind: 'section',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || 'container',
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'first',
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    ariaRole: 'region',
    ariaLabel: label,
    meta: {
      label,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,  // Initial state only
      ...config.meta
    }
  };
}

export function scope(id, children, config = {}) {
  return {
    id,
    kind: 'scope',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || 'container',
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'first',
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    meta: config.meta || {}
  };
}

export function buttonGroup(id, children, config = {}) {
  const node = {
    id,
    kind: 'button-group',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || 'container',
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'first',
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    ariaRole: 'group',
    meta: config.meta || {}
  };
  
  return {
    node,
    children: children  // Return children for flat insertion
  };
}

// === LEAF BUILDERS ===

export function button(id, config = {}) {
  return {
    id,
    kind: 'button',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: config.role || 'button',
    ariaRole: config.ariaRole || 'button',
    ariaLabel: config.ariaLabel || '',
    primary: config.primary || false,
    disabled: config.disabled || false,
    meta: config.meta || {}
  };
}

// === COMPOSITE BUILDERS ===

export function slider(id, config) {
  const childIds = [];  // IDs of children only (not including scope itself)
  const childNodes = [];

  // Param-trigger (if present)
  if (config.hasParamTrigger) {
    const paramId = `${id}:param`;
    childIds.push(paramId);
    childNodes.push({
      id: paramId,
      kind: 'param-trigger',
      parentId: id,  // will be confirmed by addNodes() parent inference pass
      children: [],
      focusMode: 'leaf',
      role: 'param-trigger',
      primary: config.meta?.preferredPrimaryRole === 'param-trigger',
      ariaLabel: `${config.label} parameter`,
      meta: { label: config.label }
    });
  }

  // Analog control (range input)
  const analogId = `${id}:analog`;
  childIds.push(analogId);
  childNodes.push({
    id: analogId,
    kind: 'analog-control',
    parentId: id,
    children: [],
    focusMode: 'leaf',
    role: 'analog-control',
    primary: !config.hasParamTrigger,
    ariaLabel: `${config.label} slider`,
    meta: {}
  });

  // Value editor (number input)
  const valueId = `${id}:value`;
  childIds.push(valueId);
  childNodes.push({
    id: valueId,
    kind: 'value-editor',
    parentId: id,
    children: [],
    focusMode: 'leaf',
    role: 'value-editor',
    primary: false,
    ariaLabel: `${config.label} value`,
    meta: {}
  });

  // Slider scope (prepend so scope is first in flat node list)
  const scopeNode = {
    id,
    kind: 'slider',
    parentId: config.parent || null,
    children: childIds,
    focusMode: 'entry-node',  // sliders are focusable before entering
    strategy: 'linear',
    entryPolicy: config.hasParamTrigger ? 'primary' : 'first',
    wrap: false,
    disabled: config.disabled || false,
    fastActions: config.fastActions || {},
    meta: {
      label: config.label,
      min: config.min,
      max: config.max,
      step: config.step,
      value: config.value,
      tip: config.meta?.tip || '',
      hasParamTrigger: config.hasParamTrigger || false,
    }
  };

  return { nodes: [scopeNode, ...childNodes] };
}

export function picker(id, config) {
  const triggerId = `${id}:trigger`;
  const dropdownId = `${id}:dropdown`;
  
  const nodes = [];
  
  // Menu items
  const menuItems = config.options.map(opt => ({
    id: `${dropdownId}:${opt.id}`,
    kind: 'menu-item',
    parentId: dropdownId,
    children: [],
    focusMode: 'leaf',
    primary: opt.id === config.selectedId,
    role: 'menu-item',
    ariaRole: 'menuitemradio',
    ariaLabel: opt.label,
    disabled: config.disabled,
    meta: {
      label: opt.label,
      value: opt.value,
      selected: opt.id === config.selectedId
    }
  }));
  
  // Dropdown overlay
  const dropdown = {
    id: dropdownId,
    kind: 'dropdown',
    parentId: null,  // Overlays have no structural parent
    children: menuItems.map(item => item.id),
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: config.selectedId ? 'primary' : 'first',
    overlay: true,
    modal: true,
    wrap: true,
    ariaRole: 'menu',
    ariaLabel: `${config.label} menu`,
    disabled: config.disabled,
    meta: {
      triggerId,
      label: config.label
    }
  };
  
  // Trigger (button or param-trigger)
  const trigger = {
    id: triggerId,
    kind: config.triggerKind || 'button',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: config.triggerKind || 'button',
    ariaRole: 'button',
    ariaLabel: config.label,
    disabled: config.disabled,
    meta: {
      label: config.label,
      opensOverlay: dropdownId,
      overlayId: dropdownId,
      selectedValue: config.options.find(o => o.id === config.selectedId)?.label || ''
    }
  };
  
  nodes.push(trigger, dropdown, ...menuItems);
  
  return {
    trigger,
    overlayNodes: [dropdown, ...menuItems]
  };
}
```

**Test:**
```javascript
const sliderNodes = slider("test-slider", {
  label: "Test",
  min: 0,
  max: 10,
  step: 1,
  value: 5,
  hasParamTrigger: false
});

console.assert(sliderNodes.nodes.length === 3, 'Slider has 3 nodes');
console.assert(sliderNodes.nodes[0].kind === 'slider', 'First is scope');
console.assert(sliderNodes.nodes[1].kind === 'analog-control', 'Second is analog');
console.assert(sliderNodes.nodes[2].kind === 'value-editor', 'Third is value');
```

---

## Day 4-5: Principia Tree Definition

### Task 4.1: Build Complete Principia Tree
**File:** `src/ui/semantic-tree/principia-tree.js`

See full implementation in `SEMANTIC_TREE_REFACTOR_PLAN.md` Phase 1, Section 1.2

**Key sections to implement:**
1. Control section (5 buttons)
2. Display section (mode + resolution pickers)
3. Slice Basis section (customMag slider)
4. Slice Offset section (z0Range slider, z0-z9 placeholders)
5. Orientation section (gamma slider, tilt pickers + sliders)
6. Simulation section (5 param sliders)
7. Export/Import section (2 buttons)

**Test:**
```javascript
import { buildPrincipiaUITree } from './principia-tree.js';

const nodes = buildPrincipiaUITree();
console.assert(nodes.length > 30, 'Tree has many nodes');

const root = nodes.find(n => n.kind === 'root');
console.assert(root, 'Root exists');
console.assert(root.children.length === 7, 'Root has 7 sections');
```

---

## Day 6: Integration

### Task 6.1: Initialize Tree in main.js
**File:** `src/main.js`

Add after existing UI initialization (around line 465, after `buildZ0Sliders`):

```javascript
// === SEMANTIC TREE INITIALIZATION ===
// NOTE: imports must be at top of file in real implementation.
// Shown inline here for readability only.

console.log('[Boot] Initializing semantic UI tree...');

const uiTree = new UITreeStore();
const treeNodes = buildPrincipiaUITree();

console.log(`[Boot] Built tree with ${treeNodes.length} nodes`);

uiTree.addNodes(treeNodes);

// Expose for debugging. Dynamic builders (buildZ0Sliders, buildPresets)
// should receive uiTree as a parameter rather than accessing window.uiTree.
// The global is kept for Phase 1 convenience only.
window.uiTree = uiTree;

console.log('[Boot] ✓ Semantic tree initialized');
console.log('[Boot] Debug: window.uiTree.toJSON() to inspect tree');
```

### Task 6.2: Verify in Console

Open browser console:
```javascript
// Should show complete tree structure
window.uiTree.toJSON()

// Should show root with 7 children
window.uiTree.getRoot()

// Should show all sections
window.uiTree.getChildren('root')

// Should show slider structure
window.uiTree.getNode('slider-gamma')
window.uiTree.getChildren('slider-gamma')

// Should show picker structure
window.uiTree.getNode('mode-picker:trigger')
window.uiTree.getNode('mode-picker:dropdown')
```

---

## Day 7: Testing & Documentation

### Task 7.1: Manual Testing
- [ ] Page loads without errors
- [ ] All existing UI still works (buttons, sliders, pickers)
- [ ] No visual changes
- [ ] No performance degradation
- [ ] Console shows tree initialization log

### Task 7.2: Tree Verification
- [ ] `window.uiTree.toJSON()` shows complete structure
- [ ] Root has 7 sections as children
- [ ] Each section has correct children
- [ ] Sliders have 2-3 child nodes (param?, analog, value)
- [ ] Pickers have trigger + dropdown + menu items
- [ ] All overlays have `parentId: null`

### Task 7.3: Write Tests
**File:** `test/semantic-tree/store.test.js`

```javascript
import { UITreeStore } from '../../src/ui/semantic-tree/store.js';

describe('UITreeStore', () => {
  let store;
  
  beforeEach(() => {
    store = new UITreeStore();
  });
  
  test('adds and retrieves nodes', () => {
    const node = { id: 'test', kind: 'button', children: [], focusMode: 'leaf' };
    store.addNode(node);
    expect(store.getNode('test')).toEqual(node);
  });
  
  test('emits event on update', () => {
    const node = { id: 'test', kind: 'button', children: [], focusMode: 'leaf' };
    store.addNode(node);
    
    const spy = jest.fn();
    store.on('node:updated', spy);
    
    store.updateNode('test', { disabled: true });
    
    expect(spy).toHaveBeenCalledWith({ id: 'test', updates: { disabled: true } });
  });
  
  test('finds nodes by predicate', () => {
    store.addNodes([
      { id: 'btn1', kind: 'button', children: [], focusMode: 'leaf' },
      { id: 'slider1', kind: 'slider', children: [], focusMode: 'container' }
    ]);
    
    const slider = store.findNode(n => n.kind === 'slider');
    expect(slider.id).toBe('slider1');
  });
});
```

### Task 7.4: Update Documentation
Add to README or docs:

```markdown
## Semantic UI Tree (Phase 1)

The project now includes a semantic UI tree that runs alongside the existing
DOM factories. The tree is built at initialization and exposed as `window.uiTree`.

**Debugging:**
- View tree structure: `window.uiTree.toJSON()`
- Get node: `window.uiTree.getNode(id)`
- Get children: `window.uiTree.getChildren(id)`

**Files:**
- `src/ui/semantic-tree/store.js` - Tree store implementation
- `src/ui/semantic-tree/builders.js` - Builder functions
- `src/ui/semantic-tree/principia-tree.js` - Complete tree definition

**Next:** Phase 2 will bind DOM elements to tree nodes.
```

---

## Phase 1 Complete Checklist

- [ ] EventEmitter implemented and tested
- [ ] UITreeStore implemented with all methods from spec
- [ ] Builder functions created (root, section, slider, picker, button, buttonGroup)
- [ ] buildPrincipiaUITree() defines complete structure
- [ ] Tree initialized in main.js without breaking existing UI
- [ ] window.uiTree exposed for debugging
- [ ] Manual testing passed (no regressions)
- [ ] Tree structure verification passed
- [ ] Unit tests written for UITreeStore
- [ ] Documentation updated

---

## Success Criteria

✅ **UI works exactly as before**  
✅ **No console errors**  
✅ **Tree structure correct** (`window.uiTree.toJSON()` shows all nodes)  
✅ **Performance unchanged** (tree initialization <10ms)  
✅ **Tests pass** (if using Jest/Mocha)  

---

## If Something Breaks

1. Comment out tree initialization in `main.js`
2. Reload page - UI should work normally
3. Check console for errors
4. Fix the error
5. Uncomment tree initialization
6. Test again

---

## Next Phase Preview

**Phase 2 (Element Binding)** will:
- Create `attachPrincipiaElements()` function
- Bind all existing DOM elements to tree nodes
- Allow retrieving elements via `uiTree.getElement(id)`
- Still no UI behavior changes

**Estimated time:** 1 week
