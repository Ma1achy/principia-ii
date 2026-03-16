# Principia Semantic Tree Refactoring Plan

**Strategic plan for migrating Principia's GUI to the semantic UI tree architecture**

This document provides a concrete, phase-by-phase plan for refactoring Principia's existing imperative DOM construction to use the semantic tree system defined in `SEMANTIC_UI_TREE_SPEC.md`.

---

## Current State Analysis

### Existing Architecture

**Strengths:**
- Clean factory pattern (`SliderFactory`, `SectionFactory`, `PickerFactory`)
- Centralized initialization (`initSections.js`, `initControlSection.js`)
- Dynamic content generation (presets, z0 sliders)
- Good separation between UI module and application logic

**Weaknesses:**
- **No canonical UI model** - DOM is the source of truth
- **Brittle element lookups** - Heavy use of `document.getElementById()`
- **Navigation is DOM-coupled** - Would need to discover structure from DOM
- **Focus restoration impossible** - No stable semantic IDs
- **Testing difficult** - Can't test UI structure without DOM
- **State sync complex** - Direct DOM manipulation scattered across codebase

### Migration Principles

1. **Build the full system first** — Implement tree store, all builders, all projections,
   and the navigation layer before migrating any existing component. No dual-track rendering.
2. **Port one component at a time** — Once the full system is ready, migrate each
   section/factory to use the projection, verify it, then delete the old factory code.
3. **Full UI in tree from day 1** — The tree definition covers the entire app
   (sidebar + canvas controls + panel overlays), not just sections migrated so far.
4. **Module singleton, not global** — `uiTree` is exported from `src/ui/semantic-tree/index.js`.
   No `window.uiTree` (except temporary debug convenience).
5. **Test at each phase** — Especially after Phase 2 (projections): each projected
   section must be visually and functionally identical to the factory output.

---

## Phase Overview

| Phase | Goal | Deliverable |
|---|---|---|
| 1. Foundation | Tree store, builders, full tree definition | `uiTree.toJSON()` shows complete UI |
| 2. Projection Layer | All widget projections producing correct DOM | Every section can be rendered from tree |
| 3. Navigation Layer | Full KNM, behaviors, visualizer | Keyboard navigation works end-to-end |
| 4. Migration | Port each factory to projection, delete old code | Factories gone, projections only |
| 5. State Integration | Events + sync flow through tree | `state.x = y` → tree → DOM |

**Target:** After Phase 3, keyboard navigation is complete. Phase 4–5 are cleanup.
Build Phase 1–2–3 in full before migrating any components (Phase 4).

---

## Phase 1: Foundation (Week 1)

**Goal:** Tree store + builders + complete Principia tree definition (full UI coverage)

### 1.1 Create Core Tree Implementation

**New files:**

```javascript
// src/ui/semantic-tree/store.js
export class UITreeStore {
  constructor() {
    this._nodes = new Map();
    this._elementBindings = new Map();
    this._eventEmitter = new EventEmitter();
    this._root = null;
  }
  
  // Core API (from spec)
  addNode(node) { /*...*/ }
  addNodes(nodes) { /*...*/ }   // also infers parentId from children arrays
  getNode(id) { /*...*/ }
  getRoot() { /*...*/ }
  getChildren(id) { /*...*/ }   // returns node objects, not IDs
  getParent(id) { /*...*/ }
  updateNode(id, updates) { /*...*/ }
  removeNode(id) { /*...*/ }
  removeSubtree(id) { /*...*/ }
  attachElement(id, element) { /*...*/ }
  getElement(id) { /*...*/ }
  findNode(predicate) { /*...*/ }

  // Transient overlay API (for dialogs)
  registerTransientOverlay(overlayNode, triggerId) {
    // Add overlay nodes to tree, emit 'overlay:registered' event
    // navManager listens and activates the overlay
  }
  removeTransientOverlay(overlayId) {
    // Remove overlay nodes from tree, emit 'overlay:removed' event
    // navManager listens and restores focus to triggerId
  }

  // Event system
  on(event, handler) { /*...*/ }
  off(event, handler) { /*...*/ }
  emit(event, payload) { /*...*/ }
}
```

```javascript
// src/ui/semantic-tree/builders.js
export function root(children) { /*...*/ }
export function section(id, label, children, config) { /*...*/ }
export function scope(id, children, config) { /*...*/ }        // generic container
export function slider(id, config) { /*...*/ }
export function button(id, config) { /*...*/ }
export function checkbox(id, config) { /*...*/ }               // checkbox leaf
export function picker(id, config) { /*...*/ }
export function buttonGroup(id, children, config) { /*...*/ }
export function panel(id, title, children, config) { /*...*/ } // side-panel overlay

// Utility
function buildChildren(nodes) {
  return nodes.map(n => n.id);
}
```

**`checkbox` builder** produces a single leaf node:
```javascript
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
```

**`panel` builder** produces a modal overlay scope with a close button as first child:
```javascript
export function panel(id, title, children, config = {}) {
  const closeId = `${id}:close`;
  const closeNode = button(closeId, {
    ariaLabel: `Close ${title}`,
    role: 'button'
  });

  const overlayNode = {
    id,
    kind: 'panel',
    parentId: null,               // overlays have no structural parent
    children: [closeId, ...buildChildren(children)],
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: 'first',
    wrap: false,
    overlay: true,
    modal: true,
    ariaRole: 'dialog',
    ariaLabel: title,
    meta: {
      title,
      triggerId: config.triggerId || null   // who opened this panel
    }
  };

  return { overlayNode, closeNode, nodes: [overlayNode, closeNode] };
}
```

**`section` default `entryPolicy` changed to `'remembered'`:**
Sections remember where the cursor was on the previous visit. Update the `section`
builder default:
```javascript
entryPolicy: config.entryPolicy || 'remembered',
```

**`hidden` property on all node types:**
All builders accept `config.hidden` (boolean, default `false`). Nodes with
`hidden: true` are skipped by the nav traversal engine. Update via:
```javascript
uiTree.updateNode(id, { hidden: false }); // reveal conditional element
```

**Module singleton:**
```javascript
// src/ui/semantic-tree/index.js
import { UITreeStore } from './store.js';
export const uiTree = new UITreeStore();
```
Import everywhere as `import { uiTree } from '../semantic-tree/index.js';`

### 1.2 Build Principia Tree Definition

**New file:**

```javascript
// src/ui/semantic-tree/principia-tree.js
import { root, section, scope, slider, button, checkbox, picker, buttonGroup, panel } from './builders.js';

export function buildPrincipiaUITree() {
  const nodes = [];

  // ─── Canvas controls ──────────────────────────────────────────────────
  // Floating buttons overlaid on the canvas. Separate from the sidebar.
  const infoBtnNode = button("infoBtn", { ariaLabel: "Controls and information" });
  const settingsBtnNode = button("settingsBtn", { ariaLabel: "Navigation and rendering settings" });
  const canvasControlsScope = scope("canvas-controls", [infoBtnNode, settingsBtnNode], {
    focusMode: "entry-node",
    strategy: "linear",
    wrap: true
  });
  nodes.push(canvasControlsScope, infoBtnNode, settingsBtnNode);

  // ─── Sidebar ──────────────────────────────────────────────────────────
  // Control section
  const renderBtn = button("renderBtn", { role: "button", primary: true, ariaLabel: "Render" });
  const copyLinkBtn = button("copyLinkBtn", { ariaLabel: "Copy link" });
  const copyJsonBtn = button("copyJsonBtn", { ariaLabel: "Copy JSON" });
  const savePngBtn = button("savePngBtn", { ariaLabel: "Save PNG" });
  const resetAllBtn = button("resetAllBtn", { ariaLabel: "Reset all" });
  const controlButtons = buttonGroup("ctrl-section", [
    renderBtn, copyLinkBtn, copyJsonBtn, savePngBtn, resetAllBtn
  ], { strategy: "linear", wrap: false });
  nodes.push(controlButtons.node, renderBtn, copyLinkBtn, copyJsonBtn, savePngBtn, resetAllBtn);
  
  // Display section
  const modePicker = picker("mode-picker", {
    triggerKind: "button",
    label: "Render mode",
    options: [
      { id: "event", label: "Event classification", value: 0 },
      { id: "phase-diffusion", label: "Phase + Diffusion", value: 1 },
      { id: "phase", label: "Shape sphere phase", value: 2 },
      { id: "diffusion", label: "Diffusion", value: 3 },
      { id: "rgb", label: "Shape sphere RGB", value: 4 }
    ],
    selectedId: "event"
  });
  
  const resPicker = picker("resolution-picker", {
    triggerKind: "button",
    label: "Resolution",
    options: [
      { id: "256", label: "256 × 256", value: 256 },
      { id: "512", label: "512 × 512", value: 512 },
      { id: "1024", label: "1024 × 1024", value: 1024 },
      { id: "2048", label: "2048 × 2048", value: 2048 }
    ],
    selectedId: "1024"
  });
  
  const displaySection = section("sec-mode", "Display", [
    modePicker.trigger,
    resPicker.trigger
  ], { entryPolicy: "remembered" });
  
  nodes.push(displaySection, modePicker.trigger, ...modePicker.overlayNodes);
  nodes.push(resPicker.trigger, ...resPicker.overlayNodes);
  
  // Slice Basis section
  // The preset grid is populated dynamically by buildPresets(). Register a
  // placeholder container node; preset button nodes are added at runtime.
  const presetGridContainer = {
    id: "preset-grid",
    kind: "scope",
    parentId: null,  // inferred by addNodes()
    children: [],    // populated by buildPresets()
    focusMode: "container",
    strategy: "grid",  // presets are a grid, not linear
    entryPolicy: "first",
    wrap: true,
    meta: { dynamic: true }
  };

  // Custom basis panel pickers (inside #customBasisPanel, hidden until custom preset selected)
  // Custom basis panel pickers: hidden until a "custom" preset is selected.
  // Revealed via: uiTree.updateNode('customDimH-picker:trigger', { hidden: false })
  const customDimHPicker = picker("customDimH-picker", {
    triggerKind: "param-trigger",
    label: "H-axis",
    options: [], // populated dynamically by buildAxisSelects()
    selectedId: "z0",
    hidden: true
  });

  const customDimVPicker = picker("customDimV-picker", {
    triggerKind: "param-trigger",
    label: "V-axis",
    options: [], // populated dynamically by buildAxisSelects()
    selectedId: "z1",
    hidden: true
  });

  const customMagSlider = slider("slider-customMag", {
    label: "±mag",
    min: 0.1,
    max: 4.0,
    step: 0.05,
    value: 1.0,
    hasParamTrigger: false,
    hidden: true,   // hidden until custom preset active
    meta: { tip: "Half-range magnitude for custom basis vectors." }
  });

  const sliceBasisSection = section("sec-presets", "Slice Basis", [
    presetGridContainer,        // dynamically populated
    customDimHPicker.trigger,   // hidden: true until custom preset active
    customDimVPicker.trigger,
    ...customMagSlider.nodes
  ], { entryPolicy: "remembered" });

  nodes.push(
    sliceBasisSection, presetGridContainer,
    customDimHPicker.trigger, ...customDimHPicker.overlayNodes,
    customDimVPicker.trigger, ...customDimVPicker.overlayNodes,
    ...customMagSlider.nodes
  );
  
  // Slice Offset section
  const z0RangeSlider = slider("slider-z0Range", {
    label: "±range",
    min: 0.25,
    max: 8.0,
    step: 0.25,
    value: 2.0,
    hasParamTrigger: false,
    meta: { tip: "Range of z0 offset sliders." }
  });
  
  const sliceOffsetSection = section("sec-z0", "Slice Offset z₀ (10D)", [
    button("z0Zero", { role: "button", ariaLabel: "Zero all z0" }),
    button("z0SmallRand", { role: "button", ariaLabel: "Small random z0" }),
    ...z0RangeSlider.nodes
    // z0-z9 sliders will be added dynamically
  ], { open: true });
  
  nodes.push(sliceOffsetSection, ...z0RangeSlider.nodes);
  
  // Orientation section
  const gammaSlider = slider("slider-gamma", {
    label: "γ — rotate within plane",
    min: 0,
    max: 360,
    step: 0.25,
    value: 0,
    hasParamTrigger: false,
    meta: { tip: "Rotate slice plane by gamma degrees." }
  });
  
  // Tilt dimension pickers: options populated dynamically by buildAxisSelects()
  // but the tilt dims are limited to extra dimensions (z8/z9 by default).
  // Start with a placeholder; options are replaced at runtime.
  const tiltDim1Picker = picker("tiltDim1-picker", {
    triggerKind: "param-trigger",
    label: "q₁ tilt into z₈",
    options: [
      { id: "z8", label: "z₈", value: 8 },
      { id: "z9", label: "z₉", value: 9 }
    ],
    selectedId: "z8"
  });
  
  const tiltAmt1Slider = slider("slider-tiltAmt1", {
    label: "Tilt amount",
    min: -2.0,
    max: 2.0,
    step: 0.01,
    value: 0,
    hasParamTrigger: false,
    fastActions: {
      "Shift+Enter": "jump-and-begin-value-edit"
    }
  });
  
  const tiltDim2Picker = picker("tiltDim2-picker", {
    triggerKind: "param-trigger",
    label: "q₂ tilt into z₉",
    options: [
      { id: "z8", label: "z₈", value: 8 },
      { id: "z9", label: "z₉", value: 9 }
    ],
    selectedId: "z9"
  });
  
  const tiltAmt2Slider = slider("slider-tiltAmt2", {
    label: "Tilt amount",
    min: -2.0,
    max: 2.0,
    step: 0.01,
    value: 0,
    hasParamTrigger: false
  });
  
  const doOrthoBtn = checkbox("doOrtho", { label: "Orthonormalise q₁, q₂" });
  const rotResetBtn = button("rotReset", { ariaLabel: "Reset tilts + γ" });

  const orientationSection = section("sec-orient", "Orientation (γ + tilts)", [
    ...gammaSlider.nodes,
    tiltDim1Picker.trigger,
    ...tiltAmt1Slider.nodes,
    tiltDim2Picker.trigger,
    ...tiltAmt2Slider.nodes,
    doOrthoBtn,
    rotResetBtn
  ], { entryPolicy: "remembered" });
  
  nodes.push(
    orientationSection,
    ...gammaSlider.nodes,
    tiltDim1Picker.trigger, ...tiltDim1Picker.overlayNodes,
    ...tiltAmt1Slider.nodes,
    tiltDim2Picker.trigger, ...tiltDim2Picker.overlayNodes,
    ...tiltAmt2Slider.nodes,
    doOrthoBtn, rotResetBtn
  );
  
  // Simulation section (collapsed by default)
  const simulationSliders = [
    slider("slider-horizon", { label: "Horizon", min: 10, max: 200, step: 10, value: 50 }),
    slider("slider-maxSteps", { label: "Max steps", min: 1000, max: 40000, step: 1000, value: 20000 }),
    slider("slider-dtMacro", { label: "dt macro", min: 0.0005, max: 0.01, step: 0.0005, value: 0.002 }),
    slider("slider-rColl", { label: "r_coll", min: 0.005, max: 0.06, step: 0.001, value: 0.02 }),
    slider("slider-rEsc", { label: "r_esc", min: 1.0, max: 12.0, step: 0.25, value: 5.0 })
  ];
  
  const simSection = section("sec-sim", "Simulation",
    simulationSliders.flatMap(s => s.nodes),
    { entryPolicy: "remembered", meta: { collapsed: true } }
  );
  
  nodes.push(simSection, ...simulationSliders.flatMap(s => s.nodes));
  
  // Export/Import section (collapsed by default)
  const pasteJsonBtn = button("pasteJsonBtn", { role: "button", ariaLabel: "Apply JSON" });
  const downloadJsonBtn = button("downloadJsonBtn", { role: "button", ariaLabel: "Download JSON" });
  // stateBox textarea is non-navigable, not included in semantic tree

  const exportSection = section("sec-state", "Export / Import", [
    pasteJsonBtn,
    downloadJsonBtn
  ], { entryPolicy: "remembered", meta: { collapsed: true } });

  nodes.push(exportSection, pasteJsonBtn, downloadJsonBtn);

  // ─── Sidebar scope wrapper ─────────────────────────────────────────────
  // Wraps all sidebar sections so canvas-controls and sidebar are siblings
  // at the top level, not mixed together.
  const sidebarScope = scope("sidebar", [
    controlButtons.node,
    displaySection,
    sliceBasisSection,
    sliceOffsetSection,
    orientationSection,
    simSection,
    exportSection
  ], { focusMode: "container", strategy: "linear" });
  nodes.push(sidebarScope);

  // ─── Panel overlays ────────────────────────────────────────────────────
  // Info panel: only the close button is navigable; content is static text.
  const infoPanel = panel("info-panel", "Controls & Info", [], {
    triggerId: "infoBtn"
  });
  nodes.push(...infoPanel.nodes);

  // Settings panel: 3 groups with checkboxes and sliders.
  const renderingGroup = scope("settings-panel:rendering", [
    checkbox("autoRender",       { label: "Auto-render" }),
    checkbox("previewWhileDrag", { label: "Preview while moving" }),
    checkbox("showHud",          { label: "Show probe" })
  ], { focusMode: "container", strategy: "linear" });

  const zoomSpeedSlider = slider("slider-stgZoomSpeed", {
    label: "Zoom speed", min: 0.2, max: 4.0, step: 0.1, value: 1.0
  });

  const scrollGroup = scope("settings-panel:scroll", [
    checkbox("stgInvertScroll", { label: "Invert scroll direction" }),
    ...zoomSpeedSlider.nodes
  ], { focusMode: "container", strategy: "linear" });

  const panSpeedSlider = slider("slider-stgPanSpeed", {
    label: "Pan speed", min: 0.2, max: 4.0, step: 0.1, value: 1.0
  });

  const panningGroup = scope("settings-panel:panning", [
    checkbox("stgInvertPanX", { label: "Invert pan X" }),
    checkbox("stgInvertPanY", { label: "Invert pan Y" }),
    ...panSpeedSlider.nodes
  ], { focusMode: "container", strategy: "linear" });

  const settingsPanel = panel("settings-panel", "Settings", [
    renderingGroup,
    scrollGroup,
    panningGroup
  ], { triggerId: "settingsBtn" });

  nodes.push(
    renderingGroup,
    checkbox("autoRender",       { label: "Auto-render" }),
    checkbox("previewWhileDrag", { label: "Preview while moving" }),
    checkbox("showHud",          { label: "Show probe" }),
    scrollGroup,
    checkbox("stgInvertScroll",  { label: "Invert scroll direction" }),
    ...zoomSpeedSlider.nodes,
    panningGroup,
    checkbox("stgInvertPanX",    { label: "Invert pan X" }),
    checkbox("stgInvertPanY",    { label: "Invert pan Y" }),
    ...panSpeedSlider.nodes,
    ...settingsPanel.nodes
  );

  // ─── Root ──────────────────────────────────────────────────────────────
  const rootNode = root([canvasControlsScope, sidebarScope]);
  // Picker dropdowns and panel overlays are overlay nodes (parentId: null)
  // and are NOT children of root — they live outside the main tree structure.
  nodes.push(rootNode);

  return nodes;
}
```

### 1.3 Integration Point

```javascript
// src/ui/semantic-tree/index.js  (module singleton - import this everywhere)
import { UITreeStore } from './store.js';
export const uiTree = new UITreeStore();

// src/main.js (top-level initialization)
import { uiTree } from './ui/semantic-tree/index.js';
import { buildPrincipiaUITree } from './ui/semantic-tree/principia-tree.js';

console.log('[Boot] Building semantic UI tree...');
uiTree.addNodes(buildPrincipiaUITree());
console.log('[Boot] ✓ Semantic tree built:', uiTree.toJSON());

// Expose for debugging
window.uiTree = uiTree;
```

**Verification:** `window.uiTree.toJSON()` in console should show complete tree structure

---

## Phase 2: Element Binding (Week 2)

**Goal:** Connect existing DOM elements to semantic tree nodes

### 2.1 Attach Elements After DOM Creation

```javascript
// New file: src/ui/semantic-tree/attach.js
export function attachPrincipiaElements(uiTree) {
  // Control buttons
  uiTree.attachElement("renderBtn", document.getElementById("renderBtn"));
  uiTree.attachElement("copyLinkBtn", document.getElementById("copyLinkBtn"));
  uiTree.attachElement("copyJsonBtn", document.getElementById("copyJsonBtn"));
  uiTree.attachElement("savePngBtn", document.getElementById("savePngBtn"));
  uiTree.attachElement("resetAllBtn", document.getElementById("resetAllBtn"));
  
  // Display section
  uiTree.attachElement("mode-picker:trigger", document.getElementById("modeLabel"));
  uiTree.attachElement("resolution-picker:trigger", document.getElementById("resLabel"));
  
  // Sliders (attach to .sl-row wrapper, not individual inputs)
  uiTree.attachElement("slider-gamma", document.getElementById("gamma").closest(".sl-row"));
  uiTree.attachElement("slider-customMag", document.getElementById("customMag").closest(".sl-row"));
  uiTree.attachElement("slider-z0Range", document.getElementById("z0Range").closest(".sl-row"));
  
  // Orientation
  uiTree.attachElement("tiltDim1-picker:trigger", document.getElementById("tiltDim1Label"));
  uiTree.attachElement("slider-tiltAmt1", document.getElementById("tiltAmt1").closest(".sl-row"));
  uiTree.attachElement("tiltDim2-picker:trigger", document.getElementById("tiltDim2Label"));
  uiTree.attachElement("slider-tiltAmt2", document.getElementById("tiltAmt2").closest(".sl-row"));
  uiTree.attachElement("doOrtho", document.getElementById("doOrtho"));
  uiTree.attachElement("rotReset", document.getElementById("rotReset"));
  
  // Simulation sliders
  ["horizon", "maxSteps", "dtMacro", "rColl", "rEsc"].forEach(id => {
    uiTree.attachElement(`slider-${id}`, document.getElementById(id).closest(".sl-row"));
  });

  // Export/Import
  uiTree.attachElement("pasteJsonBtn", document.getElementById("pasteJsonBtn"));
  uiTree.attachElement("downloadJsonBtn", document.getElementById("downloadJsonBtn"));

  // Sections (sec-mode etc. are IDs on the section body element, so .closest(".section")
  // reaches the outer wrapper which is the navigable unit)
  ["sec-mode", "sec-presets", "sec-z0", "sec-orient", "sec-sim", "sec-state"].forEach(id => {
    uiTree.attachElement(id, document.getElementById(id).closest(".section"));
  });

  // Z0 sliders: range inputs have no id - attach via container row index.
  // buildZ0Sliders() appends .sl-row elements to #z0Sliders in order z0..z9.
  const z0Container = document.getElementById('z0Sliders');
  const z0Rows = z0Container.querySelectorAll('.sl-row');
  z0Rows.forEach((row, i) => {
    uiTree.attachElement(`slider-z${i}`, row);
  });

  console.log('[Attach] Bound', uiTree._elementBindings.size, 'elements to tree');
}
```

```javascript
// In src/main.js, after factories create DOM
attachPrincipiaElements(uiTree);
```

### 2.2 Dynamic Content Binding

The actual `buildZ0Sliders` (in `src/ui/builders/sliders.js`) creates range inputs with
`dataset.idx` but no `id` attribute. Attachment uses row index order, not element IDs.
Pass `uiTree` as a parameter rather than accessing `window.uiTree` to keep the dependency explicit.

```javascript
// Modify buildZ0Sliders signature to accept uiTree
export function buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawHUD, uiTree) {
  const container = document.getElementById('z0Sliders');
  container.innerHTML = '';

  // NEW: Register z0 slider nodes in tree before creating DOM
  // (so addNodes() parentId inference runs on all nodes together)
  if (uiTree) {
    const z0SliderNodes = [];
    const z0ChildIds = [];

    for (let i = 0; i < 10; i++) {
      const { nodes } = slider(`slider-z${i}`, {
        label: `z${i}`,
        min: -2.0,
        max: 2.0,
        step: 0.01,
        value: state.z0[i] || 0,
        hasParamTrigger: false
      });
      z0SliderNodes.push(...nodes);
      z0ChildIds.push(`slider-z${i}`);
    }

    uiTree.addNodes(z0SliderNodes);

    // Append z0 slider IDs to sec-z0 children
    const sec = uiTree.getNode("sec-z0");
    uiTree.updateNode("sec-z0", {
      children: [...sec.children, ...z0ChildIds]
    });
  }

  // Build DOM (existing logic unchanged)
  for (let i = 0; i < 10; i++) {
    // ... existing DOM construction ...

    container.appendChild(row);  // row is the .sl-row element

    // Attach row to tree node by index (range inputs have no id)
    if (uiTree) {
      uiTree.attachElement(`slider-z${i}`, row);
    }

    // Existing event handlers...
  }
}
```

Call site in `main.js`:
```javascript
buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawHUD, uiTree);
```

---

## Phase 3: Navigation Integration (Week 3)

**Goal:** Connect keyboard navigation to semantic tree

### 3.1 Implement Navigation Manager Stub

```javascript
// src/navigation/KeyboardNavigationManager.js
export class KeyboardNavigationManager {
  constructor(rootNode) {
    this._root = rootNode;
    this._nodeIndex = new Map();
    this.sessionState = {
      currentNodeId: null,
      activePath: [],
      overlayStack: []
    };
    
    if (rootNode) {
      this._buildIndex(rootNode);
    }
  }
  
  setRootNode(rootNode) {
    this._root = rootNode;
    this._nodeIndex.clear();
    if (rootNode) {
      this._buildIndex(rootNode);
    }
  }
  
  _buildIndex(node) {
    this._nodeIndex.set(node.id, node);
    if (node.children) {
      node.children.forEach(child => this._buildIndex(child));
    }
  }
  
  // API methods (stubs for now)
  rebuildSubtreeById(nodeId) { /*...*/ }
  removeNodeById(nodeId) { /*...*/ }
  isInFocusChain(nodeId) { return this.sessionState.currentNodeId === nodeId; }
  restoreFocusToId(nodeId) { this.sessionState.currentNodeId = nodeId; }
  openOverlayById(overlayId, triggerId, returnFocusId) { /*...*/ }
  closeOverlay(overlayId) { /*...*/ }
  executeFastAction(nodeId, actionType) { return false; }
}
```

### 3.2 Create Semantic Tree Adapter

```javascript
// src/navigation/SemanticTreeAdapter.js
export class SemanticTreeAdapter {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree = uiTreeStore;
    this.navManager = navigationManager;
  }
  
  buildNavigationTree() {
    const rootNode = this.uiTree.getRoot();
    return rootNode ? this.convertNode(rootNode) : null;
  }
  
  convertNode(uiNode) {
    if (uiNode.focusMode === "none") return null;
    
    const element = this.uiTree.getElement(uiNode.id);
    
    if (uiNode.focusMode === "leaf") {
      return {
        id: uiNode.id,
        element,
        behavior: this.createBehavior(uiNode),
        role: uiNode.role,
        primary: uiNode.primary,
        fastActions: uiNode.fastActions
      };
    }
    
    if (uiNode.focusMode === "entry-node" || uiNode.focusMode === "container") {
      const children = this.uiTree.getChildren(uiNode.id)
        .map(child => this.convertNode(child))
        .filter(Boolean);
      
      return {
        id: uiNode.id,
        children,
        focusMode: uiNode.focusMode,
        strategy: uiNode.strategy,
        entryPolicy: uiNode.entryPolicy,
        modal: uiNode.modal,
        overlay: uiNode.overlay,
        element,
        fastActions: uiNode.fastActions
      };
    }
    
    return null;
  }
  
  createBehavior(uiNode) {
    const element = this.uiTree.getElement(uiNode.id);
    
    switch (uiNode.kind) {
      case "button":
        return {
          activate: () => element?.click()
        };
      
      case "analog-control":
        return {
          activate: () => element?.focus(),
          increment: () => { /* adjust slider */ },
          decrement: () => { /* adjust slider */ }
        };
      
      case "param-trigger":
        return {
          activate: () => {
            const dropdown = this.uiTree.findNode(node => 
              (node.kind === "dropdown" || node.kind === "menu") &&
              node.meta?.triggerId === uiNode.id
            );
            
            if (dropdown) {
              this.navManager.openOverlayById(dropdown.id, uiNode.id);
            }
          }
        };
      
      default:
        return { activate: () => element?.click() };
    }
  }
}
```

### 3.3 Create Navigation Bridge

```javascript
// src/navigation/TreeNavigationBridge.js
export class TreeNavigationBridge {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree = uiTreeStore;
    this.navManager = navigationManager;
    
    this.boundHandleNodeUpdate = this.handleNodeUpdate.bind(this);
    this.boundHandleNodesAdded = this.handleNodesAdded.bind(this);
    this.boundHandleNodeRemoved = this.handleNodeRemoved.bind(this);
    this.boundHandleSubtreeRemoved = this.handleSubtreeRemoved.bind(this);
    
    this.uiTree.on('node:updated', this.boundHandleNodeUpdate);
    this.uiTree.on('nodes:added', this.boundHandleNodesAdded);
    this.uiTree.on('node:removed', this.boundHandleNodeRemoved);
    this.uiTree.on('subtree:removed', this.boundHandleSubtreeRemoved);
  }
  
  handleNodeUpdate({ id, updates }) {
    this.navManager.rebuildSubtreeById(id);
    
    if (this.navManager.isInFocusChain(id)) {
      // Reconcile focus if needed
    }
  }
  
  handleNodesAdded({ ids }) {
    const ancestorId = this.uiTree.findCommonAncestor(ids);
    if (ancestorId) {
      this.navManager.rebuildSubtreeById(ancestorId);
    }
  }
  
  handleNodeRemoved({ id }) {
    if (this.navManager.isInFocusChain(id)) {
      const survivingAncestor = this.uiTree.getNearestAncestor(id);
      if (survivingAncestor) {
        this.navManager.restoreFocusToId(survivingAncestor);
      }
    }
    this.navManager.removeNodeById(id);
  }
  
  handleSubtreeRemoved({ rootId, removedIds }) {
    const focusedRemovedId = removedIds.find(id => this.navManager.isInFocusChain(id));
    
    if (focusedRemovedId) {
      const survivingAncestor = this.uiTree.getNearestAncestor(rootId);
      if (survivingAncestor) {
        this.navManager.restoreFocusToId(survivingAncestor);
      }
    }
    
    this.navManager.removeNodeById(rootId);
  }
  
  destroy() {
    this.uiTree.off('node:updated', this.boundHandleNodeUpdate);
    this.uiTree.off('nodes:added', this.boundHandleNodesAdded);
    this.uiTree.off('node:removed', this.boundHandleNodeRemoved);
    this.uiTree.off('subtree:removed', this.boundHandleSubtreeRemoved);
  }
}
```

### 3.4 Wire Navigation System

```javascript
// In src/main.js, after element attachment

import { KeyboardNavigationManager } from './navigation/KeyboardNavigationManager.js';
import { SemanticTreeAdapter } from './navigation/SemanticTreeAdapter.js';
import { TreeNavigationBridge } from './navigation/TreeNavigationBridge.js';

const navManager = new KeyboardNavigationManager(null);
const adapter = new SemanticTreeAdapter(uiTree, navManager);
const navTree = adapter.buildNavigationTree();
navManager.setRootNode(navTree);

const bridge = new TreeNavigationBridge(uiTree, navManager);

// Expose for debugging
window.navManager = navManager;
window.navBridge = bridge;

console.log('[Boot] ✓ Navigation system connected to semantic tree');
```

### 3.5 Dialog System Integration (Required Before Phase 3 Is Complete)

**Problem:** `src/ui/dialogs/dialog.js` has its own independent focus management that
will conflict with `KeyboardNavigationManager`:

- `DialogManager.restoreFocusTarget = document.activeElement` — stores raw DOM element,
  not a nav tree node ID. When the dialog closes it restores DOM focus but leaves the
  nav manager's `currentNodeId` stale.
- `trapFocus()` manually intercepts Tab — will fight with KNM's Tab handler.
- Both systems listen to `document.keydown` globally.

**Resolution:** Coordinate the two systems so KNM yields to `DialogManager` when
a dialog is open.

```javascript
// In KeyboardNavigationManager's keydown handler, add an early exit:
document.addEventListener('keydown', (e) => {
  // Yield to dialog system when a dialog is open
  if (DialogManager.isOpen()) return;

  // ... rest of KNM handler
}, true); // capture phase to run before dialog's handler

// In dialog.js finalizeClose(), notify KNM to restore tree focus:
// After hiding dialog, instead of raw restoreFocus():
if (options.restoreFocus && window.navManager) {
  const triggerId = /* store trigger node id at dialog open time */;
  window.navManager.restoreFocusToId(triggerId);
} else {
  restoreFocus(); // fallback
}
```

Additionally, when a dialog-triggering button is activated via KNM, store its
tree node ID before calling `showDialog()` so focus can be restored to the
correct nav position on close — not just the DOM element.

**Status:** Must be resolved before Phase 3 is considered complete. The dialog system
currently works standalone; this integration is additive and non-breaking.

---

## Phase 4: Render Projection (Week 4)

**Goal:** Convert factories to render from tree nodes

### 4.1 Create Render Projection for Sliders

```javascript
// src/ui/projections/SliderProjection.js
export class SliderProjection {
  constructor(uiTreeStore) {
    this.uiTree = uiTreeStore;
  }
  
  render(sliderScopeId) {
    const scope = this.uiTree.getNode(sliderScopeId);
    if (!scope || scope.kind !== "slider") return null;
    
    const meta = scope.meta;
    
    const row = document.createElement('div');
    row.className = 'sl-row';
    
    // Label
    const label = document.createElement('label');
    label.innerHTML = meta.label;
    
    // Track row
    const trackRow = document.createElement('div');
    trackRow.className = 'sl-track-row';
    
    // getChildren() returns node objects (not IDs)
    const children = this.uiTree.getChildren(sliderScopeId);

    // Range input (analog-control)
    const analogNode = children.find(node => node.role === "analog-control");

    const rangeInput = document.createElement('input');
    rangeInput.type = 'range';
    rangeInput.id = sliderScopeId.replace('slider-', '');
    rangeInput.min = String(meta.min);
    rangeInput.max = String(meta.max);
    rangeInput.step = String(meta.step);
    rangeInput.value = String(meta.value);

    // Attach to tree using node.id (not the node object itself)
    this.uiTree.attachElement(analogNode.id, rangeInput);

    // Number input (value-editor)
    const valueNode = children.find(node => node.role === "value-editor");

    const valWrap = document.createElement('div');
    valWrap.className = 'sl-val-wrap';

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.className = 'slider-num';
    numberInput.id = `${rangeInput.id}Val`;
    numberInput.value = meta.value.toFixed(getDecimalPlaces(meta.step));
    numberInput.step = String(meta.step);
    numberInput.min = String(meta.min);
    numberInput.max = String(meta.max);

    // NOTE: Phase 4 render projection does NOT call enhanceSlider() yet.
    // The enhanced track (sl-range-wrap, sl-track-fill, sl-markers) is added
    // by enhanceAllSliders() which runs after DOM creation. The projection
    // must either call enhanceSlider(rangeInput) itself or defer to the
    // existing enhancement pass. Calling it directly is cleaner.

    this.uiTree.attachElement(valueNode.id, numberInput);
    
    valWrap.appendChild(numberInput);
    trackRow.appendChild(rangeInput);
    trackRow.appendChild(valWrap);
    
    row.appendChild(label);
    row.appendChild(trackRow);
    
    // Attach scope to row wrapper
    this.uiTree.attachElement(sliderScopeId, row);
    
    return row;
  }
}

function getDecimalPlaces(step) {
  const str = String(step);
  const decimalIndex = str.indexOf('.');
  return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
}
```

### 4.2 Gradually Replace Factory Calls

```javascript
// In createOrientationSection() (modify initSections.js)

// OLD:
const gammaSlider = createSlider({
  id: 'gamma',
  label: '&gamma; &mdash; rotate within plane',
  min: 0,
  max: 360,
  step: 0.25,
  value: 0,
  tip: 'Rotate the slice plane...'
});
content.appendChild(gammaSlider);

// NEW:
const sliderProjection = new SliderProjection(window.uiTree);
const gammaSlider = sliderProjection.render("slider-gamma");
content.appendChild(gammaSlider);
```

---

## Phase 5: Event Handler Migration (Week 5)

**Goal:** Move from direct DOM event handlers to tree-mediated updates

### 5.1 Create Update Bridge

```javascript
// src/ui/semantic-tree/update-bridge.js
export class UpdateBridge {
  constructor(uiTreeStore, state) {
    this.uiTree = uiTreeStore;
    this.state = state;
  }
  
  // Example: Slider value change
  handleSliderChange(sliderScopeId, newValue) {
    // Update tree
    this.uiTree.updateNode(sliderScopeId, {
      meta: {
        ...this.uiTree.getNode(sliderScopeId).meta,
        value: newValue
      }
    });
    
    // Update application state (temporary, until state becomes tree-driven)
    const sliderName = sliderScopeId.replace('slider-', '');
    if (sliderName === 'gamma') {
      this.state.gammaDeg = newValue;
    }
    // ... etc
  }
  
  // Example: Picker selection
  handlePickerChange(pickerId, newSelectedId) {
    // Find dropdown overlay
    const dropdown = this.uiTree.findNode(node => 
      node.kind === "dropdown" && node.meta?.triggerId === `${pickerId}:trigger`
    );
    
    if (dropdown) {
      // Update selected menu item
      const children = this.uiTree.getChildren(dropdown.id);
      children.forEach(childId => {
        const child = this.uiTree.getNode(childId);
        this.uiTree.updateNode(childId, {
          primary: child.meta?.value === newSelectedId
        });
      });
    }
    
    // Update application state
    // ...
  }
}
```

### 5.2 Refactor Event Handlers

```javascript
// In bindUI() (src/ui.js)

const updateBridge = new UpdateBridge(uiTree, state);

// OLD:
$("gamma").addEventListener("input", (e) => {
  state.gammaDeg = +e.target.value;
  const ni = $("gammaVal");
  if (document.activeElement !== ni) ni.value = state.gammaDeg.toFixed(2);
  scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
});

// NEW:
$("gamma").addEventListener("input", (e) => {
  const newValue = +e.target.value;
  updateBridge.handleSliderChange("slider-gamma", newValue);
  
  // Sync number input (temporary, until projections handle this)
  const ni = $("gammaVal");
  if (document.activeElement !== ni) ni.value = newValue.toFixed(2);
  
  scheduleRender("γ"); writeHash(); updateStateBox_(); drawHUD();
});
```

---

## Phase 6: State Integration (Week 6)

**Goal:** Make semantic tree the source of truth for UI state

### 6.1 Sync State to Tree

```javascript
// Modify syncUIFromState() to update tree instead of DOM directly

export function syncUIFromState(renderer, scheduleRender, writeHash, drawHUD) {
  const uiTree = window.uiTree;
  
  // Update mode picker
  const modePicker = uiTree.getNode("mode-picker:trigger");
  if (modePicker) {
    const dropdown = uiTree.findNode(n => n.meta?.triggerId === "mode-picker:trigger");
    const selectedOption = MODE_INFO[state.mode];
    // Update dropdown children to mark correct item as primary
  }
  
  // Update sliders
  uiTree.updateNode("slider-gamma", {
    meta: { ...uiTree.getNode("slider-gamma").meta, value: state.gammaDeg }
  });
  
  uiTree.updateNode("slider-tiltAmt1", {
    meta: { ...uiTree.getNode("slider-tiltAmt1").meta, value: state.tiltAmt1 }
  });
  
  // ... etc for all state-driven controls
  
  // Tree updates trigger reactive reconciliation, which updates nav + DOM
}
```

---

## Migration Timeline

### Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Foundation | Week 1 | UITreeStore + builders + tree definition running alongside existing UI |
| 2. Element Binding | Week 2 | All DOM elements bound to tree nodes, debuggable via `uiTree.getElement()` |
| 3. Navigation Integration | Week 3 | Keyboard nav reads from semantic tree, basic focus management |
| 4. Render Projection | Week 4 | First factories replaced with tree-driven rendering |
| 5. Event Handler Migration | Week 5 | Events update tree, tree triggers reconciliation |
| 6. State Integration | Week 6 | Tree becomes source of truth for UI state |

### Success Criteria

**After Phase 1:**
- Tree structure matches UI hierarchy
- `window.uiTree.toJSON()` shows complete tree
- No UI behavior changes

**After Phase 2:**
- All interactive elements have tree bindings
- `uiTree.getElement(id)` returns correct DOM node
- No UI behavior changes

**After Phase 3:**
- Keyboard navigation works via tree
- Focus restoration functional
- Picker overlays navigable

**After Phase 4:**
- One section (e.g., Orientation) fully tree-rendered
- Old factories can be removed for that section
- No regressions in existing sections

**After Phase 5:**
- Event handlers update tree, not DOM directly
- Tree mutations trigger automatic nav reconciliation
- State changes flow through tree

**After Phase 6:**
- `syncUIFromState()` only touches tree
- Tree is single source of truth
- All imperative DOM manipulation removed

---

## Risks & Mitigation

### Risk 1: Breaking Existing UI During Migration

**Mitigation:**
- Dual-track rendering (tree + factories) during transition
- Feature flags for enabling tree-based rendering per section
- Comprehensive manual testing after each phase
- Keep old factories until tree rendering proven stable

### Risk 2: Performance Degradation

**Mitigation:**
- Profile tree operations (add/update/remove)
- Use efficient data structures (Map, not Object)
- Batch tree updates where possible
- Lazy render projection (only render visible sections)

### Risk 3: Complex State Sync Edge Cases

**Mitigation:**
- Start with simple controls (buttons, sliders)
- Add complex widgets (pickers, dynamic content) later
- Document state flow clearly
- Add integration tests for state sync

### Risk 4: Dynamic Content (Presets, Z0 Sliders)

**Mitigation:**
- Keep dynamic builders initially, just register nodes in tree
- Convert to tree-driven dynamic content in Phase 4+
- Use `addNodes()` / `removeSubtree()` for dynamic updates

---

## Testing Strategy

### Unit Tests

```javascript
// test/semantic-tree/store.test.js
describe('UITreeStore', () => {
  it('should add and retrieve nodes', () => {
    const store = new UITreeStore();
    const node = { id: 'test', kind: 'button', children: [], focusMode: 'leaf' };
    store.addNode(node);
    expect(store.getNode('test')).toEqual(node);
  });
  
  it('should emit events on node updates', () => {
    const store = new UITreeStore();
    const spy = jest.fn();
    store.on('node:updated', spy);
    store.updateNode('test', { disabled: true });
    expect(spy).toHaveBeenCalledWith({ id: 'test', updates: { disabled: true } });
  });
});
```

### Integration Tests

```javascript
// test/integration/tree-rendering.test.js
describe('Tree Rendering', () => {
  it('should render slider from tree node', () => {
    const store = new UITreeStore();
    const sliderNodes = slider("test-slider", {
      label: "Test",
      min: 0,
      max: 10,
      step: 1,
      value: 5
    });
    store.addNodes(sliderNodes.nodes);
    
    const projection = new SliderProjection(store);
    const element = projection.render("test-slider");
    
    expect(element.querySelector('input[type="range"]')).toBeTruthy();
    expect(element.querySelector('.slider-num')).toBeTruthy();
  });
});
```

### Manual Test Plan

After each phase:

1. **Navigation**: Tab through all controls, verify focus order
2. **Pickers**: Open each picker, select option, verify UI updates
3. **Sliders**: Drag sliders, type in number inputs, verify sync
4. **Buttons**: Click all buttons, verify actions execute
5. **State sync**: Change state externally, verify UI reflects changes
6. **Dynamic content**: Trigger preset changes, verify tree updates

---

## Rollback Strategy

If migration fails at any phase:

1. **Remove new code**: Delete `src/ui/semantic-tree/`, `src/navigation/` additions
2. **Restore imports**: Remove tree imports from `main.js`, `ui.js`
3. **Clean up**: Remove `window.uiTree`, `window.navManager` assignments
4. **Test**: Verify existing factories still work
5. **Git**: `git revert` migration commits

**Critical:** Keep old factories intact until Phase 4+ proves stable. Never delete working code until replacement is proven.

---

## Next Actions

**Immediate:**
1. Create `src/ui/semantic-tree/` directory
2. Implement `UITreeStore` from spec (store.js)
3. Implement builder functions (builders.js)
4. Write `buildPrincipiaUITree()` (principia-tree.js)
5. Add tree initialization to `main.js`
6. Test: `window.uiTree.toJSON()` shows complete structure

**Week 2:**
1. Implement `attachPrincipiaElements()`
2. Bind all static elements after DOM creation
3. Update dynamic builders to register with tree
4. Test: All elements retrievable via `uiTree.getElement(id)`

**Week 3:**
1. Implement `KeyboardNavigationManager` stub
2. Implement `SemanticTreeAdapter`
3. Implement `TreeNavigationBridge`
4. Wire navigation system in `main.js`
5. Test: Basic keyboard navigation works

Continue with Phases 4-6 as time permits.

---

## Success Metrics

- **Code quality**: Reduced DOM coupling, clear data flow
- **Maintainability**: New widgets added via tree nodes + projections
- **Testability**: Tree structure testable without DOM
- **Navigation**: Keyboard nav consistent, focus restoration reliable
- **Performance**: No regressions vs. current implementation
- **Developer experience**: Semantic tree debuggable via console

---

**Status**: Ready for Phase 1 implementation

**Next Step**: Create `UITreeStore` implementation

**Blockers**: None - spec is frozen (v1.5.3)

**Owner**: Development team

**Timeline**: 6 weeks (1 phase per week)
