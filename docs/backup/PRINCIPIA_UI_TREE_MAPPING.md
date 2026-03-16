# Principia UI Tree Mapping

**Mapping between actual codebase structure and semantic UI tree spec**

This document shows how Principia's existing GUI code (`src/ui/`) maps to the semantic UI tree architecture defined in `SEMANTIC_UI_TREE_SPEC.md`.

---

## Current Codebase Structure

### Entry Points

- **`src/ui.js`**: Main UI module, exports consolidated UI functions
- **`src/ui/sidebar/initSections.js`**: Builds all sidebar sections dynamically
- **`src/ui/sidebar/initControlSection.js`**: Creates control button layout

### Factories (Imperative DOM Construction)

- **`src/ui/components/slider/SliderFactory.js`**: `createSlider()` → DOM elements
- **`src/ui/components/section/SectionFactory.js`**: `createSection()` → collapsible sections
- **`src/ui/pickers/PickerFactory.js`**: Creates picker overlay DOM
- **`src/ui/components/button/DynamicButton.js`**: Button with text-fitting

### Actual Sidebar Sections (from `initSections.js`)

1. **Display** (`sec-mode`)
   - Mode picker (Event classification / Phase + Diffusion / etc.)
   - Resolution picker (256×256 / 512×512 / 1024×1024)

2. **Slice Basis** (`sec-presets`)
   - Preset grid (dynamically populated)
   - Custom basis panel (H-axis / V-axis pickers + ±mag slider)

3. **Slice Offset z₀** (`sec-z0`)
   - Zero / Small random buttons
   - ±range slider
   - z0-z9 sliders (10D offset, dynamically built)

4. **Orientation** (`sec-orient`)
   - γ slider (0-360°)
   - q₁ tilt picker + tilt amount slider
   - q₂ tilt picker + tilt amount slider
   - Orthonormalise checkbox
   - Reset tilts + γ button

5. **Simulation** (`sec-sim`, starts collapsed)
   - Horizon slider (10-200)
   - Max steps slider (1000-40000)
   - dt macro slider (0.0005-0.01)
   - r_coll slider (0.005-0.06)
   - r_esc slider (1.0-12.0)

6. **Export / Import** (`sec-state`, starts collapsed)
   - Apply JSON button
   - Download JSON button
   - State JSON textarea

### Control Section (from `initControlSection.js`)

- **Render** button (primary, full width)
- **Icon buttons** (URL / JSON / PNG / Reset)

### Canvas Controls (from `src/ui/components/canvas-controls/init.js`)

Floating buttons overlaid on the canvas area. Not inside the sidebar.

- **infoBtn** — opens info panel overlay
- **settingsBtn** — opens settings panel overlay

### Panels (from `src/ui/panels/`)

Two side-panel overlays created by `initAllPanels()` in `panels/init.js`:

**Info panel** (`infoPanelOverlay` / `infoPanel`):
- Static text content (navigation, render modes, about)
- `infoPanelClose` — close button (only interactive element)

**Settings panel** (`settingsPanelOverlay` / `settingsPanel`):
- `settingsPanelClose` — close button
- *Rendering group:*
  - `autoRender` checkbox
  - `previewWhileDrag` checkbox
  - `showHud` checkbox
- *Scroll/Zoom group:*
  - `stgInvertScroll` checkbox
  - `stgZoomSpeed` / `stgZoomSpeedVal` slider (range + number input)
- *Panning group:*
  - `stgInvertPanX` checkbox
  - `stgInvertPanY` checkbox
  - `stgPanSpeed` / `stgPanSpeedVal` slider (range + number input)

### Dialogs (from `src/ui/dialogs/`)

Modal dialogs using `showDialog()` from `dialog.js`. **Transient** — created on
demand, not pre-built. Register in tree when opening, deregister on close.

- **value-edit dialog** — triggered by dblclick on `.slider-num` elements; contains
  a number input field + Cancel/Set buttons
- **welcome dialog** — shown on first load
- **resolution-warning dialog** — shown when high resolution is selected

---

## Semantic UI Tree Mapping

### Full UI Tree (Aligned with Actual Codebase)

All navigable elements across the entire application. Canvas area is intentionally
excluded — it has its own gesture/mouse input system and is not keyboard-navigable.

```
Root (container)
│
├─ canvas-controls (scope, entry-node)        ← floating buttons over canvas
│  ├─ infoBtn (button) → opens info-panel:overlay
│  └─ settingsBtn (button) → opens settings-panel:overlay
│
└─ sidebar (container scope)
   │
   ├─ ctrl-section (button-group)
   │  ├─ renderBtn (button, primary)
   │  ├─ copyLinkBtn (button)
   │  ├─ copyJsonBtn (button)
   │  ├─ savePngBtn (button)
   │  └─ resetAllBtn (button)
   │
   ├─ sec-mode (section: "Display", entry-node, entryPolicy: remembered)
   │  ├─ mode-picker:trigger (button) → opens mode-picker:dropdown
   │  └─ resolution-picker:trigger (button) → opens resolution-picker:dropdown
   │
   ├─ sec-presets (section: "Slice Basis", entry-node, entryPolicy: remembered)
   │  ├─ preset-grid (scope, strategy: grid)     ← dynamically populated
   │  │  └─ [preset-{id} buttons added by buildPresets()]
   │  ├─ customDimH-picker:trigger (param-trigger, hidden: true initially)
   │  │   → opens customDimH-picker:dropdown
   │  ├─ customDimV-picker:trigger (param-trigger, hidden: true initially)
   │  │   → opens customDimV-picker:dropdown
   │  └─ slider-customMag (slider scope, hidden: true initially)
   │     ├─ slider-customMag:analog
   │     └─ slider-customMag:value
   │
   ├─ sec-z0 (section: "Slice Offset z₀", entry-node, entryPolicy: remembered)
   │  ├─ z0Zero (button)
   │  ├─ z0SmallRand (button)
   │  ├─ slider-z0Range (slider scope)
   │  │  ├─ slider-z0Range:analog
   │  │  └─ slider-z0Range:value
   │  └─ [slider-z0..slider-z9 added by buildZ0Sliders()]
   │
   ├─ sec-orient (section: "Orientation (γ + tilts)", entry-node, entryPolicy: remembered)
   │  ├─ slider-gamma (slider scope)
   │  │  ├─ slider-gamma:analog
   │  │  └─ slider-gamma:value
   │  ├─ tiltDim1-picker:trigger (param-trigger) → tiltDim1-picker:dropdown
   │  ├─ slider-tiltAmt1 (slider scope)
   │  │  ├─ slider-tiltAmt1:analog
   │  │  └─ slider-tiltAmt1:value
   │  ├─ tiltDim2-picker:trigger (param-trigger) → tiltDim2-picker:dropdown
   │  ├─ slider-tiltAmt2 (slider scope)
   │  │  ├─ slider-tiltAmt2:analog
   │  │  └─ slider-tiltAmt2:value
   │  ├─ doOrtho (checkbox)
   │  └─ rotReset (button)
   │
   ├─ sec-sim (section: "Simulation", entry-node, collapsed: true, entryPolicy: remembered)
   │  ├─ slider-horizon (slider scope)
   │  ├─ slider-maxSteps (slider scope)
   │  ├─ slider-dtMacro (slider scope)
   │  ├─ slider-rColl (slider scope)
   │  └─ slider-rEsc (slider scope)
   │
   └─ sec-state (section: "Export / Import", entry-node, collapsed: true, entryPolicy: remembered)
      ├─ pasteJsonBtn (button)
      └─ downloadJsonBtn (button)
      ↳ stateBox textarea is non-navigable, not in tree

Overlays (parentId: null — outside main tree, pushed onto nav overlay stack when open):

Panel overlays (persistent, show/hide via CSS):
├─ info-panel:overlay (modal: true)
│  └─ info-panel:close (button)
│     ↳ rest of content is static text, non-navigable
│
└─ settings-panel:overlay (modal: true)
   ├─ settings-panel:close (button)
   ├─ settings-panel:rendering (scope, container)  ← "Rendering" group
   │  ├─ checkbox:autoRender
   │  ├─ checkbox:previewWhileDrag
   │  └─ checkbox:showHud
   ├─ settings-panel:scroll (scope, container)     ← "Scroll / Zoom" group
   │  ├─ checkbox:stgInvertScroll
   │  └─ slider-stgZoomSpeed (slider scope)
   │     ├─ slider-stgZoomSpeed:analog
   │     └─ slider-stgZoomSpeed:value
   └─ settings-panel:panning (scope, container)    ← "Panning" group
      ├─ checkbox:stgInvertPanX
      ├─ checkbox:stgInvertPanY
      └─ slider-stgPanSpeed (slider scope)
         ├─ slider-stgPanSpeed:analog
         └─ slider-stgPanSpeed:value

Picker dropdowns (per-picker, opened by trigger, closed by selection/Escape):
├─ mode-picker:dropdown (dropdown, modal: true)
│  ├─ mode-picker:dropdown:event (menu-item, primary)
│  ├─ mode-picker:dropdown:phase-diffusion (menu-item)
│  ├─ mode-picker:dropdown:phase (menu-item)
│  ├─ mode-picker:dropdown:diffusion (menu-item)
│  └─ mode-picker:dropdown:rgb (menu-item)
├─ resolution-picker:dropdown (dropdown, modal: true)
│  ├─ resolution-picker:dropdown:256
│  ├─ resolution-picker:dropdown:512
│  └─ resolution-picker:dropdown:1024 (primary)
├─ tiltDim1-picker:dropdown, tiltDim2-picker:dropdown  (z-axis menu items, dynamic)
├─ customDimH-picker:dropdown, customDimV-picker:dropdown  (z0–z9 menu items, dynamic)

Transient dialog overlays (registered on open, deregistered on close):
└─ [value-edit, welcome, resolution-warning dialogs added via registerTransientOverlay()]
```

---

## Key Observations

### 1. Pickers Use Labels, Not Inline Param-Triggers

Current implementation uses **picker labels** (`.sl-dim-label`) that look like:
```html
<span class="sl-dim-label" id="modeLabel">
  <span class="sl-dim-text" id="modeName">Event classification</span>
  <span class="sl-dim-arrow">▼</span>
</span>
<select id="mode" style="display:none;">...</select>
```

**Semantic tree representation**:
- `mode-picker:trigger` (button kind, not param-trigger)
- Opens `mode-picker:dropdown` overlay

**For tilt dimension pickers** (above tilt amount sliders):
- `tiltDim1-picker:trigger` (param-trigger kind, because they're parameter selectors)
- Semantically similar to slider param-trigger labels

### 2. Sliders Have Different Param-Trigger Usage

- **gamma, tilt amounts, simulation params, z0 range, customMag**: No param-trigger (just label)
- **z0 sliders (z0-z9)**: Could have param-trigger for dimension selection (not currently implemented)
- **Tilt dimension selection**: Uses picker labels above sliders (not inline param-triggers)

**Decision**: Most Principia sliders use `hasParamTrigger: false` in semantic tree.

### 3. Control Buttons Layout

Current: **Render** (full width) + row of 4 icon buttons

Semantic tree strategy:
- `button-group` with `strategy: "linear"` (TODO: future `"grid"`)
- `renderBtn` has `primary: true`

### 4. Dynamic Content

Several UI elements are built dynamically:
- **Preset grid**: Populated by `buildPresets()`
- **z0 sliders**: Built by `buildZ0Sliders()`
- **Custom dim selects**: Built by `buildCustomDimSelects()`

**Semantic tree approach**:
- Container nodes (`preset-grid`, `sec-z0`) are pre-defined as placeholders
- Dynamic children added via `uiTree.addNodes()` + parent `children` update
- Tree mutations trigger nav adapter reconciliation automatically
- Pass `uiTree` as a parameter to dynamic builders (not `window.uiTree`)

### 5. Hidden / Conditional Nodes

The custom basis panel (`#customBasisPanel`) is hidden by default and only revealed
when a "custom" preset is selected. In the semantic tree:
- `customDimH-picker:trigger`, `customDimV-picker:trigger`, `slider-customMag` start
  with `hidden: true`
- When a custom preset is activated: `uiTree.updateNode(id, { hidden: false })`
- Navigation silently skips nodes where `hidden === true`
- Same pattern applies to collapsed section children (handled by nav layer, not tree)

### 6. Section Collapse/Expand as Keyboard Action

Sections use `focusMode: 'entry-node'`. When a section is focused:
- **Enter**: enter the section (apply `entryPolicy: 'remembered'`)
- **Space**: toggle collapse/expand (custom action bound to `kind: 'section'`)
- **ArrowDown/Up**: move to adjacent section at same level

The `.section-head` DOM element is attached to the section scope node via
`uiTree.attachElement(sectionId, sectionHeadElement)`. The nav visualizer
draws the cursor bracket around the section head when focused.

### 7. Transient Dialog Overlays

Dialogs are dynamically constructed on every call to `showDialog()`. They cannot
be pre-defined in the tree. Instead, the store exposes:

```javascript
// When dialog opens:
uiTree.registerTransientOverlay(overlayNode, triggerId);
// navManager detects new overlay node and activates it

// When dialog closes:
uiTree.removeTransientOverlay(overlayId);
// navManager returns focus to triggerId
```

The dialog system (`dialog.js`) calls these hooks in `bindHandlers` and
`finalizeClose` respectively.

---

## Migration Strategy

### Phase 1: Build Semantic Tree Alongside Current Code

```javascript
// In main initialization
import { buildPrincipiaUITree } from './ui/semantic-tree/principia-tree.js';
import { UITreeStore } from './ui/semantic-tree/store.js';

const uiTree = new UITreeStore();
uiTree.addNodes(buildPrincipiaUITree());

// Continue using existing factories for rendering
initSidebarSections();  // Still uses SliderFactory, SectionFactory
```

### Phase 2: Bind DOM Elements to Tree

```javascript
// After DOM creation, attach elements
enhanceAllSliders();  // Existing enhancement

// NEW: Attach to semantic tree
uiTree.attachElement("slider-gamma", document.getElementById("gamma").closest(".sl-row"));
uiTree.attachElement("renderBtn", document.getElementById("renderBtn"));
// ... etc
```

### Phase 3: Connect Navigation System

```javascript
import { SemanticTreeAdapter } from './navigation/SemanticTreeAdapter.js';
import { TreeNavigationBridge } from './navigation/TreeNavigationBridge.js';
import { KeyboardNavigationManager } from './navigation/KeyboardNavigationManager.js';

const adapter = new SemanticTreeAdapter(uiTree);
const navTree = adapter.buildNavigationTree();
const navManager = new KeyboardNavigationManager(navTree);
const bridge = new TreeNavigationBridge(uiTree, navManager);
```

### Phase 4: Replace Factories with Render Projection

Convert factories to consume semantic tree:

```javascript
// OLD: Imperative
const gammaSlider = createSlider({
  id: 'gamma',
  label: 'γ — rotate within plane',
  min: 0,
  max: 360,
  // ...
});

// NEW: Declarative (render from tree)
const gammaNode = uiTree.getNode("slider-gamma");
const gammaSlider = renderSlider(gammaNode);  // Render projection
```

---

## Files That Need Updates

### To Create (Semantic Tree)

| File | Purpose |
|---|---|
| `src/ui/semantic-tree/store.js` | `UITreeStore` + `EventEmitter` |
| `src/ui/semantic-tree/builders.js` | `root`, `section`, `scope`, `slider`, `button`, `checkbox`, `picker`, `buttonGroup`, `panel` |
| `src/ui/semantic-tree/principia-tree.js` | `buildPrincipiaUITree()` — full UI definition |
| `src/ui/semantic-tree/index.js` | Module-level singleton: `export const uiTree = new UITreeStore()` |

### To Create (Navigation)

| File | Purpose |
|---|---|
| `src/navigation/KeyboardNavigationManager.js` | Core nav engine (see KEYBOARD_NAVIGATION_SPEC.md) |
| `src/navigation/NavigationTree.js` | NavNode, ScopeNode, LeafNode |
| `src/navigation/NavigationTreeBuilder.js` | UITree → NavTree conversion |
| `src/navigation/FocusVisualizer.js` | Orange/cyan bracket rendering |
| `src/navigation/NavigationSessionState.js` | `currentNodeId`, `activePath`, `lastFocusedByScope` |
| `src/navigation/SemanticTreeAdapter.js` | Thin adapter wrapping NavigationTreeBuilder |
| `src/navigation/TreeNavigationBridge.js` | Reactive reconciliation on tree mutations |
| `src/navigation/behaviors/` | Per-widget behaviors (button, checkbox, analog-control, value-editor, param-trigger) |
| `src/navigation/policies/LinearTraversalPolicy.js` | Full traversal algorithm |
| `src/navigation/policies/GridTraversalPolicy.js` | For preset grid |

### To Create (Projections)

| File | Purpose |
|---|---|
| `src/ui/projections/SliderProjection.js` | Renders slider from tree node (including `enhanceSlider()`) |
| `src/ui/projections/SectionProjection.js` | Renders section (head + collapsible body) |
| `src/ui/projections/PickerProjection.js` | Renders picker trigger + dropdown overlay |
| `src/ui/projections/PanelProjection.js` | Renders side panel overlay |
| `src/ui/projections/ButtonProjection.js` | Renders button / checkbox |

### To Modify (Integration)

| File | Change |
|---|---|
| `src/main.js` | Import `uiTree` singleton, call `buildPrincipiaUITree()`, init nav |
| `src/ui/sidebar/initSections.js` | Use section projection; register dynamic content with `uiTree` |
| `src/ui/sidebar/initControlSection.js` | Use button/group projection |
| `src/ui/builders/sliders.js` | `buildZ0Sliders(uiTree)` — accept tree param, register nodes |
| `src/ui/dialogs/dialog.js` | Call `uiTree.registerTransientOverlay()` / `removeTransientOverlay()` |
| `src/ui/panels/init.js` | Register panel overlay nodes in tree via projection |
| `src/ui/components/canvas-controls/init.js` | Register canvas-controls scope in tree |

### To Eventually Remove

| File | Replaced by |
|---|---|
| `src/ui/components/slider/SliderFactory.js` | `SliderProjection` |
| `src/ui/components/section/SectionFactory.js` | `SectionProjection` |
| `src/ui/pickers/PickerFactory.js` | `PickerProjection` |
| `src/ui/panels/PanelFactory.js` | `PanelProjection` |

---

## Benefits of This Architecture

1. **Single Source of Truth**: Semantic tree defines all UI structure
2. **Navigation Consistency**: Keyboard nav reads same tree as render
3. **Stable Focus**: IDs persist across rebuilds, focus restoration works
4. **Testability**: Can test tree structure independently of DOM
5. **Debuggability**: Can serialize tree to JSON, inspect in dev tools
6. **Extensibility**: Add new widgets by adding tree nodes + render projection

---

## Next Steps

1. ✅ **Spec finalized** (v1.4 - SEMANTIC_UI_TREE_SPEC.md)
2. ⏳ **Create UITreeStore** implementation
3. ⏳ **Build Principia tree** structure matching actual UI
4. ⏳ **Integrate with existing factories** (dual rendering)
5. ⏳ **Connect keyboard navigation** system
6. ⏳ **Migrate to render projection** pattern

See `SEMANTIC_UI_TREE_INTEGRATION_PLAN.md` for detailed phased rollout.
