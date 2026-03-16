# Principia Semantic UI Tree — Implementation Guide

**This is the single authoritative implementation document.**
The earlier planning docs (`KEYBOARD_NAVIGATION_SPEC.md`, `SEMANTIC_UI_TREE_SPEC.md`,
`SEMANTIC_TREE_REFACTOR_PLAN.md`, `REFACTOR_SUMMARY.md`, `PHASE_1_CHECKLIST.md`,
`PRINCIPIA_UI_TREE_MAPPING.md`) have been archived to `docs/backup/`. Where they
conflict with this guide, **this guide is correct**.

---

## Principles

1. **Build full system first** — tree store → all builders → projections → navigation → then migrate. No dual-track.
2. **Full UI in tree from day 1** — sidebar + canvas controls + panels + dialogs. Not just "sections migrated so far."
3. **Module singleton, not global** — import `uiTree` from `src/ui/semantic-tree/index.js`. `window.uiTree` is debug only.
4. **Port one component at a time** — once system is ready, migrate each factory, verify, delete old code.
5. **Test at each phase gate** — especially after Phase 2 (projections must be visually identical to factory output).

---

## Phase Overview

| Phase | Goal | Deliverable | Effort |
|---|---|---|---|
| 1 · Foundation | Tree store, builders, full tree definition | `window.uiTree.toJSON()` shows complete UI | ~3 days |
| 2 · Element Binding | Bind DOM elements to nodes | Every element retrievable via `uiTree.getElement(id)` | ~2 days |
| 3 · Navigation | Full KNM, behaviors, visualizer, dialog integration | Keyboard navigation works end-to-end | ~2–3 weeks |
| 4 · Migration | Port factories to projections, delete old code | Factories gone | ~1–2 weeks |
| 5 · State Integration | Events and sync flow through tree | `state.x = y` → tree → DOM | ~1 week |

**Phase 3 is the delivery milestone for keyboard navigation.** Phases 4–5 are cleanup.

---

## Architecture

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

Key invariants:
- `getChildren(id)` returns **node objects**, not IDs.
- Overlay nodes (`picker:dropdown`, `panel`, transient dialogs) have `parentId: null`. They live outside the structural tree.
- `addNodes()` infers `parentId` from children arrays — builders can't know their parent at construction time.
- Only the **scope node** (first element of `slider().nodes`) is listed as a child of its parent section. The analog/value children are registered flat and get their parentId from the builder, not from inference.

---

## Phase 1: Foundation

### 1.1 Directory Structure

```bash
mkdir -p src/ui/semantic-tree
mkdir -p src/navigation
mkdir -p src/ui/projections
mkdir -p test/semantic-tree
```

Files to create:
- `src/ui/semantic-tree/EventEmitter.js`
- `src/ui/semantic-tree/store.js`
- `src/ui/semantic-tree/builders.js`
- `src/ui/semantic-tree/principia-tree.js`
- `src/ui/semantic-tree/index.js`

---

### 1.2 EventEmitter

**File:** `src/ui/semantic-tree/EventEmitter.js`

```javascript
export class EventEmitter {
  constructor() {
    this._handlers = new Map();
  }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(handler);
  }

  off(event, handler) {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event);
    const i = handlers.indexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
  }

  emit(event, payload) {
    if (!this._handlers.has(event)) return;
    this._handlers.get(event).forEach(h => h(payload));
  }
}
```

---

### 1.3 UITreeStore

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

  // ── Core ─────────────────────────────────────────────────────────────

  addNode(node) {
    if (this._nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists`);
    }
    this._nodes.set(node.id, { ...node });
    if (node.kind === 'root') this._root = node.id;
    return node.id;
  }

  addNodes(nodes) {
    const ids = nodes.map(node => this.addNode(node));

    // Infer parentId from children arrays.
    // Builders create children with parentId: null because they don't know
    // their parent at construction time. Scan ALL stored nodes (not just the
    // new batch) so dynamic additions (z0 sliders added after sec-z0 exists)
    // also get correct parentId.
    for (const node of this._nodes.values()) {
      if (!node.children) continue;
      for (const childId of node.children) {
        const child = this._nodes.get(childId);
        if (child && child.parentId === null) {
          child.parentId = node.id;
        }
      }
    }

    this._events.emit('nodes:added', { ids });
    return ids;
  }

  getNode(id) { return this._nodes.get(id) || null; }
  getRoot()   { return this._root ? this._nodes.get(this._root) : null; }

  getChildren(id) {
    const node = this._nodes.get(id);
    if (!node || !node.children) return [];
    return node.children.map(cid => this._nodes.get(cid)).filter(Boolean);
  }

  getParent(id) {
    const node = this._nodes.get(id);
    if (!node || !node.parentId) return null;
    return this._nodes.get(node.parentId) || null;
  }

  updateNode(id, updates) {
    const node = this._nodes.get(id);
    if (!node) throw new Error(`Node "${id}" not found`);
    Object.assign(node, updates);
    this._events.emit('node:updated', { id, updates });
  }

  removeNode(id, options = {}) {
    const node = this._nodes.get(id);
    if (!node) return;

    const { reparent = false } = options;

    // Remove this node from its parent's children array
    if (node.parentId) {
      const parent = this._nodes.get(node.parentId);
      if (parent) {
        const idx = parent.children.indexOf(id);
        if (idx !== -1) {
          if (reparent) {
            // Splice in this node's children at its position
            parent.children = [
              ...parent.children.slice(0, idx),
              ...node.children,
              ...parent.children.slice(idx + 1)
            ];
            node.children.forEach(cid => {
              const child = this._nodes.get(cid);
              if (child) child.parentId = node.parentId;
            });
          } else {
            parent.children.splice(idx, 1);
          }
        }
      }
    }

    // Recursively remove children (unless reparented above)
    if (!reparent && node.children?.length > 0) {
      [...node.children].forEach(cid => this.removeNode(cid));
    }

    this._nodes.delete(id);
    this._elementBindings.delete(id);
    this._events.emit('node:removed', { id, parentId: node.parentId });
  }

  removeSubtree(rootId) {
    const ids = this._collectSubtreeIds(rootId);
    ids.forEach(id => { this._nodes.delete(id); this._elementBindings.delete(id); });
    this._events.emit('subtree:removed', { rootId, removedIds: ids });
  }

  _collectSubtreeIds(rootId) {
    const ids = [rootId];
    const node = this._nodes.get(rootId);
    if (node && node.children) {
      node.children.forEach(cid => ids.push(...this._collectSubtreeIds(cid)));
    }
    return ids;
  }

  // ── Element binding ──────────────────────────────────────────────────

  attachElement(id, element) {
    if (!this._nodes.has(id)) {
      console.warn(`[UITreeStore] attachElement: node "${id}" not found`);
      return;
    }
    if (!element) {
      console.warn(`[UITreeStore] attachElement: null element for "${id}"`);
      return;
    }
    this._elementBindings.set(id, element);
  }

  getElement(id) { return this._elementBindings.get(id) || null; }

  /** Iterate all bindings without exposing the private Map */
  forEachBinding(callback) {
    for (const [id, el] of this._elementBindings) callback(id, el);
  }

  // ── Query ────────────────────────────────────────────────────────────

  findNode(predicate) {
    for (const node of this._nodes.values()) {
      if (predicate(node)) return node;
    }
    return null;
  }

  getNearestAncestor(id) {
    const node = this._nodes.get(id);
    return node?.parentId || null;
  }

  findCommonAncestor(ids) {
    if (ids.length === 0) return null;
    if (ids.length === 1) return this.getNearestAncestor(ids[0]);
    const chains = ids.map(id => this._getAncestorChain(id));
    for (const ancestorId of chains[0]) {
      if (chains.every(chain => chain.includes(ancestorId))) return ancestorId;
    }
    return this._root;
  }

  _getAncestorChain(id) {
    const chain = [];
    let cur = id;
    while (cur) {
      chain.push(cur);
      cur = this._nodes.get(cur)?.parentId || null;
    }
    return chain;
  }

  // ── Transient overlay API (dialogs) ──────────────────────────────────
  // Used by showDialog() to register on-demand dialog nodes so KNM can
  // activate the overlay and restore focus on close.

  registerTransientOverlay(overlayNode, triggerId) {
    this.addNode({ ...overlayNode, parentId: null, overlay: true, transient: true,
      meta: { ...overlayNode.meta, triggerId } });
    this._events.emit('overlay:registered', { id: overlayNode.id, triggerId });
  }

  removeTransientOverlay(overlayId) {
    const node = this._nodes.get(overlayId);
    if (!node) return;
    const triggerId = node.meta?.triggerId;
    this.removeSubtree(overlayId);
    this._events.emit('overlay:removed', { id: overlayId, triggerId });
  }

  // ── Events ───────────────────────────────────────────────────────────

  on(event, handler)  { this._events.on(event, handler); }
  off(event, handler) { this._events.off(event, handler); }

  // ── Serialization ────────────────────────────────────────────────────

  toJSON() {
    return {
      root: this._root,
      nodes: Array.from(this._nodes.values()).map(n => ({
        id: n.id, kind: n.kind, parentId: n.parentId,
        children: n.children, focusMode: n.focusMode,
        role: n.role, meta: n.meta
      }))
    };
  }
}
```

---

### 1.4 Builder Functions

**File:** `src/ui/semantic-tree/builders.js`

```javascript
// ── Utility ──────────────────────────────────────────────────────────────

// Extract ids from an array of node objects.
// Pass only TOP-LEVEL children (scope nodes), not their internal children.
function buildChildren(nodes) {
  return nodes.map(n => n.id);
}

// ── Root ─────────────────────────────────────────────────────────────────

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

// ── Structural ────────────────────────────────────────────────────────────

export function section(id, label, children, config = {}) {
  return {
    id,
    kind: 'section',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || 'entry-node',      // sections are always entry-node in practice
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'remembered',  // default: remember last position
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    hidden: config.hidden || false,
    ariaRole: 'region',
    ariaLabel: label,
    meta: {
      label,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,
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
    hidden: config.hidden || false,
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
    hidden: config.hidden || false,
    ariaRole: 'group',
    meta: config.meta || {}
  };
  return { node, children };
}

// ── Leaf ──────────────────────────────────────────────────────────────────

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
    hidden: config.hidden || false,
    meta: config.meta || {}
  };
}

export function checkbox(id, config = {}) {
  return {
    id,
    kind: 'checkbox',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: 'checkbox',
    ariaRole: 'checkbox',
    ariaLabel: config.ariaLabel || config.label || '',
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      label: config.label || '',
      defaultChecked: config.defaultChecked || false,
      tip: config.tip || ''
    }
  };
}

// ── Composite ─────────────────────────────────────────────────────────────

// Returns { nodes: [scopeNode, analogNode, valueNode] }
// (optionally [scopeNode, paramNode, analogNode, valueNode] if hasParamTrigger)
// ONLY scopeNode (nodes[0]) should be passed as a child to parent containers.
// The analog/value nodes are registered flat and have parentId set by this builder.
export function slider(id, config) {
  const childIds   = [];
  const childNodes = [];

  // Param trigger (optional)
  if (config.hasParamTrigger) {
    const paramId = `${id}:param`;
    childIds.push(paramId);
    childNodes.push({
      id: paramId,
      kind: 'param-trigger',
      parentId: id,
      children: [],
      focusMode: 'leaf',
      role: 'param-trigger',
      primary: config.meta?.preferredPrimaryRole === 'param-trigger',
      ariaLabel: `${config.label} parameter`,
      disabled: config.disabled || false,
      hidden: config.hidden || false,
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
    disabled: config.disabled || false,
    hidden: config.hidden || false,
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
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {}
  });

  const scopeNode = {
    id,
    kind: 'slider',
    parentId: config.parent || null,
    children: childIds,
    focusMode: 'entry-node',   // focusable before entering (shows label highlight)
    strategy: 'linear',
    entryPolicy: config.hasParamTrigger ? 'primary' : 'first',
    wrap: false,
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    fastActions: config.fastActions || {},
    meta: {
      label: config.label,
      min: config.min,
      max: config.max,
      step: config.step,
      value: config.value,
      tip: config.meta?.tip || '',
      hasParamTrigger: config.hasParamTrigger || false
    }
  };

  return { nodes: [scopeNode, ...childNodes] };
}

// Returns { trigger, overlayNodes: [dropdown, ...menuItems] }
// trigger is the leaf node placed in the parent's children.
// overlayNodes are registered flat (parentId: null for dropdown).
export function picker(id, config) {
  const triggerId  = `${id}:trigger`;
  const dropdownId = `${id}:dropdown`;

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
    disabled: config.disabled || false,
    hidden: false,
    meta: {
      label: opt.label,
      value: opt.value,
      selected: opt.id === config.selectedId
    }
  }));

  const dropdown = {
    id: dropdownId,
    kind: 'dropdown',
    parentId: null,           // overlay — no structural parent
    children: menuItems.map(item => item.id),
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: config.selectedId ? 'primary' : 'first',
    overlay: true,
    modal: true,
    wrap: true,
    ariaRole: 'menu',
    ariaLabel: `${config.label} menu`,
    disabled: config.disabled || false,
    meta: { triggerId, label: config.label }
  };

  const trigger = {
    id: triggerId,
    kind: config.triggerKind || 'button',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: config.triggerKind || 'button',
    ariaRole: 'button',
    ariaLabel: config.label,
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      label: config.label,
      opensOverlay: dropdownId,
      overlayId: dropdownId,
      selectedValue: config.options.find(o => o.id === config.selectedId)?.label || ''
    }
  };

  return { trigger, overlayNodes: [dropdown, ...menuItems] };
}

// Returns { overlayNode, closeNode, nodes: [overlayNode, closeNode] }
// overlayNode is the panel scope (parentId: null — it's an overlay).
// Pass only group/item nodes to `children`; they are registered flat.
export function panel(id, title, children, config = {}) {
  const closeId = `${id}:close`;
  const closeNode = button(closeId, {
    ariaLabel: `Close ${title}`,
    role: 'button'
  });

  const overlayNode = {
    id,
    kind: 'panel',
    parentId: null,            // overlay — no structural parent
    children: [closeId, ...buildChildren(children)],
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: 'first',      // always start at close button on open
    wrap: false,
    overlay: true,
    modal: true,
    ariaRole: 'dialog',
    ariaLabel: title,
    meta: {
      title,
      triggerId: config.triggerId || null
    }
  };

  return { overlayNode, closeNode, nodes: [overlayNode, closeNode] };
}
```

---

### 1.5 Principia Tree Definition

**File:** `src/ui/semantic-tree/principia-tree.js`

> **Critical rules:**
> - Pass **only the scope node** (`slider.nodes[0]`) as a child of sections/scopes.
>   Never spread `...slider.nodes` into a container's children array — that would
>   register the analog/value nodes as direct children of the container.
> - Bind checkbox/slider nodes to **variables** before passing to `scope()`, then
>   push the same variables to `nodes`. Never call `checkbox()` twice with the same ID.

```javascript
import {
  root, section, scope, slider, button, checkbox, picker, buttonGroup, panel
} from './builders.js';

export function buildPrincipiaUITree() {
  const nodes = [];

  // ─── WebGL canvas ──────────────────────────────────────────────────────────
  // The canvas is a scope. Nav cursor sits on it at root level; Enter enters
  // the canvas scope (orange+brackets → cyan while inside); Escape exits.
  // Inside the scope, keys dispatch to canvas operations via scopeKeyHandlers.
  // No DOM children — the scope machinery still works, it just has no sub-nodes.
  const canvasNode = {
    id: "canvas",
    kind: "canvas",
    parentId: null,           // inferred by addNodes()
    children: [],             // no structural sub-nodes; all ops via scopeKeyHandlers
    focusMode: "entry-node",  // cursor rests here; Enter enters scope
    strategy: "canvas",       // custom strategy — delegates to scopeKeyHandlers
    entryPolicy: "first",
    wrap: false,
    role: "canvas",
    ariaRole: "application",
    ariaLabel: "Visualization canvas — Enter to interact, arrow keys to pan, +/− to zoom, Escape to exit",
    meta: { }
  };
  nodes.push(canvasNode);

  // ─── Canvas controls ───────────────────────────────────────────────────────
  // Floating buttons overlaid on the canvas. Sibling of canvas and sidebar.

  const infoBtnNode     = button("infoBtn",     { ariaLabel: "Controls and information" });
  const settingsBtnNode = button("settingsBtn", { ariaLabel: "Navigation and rendering settings" });
  const canvasControls  = scope("canvas-controls", [infoBtnNode, settingsBtnNode], {
    focusMode: "entry-node",
    strategy: "linear",
    wrap: true
  });
  nodes.push(canvasControls, infoBtnNode, settingsBtnNode);

  // ─── Sidebar sections ──────────────────────────────────────────────────────

  // — Control section —
  const renderBtn      = button("renderBtn",      { primary: true,  ariaLabel: "Render" });
  const copyLinkBtn    = button("copyLinkBtn",    { ariaLabel: "Copy link" });
  const copyJsonBtn    = button("copyJsonBtn",    { ariaLabel: "Copy JSON" });
  const savePngBtn     = button("savePngBtn",     { ariaLabel: "Save PNG" });
  const resetAllBtn    = button("resetAllBtn",    { ariaLabel: "Reset all" });
  const ctrlGroup      = buttonGroup("ctrl-section", [
    renderBtn, copyLinkBtn, copyJsonBtn, savePngBtn, resetAllBtn
  ], { strategy: "linear", wrap: false });
  nodes.push(ctrlGroup.node, renderBtn, copyLinkBtn, copyJsonBtn, savePngBtn, resetAllBtn);

  // — Display section —
  const modePicker = picker("mode-picker", {
    triggerKind: "button",
    label: "Render mode",
    options: [
      { id: "event",          label: "Event classification",  value: 0 },
      { id: "phase-diffusion",label: "Phase + Diffusion",     value: 1 },
      { id: "phase",          label: "Shape sphere phase",    value: 2 },
      { id: "diffusion",      label: "Diffusion",             value: 3 },
      { id: "rgb",            label: "Shape sphere RGB",      value: 4 }
    ],
    selectedId: "event"
  });

  const resPicker = picker("resolution-picker", {
    triggerKind: "button",
    label: "Resolution",
    options: [
      { id: "256",  label: "256 × 256",   value: 256  },
      { id: "512",  label: "512 × 512",   value: 512  },
      { id: "1024", label: "1024 × 1024", value: 1024 },
      { id: "2048", label: "2048 × 2048", value: 2048 }
    ],
    selectedId: "1024"
  });

  const displaySection = section("sec-mode", "Display", [
    modePicker.trigger,
    resPicker.trigger
  ]);
  nodes.push(displaySection, modePicker.trigger, ...modePicker.overlayNodes);
  nodes.push(resPicker.trigger, ...resPicker.overlayNodes);

  // — Slice Basis section —
  // Preset grid: populated dynamically by buildPresets(). Register placeholder.
  // Use strategy: "linear" — GridTraversalPolicy is not yet implemented.
  const presetGrid = {
    id: "preset-grid",
    kind: "scope",
    parentId: null,   // inferred by addNodes()
    children: [],     // populated dynamically
    focusMode: "container",
    strategy: "linear",
    entryPolicy: "first",
    wrap: true,
    meta: { dynamic: true }
  };

  // Custom basis pickers: hidden until "custom" preset selected.
  // Reveal via: uiTree.updateNode("customDimH-picker:trigger", { hidden: false })
  const customDimHPicker = picker("customDimH-picker", {
    triggerKind: "param-trigger",
    label: "H-axis",
    options: [],       // populated dynamically by buildAxisSelects()
    selectedId: "z0",
    hidden: true
  });
  const customDimVPicker = picker("customDimV-picker", {
    triggerKind: "param-trigger",
    label: "V-axis",
    options: [],
    selectedId: "z1",
    hidden: true
  });
  const customMagSlider = slider("slider-customMag", {
    label: "±mag",
    min: 0.1, max: 4.0, step: 0.05, value: 1.0,
    hasParamTrigger: false,
    hidden: true,
    meta: { tip: "Half-range magnitude for custom basis vectors." }
  });

  const sliceBasisSection = section("sec-presets", "Slice Basis", [
    presetGrid,
    customDimHPicker.trigger,
    customDimVPicker.trigger,
    customMagSlider.nodes[0]  // ← scope node only, not all nodes
  ]);
  nodes.push(
    sliceBasisSection, presetGrid,
    customDimHPicker.trigger, ...customDimHPicker.overlayNodes,
    customDimVPicker.trigger, ...customDimVPicker.overlayNodes,
    ...customMagSlider.nodes
  );

  // — Slice Offset section —
  const z0ZeroBtn      = button("z0Zero",      { ariaLabel: "Zero all z0" });
  const z0SmallRandBtn = button("z0SmallRand", { ariaLabel: "Small random z0" });
  const z0RangeSlider  = slider("slider-z0Range", {
    label: "±range",
    min: 0.25, max: 8.0, step: 0.25, value: 2.0,
    hasParamTrigger: false,
    meta: { tip: "Range of z0 offset sliders." }
  });

  const sliceOffsetSection = section("sec-z0", "Slice Offset z₀ (10D)", [
    z0ZeroBtn,
    z0SmallRandBtn,
    z0RangeSlider.nodes[0]   // ← scope node only
    // z0-z9 sliders added dynamically by buildZ0Sliders()
  ]);
  nodes.push(sliceOffsetSection, z0ZeroBtn, z0SmallRandBtn, ...z0RangeSlider.nodes);

  // — Orientation section —
  const gammaSlider = slider("slider-gamma", {
    label: "γ — rotate within plane",
    min: 0, max: 360, step: 0.25, value: 0,
    hasParamTrigger: false,
    meta: { tip: "Rotate slice plane by gamma degrees." }
  });

  const tiltDim1Picker = picker("tiltDim1-picker", {
    triggerKind: "param-trigger",
    label: "q₁ tilt into",
    options: [{ id: "z8", label: "z₈", value: 8 }, { id: "z9", label: "z₉", value: 9 }],
    selectedId: "z8"
  });
  const tiltAmt1Slider = slider("slider-tiltAmt1", {
    label: "Tilt amount",
    min: -2.0, max: 2.0, step: 0.01, value: 0,
    hasParamTrigger: false,
    fastActions: { "Shift+Enter": "jump-and-begin-value-edit" }
  });

  const tiltDim2Picker = picker("tiltDim2-picker", {
    triggerKind: "param-trigger",
    label: "q₂ tilt into",
    options: [{ id: "z8", label: "z₈", value: 8 }, { id: "z9", label: "z₉", value: 9 }],
    selectedId: "z9"
  });
  const tiltAmt2Slider = slider("slider-tiltAmt2", {
    label: "Tilt amount",
    min: -2.0, max: 2.0, step: 0.01, value: 0,
    hasParamTrigger: false
  });

  const doOrthoBtn = checkbox("doOrtho",  { label: "Orthonormalise q₁, q₂" });
  const rotResetBtn = button("rotReset",  { ariaLabel: "Reset tilts + γ" });

  const orientationSection = section("sec-orient", "Orientation (γ + tilts)", [
    gammaSlider.nodes[0],
    tiltDim1Picker.trigger,
    tiltAmt1Slider.nodes[0],
    tiltDim2Picker.trigger,
    tiltAmt2Slider.nodes[0],
    doOrthoBtn,
    rotResetBtn
  ]);
  nodes.push(
    orientationSection,
    ...gammaSlider.nodes,
    tiltDim1Picker.trigger, ...tiltDim1Picker.overlayNodes,
    ...tiltAmt1Slider.nodes,
    tiltDim2Picker.trigger, ...tiltDim2Picker.overlayNodes,
    ...tiltAmt2Slider.nodes,
    doOrthoBtn, rotResetBtn
  );

  // — Simulation section (collapsed by default) —
  const simSliders = [
    slider("slider-horizon",   { label: "Horizon",    min: 10,   max: 200,   step: 10,     value: 50    }),
    slider("slider-maxSteps",  { label: "Max steps",  min: 1000, max: 40000, step: 1000,   value: 20000 }),
    slider("slider-dtMacro",   { label: "dt macro",   min: 5e-4, max: 0.01,  step: 5e-4,   value: 0.002 }),
    slider("slider-rColl",     { label: "r_coll",     min: 0.005,max: 0.06,  step: 0.001,  value: 0.02  }),
    slider("slider-rEsc",      { label: "r_esc",      min: 1.0,  max: 12.0,  step: 0.25,   value: 5.0   })
  ];

  const simSection = section("sec-sim", "Simulation",
    simSliders.map(s => s.nodes[0]),   // ← scope nodes only
    { collapsed: true }
  );
  nodes.push(simSection, ...simSliders.flatMap(s => s.nodes));

  // — Export / Import section (collapsed by default) —
  const pasteJsonBtn    = button("pasteJsonBtn",    { ariaLabel: "Apply JSON" });
  const downloadJsonBtn = button("downloadJsonBtn", { ariaLabel: "Download JSON" });
  // stateBox textarea is non-navigable — not in tree

  const exportSection = section("sec-state", "Export / Import", [
    pasteJsonBtn,
    downloadJsonBtn
  ], { collapsed: true });
  nodes.push(exportSection, pasteJsonBtn, downloadJsonBtn);

  // — Sidebar scope (wraps all sections) —
  const sidebar = scope("sidebar", [
    ctrlGroup.node,
    displaySection,
    sliceBasisSection,
    sliceOffsetSection,
    orientationSection,
    simSection,
    exportSection
  ], { focusMode: "container", strategy: "linear" });
  nodes.push(sidebar);

  // ─── Panel overlays ────────────────────────────────────────────────────────
  // Panels are overlays (parentId: null). Not children of root or sidebar.

  // Info panel: content is static text; only close button is navigable.
  const infoPanel = panel("info-panel", "Controls & Info", [], { triggerId: "infoBtn" });
  nodes.push(...infoPanel.nodes);

  // Settings panel: 3 groups.
  // IMPORTANT: bind each node to a variable before passing to scope() to avoid
  // "Node already exists" errors. Never call checkbox() inline and then push the
  // same id again — they'd both try to register the same ID.

  // Rendering group
  const autoRenderCbx  = checkbox("autoRender",       { label: "Auto-render" });
  const previewDragCbx = checkbox("previewWhileDrag", { label: "Preview while moving" });
  const showHudCbx     = checkbox("showHud",          { label: "Show probe" });
  const renderingGroup = scope("settings-panel:rendering", [autoRenderCbx, previewDragCbx, showHudCbx], {
    focusMode: "container", strategy: "linear"
  });

  // Scroll / Zoom group
  const invertScrollCbx = checkbox("stgInvertScroll",   { label: "Invert scroll direction" });
  const zoomSpeedSlider = slider("slider-stgZoomSpeed", { label: "Zoom speed", min: 0.2, max: 4.0, step: 0.1, value: 1.0 });
  const scrollGroup     = scope("settings-panel:scroll", [invertScrollCbx, zoomSpeedSlider.nodes[0]], {
    focusMode: "container", strategy: "linear"
  });

  // Panning group
  const invertPanXCbx = checkbox("stgInvertPanX",   { label: "Invert pan X" });
  const invertPanYCbx = checkbox("stgInvertPanY",   { label: "Invert pan Y" });
  const panSpeedSlider = slider("slider-stgPanSpeed", { label: "Pan speed", min: 0.2, max: 4.0, step: 0.1, value: 1.0 });
  const panningGroup  = scope("settings-panel:panning", [invertPanXCbx, invertPanYCbx, panSpeedSlider.nodes[0]], {
    focusMode: "container", strategy: "linear"
  });

  const settingsPanel = panel("settings-panel", "Settings", [
    renderingGroup, scrollGroup, panningGroup
  ], { triggerId: "settingsBtn" });

  nodes.push(
    renderingGroup,  autoRenderCbx, previewDragCbx, showHudCbx,
    scrollGroup,     invertScrollCbx, ...zoomSpeedSlider.nodes,
    panningGroup,    invertPanXCbx, invertPanYCbx, ...panSpeedSlider.nodes,
    ...settingsPanel.nodes
  );

  // ─── Root ──────────────────────────────────────────────────────────────────
  // Three top-level regions: canvas, canvas-controls overlay, sidebar.
  // Picker dropdowns, panels, and dialogs are NOT children of root — they are
  // overlays with parentId: null, managed via the overlay stack.
  const rootNode = root([canvasNode, canvasControls, sidebar]);
  nodes.push(rootNode);

  return nodes;
}
```

---

### 1.6 Module Singleton + Integration

**File:** `src/ui/semantic-tree/index.js`

```javascript
import { UITreeStore } from './store.js';
export const uiTree = new UITreeStore();
```

Import everywhere as: `import { uiTree } from '../semantic-tree/index.js';`

**In `src/main.js`** (after DOM is ready, before calling UI factories):

```javascript
import { uiTree } from './ui/semantic-tree/index.js';
import { buildPrincipiaUITree } from './ui/semantic-tree/principia-tree.js';

console.log('[Boot] Building semantic UI tree...');
uiTree.addNodes(buildPrincipiaUITree());
console.log('[Boot] ✓ Semantic tree built:', uiTree.toJSON().nodes.length, 'nodes');
window.uiTree = uiTree; // debug only
```

**Verification:**
```javascript
window.uiTree.toJSON()              // full structure
window.uiTree.getRoot()             // root node
window.uiTree.getChildren('sidebar')// 7 sections
window.uiTree.getChildren('slider-gamma') // analog + value nodes
window.uiTree.getNode('settings-panel')   // panel overlay node
```

---

## Phase 2: Element Binding

**Goal:** Connect every existing DOM element to its tree node.
No behavior changes. Just `uiTree.getElement(id)` returning elements.

### 2.1 Static Attachment

**File:** `src/ui/semantic-tree/attach.js`

```javascript
export function attachPrincipiaElements(uiTree) {
  // WebGL canvas
  uiTree.attachElement('canvas', document.getElementById('glCanvas'));

  // Canvas control buttons
  uiTree.attachElement('infoBtn',     document.getElementById('infoBtn'));
  uiTree.attachElement('settingsBtn', document.getElementById('settingsBtn'));

  // Control buttons
  ['renderBtn','copyLinkBtn','copyJsonBtn','savePngBtn','resetAllBtn'].forEach(id => {
    uiTree.attachElement(id, document.getElementById(id));
  });

  // Display pickers (trigger = label button element)
  uiTree.attachElement('mode-picker:trigger',       document.getElementById('modeLabel'));
  uiTree.attachElement('resolution-picker:trigger', document.getElementById('resLabel'));

  // Sliders — attach scope to .sl-row wrapper, analog/value to their inputs
  [
    ['slider-gamma',    'gamma'],
    ['slider-customMag','customMag'],
    ['slider-z0Range',  'z0Range'],
    ['slider-tiltAmt1', 'tiltAmt1'],
    ['slider-tiltAmt2', 'tiltAmt2'],
    ['slider-horizon',  'horizon'],
    ['slider-maxSteps', 'maxSteps'],
    ['slider-dtMacro',  'dtMacro'],
    ['slider-rColl',    'rColl'],
    ['slider-rEsc',     'rEsc'],
    ['slider-stgZoomSpeed', 'stgZoomSpeed'],
    ['slider-stgPanSpeed',  'stgPanSpeed']
  ].forEach(([nodeId, domId]) => {
    const rangeEl = document.getElementById(domId);
    if (!rangeEl) return;
    uiTree.attachElement(nodeId,              rangeEl.closest('.sl-row'));
    uiTree.attachElement(`${nodeId}:analog`,  rangeEl);
    uiTree.attachElement(`${nodeId}:value`,   document.getElementById(`${domId}Val`));
  });

  // Orientation pickers
  uiTree.attachElement('tiltDim1-picker:trigger', document.getElementById('tiltDim1Label'));
  uiTree.attachElement('tiltDim2-picker:trigger', document.getElementById('tiltDim2Label'));

  // Orientation buttons/checkboxes
  uiTree.attachElement('doOrtho',   document.getElementById('doOrtho'));
  uiTree.attachElement('rotReset',  document.getElementById('rotReset'));
  uiTree.attachElement('z0Zero',    document.getElementById('z0Zero'));
  uiTree.attachElement('z0SmallRand', document.getElementById('z0SmallRand'));

  // Export/Import
  uiTree.attachElement('pasteJsonBtn',    document.getElementById('pasteJsonBtn'));
  uiTree.attachElement('downloadJsonBtn', document.getElementById('downloadJsonBtn'));

  // Sections (.section wrapper is the navigable unit for section header focus)
  ['sec-mode','sec-presets','sec-z0','sec-orient','sec-sim','sec-state'].forEach(id => {
    const el = document.getElementById(id);
    if (el) uiTree.attachElement(id, el.closest('.section') || el);
  });

  // Settings panel checkboxes
  ['autoRender','previewWhileDrag','showHud','stgInvertScroll','stgInvertPanX','stgInvertPanY'].forEach(id => {
    uiTree.attachElement(id, document.getElementById(id));
  });

  // Panel close buttons (after panels are in DOM)
  const settingsClose = document.getElementById('settingsPanelClose');
  const infoClose     = document.getElementById('infoPanelClose');
  if (settingsClose) uiTree.attachElement('settings-panel:close', settingsClose);
  if (infoClose)     uiTree.attachElement('info-panel:close',     infoClose);

  // Z0 sliders: range inputs have no id — attach via DOM order
  // (buildZ0Sliders appends .sl-row elements in order z0..z9)
  const z0Container = document.getElementById('z0Sliders');
  if (z0Container) {
    z0Container.querySelectorAll('.sl-row').forEach((row, i) => {
      uiTree.attachElement(`slider-z${i}`, row);
      const range  = row.querySelector('input[type="range"]');
      const number = row.querySelector('input[type="number"]');
      if (range)  uiTree.attachElement(`slider-z${i}:analog`, range);
      if (number) uiTree.attachElement(`slider-z${i}:value`,  number);
    });
  }

  console.log('[Attach] Element binding complete');
}
```

Call from `main.js` after all factories have run:
```javascript
import { attachPrincipiaElements } from './ui/semantic-tree/attach.js';
attachPrincipiaElements(uiTree);
```

### 2.2 Dynamic Content: Z0 Sliders

Modify `buildZ0Sliders` signature to accept `uiTree`:

```javascript
// src/ui/builders/sliders.js
export function buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawOverlayHUD, uiTree) {
  const container = document.getElementById('z0Sliders');
  container.innerHTML = '';

  if (uiTree) {
    // Register z0 tree nodes before building DOM
    const sliderNodes = [];
    const childIds = [];
    for (let i = 0; i < 10; i++) {
      const { nodes } = slider(`slider-z${i}`, {
        label: `z${i}`,
        min: -2.0, max: 2.0, step: 0.01,
        value: state.z0[i] || 0,
        hasParamTrigger: false
      });
      sliderNodes.push(...nodes);
      childIds.push(`slider-z${i}`);
    }
    uiTree.addNodes(sliderNodes);  // parentId inference will link to sec-z0 via addNodes scan

    // Append slider IDs to sec-z0 children list
    const sec = uiTree.getNode('sec-z0');
    uiTree.updateNode('sec-z0', { children: [...sec.children, ...childIds] });
  }

  // Build DOM (existing logic unchanged)
  for (let i = 0; i < 10; i++) {
    // ... existing row construction ...
    container.appendChild(row);

    if (uiTree) {
      uiTree.attachElement(`slider-z${i}`,        row);
      uiTree.attachElement(`slider-z${i}:analog`, row.querySelector('input[type="range"]'));
      uiTree.attachElement(`slider-z${i}:value`,  row.querySelector('input[type="number"]'));
    }
  }
}
```

Call site in `main.js`:
```javascript
buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawOverlayHUD, uiTree);
```

### 2.3 Dynamic Content: Presets

When `buildPresets()` populates the preset grid:
```javascript
export function buildPresets(container, presets, uiTree) {
  container.innerHTML = '';
  const presetNodes = [];
  const presetIds   = [];

  presets.forEach(preset => {
    const nodeId = `preset:${preset.id}`;
    presetNodes.push(button(nodeId, { ariaLabel: preset.label }));
    presetIds.push(nodeId);

    const btn = document.createElement('button');
    btn.textContent = preset.label;
    // ... existing DOM logic ...
    container.appendChild(btn);

    if (uiTree) uiTree.attachElement(nodeId, btn);
  });

  if (uiTree) {
    // Guard: remove old preset nodes first (buildPresets is called twice in main.js)
    presetIds.forEach(id => {
      if (uiTree.getNode(id)) uiTree.removeNode(id);
    });
    uiTree.addNodes(presetNodes);
    uiTree.updateNode('preset-grid', { children: presetIds });
  }
}
```

### 2.4 Section Collapse State Sync

**The tree has `meta.collapsed` but nothing enforces it.** Three things must stay in sync:
the tree state, the DOM class, and nav traversal (children of collapsed sections must be
skipped). This is done by:

1. **Initial sync after attach** — read `meta.collapsed` from tree, apply `open` CSS class to DOM (the actual codebase uses class `open` on `.section-head` and `.section-body` to mark expanded sections — no class = collapsed)
2. **Section header click → tree** — existing click handler (in `src/ui.js` lines 361–370) calls `uiTree.updateNode()` in addition to toggling the `open` class
3. **`node:updated` → nav hidden** — when `meta.collapsed` changes, set `hidden: true/false` on all direct children so traversal skips them automatically

**`syncCollapseState` (call once after `attachPrincipiaElements`):**

```javascript
// src/ui/semantic-tree/attach.js  (add after attachPrincipiaElements)
export function syncCollapseState(uiTree) {
  const sectionIds = ['sec-mode','sec-presets','sec-z0','sec-orient','sec-sim','sec-state'];
  sectionIds.forEach(id => {
    const node = uiTree.getNode(id);
    const el   = uiTree.getElement(id);
    if (!node || !el) return;
    const head = el.querySelector('.section-head');
    const body = el.querySelector('.section-body');
    if (node.meta?.collapsed) {
      // Collapsed: remove 'open' class (codebase convention — no class = hidden)
      head?.classList.remove('open');
      body?.classList.remove('open');
    } else {
      head?.classList.add('open');
      body?.classList.add('open');
    }
    // Sync nav hidden state for children
    uiTree.getChildren(id).forEach(child => {
      uiTree.updateNode(child.id, { hidden: !!node.meta?.collapsed });
    });
  });
}
```

**Section header click handler** — modify the existing handler in `src/ui.js` (lines 361–370):

```javascript
// In src/ui.js, inside the section-head click handler:
head.addEventListener('click', () => {
  const body = head.nextElementSibling;
  const isOpen = body.classList.contains('open');

  // 1. Toggle DOM (existing behaviour — uses 'open' class, NOT 'collapsed')
  body.classList.toggle('open', !isOpen);
  head.classList.toggle('open', !isOpen);

  // 2. Update tree (fires 'node:updated' → bridge reacts)
  const node = uiTree.getNode(sectionId);
  const collapsed = isOpen;  // was open → now collapsed
  uiTree.updateNode(sectionId, { meta: { ...node.meta, collapsed } });

  // 3. Update nav hidden state for direct children
  uiTree.getChildren(sectionId).forEach(child => {
    uiTree.updateNode(child.id, { hidden: collapsed });
  });

  // 4. If cursor was inside this section, move it to the section entry-node
  if (collapsed && navManager) {
    const currentId = navManager.sessionState?.currentNodeId;
    const isInsideSection = uiTree.getChildren(sectionId).some(c => c.id === currentId);
    if (isInsideSection) navManager.restoreFocusToId(sectionId);
  }
});
```

> **Why set `hidden` on children (not the section itself)?** The section node uses
> `focusMode: 'entry-node'` — it stays focusable when collapsed so you can expand it
> with Enter/Space. Only its children should be unreachable by nav traversal.

**`TreeNavigationBridge` already calls `navManager.rebuildSubtreeById(id)` on every
`node:updated` event**, so as long as `SemanticTreeAdapter.convertNode()` checks
`uiNode.hidden`, the nav tree will automatically exclude collapsed children.

---

## Phase 3: Navigation Layer

Full spec: `docs/KEYBOARD_NAVIGATION_SPEC.md`. This phase implements KNM per that spec.

### 3.1 KNM Stub

**File:** `src/navigation/KeyboardNavigationManager.js`

```javascript
export class KeyboardNavigationManager {
  constructor(rootNode, uiTreeStore) {
    this._root = rootNode;
    this.uiTree = uiTreeStore;    // needed for getElement() in _setFocus, overlay toggle, etc.
    this._nodeIndex = new Map();
    this._scopeStack = [];  // unified scope/layer stack (see §3.10)
    this.sessionState = {
      currentNodeId: null,
      activePath: [],
    };
    if (rootNode) this._buildIndex(rootNode);
  }

  setRootNode(rootNode) {
    this._root = rootNode;
    this._nodeIndex.clear();
    if (rootNode) this._buildIndex(rootNode);
  }

  _buildIndex(node) {
    this._nodeIndex.set(node.id, node);
    node.children?.forEach(child => this._buildIndex(child));
  }

  // Stub methods — implement per §3.5–§3.10
  rebuildSubtreeById(nodeId)                      { /* rebuild subtree from this node */ }
  removeNodeById(nodeId)                          { this._nodeIndex.delete(nodeId); }
  isInFocusChain(nodeId)                          { return this.sessionState.currentNodeId === nodeId; }
  restoreFocusToId(nodeId)                        { this.sessionState.currentNodeId = nodeId; }
  executeFastAction(nodeId, actionType)           { return false; }
}
```

### 3.2 Semantic Tree Adapter

**File:** `src/navigation/SemanticTreeAdapter.js`

```javascript
export class SemanticTreeAdapter {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree    = uiTreeStore;
    this.navManager = navigationManager;
    this._behaviors = new Map();

    // Register built-in behaviors (see Extensibility section for full list + canvas)
    this.registerBehavior('button',         (node, el) => ({ activate: () => el?.click() }));
    this.registerBehavior('checkbox',       (node, el) => ({ activate: () => el?.click() }));
    this.registerBehavior('value-editor',   (node, el) => ({ activate: () => el?.focus() }));
    this.registerBehavior('analog-control', (node, el) => ({
      activate:  () => el?.focus(),
      increment: () => { el.stepUp();   el.dispatchEvent(new Event('input', { bubbles: true })); },
      decrement: () => { el.stepDown(); el.dispatchEvent(new Event('input', { bubbles: true })); }
    }));
    this.registerBehavior('param-trigger', (node, el) => ({
      activate: () => {
        const pickerId = node.meta.overlayId;
        const pickerNode = uiTreeStore.getNode(pickerId);
        if (!pickerNode) return;
        if (!pickerNode.hidden) {
          navigationManager._exitScope();
        } else {
          navigationManager._enterScope(pickerId, node.id);
        }
      }
    }));
    this.registerBehavior('panel-trigger', (node, el) => ({
      activate: () => {
        const panelId = node.meta.panelId;
        const panelNode = uiTreeStore.getNode(panelId);
        if (!panelNode) return;
        if (!panelNode.hidden) {
          navigationManager._exitScope();
        } else {
          navigationManager._enterScope(panelId, node.id);
        }
      }
    }));
    // canvas behavior — see §3.5
  }

  registerBehavior(kind, factory) { this._behaviors.set(kind, factory); }

  buildNavigationTree() {
    const rootNode = this.uiTree.getRoot();
    return rootNode ? this.convertNode(rootNode) : null;
  }

  convertNode(uiNode) {
    if (!uiNode || uiNode.focusMode === 'none') return null;
    if (uiNode.hidden) return null;

    const element = this.uiTree.getElement(uiNode.id);

    if (uiNode.focusMode === 'leaf') {
      return {
        id:          uiNode.id,
        element,
        behavior:    this._createBehavior(uiNode),
        role:        uiNode.role,
        primary:     uiNode.primary,
        fastActions: uiNode.fastActions
      };
    }

    // entry-node or container
    // getChildren() returns node objects — map through convertNode
    const children = this.uiTree.getChildren(uiNode.id)
      .map(child => this.convertNode(child))
      .filter(Boolean);

    return {
      id:           uiNode.id,
      children,
      focusMode:    uiNode.focusMode,
      strategy:     uiNode.strategy,
      entryPolicy:  uiNode.entryPolicy,
      overlay:      uiNode.overlay,
      modal:        uiNode.modal,
      element,
      fastActions:  uiNode.fastActions
    };
  }

  _createBehavior(uiNode) {
    const el = this.uiTree.getElement(uiNode.id);
    if (uiNode.disabled) return { activate: () => {} };
    const factory = this._behaviors.get(uiNode.kind) ?? this._behaviors.get('button');
    return factory(uiNode, el);
  }
}
```

### 3.3 Navigation Bridge

**File:** `src/navigation/TreeNavigationBridge.js`

```javascript
export class TreeNavigationBridge {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree     = uiTreeStore;
    this.navManager = navigationManager;

    this._onNodeUpdate     = ({ id })       => this.navManager.rebuildSubtreeById(id);
    this._onNodesAdded     = ({ ids })      => {
      const ancestor = this.uiTree.findCommonAncestor(ids);
      if (ancestor) this.navManager.rebuildSubtreeById(ancestor);
    };
    this._onNodeRemoved    = ({ id, parentId }) => {
      if (this.navManager.isInFocusChain(id)) {
        const ancestor = this.uiTree.getNearestAncestor(id) || parentId;
        if (ancestor) this.navManager.restoreFocusToId(ancestor);
      }
      this.navManager.removeNodeById(id);
    };
    this._onSubtreeRemoved = ({ rootId, removedIds }) => {
      const focused = removedIds.find(id => this.navManager.isInFocusChain(id));
      if (focused) {
        const ancestor = this.uiTree.getNearestAncestor(rootId);
        if (ancestor) this.navManager.restoreFocusToId(ancestor);
      }
      this.navManager.removeNodeById(rootId);
    };
    this._onOverlayRegistered = ({ id, triggerId }) => {
      this.navManager.openOverlayById(id, triggerId);
    };
    this._onOverlayRemoved = ({ id, triggerId }) => {
      this.navManager.closeOverlay(id);
      if (triggerId) this.navManager.restoreFocusToId(triggerId);
    };

    this.uiTree.on('node:updated',        this._onNodeUpdate);
    this.uiTree.on('nodes:added',         this._onNodesAdded);
    this.uiTree.on('node:removed',        this._onNodeRemoved);
    this.uiTree.on('subtree:removed',     this._onSubtreeRemoved);
    this.uiTree.on('overlay:registered',  this._onOverlayRegistered);
    this.uiTree.on('overlay:removed',     this._onOverlayRemoved);
  }

  destroy() {
    this.uiTree.off('node:updated',       this._onNodeUpdate);
    this.uiTree.off('nodes:added',        this._onNodesAdded);
    this.uiTree.off('node:removed',       this._onNodeRemoved);
    this.uiTree.off('subtree:removed',    this._onSubtreeRemoved);
    this.uiTree.off('overlay:registered', this._onOverlayRegistered);
    this.uiTree.off('overlay:removed',    this._onOverlayRemoved);
  }
}
```

### 3.4 Wire in main.js

```javascript
import { KeyboardNavigationManager } from './navigation/KeyboardNavigationManager.js';
import { SemanticTreeAdapter }       from './navigation/SemanticTreeAdapter.js';
import { TreeNavigationBridge }      from './navigation/TreeNavigationBridge.js';

const navManager = new KeyboardNavigationManager(null, uiTree);
const adapter    = new SemanticTreeAdapter(uiTree, navManager);
const navTree    = adapter.buildNavigationTree();
navManager.setRootNode(navTree);

const navBridge = new TreeNavigationBridge(uiTree, navManager);

window.navManager = navManager;  // debug
window.navBridge  = navBridge;   // debug

console.log('[Boot] ✓ Navigation connected to semantic tree');
```

### 3.5 Canvas Scope Behavior

The canvas is a **first-class scope** in the nav tree, not a special mode. It uses the
same Enter/Escape entry/exit mechanism as sections — no ad-hoc `_interactionMode` flag
on KNM.

**State flow:**
```
[cursor on canvas]          orange + animated brackets  (entry-node)
    ↓ Enter
[inside canvas scope]       cyan outline                (scope active, strategy:"canvas")
    ↓ ArrowLeft/Right/Up/Down → pan
    ↓ + / -                   → zoom
    ↓ R                        → reset view
    ↓ Escape
[cursor back on canvas]     orange + animated brackets
```

**The `strategy: "canvas"` scope** tells KNM to dispatch keys to `scopeKeyHandlers`
rather than traversing child nodes (the canvas has none). KNM only needs one new
branch in its scope traversal:

```javascript
// In KNM scope key dispatch (simplified):
if (currentScope.strategy === 'canvas') {
  const handler = currentScope.behavior?.scopeKeyHandlers?.[e.key];
  if (handler) { e.preventDefault(); handler(); return; }
  if (e.key === 'Escape') { exitScope(); return; }
  return; // all other keys suppressed while inside canvas scope
}
// ... normal linear/grid traversal for all other strategies
```

**Canvas behavior in the behavior registry** (registered in `SemanticTreeAdapter`):

```javascript
this.registerBehavior('canvas', (node, el) => ({
  // activate() is called when Enter is pressed on the entry-node
  // KNM handles actual scope entry; this just focuses the DOM element
  activate: () => el?.focus(),

  // scopeKeyHandlers: called when KNM is INSIDE the canvas scope
  // These mirror what the mouse already does — same underlying functions
  scopeKeyHandlers: {
    'ArrowLeft':  () => dispatchCanvasAction('pan', { dx: -PAN_STEP, dy: 0 }),
    'ArrowRight': () => dispatchCanvasAction('pan', { dx:  PAN_STEP, dy: 0 }),
    'ArrowUp':    () => dispatchCanvasAction('pan', { dx: 0, dy: -PAN_STEP }),
    'ArrowDown':  () => dispatchCanvasAction('pan', { dx: 0, dy:  PAN_STEP }),
    '+':          () => dispatchCanvasAction('zoom', { delta:  ZOOM_STEP }),
    '-':          () => dispatchCanvasAction('zoom', { delta: -ZOOM_STEP }),
    '=':          () => dispatchCanvasAction('zoom', { delta:  ZOOM_STEP }), // = is unshifted +
    'r':          () => dispatchCanvasAction('resetView', {}),
  }
}));
```

`dispatchCanvasAction` fires a custom event on the canvas element (or calls the canvas
module's API directly) — the same path mouse pan/zoom already uses. This means canvas
keyboard behaviour stays consistent with mouse behaviour at zero extra maintenance cost.

**`SemanticTreeAdapter.convertNode` for the canvas scope:**

```javascript
// canvas with strategy:"canvas" converts just like a regular entry-node scope
// except its children array is empty — KNM never tries to traverse into sub-nodes
if (uiNode.kind === 'canvas') {
  return {
    id:          uiNode.id,
    children:    [],
    focusMode:   'entry-node',
    strategy:    'canvas',       // KNM checks this before traversing children
    element,
    behavior:    this._createBehavior(uiNode)
  };
}
```

**Tabindex** — the canvas element gets `tabindex="0"` permanently (it needs to receive
native events even outside nav mode). The roving tabindex rule applies to sidebar
elements only; the canvas is not managed by `initTabindexes()`.

### 3.6 Tabindex Strategy

KNM owns `tabindex`. All interactive elements are set to `tabindex="-1"` so native Tab
does not cycle through them independently of the nav tree. Only the currently focused
nav node gets `tabindex="0"` (roving tabindex pattern).

```javascript
// In KNM, whenever currentNodeId changes:
_setFocus(newNodeId) {
  // Remove tabindex="0" from previous node
  if (this.sessionState.currentNodeId) {
    const prevEl = this.uiTree.getElement(this.sessionState.currentNodeId);
    prevEl?.setAttribute('tabindex', '-1');
  }
  // Give tabindex="0" to new node and show visual cursor
  const el = this.uiTree.getElement(newNodeId);
  el?.setAttribute('tabindex', '0');
  this.sessionState.currentNodeId = newNodeId;
  this._visualizer.moveTo(newNodeId);
}
```

On Phase 2 attach, set all interactive elements to `tabindex="-1"` so they're reachable
by KNM but not by native Tab:

```javascript
// In attachPrincipiaElements, after all attachElement() calls:
export function initTabindexes(uiTree) {
  uiTree.forEachBinding((id, el) => {
    const node = uiTree.getNode(id);
    if (node?.focusMode === 'leaf' || node?.focusMode === 'entry-node') {
      if (el?.setAttribute) el.setAttribute('tabindex', '-1');
    }
  });
}
```

Call after `attachPrincipiaElements(uiTree)` and `syncCollapseState(uiTree)`.

> **Exception:** Value editors (`input[type="number"]`) and analog controls
> (`input[type="range"]`) that are actively being interacted with should get
> `tabindex="0"` while in the "interacting" (cyan) state so the browser's native
> number/arrow key handling works normally.

### 3.7 Mouse → Keyboard Handoff

When a user clicks an element with the mouse and then presses a key, the nav cursor
must be at that element — not wherever it was before. Without this, the first keypress
after any mouse click jumps focus to a seemingly unrelated location.

Add a `pointerdown` listener for each navigable element at attach time, or use event
delegation on the sidebar root:

```javascript
// In Phase 3 KNM setup (main.js or KNM constructor)
document.addEventListener('pointerdown', (e) => {
  // Walk up from click target to find a bound tree node
  let el = e.target;
  while (el && el !== document.body) {
    const nodeId = _findNodeIdForElement(uiTree, el);
    if (nodeId) {
      navManager.restoreFocusToId(nodeId);
      return;
    }
    el = el.parentElement;
  }
}, true);

function _findNodeIdForElement(uiTree, el) {
  let found = null;
  uiTree.forEachBinding((id, bound) => {
    if (bound === el) found = id;
  });
  return found;
}
```

> The linear scan in `_findNodeIdForElement` is fine for the small element count in
> Principia's UI. If it becomes a performance concern, maintain a reverse
> `Map<element, nodeId>` alongside `_elementBindings`.

### 3.8 Disabled Node Behavior

Disabled nodes are **focusable but not activatable**. They appear in traversal with the
nav cursor visible on them; pressing Enter/Space/arrows does nothing (or shows a brief
visual signal). They are NOT invisible to the keyboard — skipping them entirely would
be inaccessible.

In `SemanticTreeAdapter.convertNode()`:
```javascript
// disabled check in _createBehavior:
_createBehavior(uiNode) {
  const element = this.uiTree.getElement(uiNode.id);
  if (uiNode.disabled) {
    return { activate: () => { /* no-op — node is disabled */ } };
  }
  // ... existing switch ...
}
```

The visual cursor still moves to disabled nodes; `FocusVisualizer` should render them
with reduced opacity or a different border style to signal the disabled state.

### 3.9 Dialog System Integration

`src/ui/dialogs/dialog.js` has independent focus management that conflicts with KNM:
- Stores `restoreFocusTarget = document.activeElement` (raw element, not nav ID)
- Has its own `trapFocus()` Tab interceptor
- Both systems listen on `document.keydown` globally

**Resolution — KNM yields when dialog is open:**

```javascript
// KeyboardNavigationManager keydown handler
document.addEventListener('keydown', (e) => {
  if (DialogManager.isOpen()) return;  // yield to dialog system
  // ... KNM handler
}, true); // capture phase
```

**On dialog close, restore nav focus by tree node ID:**

```javascript
// In dialog.js finalizeClose():
if (window.navManager && this._triggerNodeId) {
  window.navManager.restoreFocusToId(this._triggerNodeId);
} else {
  // fallback: restore raw DOM focus
  this._restoreFocusTarget?.focus();
}
```

**When opening a dialog via KNM, pass the tree node ID:**

```javascript
// In the button's behavior.activate() or event handler:
DialogManager._triggerNodeId = uiNode.id;  // store before showDialog()
showDialog({ ... });
```

**Transient dialogs (value-edit, welcome, resolution-warning)** should call:
```javascript
// On open (in showDialog()):
uiTree.registerTransientOverlay({ id: 'dialog:value-edit', kind: 'panel', ... }, triggerId);

// On close (in finalizeClose()):
uiTree.removeTransientOverlay('dialog:value-edit');
// TreeNavigationBridge handles restoring focus to triggerId automatically
```

### 3.10 Layer / Overlay Stack

All modal and semi-modal surfaces — info/settings panels, dropdown pickers, dialogs —
are just **scopes**. They use the exact same `enterScope` / `exitScope` / Escape
machinery as canvas interaction. There is no separate overlay stack; the KNM scope
stack **is** the layer stack.

The only overlay-specific behaviour is cosmetic: when a scope has `overlay: true`, KNM
toggles its `hidden` flag on enter/exit so the DOM element shows and hides.

---

#### The unified model

```
KNM scope stack (already exists):
  scopeStack: NodeId[]   ← top = current scope
```

```
Scope entry:           enterScope(id, triggerId)
Scope exit / Escape:   exitScope()
Tab confinement:       traversal is always scoped to current scope node's subtree
```

Overlay layers are scopes with two extra properties on the node:

```javascript
overlay: true    // KNM shows/hides the DOM element on enter/exit
modal: true      // Tab wraps instead of potentially bubbling out (optional)
```

That's it. The scope stack naturally handles nesting, focus memory, and Escape
propagation — no new state required.

```
Scope stack diagram:

  [sidebar scope]
      │ settings button → Enter
      ▼
  [sidebar scope, settings-panel]   ← focus confined here; panel DOM shown
      │ picker button → Enter
      ▼
  [sidebar scope, settings-panel, mode-picker]   ← focus confined here
      │ Escape
      ▼
  [sidebar scope, settings-panel]   ← picker DOM hidden, focus → picker button
      │ Escape
      ▼
  [sidebar scope]   ← panel DOM hidden, focus → settings button
```

---

#### Two categories of overlay

| Category | Examples | Lifetime | Tree presence |
|---|---|---|---|
| **Static** | Settings panel, info panel, pickers | Pre-built at startup | Always in tree (`hidden: true` when closed) |
| **Transient** | Dialogs, confirmation prompts | Created on demand | Added via `registerTransientOverlay()`, removed on exit |

Both work identically at the KNM level: enter scope → exit scope.

---

#### `enterScope` and `exitScope` — overlay-aware

Extend the existing `enterScope` / `exitScope` to handle visibility:

```javascript
_enterScope(nodeId, triggerId) {
  const node = this.uiTree.getNode(nodeId);
  this._scopeStack.push({ nodeId, triggerId });

  // Show overlay DOM element on enter
  if (node?.overlay) {
    this.uiTree.updateNode(nodeId, { hidden: false });
  }

  this._moveFocusByPolicy(node);
}

_exitScope() {
  const { nodeId, triggerId } = this._scopeStack.pop() ?? {};
  if (!nodeId) return;

  const node = this.uiTree.getNode(nodeId);

  // Hide or remove overlay on exit
  if (node?.overlay) {
    if (node.transient) {
      this.uiTree.removeTransientOverlay(nodeId);
    } else {
      this.uiTree.updateNode(nodeId, { hidden: true });
    }
  }

  // Return focus to whatever opened this scope
  if (triggerId) this.restoreFocusToId(triggerId);
}
```

Escape already calls `exitScope()` in KNM — no special overlay handling needed in the
keydown handler. Every Escape goes back one layer, same as exiting the canvas scope.

---

#### Static overlay: info / settings panels

Define in `principia-tree.js`:

```javascript
// panel(id, title, children, config)  — matches builder signature at §1.2
const settingsPanel = panel("settings-panel", "Settings", [/* ... */], {
  hidden: true,         // closed at startup — shown by enterScope
  overlay: true,        // KNM toggles hidden on enter/exit
  modal: true,          // Tab wraps within panel
  entryPolicy: "first",
});

const infoPanel = panel("info-panel", "Controls & Info", [/* ... */], {
  hidden: true,
  overlay: true,
  modal: true,
  entryPolicy: "first",
});
```

Open from button behavior (toggle):

```javascript
this.registerBehavior('panel-trigger', (node, el) => ({
  activate: () => {
    const panelId = node.meta.panelId;
    const panelNode = uiTree.getNode(panelId);
    if (!panelNode.hidden) {
      navManager._exitScope();          // same as pressing Escape
    } else {
      navManager._enterScope(panelId, node.id);
    }
  }
}));
```

In `attach.js`:

```javascript
uiTree.attachElement("settings-panel", document.getElementById("settingsPanel"));
uiTree.attachElement("info-panel",     document.getElementById("infoPanel"));
```

---

#### Static overlay: dropdown pickers

Pickers are `kind: 'picker'` with `overlay: true, hidden: true`. The `param-trigger`
behavior (registered in §3.2) uses `node.meta.overlayId` to find the associated picker
and calls `_enterScope(pickerId, triggerId)` / `_exitScope()` to toggle it — same as
panels.

---

#### Nested layers

Nesting is free — `_scopeStack` is already a stack:

```javascript
// Settings panel open → user opens a picker inside it
_scopeStack = ['sidebar', 'settings-panel', 'mode-picker']
                                              ^── Tab confined here
```

Escape pops `mode-picker` → hides picker → focus back to picker button →
`_scopeStack = ['sidebar', 'settings-panel']`.
Escape again pops `settings-panel` → hides panel → focus back to settings button.

---

#### Backdrop dismiss

A click outside the current overlay scope closes it (exits the scope). This is checked
**before** the mouse→keyboard handoff. **Replace** the §3.7 `pointerdown` handler:

```javascript
document.addEventListener('pointerdown', (e) => {
  // 1. Backdrop dismiss: click outside the current overlay scope exits it
  const topScopeId = navManager._scopeStack.at(-1)?.nodeId;
  if (topScopeId) {
    const topNode = uiTree.getNode(topScopeId);
    if (topNode?.overlay) {
      const topEl = uiTree.getElement(topScopeId);
      if (topEl && !topEl.contains(e.target)) {
        navManager._exitScope();
        return;   // don't also do mouse→keyboard handoff on backdrop click
      }
    }
  }

  // 2. Mouse → keyboard handoff (unchanged from §3.7)
  let el = e.target;
  while (el && el !== document.body) {
    const nodeId = _findNodeIdForElement(uiTree, el);
    if (nodeId) {
      navManager.restoreFocusToId(nodeId);
      return;
    }
    el = el.parentElement;
  }
}, true);
```

---

#### Transient overlays (dialogs)

Transient overlays register on demand and are removed from the tree on exit. They work
identically to static overlays at the KNM level — just set `_transient: true` on the
node before registering so `_exitScope` knows to call `removeTransientOverlay` instead
of `hidden: true`.

See §3.9 for `registerTransientOverlay` / `removeTransientOverlay`.

---

#### Summary

Opening a layer = `_enterScope(overlayId, triggerId)` — shows DOM, pushes scope, moves
focus in.

Closing a layer = `_exitScope()` — hides or removes DOM, pops scope, returns focus to
trigger.

Escape already calls `_exitScope()`. There is no separate overlay API, no second stack,
no special Escape handler. Every layer obeys the same rules as every other scope.

---

## Phase 4: Render Projection

Convert factories to render from tree nodes. Port one section at a time.

### 4.0 Visual Parity Contract

**The new GUI must look and behave exactly like the current one.** This is a hard
requirement, not just a best-effort goal. The acceptance criterion for each migrated
section is:

> Inspecting the migrated section's `outerHTML` before and after migration shows the
> **same element types, same CSS class names, and same DOM hierarchy** as the factory
> output. No visual regression is acceptable.

Specifically:

| Element | Required class / attribute | Notes |
|---|---|---|
| Slider row wrapper | `.sl-row` | Nav cursor attaches to this |
| Track container | `.sl-track-row` | |
| Range input wrapper | `.sl-range-wrap` | Added by `enhanceSlider()` — not in raw factory output |
| Track fill bar | `.sl-track-fill` | Added by `enhanceSlider()` |
| Range input | `input[type="range"]` with correct `id` | `id` must match factory convention |
| Number input | `input[type="number"].slider-num` with `id="${rangeId}Val"` | `slider-num` is targeted by value-edit double-click |
| Section wrapper | `.section` | Collapse animation targets this |
| Section header | `.section-head` | Click handler for collapse, keyboard Enter/Space |
| Section body | `.section-body` | Hidden/shown on collapse |
| Picker trigger | Button with correct `id` (e.g. `modeLabel`) | `attach.js` looks up by this id |

**Projection output must call `enhanceSlider(rangeInput)`** — the enhanced track
(`.sl-range-wrap`, `.sl-track-fill`, tick marks) is built by that function, not the
factory. Without it, sliders will have no track fill or markers.

**Migration verification procedure (per section):**
1. Screenshot the section before migration.
2. Migrate and reload.
3. Screenshot after. Compare visually.
4. Run all existing slider/picker/collapse interactions manually.
5. Check console for errors.
6. Only then delete the old factory code for that section.

**Guiding constraint:** `SliderProjection` must call `enhanceSlider(rangeInput)` (or
defer to the existing `enhanceAllSliders()` pass) — the enhanced track adds
`.sl-range-wrap`, `.sl-track-fill`, and marker elements that the factory currently
produces. Without this the slider will look wrong.

```javascript
// src/ui/projections/SliderProjection.js
export class SliderProjection {
  constructor(uiTreeStore) { this.uiTree = uiTreeStore; }

  render(sliderScopeId) {
    const scopeNode = this.uiTree.getNode(sliderScopeId);
    if (!scopeNode || scopeNode.kind !== 'slider') return null;

    const meta = scopeNode.meta;

    // getChildren() returns node objects, not IDs
    const children  = this.uiTree.getChildren(sliderScopeId);
    const analogNode = children.find(n => n.role === 'analog-control');
    const valueNode  = children.find(n => n.role === 'value-editor');

    const row = document.createElement('div');
    row.className = 'sl-row';

    const label = document.createElement('label');
    label.innerHTML = meta.label;

    const trackRow = document.createElement('div');
    trackRow.className = 'sl-track-row';

    const rangeInput = document.createElement('input');
    rangeInput.type  = 'range';
    rangeInput.id    = sliderScopeId.replace('slider-', '');
    rangeInput.min   = String(meta.min);
    rangeInput.max   = String(meta.max);
    rangeInput.step  = String(meta.step);
    rangeInput.value = String(meta.value);
    this.uiTree.attachElement(analogNode.id, rangeInput);

    const valWrap = document.createElement('div');
    valWrap.className = 'sl-val-wrap';

    const numberInput = document.createElement('input');
    numberInput.type      = 'number';
    numberInput.className = 'slider-num';
    numberInput.id        = `${rangeInput.id}Val`;
    numberInput.value     = meta.value.toFixed(_decimalPlaces(meta.step));
    numberInput.step      = String(meta.step);
    numberInput.min       = String(meta.min);
    numberInput.max       = String(meta.max);
    this.uiTree.attachElement(valueNode.id, numberInput);

    // Must call enhanceSlider() to add track fill + markers
    enhanceSlider(rangeInput);

    valWrap.appendChild(numberInput);
    trackRow.appendChild(rangeInput);
    trackRow.appendChild(valWrap);
    row.appendChild(label);
    row.appendChild(trackRow);

    this.uiTree.attachElement(sliderScopeId, row);
    return row;
  }
}

function _decimalPlaces(step) {
  const s = String(step);
  const d = s.indexOf('.');
  return d === -1 ? 0 : s.length - d - 1;
}
```

Migration pattern (one section at a time):
```javascript
// OLD (initSections.js):
const gammaSlider = createSlider({ id: 'gamma', ... });
content.appendChild(gammaSlider);

// NEW:
const projection = new SliderProjection(uiTree);
content.appendChild(projection.render('slider-gamma'));
```

---

## Phase 5: State Integration

Move event handlers from direct DOM manipulation to tree-mediated updates.

```javascript
// src/ui/semantic-tree/update-bridge.js
export class UpdateBridge {
  constructor(uiTreeStore, state) {
    this.uiTree = uiTreeStore;
    this.state  = state;
  }

  handleSliderChange(sliderScopeId, newValue) {
    this.uiTree.updateNode(sliderScopeId, {
      meta: { ...this.uiTree.getNode(sliderScopeId).meta, value: newValue }
    });
    // tree mutation → nav reconciliation is automatic via TreeNavigationBridge
  }
}
```

---

## Extensibility

The system is designed to accommodate any UI element, present or future, without
modifying core code. The extension points are:

### Adding a new node kind

Any element can become navigable by:
1. Adding a node with any `kind` string to the tree
2. Attaching its DOM element via `uiTree.attachElement(id, el)`
3. Registering its behavior in `SemanticTreeAdapter` (or the behavior registry)

The `kind` field is used only for behavior dispatch — the tree itself treats all
kinds uniformly.

### Behavior registry

The `SemanticTreeAdapter` constructor (§3.2) registers all built-in behaviors via
`registerBehavior(kind, factory)`. The `_createBehavior()` method looks up the registry
by `uiNode.kind`, falling back to the `'button'` behavior. Disabled nodes get a no-op
`activate`.

External code can add behaviors for new widget types before the nav tree is built:
```javascript
adapter.registerBehavior('color-picker', (node, el) => ({
  activate: () => el?.showPicker?.()
}));
```

### Custom node kinds

For one-off widgets that don't fit any existing kind, use `kind: 'custom'` with a
`meta.behaviorKey` pointing to a registered behavior:

```javascript
const myWidget = {
  id: "my-widget",
  kind: "custom",
  focusMode: "entry-node",
  meta: { behaviorKey: "color-picker" }
  // ... rest of node
};
uiTree.addNode(myWidget);
adapter.registerBehavior('color-picker', ...);
```

### Adding future UI regions

Any new top-level UI area (e.g. a toolbar, a timeline scrubber, a second canvas) is
added as a new top-level child of `root`. Since `root` is just a linear scope, adding
a new sibling requires only:
1. Defining the new scope/node in `principia-tree.js`
2. Adding it to the `root([..., newScope])` call
3. Attaching its elements in `attach.js`

No changes to the nav engine, bridge, or adapter core code are needed.

### Overlay protocol (panels, pickers, dialogs)

Any modal overlay — regardless of how it's triggered or what it contains — uses the
same protocol:

```
On open:
  uiTree.registerTransientOverlay(overlayNode, triggerId)
    → emits 'overlay:registered'
    → TreeNavigationBridge calls navManager._enterScope(overlayId, triggerId)
    → scope stack push, nav confined to overlay subtree

On close (Escape or backdrop click):
  navManager._exitScope()
    → scope stack pop
    → node.transient? removeTransientOverlay() : updateNode({ hidden: true })
    → focus returns to triggerId
```

For **static overlays** (settings panel, info panel) that are pre-built in the tree,
the trigger's `activate()` calls `_enterScope(panelId, triggerId)` directly — no need
for `registerTransientOverlay`.

For **dynamic overlays** (value-edit dialog, resolution warning, any dialog created on
demand): use `registerTransientOverlay` to add the node, then `_enterScope` to enter it.
`_exitScope` handles cleanup automatically based on the `transient` flag.

The overlay node structure doesn't matter to the protocol — any node with
`overlay: true` is treated the same way by KNM's scope stack.

---

## Design Notes

### What works well
- Phases 1–3 map cleanly to Principia's sidebar structure.
- The factory pattern (SliderFactory, SectionFactory, PickerFactory) already
  implies a widget model — the tree makes it explicit and queryable.
- `focusMode: 'entry-node'` on slider scopes gives keyboard users a single
  focus target per slider before entering its sub-controls — matches the visual
  design where each row is a unit.

### Scope warning (Phases 4–5)
Converting the render path (factories → projections) is significant rearchitecting
with real regression risk for zero user-visible benefit beyond Phase 3. The existing
factories are small and well-tested. **Treat Phase 3 as the keyboard-navigation
delivery milestone.** Phases 4–5 are optional cleanup.

### Phase 3 is the hard part
The spec (`KEYBOARD_NAVIGATION_SPEC.md`) describes real complexity: traversal engine,
entry/exit policies, overlay stack, animated focus brackets, per-widget behaviors for
analog controls, value editors, param triggers, and checkboxes. Budget 2–3 weeks.

### Scroll into view
When KNM moves the cursor to a node, the element must scroll into view if it's
off-screen (relevant for the sidebar when sections are tall). Call in `_setFocus()`:
```javascript
el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
```
`block: 'nearest'` avoids jarring jumps — it only scrolls if the element isn't already
visible. Use `behavior: 'instant'` during rapid arrow-key traversal to avoid lag.

---

## Known Issues Fixed vs. Earlier Plan Drafts

1. **`getChildren()` returns node objects** — `SliderProjection` now uses `.find(n => n.role === "analog-control")` not `.find(id => ...)`.
2. **Z0 range inputs have no `id`** — attachment uses `querySelectorAll('.sl-row')` row index, not `getElementById`.
3. **`parentId: null` for children** — `addNodes()` infers parentId from all stored nodes (not just new batch) so dynamic additions after initial load also get correct parentId.
4. **Double-creation in settings panel** — All checkbox/slider nodes bound to variables before passing to `scope()`. Never call builder inline inside `scope()` if you also push the node separately.
5. **Slider scope as only child of parent** — `slider.nodes[0]` (scope) listed in section children, not `...slider.nodes` (which would register analog/value as direct section children and cause duplicate traversal).
6. **`slider()` builder sets `focusMode: 'entry-node'`** — sliders are focusable before entering.
7. **`section()` default `entryPolicy: 'remembered'`** — sections remember cursor position between visits.
8. **`{ collapsed: true }` not `{ meta: { collapsed: true } }`** — callers pass `collapsed` at the config level; the `section()` builder moves it into `meta.collapsed` internally.
9. **Dialog/KNM conflict** — KNM early-exits when `DialogManager.isOpen()`. On dialog close, `navManager.restoreFocusToId(triggerId)` is called, not raw DOM `.focus()`.
10. **`window.uiTree` is debug-only** — module singleton `import { uiTree }` is the import path.
11. **Section collapse not synced to tree or nav** — `syncCollapseState()` applies initial collapsed DOM state; section header clicks call `uiTree.updateNode()` and set `hidden` on children so nav skips them.
12. **Roving tabindex not specified** — all interactive elements initialized to `tabindex="-1"`; only the current nav node gets `tabindex="0"`. See `initTabindexes()` in §3.5.
13. **Mouse → keyboard handoff missing** — `pointerdown` delegation updates `navManager.currentNodeId` so keyboard nav always starts from where the user last clicked.
14. **Disabled nodes were invisible to nav** — disabled nodes are focusable (cursor visits them) but non-activatable; not hidden from traversal.
15. **No visual parity contract for Phase 4** — explicit DOM class requirements and migration verification procedure added to §4.0.
16. **Scroll into view not specified** — `_setFocus()` calls `scrollIntoView({ block: 'nearest' })` when moving cursor.
17. **Canvas used ad-hoc `_interactionMode` flag** — replaced with `strategy: "canvas"` scope that uses standard KNM scope entry/exit. `scopeKeyHandlers` on the behavior object dispatch canvas operations; no special KNM state needed.

### Edge cases to handle

- **Collapse while cursor is inside section** — the section header click handler now moves the cursor to the section entry-node before collapsing children (see §2.4).
- **Node removed while focused** — `removeNode` emits `node:removed` with `parentId`; `TreeNavigationBridge` calls `restoreFocusToId(parentId)`. If the parent was also removed (subtree removal), use the subtree root's parentId.
- **Double overlay open** — `_enterScope` has no re-entrancy guard. Two rapid trigger activations could push the same overlay twice. Trigger behaviors should check `!pickerNode.hidden` before entering scope (already done in §3.2 behaviors).
- **Slider disabled mid-drag** — the `disabled` check in `_createBehavior` runs at nav tree build time, not invocation time. A runtime disable requires rebuilding that subtree (via `uiTree.updateNode` → bridge → `rebuildSubtreeById`).
- **`scrollIntoView` during rapid traversal** — use `behavior: 'instant'` when time between keystrokes is < 200ms, `'smooth'` otherwise. Track last keystroke timestamp in KNM.
- **`buildPresets` called twice** — the guard in §2.3 removes existing preset nodes before re-adding them, preventing "Node already exists" errors.

---

## File Checklist

### Create

- [ ] `src/ui/semantic-tree/EventEmitter.js`
- [ ] `src/ui/semantic-tree/store.js`
- [ ] `src/ui/semantic-tree/builders.js`
- [ ] `src/ui/semantic-tree/principia-tree.js`
- [ ] `src/ui/semantic-tree/index.js`
- [ ] `src/ui/semantic-tree/attach.js`
- [ ] `src/navigation/KeyboardNavigationManager.js`
- [ ] `src/navigation/SemanticTreeAdapter.js`
- [ ] `src/navigation/TreeNavigationBridge.js`
- [ ] `src/ui/projections/SliderProjection.js` *(Phase 4)*
- [ ] `src/ui/projections/SectionProjection.js` *(Phase 4)*
- [ ] `src/ui/projections/PickerProjection.js` *(Phase 4)*
- [ ] `src/ui/semantic-tree/update-bridge.js` *(Phase 5)*

### Modify

- [ ] `src/main.js` — initialize tree, attach elements, sync collapse, init tabindexes, wire navigation
- [ ] `src/ui/semantic-tree/attach.js` — add `syncCollapseState()` and `initTabindexes()`
- [ ] `src/ui/builders/sliders.js` — `buildZ0Sliders` accepts `uiTree` parameter
- [ ] `src/ui/builders/presets.js` — `buildPresets` registers tree nodes
- [ ] `src/ui/dialogs/dialog.js` — integrate with KNM on open/close
- [ ] `src/ui/components/section/SectionFactory.js` — section header click calls `uiTree.updateNode()` + sets child `hidden` flags
- [ ] `src/ui/sidebar/initSections.js` *(Phase 4)* — use projections

### Eventually Remove (Phase 4+)

- [ ] `src/ui/components/slider/SliderFactory.js`
- [ ] `src/ui/components/section/SectionFactory.js`
- [ ] Most of `src/ui/pickers/`

---

*Archived docs in `docs/backup/`: `SEMANTIC_UI_TREE_SPEC.md`, `KEYBOARD_NAVIGATION_SPEC.md`, `PRINCIPIA_UI_TREE_MAPPING.md`, `PHASE_1_CHECKLIST.md`, `REFACTOR_SUMMARY.md`, `SEMANTIC_TREE_REFACTOR_PLAN.md`*
