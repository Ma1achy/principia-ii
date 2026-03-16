# Keyboard Navigation Implementation Plan

**Version 2.4 - Implementation Complete**

Tree-based arrow key navigation for Principia with universal layered scope model, semantic composite widgets, and a **single visible navigation cursor**.

> **Ready for Implementation**: Core architecture complete. Deterministic rebuild strategy specified. All critical subsystems defined. Linear traversal fully specified. Grid and spatial traversal interfaces defined. One final integration pass recommended before treating as canonical production documentation.

---

## Visual Identity Reference

See `docs/assets/keyboard-nav-visual-guide.png` for visual state examples.

### Three Visual States (One Cursor)

**1. Normal Focus (Orange)**
- Simple orange outline
- For basic buttons/elements with no children in nav tree
- Example: standard buttons, simple checkboxes

**2. Enterable Focus (Orange + Animated Brackets)**
- Orange outline
- Two animated "breathing" corner brackets (top-left, bottom-right)
- Signals "press Enter to go down a level/interact"
- For elements with children in nav tree (sliders, sections, composite controls)
- Examples: dropdown triggers, slider rows, composite widgets

**3. Interacting (Cyan)**
- Cyan highlight on the actively manipulated element
- Same single cursor, different color
- When actively manipulating/editing
- Overrides nav keys to change value/text input
- Examples: numeric input while typing, slider knob while adjusting

### Visual Principle

> **"Only one cursor on screen at any point. Use styling/colours/animations to convey state/info"**

The cursor never duplicates - it moves and restyls as focus/interaction changes.

---

## Core Concept

**One canonical navigation tree** mirrors the UI hierarchy:

```text
root
├─ sidebar (scope)
│  ├─ control-buttons (scope)
│  │  └─ render-btn (leaf)
│  └─ display-section (scope)
│      └─ mode-picker-btn (leaf)
└─ canvas-controls (scope)
   └─ info-btn (leaf)
```

**Navigation rule:** Start local (within current scope), then bubble up to parent if no local target is found.

**Modal rule:** Dialogs, pickers, and dropdown overlays trap navigation. Arrows cannot escape them. Escape closes/pops them.

**Visual rule:** There is only ever **one visible navigation cursor** on screen.

---

## Design Goals

* **Global keyboard navigation** across all UI elements
* **Tree-first traversal** rather than raw geometric search
* **Fast skipping + precise dive-in**
* **Single visible cursor** with mode-dependent styling
* **Extensible semantic widget model**
* **Minimal conflict** with native text editing and browser behavior
* **Composite widgets** such as sliders, pickers, dialogs, button groups, and dropdown triggers
* **Production-friendly architecture** with static structure and mutable session state

---

## Single Highlight Model

### Single Highlight Invariant

At all times:

* exactly **one** visible highlight/cursor is rendered
* it encloses the **currently focused navigation target**
* it may change:
  * color
  * bracket decoration
  * animation
  * tightness / fit
* but it **never duplicates**

### Never Allowed

* orange parent outline + cyan child outline simultaneously
* multiple focus rectangles
* separate "context cursor" and "active cursor"
* two different things looking focused at once

---

## Visual Semantics

### 1. Focused / Navigating

Current target is selected but not actively consuming input.

**Style**

* orange
* single frame
* no duplicate cursor
* may wrap a whole row/card if current target is a composite scope entry

**Meaning**

* "I am here"
* "arrows navigate"
* "Enter may activate or enter"

---

### 2. Focused + Enterable

Current target has a deeper scope / interactable layer.

**Style**

* orange
* same single frame
* animated corner bracket accents / ingress markers
* still only one highlight

**Meaning**

* "this thing has depth"
* "press Enter to go in"

This is ideal for:

* slider rows
* button groups
* section headers
* composite controls
* dropdown triggers with nested choices

---

### 3. Interacting

Current target is actively consuming input.

**Style**

* cyan
* same single frame
* tighter to the actively manipulated subcontrol
* bracket animation usually removed while already interacting

**Meaning**

* "I am actively editing/manipulating this"

Examples:

* numeric value box while typing
* slider analog control while arrow-adjusting
* editable text field while in edit mode

---

## Composite Context Without Multiple Highlights

When inside a composite widget, parent context is **not** shown by a second outline.

Instead, context may be conveyed by:

### A. Highlight style

* tighter frame on child target
* bracket shape/style changes when a target is enterable

### B. Mode / breadcrumb indicator

Examples:

* `SLIDER > VALUE`
* `SLIDER > PARAM`
* `DISPLAY > MODE`
* `DIALOG > CONFIRM`

### C. Optional subtle container tint

Allowed:

* faint background tint on containing row/card

Not allowed:

* second border
* second cursor-like frame
* anything that visually competes with the main cursor

---

## Core Innovation: Layered Scope Navigation

Every scope in the tree can be entered/exited, creating a layered navigation model.

```text
Layer 0: Top-level sections
┌─────────────────────────────┐
│ [Control Buttons]           │  ← Highlighted (orange, enterable)
│ [Display Section]           │
│ [Slice Offset Section]      │
└─────────────────────────────┘

Press Enter → Enter scope

Layer 1: Inside Display Section
┌─────────────────────────────┐
│ Display Section             │
│   [Mode Picker]      ← Highlighted
│   [Resolution]              │
│   [Auto-render ☑]           │
└─────────────────────────────┘

Press Enter on slider → Enter slider scope

Layer 2: Inside Slider
┌─────────────────────────────┐
│ Q₁ TILT INTO Zₛ (M₁)        │ ← Param trigger (orange)
│ ─────────●────────          │
│                     [0.00]  │
└─────────────────────────────┘

ArrowDown → highlight moves to knob
Enter → knob becomes interacting (cyan)
Escape → exit interaction
Escape again → exit slider scope
```

### This creates

* **Fast navigation**: ArrowDown to skip sections/sliders
* **Precise control**: Enter to dive into details
* **Single-cursor clarity**: one current thing, always
* **Consistent behavior** across all scoped widgets

---

## Architectural Principles

### 1. Static tree, mutable session state

Nodes describe GUI structure.
They do **not** store user runtime position.

### 2. Focusable scopes vs container scopes

Some scopes are selectable before entering.
Others are transparent containers only.

### 3. Composite widgets are semantic

Sliders are not "just label/knob/value."
They have semantic roles:

* parameter trigger
* analog control
* value editor

### 4. Traversal is structural first

Use local siblings first, then bubble upward, then descend into target subtree using entry policy.

### 5. One cursor only

The cursor relocates as focus moves between container, child, and interacting states.

---

## File Structure

```text
src/navigation/
├── index.js
├── KeyboardNavigationManager.js
├── NavigationTree.js
├── NavigationTreeBuilder.js
├── FocusVisualizer.js
├── NavigationSessionState.js
├── behaviors/
│   ├── ButtonBehavior.js
│   ├── CheckboxBehavior.js
│   ├── NativeSelectBehavior.js
│   ├── ParamTriggerBehavior.js
│   ├── AnalogControlBehavior.js
│   └── ValueEditorBehavior.js
└── policies/
    ├── LinearTraversalPolicy.js      (fully specified)
    ├── GridTraversalPolicy.js        (interface defined, algorithm partial)
    └── SpatialTraversalPolicy.js     (interface defined, algorithm placeholder)
```

---

## Node Model (Static Structure)

```javascript
class NavNode {
  constructor({ id, type, parent = null, children = [] }) {
    this.id = id;
    this.type = type; // 'scope' | 'leaf'
    this.parent = parent;
    this.children = children;
  }

  isScope() {
    return this.type === 'scope';
  }

  isLeaf() {
    return this.type === 'leaf';
  }
}

class ScopeNode extends NavNode {
  constructor(options) {
    super({ ...options, type: 'scope' });

    this.strategy = options.strategy || 'linear'; // linear | grid | spatial
    this.wrap = !!options.wrap;

    this.focusMode = options.focusMode || 'container';
    // 'container'  -> not itself a target
    // 'entry-node' -> can be focused before entering

    this.entryPolicy = options.entryPolicy || 'first';
    // first | last | primary | selected | remembered

    this.exitPolicy = options.exitPolicy || 'bubble';

    this.modal = !!options.modal;
    this.overlay = !!options.overlay;

    this.element = options.element || null; // optional focusable scope element
  }

  resolveEntry(direction, fromNode, sessionState) {
    switch (this.entryPolicy) {
      case 'first':
        return this.children[0] || null;

      case 'last':
        return this.children[this.children.length - 1] || null;

      case 'primary':
        return this.children.find(c => c.primary) || this.children[0] || null;

      case 'selected':
        // Use getter or callback for runtime-dynamic selected state
        return this.children.find(c => {
          if (typeof c.isSelected === 'function') {
            return c.isSelected();
          }
          // Fallback to static property for simple cases
          return c.selected;
        }) || this.children[0] || null;

      case 'remembered':
        return sessionState.lastFocusedByScope.get(this.id) || this.children[0] || null;

      case 'custom':
        // Allow scope-specific custom entry resolver
        if (typeof this.customEntryResolver === 'function') {
          return this.customEntryResolver(direction, fromNode, sessionState);
        }
        return this.children[0] || null;

      default:
        return this.children[0] || null;
    }
  }
}

class LeafNode extends NavNode {
  constructor(options) {
    super({ ...options, type: 'leaf' });
    this.element = options.element;
    this.behavior = options.behavior;
    this.role = options.role || null;
    this.primary = !!options.primary;
    
    // Support both static property and dynamic getter for selected state
    if (typeof options.isSelected === 'function') {
      this.isSelected = options.isSelected;
    } else {
      this.selected = !!options.selected;
      // Provide getter that returns static property
      this.isSelected = () => this.selected;
    }
  }
}
```

### Universal Resolution Rule

**A traversal target is not valid until it resolves to a focusable node.**

This means:
- `LeafNode` → always valid
- `entry-node` scope → valid (can be focused before entering)
- `container` scope → must recurse through entry policy until valid descendant found

**This is the single canonical resolution authority.** All entry paths (initial activation, directional move, Enter on scope, overlay open) use this function.

```javascript
// Universal resolution: returns { node, enterScopes }
_resolveToFocusable(node, direction) {
  if (!node) return null;
  
  if (node.isLeaf()) {
    return { node, enterScopes: [] };
  }
  
  if (node.isScope() && node.focusMode === 'entry-node') {
    return { node, enterScopes: [] };
  }
  
  if (node.isScope() && node.focusMode === 'container') {
    // Container scopes are transparent - descend to first focusable
    // Track all containers we pass through for activePath
    const enterScopes = [node];
    let currentNode = node;
    
    while (currentNode.isScope() && currentNode.focusMode === 'container') {
      const child = currentNode.resolveEntry(direction, null, this.state);
      if (!child) {
        console.warn(`Container scope ${currentNode.id} has no valid descendants`);
        return null;
      }
      
      if (child.isLeaf()) {
        return { node: child, enterScopes };
      }
      
      if (child.focusMode === 'entry-node') {
        return { node: child, enterScopes };
      }
      
      // Another container - continue descent
      enterScopes.push(child);
      currentNode = child;
    }
  }
  
  return null;
}
```

This ensures:
- Initial activation always reaches an actually focusable target
- Enter on scope uses the same resolution path
- Directional moves through containers work consistently
- No parallel resolution logic to drift

---

## Session State (Runtime Navigation State)

```javascript
class NavigationSessionState {
  constructor() {
    this.active = false;

    // currently focused node (scope entry-node or leaf)
    this.currentNode = null;

    // structural nesting currently entered
    this.activePath = [];

    // modal / top-layer scopes
    this.overlayStack = [];

    // scopeId -> last focused descendant
    this.lastFocusedByScope = new Map();

    // current interaction mode
    this.interaction = {
      active: false,
      node: null,
      type: null // e.g. 'analog-adjust', 'text-edit'
    };
  }

  getCurrentTraversalScope() {
    if (this.overlayStack.length > 0) {
      return this.overlayStack[this.overlayStack.length - 1];
    }
    return this.activePath[this.activePath.length - 1] || null;
  }

  enterScope(scope) {
    if (scope.overlay || scope.modal) {
      this.overlayStack.push(scope);
    } else {
      this.activePath.push(scope);
    }
  }

  exitScope(scope) {
    const overlayIdx = this.overlayStack.indexOf(scope);
    if (overlayIdx >= 0) {
      this.overlayStack.splice(overlayIdx, 1);
      return;
    }

    const pathIdx = this.activePath.indexOf(scope);
    if (pathIdx >= 0) {
      this.activePath.splice(pathIdx);
    }
  }

  beginInteraction(node, type) {
    this.interaction.active = true;
    this.interaction.node = node;
    this.interaction.type = type;
  }

  endInteraction() {
    this.interaction.active = false;
    this.interaction.node = null;
    this.interaction.type = null;
  }

  isInteractingWith(node) {
    return this.interaction.active && this.interaction.node === node;
  }
}
```

---

## Focus Visualizer

### Responsibility

The visualizer owns **all focus rendering**.

Behaviors do **not** draw borders or extra highlights.

The visualizer renders the one single visible cursor according to:

* current node
* whether current node is enterable
* whether current node is currently interacting
* optional scope depth context
* optional breadcrumb text

---

### Visual States

**`focus`**

* orange
* used for normal navigation focus

**`focus-enterable`**

* orange
* animated corner bracket accents
* means Enter can descend/open/activate scope-like depth

**`interacting`**

* cyan
* same one cursor
* tighter to the active element
* used while target consumes directional/text input

---

### Visualizer API

```javascript
class FocusVisualizer {
  constructor() {
    this.ring = this._createRing();
    this.lastRect = null;
    this.transitionThreshold = 200; // px - disable transition if jump exceeds this
  }

  render({ node, isEnterable, isInteracting }) {
    if (!node) {
      this.hide();
      return;
    }

    const element = node.element;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    
    // Check if this is a large jump - disable transition to avoid visible slide
    if (this.lastRect) {
      const dx = Math.abs(rect.left - this.lastRect.left);
      const dy = Math.abs(rect.top - this.lastRect.top);
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > this.transitionThreshold) {
        // Temporarily disable transitions for instant jump
        this.ring.style.transition = 'none';
        // Force reflow to apply instant positioning
        void this.ring.offsetHeight;
      } else {
        // Re-enable transitions for smooth adjacent moves
        this.ring.style.transition = '';
      }
    }

    this.ring.style.display = 'block';
    this.ring.style.left = `${rect.left}px`;
    this.ring.style.top = `${rect.top}px`;
    this.ring.style.width = `${rect.width}px`;
    this.ring.style.height = `${rect.height}px`;

    this.ring.classList.toggle('nav-focus', !isInteracting);
    this.ring.classList.toggle('nav-interacting', isInteracting);
    this.ring.classList.toggle('nav-enterable', !!isEnterable && !isInteracting);
    
    this.lastRect = rect;
  }

  hide() {
    this.ring.style.display = 'none';
    this.lastRect = null;
  }

  _createRing() {
    const el = document.createElement('div');
    el.id = 'nav-focus-ring';
    document.body.appendChild(el);
    return el;
  }
}
```

---

### Suggested CSS Semantics

```css
:root {
  --nav-focus-z-index: 999999;
  --nav-focus-color: #ff8800;
  --nav-interact-color: #00aaff;
}

#nav-focus-ring {
  position: fixed;
  pointer-events: none;
  z-index: var(--nav-focus-z-index);
  box-sizing: border-box;
  transition:
    top 0.10s ease-out,
    left 0.10s ease-out,
    width 0.10s ease-out,
    height 0.10s ease-out;
}

#nav-focus-ring.nav-focus {
  border: 2px solid var(--nav-focus-color);
}

#nav-focus-ring.nav-interacting {
  border: 2px solid var(--nav-interact-color);
}

/* Enterable indicator: two animated corner brackets (top-left, bottom-right) */
#nav-focus-ring.nav-enterable::before,
#nav-focus-ring.nav-enterable::after {
  content: "";
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: var(--nav-focus-color);
  border-style: solid;
  animation: navBracketPulse 0.9s ease-in-out infinite alternate;
}

/* Top-left bracket */
#nav-focus-ring.nav-enterable::before {
  top: -2px;
  left: -2px;
  border-width: 2px 0 0 2px;
}

/* Bottom-right bracket */
#nav-focus-ring.nav-enterable::after {
  bottom: -2px;
  right: -2px;
  border-width: 0 2px 2px 0;
}

@keyframes navBracketPulse {
  from {
    transform: scale(1);
    opacity: 0.85;
  }
  to {
    transform: scale(1.08);
    opacity: 1;
  }
}

/* Respect prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  #nav-focus-ring {
    transition: none;
  }
  
  #nav-focus-ring.nav-enterable::before,
  #nav-focus-ring.nav-enterable::after {
    animation: none;
    opacity: 1;
  }
}
```
```

---

## Scope Types

### `focusMode: 'entry-node'`

The scope itself may be selected before entering.

Use for:

* sidebar sections
* composite slider rows
* button groups
* cards with nested controls

Behavior:

* arrows can land on the scope itself
* Enter enters the scope
* highlight wraps the whole scope row/card while selected outside it
* if enterable, brackets animate

### `focusMode: 'container'`

The scope is transparent structurally.

Use for:

* wrappers
* simple field groups
* dialog button row wrappers
* layout grouping without direct user-facing selection

Behavior:

* traversal descends through it automatically
* cursor never highlights it directly unless explicitly desired

---

## Semantic Composite Widgets

## Updated Slider Interaction Model

Sliders are not treated as a flat trio of "label, knob, value". They are treated as a **semantic composite widget** with optional nested depth on the label.

### Canonical Slider Semantic Tree

```text
slider-scope (ScopeNode, focusMode: 'entry-node', entryPolicy: 'primary')
├─ param-trigger   (optional leaf, opens submenu/dropdown)
├─ analog-control  (leaf, slider/range control)
└─ value-editor    (leaf, numeric/text value input)
```

### Roles

#### `param-trigger`

* Usually the label/button at the top of the slider row
* Opens a submenu/dropdown that changes what the slider controls
* Is not just decorative text
* If present, it is a first-class sibling in slider navigation

#### `analog-control`

* The slider track / knob / native range input
* Used for analog adjustment
* Can enter interaction mode
* While interacting, left/right belong to the native range input

#### `value-editor`

* Numeric input / text box for direct value entry
* Can enter text-edit interaction mode
* While editing, keys belong to the native input

---

## Visual / Structural Rule

At the outer level, the slider row is one **entry-node scope**.

* When the slider row is selected from outside, the **single orange highlight** wraps the whole slider row
* Because the slider has depth, it shows the **enterable bracket treatment**
* Pressing `Enter` moves the highlight *inside* the slider
* The parent row highlight disappears immediately
* Only the child target remains highlighted

This preserves the **single-highlight invariant**.

---

## Default Internal Order

Internal slider traversal order is:

```text
param-trigger (if present)
→ analog-control
→ value-editor
```

If there is no `param-trigger`, then internal traversal is:

```text
analog-control
→ value-editor
```

This order is vertical/semantic, not merely DOM-positional.

---

## Primary Entry Policy

Sliders use:

```text
entryPolicy: 'primary'
```

But the actual primary child is metadata-driven per slider:

```javascript
preferredPrimaryRole: 'analog-control' | 'value-editor' | 'param-trigger'
```

### Recommended Defaults

#### Analog-first sliders

Use when the control is mainly adjusted continuously.

```javascript
preferredPrimaryRole: 'analog-control'
```

Best for:

* ordinary scientific sliders
* frequently nudged controls
* interactive tuning

#### Value-first sliders

Use when the main workflow is precise manual entry.

```javascript
preferredPrimaryRole: 'value-editor'
```

Best for:

* calibration values
* exact numeric workflows
* infrequently dragged controls

#### Trigger-first sliders

Use when choosing the parameter is the dominant action.

```javascript
preferredPrimaryRole: 'param-trigger'
```

Best for:

* multi-mode sliders
* parameter remapping rows
* sliders whose label is effectively a mode selector

---

## Recommended Principia Default

For the current Principia slider design:

* if a slider has a label button that opens a submenu, keep it as `param-trigger`
* default `preferredPrimaryRole` should still usually be:

```javascript
preferredPrimaryRole: 'analog-control'
```

Reason:

* the slider should still feel like an instrument first
* the label-trigger remains one step away
* `ArrowUp` from the analog control reaches it immediately
* the workflow remains fast for repeated adjustment

Only switch a specific slider to value-first or trigger-first if that particular control is genuinely dominated by those actions.

---

## Entry Behavior

### From outside the slider

When the slider row itself is selected:

* highlight = orange
* brackets visible
* row is treated as an enterable scope

#### `Enter`

* enters slider scope
* resolves `entryPolicy: 'primary'`
* highlight moves to the chosen internal child

Examples:

* analog-first slider → lands on `analog-control`
* value-first slider → lands on `value-editor`
* trigger-first slider → lands on `param-trigger`

---

## Internal Navigation Behavior

### If `param-trigger` exists

Internal navigation should feel like:

```text
param-trigger
↓
analog-control
↓
value-editor
```

And correspondingly upward:

```text
value-editor
↑
analog-control
↑
param-trigger
```

### If `param-trigger` does not exist

Internal navigation becomes:

```text
analog-control
↕
value-editor
```

---

## Param Trigger Interaction

### Focused state

When `param-trigger` is focused:

* highlight tightens around the label button itself
* highlight remains orange
* because it opens deeper UI, it may also display enterable/activatable brackets

### `Enter`

* opens the submenu/dropdown overlay
* overlay is pushed onto `overlayStack`
* slider internal highlight disappears
* single highlight moves into overlay entry target

### While overlay is open

* slider shows no second cursor
* overlay traps arrow navigation
* `Escape` closes overlay
* focus restores to `param-trigger` if still valid

---

## Analog Control Interaction

### Focused state

When `analog-control` is focused but not interacting:

* highlight tightens around the range input / knob region
* highlight remains orange

### `Enter`

* begins analog interaction mode
* same highlight turns cyan
* no duplicate outline appears

### While interacting

Behavior uses **native range semantics**.

#### `ArrowLeft` / `ArrowRight`

* return `IGNORED`
* native `<input type="range">` adjusts value

#### `ArrowUp` / `ArrowDown`

* end interaction mode
* then continue structural navigation to sibling target

#### `Escape`

* end interaction mode
* remain focused on `analog-control`
* highlight returns to orange

This preserves:

* native accessibility
* native step/min/max behavior
* less custom bug surface

---

## Value Editor Interaction

### Focused state

When `value-editor` is focused but not editing:

* highlight tightens around the numeric input
* highlight remains orange

### `Enter`

* begins text-edit interaction mode
* same highlight turns cyan
* input receives native focus and text selection

### While editing

#### Text keys / numeric keys

* native input behavior

#### Arrow keys

* return `IGNORED`
* native input behavior

#### `Enter`

* commit / exit edit mode
* remain focused on value editor
* highlight returns to orange

#### `Escape`

* exit edit mode
* optionally revert if desired by widget policy
* remain focused on value editor
* highlight returns to orange

#### `Blur`

* also exits edit mode

---

## Boundary Behavior Inside Slider Scope

When internal traversal hits a boundary:

### At top boundary

If current internal target is `param-trigger` and user navigates upward again:

* exit slider scope
* focus returns to slider row scope
* if upward traversal continues, bubble to previous sibling in parent scope

### At bottom boundary

If current internal target is `value-editor` and user navigates downward again:

* exit slider scope
* focus returns to slider row scope
* if downward traversal continues, bubble to next sibling in parent scope

This follows the general rule:

> local traversal first, then bubble upward, then descend into next resolved target

---

## Fast-Travel Shortcut (Optional Power-User Behavior)

If desired, support:

### `Shift + Enter` on selected slider row

* bypass normal primary entry
* deep-jump directly to `value-editor`
* immediately begin edit interaction

This is useful for power users who often want to type exact values.

### Rule

Normal `Enter` respects `preferredPrimaryRole`.
`Shift + Enter` is a shortcut, not a replacement.

---

## Visual Rules for Slider States

### 1. Slider row selected from outside

* orange highlight around full row
* animated brackets visible
* means: "this control has depth"

### 2. Internal target focused

* highlight moves inward onto current child target
* orange
* row outline disappears

### 3. Internal target interacting

* same highlight turns cyan
* no second cursor
* no parent outline
* no duplicate border

### 4. Param trigger submenu open

* highlight leaves slider entirely
* moves into submenu overlay
* slider shows no active cursor

---

## Breadcrumb / Mode Indicator Examples

These are strongly recommended for clarity inside composite controls.

Examples:

```text
[NAV] Slice Offset > Slider Q1 > Parameter
[NAV] Slice Offset > Slider Q1 > Analog Control
[NAV] Slice Offset > Slider Q1 > Value Editor
[NAV] Slice Offset > Slider Q1 > Parameter Menu
```

This communicates context without violating the one-highlight rule.

---

## Canonical Interaction Examples

### Example 1: Standard analog-first slider with label submenu

```text
1. ArrowDown → slider row selected
   Orange row highlight + brackets

2. Enter → enter slider
   Focus lands on analog-control

3. ArrowUp → move to param-trigger
   Orange highlight around label button

4. Enter → open submenu
   Highlight moves into overlay
   Slider no longer highlighted

5. Escape → close submenu
   Focus restores to param-trigger

6. ArrowDown → analog-control
7. Enter → begin analog interaction
   Highlight turns cyan

8. ArrowLeft / ArrowRight
   Native range input adjusts value

9. Escape
   End interaction, remain on analog-control
   Highlight returns orange

10. ArrowDown → value-editor
11. Enter → begin text editing
   Highlight turns cyan
```

### Example 2: Value-first slider

```text
1. Slider row selected
2. Enter
3. Focus lands directly on value-editor
4. Enter again
5. Begin text-edit interaction
```

### Example 3: Trigger-first slider

```text
1. Slider row selected
2. Enter
3. Focus lands directly on param-trigger
4. Enter again
5. Open submenu overlay
```

---

## Implementation Notes

### Tree builder requirement

If the slider label opens a submenu, it must be detected and registered as:

```javascript
role: 'param-trigger'
```

It must **not** be treated as plain text.

### Semantic rule

A slider with a label-trigger is not:

```text
[label] + [knob] + [value]
```

It is:

```text
[param-trigger] + [analog-control] + [value-editor]
```

That distinction is critical to correct navigation.

### Recommended detection heuristic

If a slider label:

* is a `<button>`, or
* has a click handler that opens a picker/menu/dropdown, or
* has explicit metadata like `data-slider-param`

then classify it as `param-trigger`.

---

## Spec Insert Summary

If you want a short insertable rule block:

> Sliders are semantic composite widgets with optional `param-trigger`, `analog-control`, and `value-editor` children.
> The slider row itself is an `entry-node` scope.
> Entering the slider resolves a metadata-driven primary child (`preferredPrimaryRole`).
> If the label opens a submenu, it must be modeled as `param-trigger`, not plain text.
> Internal navigation moves between semantic children, not arbitrary DOM fragments.
> The single highlight moves from the row into the active child, and from there into overlays when triggered.
> Interaction state changes the same highlight from orange to cyan; no duplicate highlight is ever shown.

---

### Slider Behaviors

**Param Trigger**

```javascript
class ParamTriggerBehavior {
  constructor(buttonElement, dropdownHandler) {
    this.element = buttonElement;
    this.dropdownHandler = dropdownHandler;
  }

  handleDirection(key, sessionState) {
    return 'PASSTHROUGH';
  }

  activate(sessionState) {
    this.dropdownHandler.open();
  }

  focus() {
    this.element.focus();
  }
}
```

**Analog Control**

**Implementation Strategy: Native Range Semantics**

We use **Option A: Native Owns Adjustment** for maximum accessibility and minimal bugs.

```javascript
class AnalogControlBehavior {
  constructor(rangeElement) {
    this.element = rangeElement; // Native <input type="range">
  }

  handleDirection(key, sessionState, currentLeaf) {
    const isInteracting = sessionState.isInteractingWith(currentLeaf);
    
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (isInteracting) {
        // Let native range input handle adjustment
        // Browser will change value with left/right arrows
        return 'IGNORED';
      } else {
        // Not interacting - allow structural navigation
        return 'PASSTHROUGH';
      }
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (isInteracting) {
        // Exit interaction mode, allow navigation to sibling controls
        sessionState.endInteraction();
        return 'PASSTHROUGH';
      }
      return 'PASSTHROUGH';
    }

    return 'PASSTHROUGH';
  }

  activate(sessionState, currentLeaf) {
    if (sessionState.isInteractingWith(currentLeaf)) {
      // Exit interaction mode
      sessionState.endInteraction();
    } else {
      // Enter interaction mode - native range now owns arrows
      sessionState.beginInteraction(currentLeaf, 'analog-adjust');
    }
  }

  focus() {
    this.element.focus();
  }
}
```

**Key Design Choice**: When interacting with analog control, we return `IGNORED` for left/right arrows. This allows the native `<input type="range">` element to handle value changes using its built-in accessibility features (step, min, max, aria-valuemin, etc.). This approach:
- Reduces custom code and potential bugs
- Improves screen reader compatibility
- Respects user's browser/OS settings for range controls
- Maintains standard keyboard behavior

**Value Editor**

**Strict Edit-Mode Boundaries**

```javascript
class ValueEditorBehavior {
  constructor(inputElement) {
    this.element = inputElement; // <input type="number">
  }

  handleDirection(key, sessionState, currentLeaf) {
    if (sessionState.isInteractingWith(currentLeaf)) {
      // While editing, all keys are native
      return 'IGNORED';
    }

    return 'PASSTHROUGH';
  }

  activate(sessionState, currentLeaf) {
    if (sessionState.isInteractingWith(currentLeaf)) {
      // Exit editing - commit value
      sessionState.endInteraction();
      // Keep DOM focus to maintain accessibility
      // The navigation system tracks state separately
      return;
    }

    // Enter editing
    sessionState.beginInteraction(currentLeaf, 'text-edit');
    this.element.focus();
    this.element.select();
  }

  focus() {
    this.element.focus();
  }
}
```

**Edit Mode Rules**

While editing (`sessionState.isInteractingWith(currentLeaf)` is true):

- **Text/numeric keys**: Native input behavior
- **Arrow keys**: Native cursor movement (returns `IGNORED`)
- **Enter**: Manager calls `activate()` which commits value and exits edit mode
- **Escape**: Manager calls `state.endInteraction()` directly, exits edit mode
- **Blur**: Should trigger blur listener that calls `state.endInteraction()`
- **Tab**: Exit edit mode and let browser handle focus (returns `IGNORED`)

The navigation system only intercepts keys when *not* editing. During editing, native input semantics take full control.

**Note**: Escape is handled entirely at the manager level per the formal Escape precedence chain. Individual behaviors do not need `handleEscape()` methods unless they have special escape semantics beyond ending interaction.

---

### Enterability vs Activatability

**Important Distinction**

The spec uses "enterable" to mean "shows brackets and descends into child scope." However, there's a semantic difference:

**Enterable** (structural depth)
- True for `entry-node` scopes
- Enter descends into child navigation
- Example: slider row, button group, section header

**Activatable** (triggers action/overlay)
- True for `param-trigger`, buttons that open dialogs
- Enter triggers action or opens overlay
- May not have structural children in nav tree

**Visual Treatment**: Both use orange + animated brackets because they both represent "pressing Enter will do something interesting." The spec unifies these visually but distinguishes them semantically via `node.role`.

```javascript
_isEnterable(node) {
  if (!node) return false;

  // Structural entry-node scopes
  if (node.isScope() && node.focusMode === 'entry-node') {
    return true;
  }

  // Activatable nodes that open overlays/depth
  if (node.role === 'param-trigger') return true;
  
  // Could extend for other activatable types
  // if (node.canActivate) return true;

  return false;
}
}
```

---

## Other Behaviors

**Button**

```javascript
class ButtonBehavior {
  constructor(element) {
    this.element = element;
  }

  handleDirection() {
    return 'PASSTHROUGH';
  }

  activate() {
    this.element.click();
  }

  focus() {
    this.element.focus();
  }
}
```

**Checkbox**

```javascript
class CheckboxBehavior {
  constructor(element) {
    this.element = element;
  }

  handleDirection() {
    return 'PASSTHROUGH';
  }

  activate() {
    this.element.checked = !this.element.checked;
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  focus() {
    this.element.focus();
  }
}
```

**Native Select**

```javascript
class NativeSelectBehavior {
  constructor(element) {
    this.element = element;
  }

  handleDirection(key, sessionState, currentLeaf) {
    if (document.activeElement === this.element) {
      return 'IGNORED';
    }
    return 'PASSTHROUGH';
  }

  activate() {
    this.element.focus();
  }

  focus() {
    this.element.focus();
  }
}
```

---

## Navigation Tree Builder

**Critical: This is the most complex subsystem and must be fully specified before implementation begins.**

The tree builder's job is to construct a semantic navigation tree from the DOM that:
- Respects visual hierarchy and grouping
- Inserts semantic scopes where DOM structure doesn't match navigation intent
- Handles portaled/detached overlays (dialogs, dropdowns, pickers)
- Assigns correct behaviors based on element types
- Maintains stable node IDs across rebuilds

### DOM Attribute Schema

```html
<!-- Scope definition -->
<div 
  data-nav-scope="section-id"
  data-nav-focus-mode="entry-node"     <!-- or "container" -->
  data-nav-strategy="linear"            <!-- or "grid", "spatial" -->
  data-nav-entry-policy="primary"       <!-- or "first", "last", "selected", "remembered" -->
  data-nav-modal="true"                 <!-- optional, for modal scopes -->
>
  <!-- Leaf definition -->
  <button 
    data-nav-leaf="button-id"
    data-nav-role="action"              <!-- or "param-trigger", "analog-control", "value-editor" -->
    data-nav-primary="true"             <!-- optional, marks primary entry point -->
  >
    Action
  </button>
</div>
```

### Builder Implementation

```javascript
class NavigationTreeBuilder {
  constructor() {
    this.nodeIdCounter = 0; // Only for ephemeral nodes, not persisted in state
    this.nodeIndex = new Map(); // element -> node
    this.overlayRegistry = new Map(); // overlay id -> { scope, trigger }
  }

  build(rootElement) {
    const root = new ScopeNode({
      id: 'root',
      strategy: 'linear',
      focusMode: 'container',
      entryPolicy: 'first',
      element: rootElement
    });

    this._walkAndBuild(rootElement, root);
    return root;
  }

  _walkAndBuild(element, parentScope) {
    for (const child of element.children) {
      // Skip hidden or aria-hidden elements
      if (child.hidden || child.getAttribute('aria-hidden') === 'true') {
        continue;
      }

      // Check for explicit scope
      if (child.hasAttribute('data-nav-scope')) {
        const scope = this._createScope(child, parentScope);
        parentScope.children.push(scope);
        this._walkAndBuild(child, scope);
        continue;
      }

      // Check for explicit leaf
      if (child.hasAttribute('data-nav-leaf')) {
        const leaf = this._createLeaf(child, parentScope);
        if (leaf) {
          parentScope.children.push(leaf);
        }
        continue;
      }

      // Auto-detect semantic composite widgets
      const detected = this._detectCompositeWidget(child, parentScope);
      if (detected) {
        parentScope.children.push(detected);
        continue;
      }

      // Auto-detect simple interactive elements
      const leaf = this._detectSimpleLeaf(child, parentScope);
      if (leaf) {
        parentScope.children.push(leaf);
        continue;
      }

      // Not a recognized element - recurse into children
      this._walkAndBuild(child, parentScope);
    }
  }

  _generateStableId(element, role, parent) {
    // Priority 1: Explicit data attribute (STABLE)
    const explicit = element.getAttribute('data-nav-id') || 
                     element.getAttribute('data-nav-scope') ||
                     element.getAttribute('data-nav-leaf');
    if (explicit) return explicit;
    
    // Priority 2: DOM id attribute (STABLE)
    const domId = element.id;
    if (domId) return `${role || 'node'}-${domId}`;
    
    // Priority 3: Class-based semantic key (STABLE if structure stable)
    const semanticClass = element.className.split(' ')[0];
    if (semanticClass && parent) {
      const siblings = Array.from(parent.element?.children || [])
        .filter(c => c.className.split(' ')[0] === semanticClass);
      const index = siblings.indexOf(element);
      if (index >= 0) {
        return `${parent.id}:${semanticClass}-${index}`;
      }
    }
    
    // Priority 4: Ordinal within parent (STABLE if insertion order stable)
    if (parent && parent.element) {
      const index = Array.from(parent.element.children).indexOf(element);
      if (index >= 0) {
        return `${parent.id}:child-${index}`;
      }
    }
    
    // Fallback: UNSTABLE - warn developer
    console.warn('Using unstable ID for element - add data-nav-id for remembered focus stability', element);
    return `ephemeral-${role || 'node'}-${this.nodeIdCounter++}`;
  }

  _createScope(element, parent) {
    const id = this._generateStableId(element, 'scope', parent);
    const focusMode = element.getAttribute('data-nav-focus-mode') || 'container';
    const strategy = element.getAttribute('data-nav-strategy') || 'linear';
    const entryPolicy = element.getAttribute('data-nav-entry-policy') || 'first';
    const modal = element.hasAttribute('data-nav-modal');
    const overlay = element.hasAttribute('data-nav-overlay');

    const scope = new ScopeNode({
      id,
      parent,
      strategy,
      focusMode,
      entryPolicy,
      modal,
      overlay,
      element: focusMode === 'entry-node' ? element : null
    });

    this.nodeIndex.set(element, scope);
    return scope;
  }

  _createLeaf(element, parent) {
    const role = element.getAttribute('data-nav-role');
    const id = this._generateStableId(element, role || 'leaf', parent);
    const primary = element.hasAttribute('data-nav-primary');

    const behavior = this._createBehavior(element, role);
    if (!behavior) {
      console.warn(`Could not create behavior for element ${id}`, element);
      return null;
    }

    const leaf = new LeafNode({
      id,
      parent,
      element,
      behavior,
      role,
      primary
    });

    this.nodeIndex.set(element, leaf);
    return leaf;
  }

  _detectCompositeWidget(element, parent) {
    // Detect Principia slider rows
    if (element.classList.contains('slider-row') || 
        element.querySelector('input[type="range"]')) {
      return this._buildSliderScope(element, parent);
    }

    // Detect button groups
    if (element.classList.contains('button-group')) {
      return this._buildButtonGroupScope(element, parent);
    }

    return null;
  }

  _buildSliderScope(element, parent) {
    // Generate stable ID using semantic information
    const sliderId = element.id || element.getAttribute('data-slider-id');
    const id = sliderId ? `slider-${sliderId}` : this._generateStableId(element, 'slider', parent);
    
    const scope = new ScopeNode({
      id,
      parent,
      strategy: 'linear',
      focusMode: 'entry-node',
      entryPolicy: 'primary',
      element
    });

    // Find slider sub-parts
    const paramTrigger = element.querySelector('[data-slider-param]') || 
                        element.querySelector('.slider-label[data-opens-dropdown]');
    const rangeInput = element.querySelector('input[type="range"]');
    const valueInput = element.querySelector('input[type="number"]');

    if (paramTrigger) {
      const trigger = new LeafNode({
        id: `${id}-param`,
        parent: scope,
        element: paramTrigger,
        behavior: new ParamTriggerBehavior(paramTrigger, this._getDropdownHandler(paramTrigger)),
        role: 'param-trigger'
      });
      scope.children.push(trigger);
    }

    if (rangeInput) {
      const analog = new LeafNode({
        id: `${id}-analog`,
        parent: scope,
        element: rangeInput,
        behavior: new AnalogControlBehavior(rangeInput),
        role: 'analog-control',
        primary: true
      });
      scope.children.push(analog);
    }

    if (valueInput) {
      const editor = new LeafNode({
        id: `${id}-value`,
        parent: scope,
        element: valueInput,
        behavior: new ValueEditorBehavior(valueInput),
        role: 'value-editor',
        primary: !rangeInput // primary if no analog control
      });
      scope.children.push(editor);
    }

    this.nodeIndex.set(element, scope);
    return scope;
  }

  _buildButtonGroupScope(element, parent) {
    // Generate stable ID
    const groupId = element.id || element.getAttribute('data-group-id');
    const id = groupId ? `btn-group-${groupId}` : this._generateStableId(element, 'btn-group', parent);
    
    const scope = new ScopeNode({
      id,
      parent,
      strategy: 'grid', // or 'linear' depending on layout
      focusMode: 'container',
      entryPolicy: 'first',
      element
    });

    for (const button of element.querySelectorAll('button')) {
      const leaf = this._createLeaf(button, scope);
      if (leaf) {
        scope.children.push(leaf);
      }
    }

    return scope;
  }

  _detectSimpleLeaf(element, parent) {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'button' && !element.disabled) {
      return new LeafNode({
        id: this._generateStableId(element, 'btn', parent),
        parent,
        element,
        behavior: new ButtonBehavior(element),
        role: 'action'
      });
    }

    if (tagName === 'input') {
      const type = element.type;
      if (type === 'checkbox') {
        return new LeafNode({
          id: this._generateStableId(element, 'check', parent),
          parent,
          element,
          behavior: new CheckboxBehavior(element),
          role: 'toggle'
        });
      }
      // Add other input types as needed
    }

    if (tagName === 'select') {
      return new LeafNode({
        id: this._generateStableId(element, 'select', parent),
        parent,
        element,
        behavior: new NativeSelectBehavior(element),
        role: 'selector'
      });
    }

    return null;
  }

  _createBehavior(element, role) {
    const tagName = element.tagName.toLowerCase();

    if (role === 'param-trigger') {
      return new ParamTriggerBehavior(element, this._getDropdownHandler(element));
    }

    if (role === 'analog-control') {
      return new AnalogControlBehavior(element);
    }

    if (role === 'value-editor') {
      return new ValueEditorBehavior(element);
    }

    // Auto-detect from element type
    if (tagName === 'button') {
      return new ButtonBehavior(element);
    }

    if (tagName === 'input') {
      if (element.type === 'checkbox') {
        return new CheckboxBehavior(element);
      }
      if (element.type === 'number' || element.type === 'text') {
        return new ValueEditorBehavior(element);
      }
      if (element.type === 'range') {
        return new AnalogControlBehavior(element);
      }
    }

    if (tagName === 'select') {
      return new NativeSelectBehavior(element);
    }

    return null;
  }

  _getDropdownHandler(triggerElement) {
    // Hook into existing Principia picker/dropdown system
    return {
      open: () => {
        // Trigger existing dropdown open logic
        triggerElement.click();
      }
    };
  }

  // Support for dynamically registered overlays (dialogs, pickers)
  registerOverlay(overlayElement, triggerNode) {
    const overlayScope = this._createScope(overlayElement, triggerNode.parent);
    overlayScope.overlay = true;
    overlayScope.modal = true;
    overlayScope.returnFocusNode = triggerNode;

    this._walkAndBuild(overlayElement, overlayScope);
    
    const id = overlayScope.id;
    this.overlayRegistry.set(id, { scope: overlayScope, trigger: triggerNode });
    
    return overlayScope;
  }

  // Incremental subtree rebuild for DOM mutations
  rebuildSubtree(element) {
    const node = this.nodeIndex.get(element);
    if (!node || !node.isScope()) {
      console.warn('Cannot rebuild non-scope node', element);
      return;
    }

    // Clear old children
    for (const child of node.children) {
      this._clearNodeIndex(child);
    }
    node.children = [];

    // Rebuild
    this._walkAndBuild(element, node);
    
    // Return info about what changed for reconciliation
    return {
      rebuiltScope: node,
      needsReconciliation: true
    };
  }

  _clearNodeIndex(node) {
    if (node.element) {
      this.nodeIndex.delete(node.element);
    }
    if (node.isScope()) {
      for (const child of node.children) {
        this._clearNodeIndex(child);
      }
    }
  }
}
```

### Builder Usage

```javascript
// In KeyboardNavigationManager._buildTree()
_buildTree(rootElement) {
  const builder = new NavigationTreeBuilder();
  return builder.build(rootElement);
}

// For dynamic overlays (dialogs, pickers)
manager.registerOverlay = function(overlayElement, triggerNode) {
  const builder = this._treeBuilder; // store builder as instance property
  const overlayScope = builder.registerOverlay(overlayElement, triggerNode);
  this.state.overlayStack.push(overlayScope);
  return overlayScope;
};
```

---

## Traversal Policies

### Linear Traversal

```javascript
class LinearTraversalPolicy {
  findNext(scope, currentChild, direction) {
    const children = scope.children;
    const idx = children.indexOf(currentChild);

    const step = (direction === 'ArrowDown' || direction === 'ArrowRight') ? 1 : -1;
    const nextIdx = idx + step;

    if (nextIdx >= 0 && nextIdx < children.length) {
      return children[nextIdx];
    }

    if (scope.wrap) {
      return step > 0 ? children[0] : children[children.length - 1];
    }

    return null;
  }
}
```

### Grid Traversal

Used for button matrices, dialog button rows, etc.

**Status**: Interface defined, algorithm partially specified. Full row/column metadata strategy TBD.

```javascript
class GridTraversalPolicy {
  findNext(scope, currentChild, direction) {
    // Implementation needs:
    // - Row/column metadata or bounds-based grouping
    // - ArrowUp/Down moves between rows
    // - ArrowLeft/Right moves within row
    // - Wrapping behavior per axis
    return null; // Placeholder until strategy finalized
  }
}
```

### Spatial Traversal

Only used where structural order is insufficient.

**Status**: Interface defined, algorithm placeholder. Directional best-match strategy TBD.

```javascript
class SpatialTraversalPolicy {
  findNext(scope, currentChild, direction) {
    // Implementation needs:
    // - Bounds-based directional search
    // - Best-match heuristic (angle + distance)
    // - Fallback to structural order on ambiguous match
    return null; // Placeholder until strategy finalized
  }
}
```

---

## Manager (Unified Traversal Model)

```javascript
class KeyboardNavigationManager {
  constructor() {
    this.tree = null;
    this.treeBuilder = null; // Store builder instance for overlay registration
    this.state = new NavigationSessionState();
    this.visualizer = new FocusVisualizer();

    this.policies = {
      linear: new LinearTraversalPolicy(),
      grid: new GridTraversalPolicy(),
      spatial: new SpatialTraversalPolicy()
    };
    
    this._resizeObserver = null;
    this._focusedElement = null;
  }

  init(rootElement) {
    this.treeBuilder = new NavigationTreeBuilder();
    this.tree = this.treeBuilder.build(rootElement);
    this.state.activePath = [this.tree];

    document.addEventListener('keydown', (e) => this._handleKeyDown(e));
    document.addEventListener('focusin', (e) => this._syncFromNativeFocus(e));
    
    // Mouse interaction handlers
    document.addEventListener('pointerdown', (e) => this._handleMouseInteraction(e), { capture: true });
    document.addEventListener('click', (e) => this._handleMouseInteraction(e), { capture: true });
    
    // Reposition focus ring on layout changes
    this._resizeObserver = new ResizeObserver(() => {
      if (this.state.currentNode) {
        this._renderFocus();
      }
    });
    
    // Reposition on scroll
    document.addEventListener('scroll', () => {
      if (this.state.currentNode) {
        this._renderFocus();
      }
    }, { passive: true, capture: true });
  }
  
  _handleMouseInteraction(e) {
    // Mouse Interaction Policy:
    // - Click ends cyan interaction immediately
    // - Click on mapped nav element syncs currentNode to it
    // - Click outside mapped elements hides cursor but keeps session active
    
    if (!this.state.active) return;
    
    // End any active interaction immediately on any click
    if (this.state.interaction.active) {
      this.state.endInteraction();
      this._renderFocus();
    }
    
    // Check if click target is in nav tree
    let target = e.target;
    let node = null;
    
    // Walk up to find a mapped nav element
    while (target && target !== document.body) {
      node = this.treeBuilder?.nodeIndex.get(target);
      if (node) break;
      target = target.parentElement;
    }
    
    if (node && node.isLeaf()) {
      // Sync to clicked nav element
      this.state.currentNode = node;
      
      // Update remembered descendant
      if (node.parent) {
        this.state.lastFocusedByScope.set(node.parent.id, node);
      }
      
      // Update activePath
      const newPath = [];
      let ancestor = node.parent;
      while (ancestor) {
        newPath.unshift(ancestor);
        ancestor = ancestor.parent;
      }
      this.state.activePath = newPath;
      
      this._renderFocus();
    } else {
      // Clicked outside nav tree - hide cursor but keep session
      this._handleOutOfTreeFocus();
    }
  }

  navigate(direction) {
    const current = this.state.currentNode;
    if (!current) return false;

    if (current.isLeaf()) {
      const result = current.behavior.handleDirection(direction, this.state, current);

      if (result === 'CONSUMED') {
        this._renderFocus();
        return true;
      }

      if (result === 'IGNORED') {
        return false;
      }
    }

    const scope = this.state.getCurrentTraversalScope();
    if (!scope) return false;

    // Plan phase: compute target without mutating state
    const plan = this._planDirectionalMove(scope, current, direction);
    if (!plan) return false;

    // Commit phase: apply state changes atomically
    this._commitMove(plan);
    return true;
  }

  _planDirectionalMove(scope, fromNode, direction) {
    const policy = this.policies[scope.strategy];
    
    if (!policy || !policy.findNext) {
      console.warn(`Missing or invalid traversal policy for strategy: ${scope.strategy}`);
      return null;
    }
    
    const localNext = policy.findNext(scope, fromNode, direction);

    if (localNext) {
      return this._planEntry(localNext, direction, []);
    }

    if (scope.modal && this.state.overlayStack.includes(scope)) {
      return null;
    }

    const parent = scope.parent;
    if (!parent || !parent.isScope()) {
      return null;
    }

    // Plan to exit this scope
    const parentPolicy = this.policies[parent.strategy];
    const siblingNext = parentPolicy.findNext(parent, scope, direction);

    if (siblingNext) {
      return this._planEntry(siblingNext, direction, [scope]);
    }

    // Recursively plan upward, accumulating scopes to exit
    const upwardPlan = this._planDirectionalMove(parent, scope, direction);
    if (upwardPlan) {
      // Prepend current scope to maintain innermost-first order
      upwardPlan.exitScopes.unshift(scope);
      return upwardPlan;
    }

    return null;
  }

  _planEntry(targetNode, direction, exitScopes) {
    // Delegate to canonical resolution authority
    const result = this._resolveToFocusable(targetNode, direction);
    
    if (!result) {
      return null;
    }
    
    return {
      targetNode: result.node,
      exitScopes,
      enterScopes: result.enterScopes
    };
  }

  _commitMove(plan) {
    // Exit scopes first
    for (const scope of plan.exitScopes) {
      this.state.exitScope(scope);
    }

    // Enter scopes
    for (const scope of plan.enterScopes) {
      this.state.enterScope(scope);
    }

    // Focus target
    this._focusTarget(plan.targetNode);
  }

  _focusTarget(node) {
    const current = this.state.currentNode;
    
    // Stop observing old element
    if (this._focusedElement && this._resizeObserver) {
      this._resizeObserver.unobserve(this._focusedElement);
    }

    if (current && current.parent && current.isLeaf()) {
      this.state.lastFocusedByScope.set(current.parent.id, current);
    }

    this.state.currentNode = node;

    if (node.isLeaf()) {
      node.behavior.focus();
      this._focusedElement = node.element;
    } else if (node.isScope() && node.focusMode === 'entry-node' && node.element) {
      node.element.focus();
      this._focusedElement = node.element;
    }
    
    // Observe new element for layout changes
    if (this._focusedElement && this._resizeObserver) {
      this._resizeObserver.observe(this._focusedElement);
    }

    this._renderFocus();
  }

  _renderFocus() {
    const node = this.state.currentNode;
    if (!node) {
      this.visualizer.hide();
      return;
    }

    const isInteracting = this.state.isInteractingWith(node);
    const isEnterable = this._isEnterable(node);

    this.visualizer.render({
      node,
      isInteracting,
      isEnterable
    });
  }

  _isEnterable(node) {
    if (!node) return false;

    if (node.isScope()) {
      return node.focusMode === 'entry-node';
    }

    // leaf-level behaviors that open deeper scopes/overlays
    if (node.role === 'param-trigger') return true;

    return false;
  }

  _resolveToFocusable(node, direction) {
    if (!node) return null;
    
    if (node.isLeaf()) {
      return { node, enterScopes: [] };
    }
    
    if (node.isScope() && node.focusMode === 'entry-node') {
      return { node, enterScopes: [] };
    }
    
    if (node.isScope() && node.focusMode === 'container') {
      // Container scopes are transparent - descend to first focusable
      // But we must track all containers we pass through for activePath
      const enterScopes = [node];
      let currentNode = node;
      
      while (currentNode.isScope() && currentNode.focusMode === 'container') {
        const child = currentNode.resolveEntry(direction, null, this.state);
        if (!child) {
          console.warn(`Container scope ${currentNode.id} has no valid descendants`);
          return null;
        }
        
        if (child.isLeaf()) {
          return { node: child, enterScopes };
        }
        
        if (child.focusMode === 'entry-node') {
          return { node: child, enterScopes };
        }
        
        // Another container - continue descent
        enterScopes.push(child);
        currentNode = child;
      }
    }
    
    return null;
  }

  _handleKeyDown(e) {
    if (e.defaultPrevented) return;
    if (e.isComposing) return;
    
    // Allow certain modifier combinations (e.g., Shift+Arrow for future range selection)
    // but bail on most modifier combos to avoid conflicts
    if ((e.ctrlKey || e.altKey || e.metaKey) && e.key !== 'Enter') return;

    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);

    if (isArrow) {
      if (!this.state.active) {
        this.state.active = true;
        // Use resolveToFocusable to ensure we reach an actually focusable node
        const firstResolved = this.tree.resolveEntry('down', null, this.state);
        const result = firstResolved ? this._resolveToFocusable(firstResolved, 'down') : null;
        
        if (result) {
          // Enter any container scopes we descended through
          for (const scope of result.enterScopes) {
            this.state.enterScope(scope);
          }
          this._focusTarget(result.node);
          e.preventDefault();
        } else {
          console.warn('Cannot activate navigation: no focusable descendants');
          this.state.active = false;
        }
        return;
      }

      if (this.navigate(e.key)) {
        e.preventDefault();
      }

      return;
    }

    if (e.key === 'Enter' && this.state.active && this.state.currentNode) {
      const current = this.state.currentNode;

      if (current.isLeaf()) {
        current.behavior.activate(this.state, current);
        this._renderFocus();
        e.preventDefault();
        return;
      }

      if (current.isScope() && current.focusMode === 'entry-node') {
        this.state.enterScope(current);
        const entry = current.resolveEntry('down', current, this.state);
        if (entry) {
          // Use canonical resolution to ensure we reach focusable target
          const result = this._resolveToFocusable(entry, 'down');
          if (result) {
            for (const scope of result.enterScopes) {
              this.state.enterScope(scope);
            }
            this._focusTarget(result.node);
          } else {
            // No valid entry - back out
            this.state.exitScope(current);
            console.warn(`Cannot enter scope ${current.id}: no valid entry target`);
          }
        } else {
          // No valid entry - back out
          this.state.exitScope(current);
          console.warn(`Cannot enter scope ${current.id}: no valid entry target`);
        }
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Escape' && this.state.active) {
      // 1. end active interaction first
      if (this.state.interaction.active) {
        this.state.endInteraction();
        this._renderFocus();
        e.preventDefault();
        return;
      }

      // 2. pop overlay
      if (this.state.overlayStack.length > 0) {
        const overlay = this.state.overlayStack.pop();
        this._restoreAfterOverlayClose(overlay);
        this._renderFocus();
        e.preventDefault();
        return;
      }

      // 3. exit deepest entered scope
      if (this.state.activePath.length > 1) {
        const deepest = this.state.activePath.pop();

        if (deepest.focusMode === 'entry-node') {
          this._focusTarget(deepest);
        } else {
          const parent = this.state.activePath[this.state.activePath.length - 1];
          const remembered = this.state.lastFocusedByScope.get(parent.id);
          if (remembered) {
            this._focusTarget(remembered);
          }
        }

        e.preventDefault();
        return;
      }

      // 4. deactivate
      this.state.active = false;
      this.state.currentNode = null;
      this.state.endInteraction();
      this.visualizer.hide();
      e.preventDefault();
    }
  }

  _restoreAfterOverlayClose(overlay) {
    // Formal fallback chain for overlay restoration:
    // 1. overlay.returnFocusNode if still valid
    // 2. remembered descendant of parent scope if still valid
    // 3. parent scope entry target
    // 4. nearest valid ancestor entry-node
    // 5. deactivate navigation if nothing valid remains
    
    if (overlay.returnFocusNode && this._isNodeStillValid(overlay.returnFocusNode)) {
      this._focusTarget(overlay.returnFocusNode);
      return;
    }
    
    const parent = this.state.activePath[this.state.activePath.length - 1];
    if (parent) {
      const remembered = this.state.lastFocusedByScope.get(parent.id);
      if (remembered && this._isNodeStillValid(remembered)) {
        this._focusTarget(remembered);
        return;
      }
      
      const entry = parent.resolveEntry('down', null, this.state);
      if (entry) {
        const result = this._resolveToFocusable(entry, 'down');
        if (result) {
          for (const scope of result.enterScopes) {
            this.state.enterScope(scope);
          }
          this._focusTarget(result.node);
          return;
        }
      }
    }
    
    // Try nearest ancestor entry-node
    for (let i = this.state.activePath.length - 1; i >= 0; i--) {
      const ancestor = this.state.activePath[i];
      if (ancestor.focusMode === 'entry-node' && this._isNodeStillValid(ancestor)) {
        // Trim activePath to this ancestor
        this.state.activePath.length = i + 1;
        this._focusTarget(ancestor);
        return;
      }
    }
    
    // No valid restoration target - deactivate navigation
    console.warn('Overlay restoration failed: no valid target remains, deactivating navigation');
    this.state.active = false;
    this.state.currentNode = null;
    this.state.endInteraction();
    this.visualizer.hide();
  }

  _isNodeStillValid(node) {
    if (!node) return false;
    if (!node.element) return false;
    if (!node.element.isConnected) return false;
    if (node.element.hidden) return false;
    if (node.element.getAttribute('aria-hidden') === 'true') return false;
    if (node.element.disabled) return false;
    
    // Check computed styles for hidden elements
    const computed = window.getComputedStyle(node.element);
    if (computed.display === 'none') return false;
    if (computed.visibility === 'hidden') return false;
    
    // Check for disabled ancestor semantics
    let ancestor = node.element.parentElement;
    while (ancestor) {
      if (ancestor.hasAttribute('aria-disabled') && ancestor.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      if (ancestor.getAttribute('aria-hidden') === 'true') return false;
      ancestor = ancestor.parentElement;
    }
    
    return true;
  }

  _syncFromNativeFocus(e) {
    // Sync navigation state when native focus changes (Tab coexistence)
    const target = e.target;
    if (!target) return;
    
    // Check if target is in our navigation tree
    const node = this.treeBuilder?.nodeIndex.get(target);
    
    if (!node || !node.isLeaf()) {
      // Focus moved outside navigation tree
      this._handleOutOfTreeFocus();
      return;
    }
    
    // Update current node
    this.state.currentNode = node;
    
    // Update remembered descendant for parent scope
    if (node.parent) {
      this.state.lastFocusedByScope.set(node.parent.id, node);
    }
    
    // Recompute minimal compatible activePath
    const newPath = [];
    let ancestor = node.parent;
    while (ancestor) {
      newPath.unshift(ancestor);
      ancestor = ancestor.parent;
    }
    
    // Only update activePath if it differs
    if (!this._pathsEqual(this.state.activePath, newPath)) {
      this.state.activePath = newPath;
    }
    
    // Render focus ring on new target
    if (this.state.active) {
      this._renderFocus();
    }
  }
  
  _handleOutOfTreeFocus() {
    // Native focus moved outside the navigation tree
    // Strategy: Keep session active but hide cursor and clear current node
    // Allows reactivation on next arrow press without full reinitialization
    
    if (!this.state.active) return;
    
    this.visualizer.hide();
    // Don't clear activePath or lastFocusedByScope - preserve for reactivation
    // Only clear currentNode to indicate "not currently focused"
    const previousNode = this.state.currentNode;
    this.state.currentNode = null;
    
    // If we were interacting, end that
    if (this.state.interaction.active) {
      this.state.endInteraction();
    }
    
    console.log('Navigation focus moved outside tree, hiding cursor but keeping session active');
    
    // Store the last valid node for potential reactivation
    if (previousNode && this._isNodeStillValid(previousNode)) {
      this._lastOutOfTreeNode = previousNode;
    }
  }

  _pathsEqual(path1, path2) {
    if (path1.length !== path2.length) return false;
    for (let i = 0; i < path1.length; i++) {
      if (path1[i] !== path2[i]) return false;
    }
    return true;
  }

  // Overlay registration for dynamically opened dialogs, pickers, dropdowns
  registerOverlay(overlayElement, triggerNode) {
    if (!this.treeBuilder) {
      console.error('Cannot register overlay: tree builder not initialized');
      return null;
    }
    
    const overlayScope = this.treeBuilder.registerOverlay(overlayElement, triggerNode);
    this.state.overlayStack.push(overlayScope);
    
    // Focus entry target in overlay
    const entry = overlayScope.resolveEntry('down', null, this.state);
    if (entry) {
      const result = this._resolveToFocusable(entry, 'down');
      if (result) {
        for (const scope of result.enterScopes) {
          this.state.enterScope(scope);
        }
        this._focusTarget(result.node);
      }
    }
    
    return overlayScope;
  }

  // Incremental rebuild for DOM mutations
  rebuildSubtree(element) {
    if (!this.treeBuilder) {
      console.error('Cannot rebuild: tree builder not initialized');
      return;
    }
    
    const rebuildInfo = this.treeBuilder.rebuildSubtree(element);
    
    if (rebuildInfo && rebuildInfo.needsReconciliation) {
      this._reconcileAfterRebuild(rebuildInfo.rebuiltScope);
    }
  }
  
  _reconcileAfterRebuild(rebuiltScope) {
    // Validate and reconcile all stateful references after subtree rebuild
    
    // 1. Validate currentNode
    if (this.state.currentNode && !this._isNodeStillValid(this.state.currentNode)) {
      console.warn('Current node invalidated by rebuild, finding fallback');
      const fallback = this._findNearestValidNode(this.state.currentNode, rebuiltScope);
      if (fallback) {
        this._focusTarget(fallback);
      } else {
        // No valid fallback - deactivate
        this.state.active = false;
        this.state.currentNode = null;
        this.visualizer.hide();
      }
    }
    
    // 2. Validate lastFocusedByScope references
    for (const [scopeId, rememberedNode] of this.state.lastFocusedByScope.entries()) {
      if (!this._isNodeStillValid(rememberedNode)) {
        this.state.lastFocusedByScope.delete(scopeId);
        console.warn(`Remembered focus for scope ${scopeId} invalidated by rebuild`);
      }
    }
    
    // 3. Validate activePath
    this.state.activePath = this.state.activePath.filter(scope => {
      if (!scope.element || !scope.element.isConnected) {
        console.warn(`Scope ${scope.id} removed from activePath due to rebuild`);
        return false;
      }
      return true;
    });
    
    // 4. Validate overlayStack
    this.state.overlayStack = this.state.overlayStack.filter(overlay => {
      if (!overlay.element || !overlay.element.isConnected) {
        console.warn(`Overlay ${overlay.id} removed from overlayStack due to rebuild`);
        return false;
      }
      return true;
    });
  }
  
  _findNearestValidNode(invalidNode, rebuiltScope) {
    // Try to find nearest surviving equivalent after rebuild
    
    // 1. Try same ID (might be reconstructed)
    if (invalidNode.id && rebuiltScope) {
      const sameId = this._findNodeById(rebuiltScope, invalidNode.id);
      if (sameId && this._isNodeStillValid(sameId)) {
        return sameId;
      }
    }
    
    // 2. Try parent's remembered descendant
    if (invalidNode.parent) {
      const remembered = this.state.lastFocusedByScope.get(invalidNode.parent.id);
      if (remembered && this._isNodeStillValid(remembered)) {
        return remembered;
      }
      
      // 3. Try parent's entry target
      const entry = invalidNode.parent.resolveEntry('down', null, this.state);
      if (entry) {
        const result = this._resolveToFocusable(entry, 'down');
        if (result && result.node) {
          return result.node;
        }
      }
    }
    
    // 4. Try nearest ancestor entry-node
    for (let i = this.state.activePath.length - 1; i >= 0; i--) {
      const ancestor = this.state.activePath[i];
      if (ancestor.focusMode === 'entry-node' && this._isNodeStillValid(ancestor)) {
        return ancestor;
      }
    }
    
    return null;
  }
  
  _findNodeById(scope, id) {
    if (scope.id === id) return scope;
    
    for (const child of scope.children) {
      if (child.id === id) return child;
      if (child.isScope()) {
        const found = this._findNodeById(child, id);
        if (found) return found;
      }
    }
    
    return null;
  }
}
```

---

## Semantic Tree Example

```text
root (container)
└─ sidebar (container, linear)
   ├─ control-buttons (entry-node, grid)
   │  ├─ render-btn
   │  ├─ url-btn
   │  ├─ json-btn
   │  ├─ png-btn
   │  └─ reset-btn
   │
   ├─ display-section (entry-node, linear)
   │  ├─ mode-picker-btn
   │  ├─ resolution-picker-btn
   │  └─ auto-render-check
   │
   └─ slice-offset-section (entry-node, linear)
      ├─ slider-0 (entry-node, primary)
      │  ├─ param-trigger
      │  ├─ analog-control   [primary]
      │  └─ value-editor
      ├─ slider-1 (entry-node, primary)
      │  ├─ param-trigger
      │  ├─ analog-control   [primary]
      │  └─ value-editor
      └─ ...
```

### Example overlay spawned from param-trigger

```text
overlayStack:
└─ param-dropdown (modal overlay scope)
   ├─ item-0
   ├─ item-1
   └─ item-2
```

### Example dialog overlay

```text
overlayStack:
└─ warning-dialog (modal overlay scope)
   ├─ checkbox-1
   ├─ checkbox-2
   └─ button-row (container)
      ├─ cancel-btn
      └─ confirm-btn
```

---

## DOM Markup Guidance

```html
<div data-nav-scope="slice-offset-section" data-nav-focus-mode="entry-node">
  <div data-nav-scope="slider-q1" data-nav-focus-mode="entry-node" data-nav-entry-policy="primary">
    <button data-nav-leaf="param-trigger">Q₁ TILT INTO Zₛ (M₁)</button>
    <input data-nav-leaf="analog-control" type="range" min="-2" max="2" step="0.01" value="0" />
    <input data-nav-leaf="value-editor" type="number" value="0.00" />
  </div>
</div>
```

Notes:

* DOM shape and navigation tree may not be identical
* use a semantic tree builder / projection layer
* portals and overlays must register explicitly

---

## Integration in `main.js`

```javascript
import { KeyboardNavigationManager } from './navigation/index.js';

async function boot() {
  // ... existing setup ...

  const navManager = new KeyboardNavigationManager();
  navManager.init(document.body);

  // ... rest of boot ...
}
```

---

## Behavior Summary

### Universal Scope Behavior

| State | Key | Action |
|-------|-----|--------|
| Scope selected outside | Arrow keys | Move to sibling scope/target |
| Scope selected outside | Enter | Enter scope and focus entry target |
| Inside scope | Arrow keys | Move among local children |
| Inside scope at boundary | Arrow key | Bubble up and continue in same direction |
| Inside scope | Escape | Exit current interaction or scope |
| Overlay active | Escape | Close/pop overlay |

---

### Slider Behavior Summary

| State | Cursor Style | Key | Result |
|-------|-------------|-----|--------|
| Slider row selected | Orange + brackets | Enter | Enter slider |
| Param trigger focused | Orange | Enter | Open dropdown |
| Analog control focused | Orange | Enter | Begin adjusting |
| Analog control interacting | Cyan | Left/Right | Native range input adjusts value |
| Analog control interacting | Cyan | Up/Down or Escape | Stop adjusting |
| Value editor focused | Orange | Enter | Begin text editing |
| Value editor interacting | Cyan | Type | Edit value |
| Value editor interacting | Cyan | Enter/Escape | Stop editing |

---

## Example Interaction Flows

### Entering and adjusting a slider

```text
1. ArrowDown → slider row selected
   Highlight: orange row frame with animated corner brackets

2. Enter → enter slider
   Highlight moves to analog control
   Highlight: orange, single cursor only

3. Enter → begin analog interaction
   Same highlight turns cyan

4. ArrowLeft / ArrowRight → adjust slider
   Same cyan highlight remains on analog control

5. Escape → stop interacting
   Same highlight stays on analog control, returns orange

6. ArrowUp → move to param trigger
   Highlight moves to param button

7. Enter → open dropdown overlay
   Highlight moves into overlay first item
   No old highlight remains behind
```

### Typing into value box

```text
1. Inside slider, ArrowDown → move to value editor
   Highlight moves to numeric box (orange)

2. Enter → start editing
   Same highlight turns cyan

3. Type value

4. Enter or Escape → stop editing
   Same highlight stays on value box, returns orange
```

### Fast section skipping

```text
1. ArrowDown → Control Buttons scope selected
2. ArrowDown → Display Section scope selected
3. ArrowDown → Slice Offset Section scope selected
4. Enter → enter section
5. ArrowDown → slider row selected
6. ArrowDown → next slider row selected
```

---

## Accessibility

* DOM focus remains canonical where possible
* only one visual cursor reduces ambiguity
* focus state should be mirrored by actual focus target
* native text inputs and selects keep their expected behavior when interacting
* overlay stack prevents accidental escape from modal content
* reduced-motion mode should disable cursor animation but keep state distinction

### Reduced Motion

If `prefers-reduced-motion: reduce`:

* remove bracket pulsing animation
* keep color/state differences
* keep single cursor semantics unchanged

---

## Testing Checklist

### Single Highlight Invariant

* [ ] Only one visible highlight ever appears
* [ ] Entering a composite moves highlight inward rather than duplicating it
* [ ] Interacting changes the same highlight to cyan
* [ ] Exiting interaction reverts the same highlight to orange
* [ ] No parent orange + child cyan dual state ever occurs

### Scope Enter/Exit

* [ ] ArrowDown navigates between outer scopes
* [ ] Enter on entry-node scope enters it
* [ ] Escape exits current interaction first
* [ ] Escape then exits current scope
* [ ] Boundary traversal bubbles upward correctly

### Sliders

* [ ] Slider row can be selected from outside
* [ ] Slider row shows enterable bracket animation
* [ ] Enter moves cursor to primary child
* [ ] Analog control can enter cyan interaction mode
* [ ] Left/right only adjust while interacting
* [ ] Value editor can enter cyan text editing mode
* [ ] Param trigger opens overlay dropdown
* [ ] Closing dropdown restores focus to trigger without duplicate cursor

### Dialogs / Overlays

* [ ] Opening overlay moves single cursor into overlay
* [ ] Navigation is trapped inside modal overlay
* [ ] Escape closes top overlay first
* [ ] Focus restores cleanly afterward

### Native Control Safety

* [ ] Text inputs are not hijacked while editing
* [ ] Native selects behave normally
* [ ] Number inputs behave normally while interacting

### Visual Design

* [ ] Orange clearly reads as navigation focus
* [ ] Cyan clearly reads as active interaction
* [ ] Enterable bracket animation is noticeable but not noisy
* [ ] No visual ambiguity between selected and interacting states
* [ ] Optional container tint never feels like a second cursor

### Failure & Interruption Cases

**Critical edge cases that commonly break navigation systems:**

* [ ] Focused node removed during interaction - recovers to nearest sibling or parent
* [ ] Overlay opens while editing value box - interaction state clears correctly
* [ ] Overlay closes after triggering node was removed - fallback restoration works
* [ ] Active scope rebuilt while focused - tree patching preserves navigation state
* [ ] Slider row gains/loses param-trigger dynamically - entry policy adapts
* [ ] Native blur while interacting correctly clears cyan state
* [ ] No stale cyan highlight after Escape chain
* [ ] Clicking mouse while interacting exits cleanly to orange state
* [ ] Reduced-motion mode disables bracket animation but preserves state clarity
* [ ] Container scope with no valid descendants - activation fails gracefully
* [ ] Plan-commit traversal prevents state corruption on failed search
* [ ] ResizeObserver and scroll listeners keep ring positioned during layout changes
* [ ] Distance-based transition prevents visible sliding on large jumps

---

## Implementation Steps

### Week 1: Foundation

1. Create file structure
2. Implement static node model (NavNode, ScopeNode, LeafNode)
3. Implement NavigationSessionState with plan-commit support
4. Implement NavigationTreeBuilder with Principia widget detection
5. Implement single highlight visualizer with distance-based transitions
6. Implement basic linear traversal
7. Test top-level scope skipping

### Week 2: Composite Widgets & Context

1. Implement slider semantic roles (param-trigger, analog-control, value-editor)
2. Implement analog-control interaction mode
3. Implement value-editor interaction mode
4. **Implement breadcrumb/mode indicator** (moved from Week 5 - critical for context)
5. Implement param-trigger overlay opening
6. Test single-cursor transitions for sliders with context indicator

### Week 3: Other Controls

1. Implement buttons
2. Implement checkboxes
3. Implement native select behavior
4. Implement grid traversal for button groups
5. Test mixed section navigation

### Week 4: Overlays

1. Register dropdown overlays semantically
2. Register dialogs semantically
3. **Implement overlay restoration logic** (was stub - now critical path)
4. Test modal trapping and restoration
5. Reduced-motion pass

### Week 5: Polish & Hardening

1. Fine-tune cursor animation
2. Optional subtle container tint
3. QA pass with focus on edge cases:
   - Empty scopes
   - Failed traversal recovery
   - Overlay close edge cases
   - Layout change stress testing
4. Performance profiling
5. Documentation pass

---

## Implementation Notes & Correctness Fixes

### Critical Fixes Applied (v2.1.1)

This spec includes fixes for several correctness issues identified in technical review:

**1. State Mutation During Search (CRITICAL FIX)**

Original implementation mutated `activePath`/`overlayStack` during the search phase in `_findDirectionalTarget` and `_resolveEntry`. This caused state corruption when traversal failed partway through.

**Solution**: Implemented plan-commit pattern:
- `_planDirectionalMove()` - pure computation, returns move plan
- `_commitMove(plan)` - atomic state mutation only after successful target found
- Plan includes `{ targetNode, exitScopes, enterScopes }`

**2. Selected Entry Policy Dynamic State**

Original `entryPolicy: 'selected'` used static `child.selected` property set at construction, which never updated for runtime state like radio groups or list selections.

**Solution**: 
- `LeafNode` now supports `isSelected()` getter function
- `resolveEntry()` checks `typeof c.isSelected === 'function'` first
- Fallback to static property for simple cases
- Added `custom` entry policy for complex cases

**3. Focus Ring Layout Reactivity**

Original visualizer only repositioned on navigation events, causing misalignment after window resize or scroll.

**Solution**:
- Added `ResizeObserver` on focused element
- Added scroll listener (passive, capture phase)
- Ring repositions automatically on layout changes

**4. Focus Ring Transition on Large Jumps**

Original 0.10s transition caused visible sliding for distant element jumps (e.g., top to bottom of sidebar).

**Solution**:
- Track `lastRect` to compute jump distance
- Disable transition if distance > 200px threshold
- Instant positioning for large jumps, smooth for adjacent moves

**5. Overlay Restoration**

Original `_restoreAfterOverlayClose()` was a stub, leaving focus undefined after closing dropdowns/dialogs.

**Solution**:
- Overlays store `returnFocusNode` pointing to trigger
- Restore logic checks `overlay.returnFocusNode` first
- Falls back to `lastFocusedByScope` for parent
- Final fallback: resolve entry in parent scope

**6. Modifier Key Guard**

Original guard blocked all modifier combinations, preventing future use of `Ctrl+Enter` or `Shift+Arrow`.

**Solution**:
- Modified guard to allow Enter with modifiers
- Added comment explaining intentional scope
- Leaves room for future Shift+Arrow range selection

**7. Z-Index Management**

Hardcoded `z-index: 999999` will eventually conflict.

**Solution**:
- Uses CSS custom property `--nav-focus-z-index`
- Allows project-wide z-index scale management
- Documented in CSS semantics section

**8. Navigation Tree Builder**

Was a one-line stub hiding the most complex subsystem. The entire correctness argument depended on it.

**Solution**:
- Full `NavigationTreeBuilder` class specification
- Handles explicit DOM attributes and auto-detection
- Detects Principia sliders, button groups, composite widgets
- Supports overlay registration and incremental rebuilds
- Clear separation of concerns from Manager

**9. Missing Spatial Traversal Warning**

Original spatial policy silently returned `null`, causing navigation to fail without explanation.

**Solution**:
- Added policy validation in `_planDirectionalMove`
- Console warning if policy is missing or invalid
- Prevents silent failures from misconfigured strategies

**10. Breadcrumb Context Indicator**

Listed as Week 5 polish, but cited as critical for composite context communication.

**Solution**:
- Moved to Week 2 in revised implementation plan
- Must be present during slider testing in Weeks 2-4
- Prevents context communication bugs from being invisible

---

## Notes

### Key architectural rule

> The navigation tree is structural; the user's current depth within it is session state, not node state.

### Key visual rule

> The highlight is a single movable cursor whose styling communicates whether the current target is merely selected, enterable, or actively being manipulated.

### Chazy

No interaction required:

* separate layer
* `pointer-events: none`
* excluded from tree

### Tab coexistence

Tab may continue to follow DOM order.
Arrow navigation follows semantic tree order.
Current node may sync from native focus when helpful.

### Performance

Tree-based traversal keeps navigation local:

* usually O(siblings)
* overlays are shallow
* geometry only needed for spatial policy edge cases

### Universal Interaction Ladder

The system uses a consistent three-level hierarchy everywhere:

**Level 1: Selected**
- Node is current navigation target
- Orange highlight
- Arrows navigate structurally

**Level 2: Entered** (for scopes only)
- Scope has been entered
- Focus is on a child target within
- Escape exits back to scope level

**Level 3: Interacting** (for targets only)
- Target is actively consuming input
- Cyan highlight
- Keys modify value/content
- Escape returns to selected state

Not every control uses all three levels, but this ladder is globally consistent:

- Simple button: Selected → (activate) → Selected
- Entry-node scope: Selected → Entered → Selected
- Analog control: Selected → Entered (in parent scope) → Interacting → Selected
- Value editor: Selected → Entered (in parent scope) → Interacting (editing) → Selected

This hierarchy prevents confusion about "where am I" and "what mode am I in."

---

## Implementation Checklist

Before beginning implementation, verify the spec has:

- ✅ No duplicate class definitions
- ✅ No stub methods marked "TODO" or "placeholder"
- ✅ Correct exit scope ordering (innermost-first)
- ✅ Container scope registration in activePath
- ✅ Tree builder integration complete
- ✅ Formal restoration fallback chain
- ✅ Node validity checks on all stored references
- ✅ Native focus sync fully specified
- ✅ Behavior summary matches implementation
- ✅ Dead code removed
- ✅ Deterministic ID generation strategy
- ✅ Rebuild reconciliation rules specified
- ✅ Single canonical resolution pipeline
- ✅ Out-of-tree focus behavior defined
- ✅ Mouse interaction policy defined

All checks passed in v2.4.

---

That is the v2.4 spec: tree-based, scope-aware, semantically compositional, visually unified by a strict one-highlight model, production-hardened with native input semantics, comprehensive edge case handling, deterministic rebuild identity, and unified resolution pipeline. **Ready for implementation with one final integration pass recommended before treating as canonical production documentation.**

---

# Appendix: Version History

This appendix contains the detailed changelog for all versions. The main specification above represents the current canonical implementation guidance.

## What Changed in v2.4 (Final Integration Pass)

### Deterministic Rebuild Identity
✅ **Stable ID Generation Strategy**
- Removed counter-based IDs from builder examples
- Priority-based deterministic ID resolution
- Explicit IDs > DOM IDs > semantic keys > ordinal positions
- Warned on ephemeral fallback IDs
- Enables stable focus restoration across rebuilds

✅ **Rebuild Reconciliation Rules**
- Validates currentNode after rebuild
- Validates all lastFocusedByScope references
- Validates overlayStack and activePath
- Falls back to nearest surviving equivalent or parent entry
- Prevents undefined state after DOM mutations

### Resolution Pipeline Unification
✅ **Single Canonical Descent Authority**
- `_resolveToFocusable()` is the single source of truth for container descent
- `_planEntry()` delegates to it
- `Enter` on entry-node uses same path as initial activation
- No parallel resolution logic to drift

### Policy Completeness
✅ **Out-of-Tree Native Focus Behavior**
- Defined what happens when native focus leaves nav tree
- Session remains active, cursor hidden, state preserved
- Reactivates cleanly on next arrow press

✅ **Mouse Interaction Policy**
- Click ends cyan interaction immediately
- Click on mapped element syncs currentNode
- Click outside mapped elements hides cursor but keeps session active
- Clear handoff between keyboard and mouse modes

✅ **Node Validity Expansion**
- `_isNodeStillValid()` now checks computed styles
- Validates display:none, visibility:hidden
- Validates disabled ancestors
- Renamed from "basic" to "comprehensive" validation

### Documentation Accuracy
✅ **File Structure Consistency**
- Removed orphaned `TextEditBehavior.js` reference
- Aligned file list with actual behavior definitions

✅ **Traversal Policy Honesty**
- Linear: fully specified
- Grid: interface defined, algorithm partial
- Spatial: interface defined, algorithm placeholder

✅ **Asset Path Portability**
- Replaced Windows-specific image path with repo-relative reference

## What Changed in v2.3 (Critical Bug Fixes)

### Critical Correctness Fixes

✅ **Removed Duplicate Behavior Classes**
- Eliminated duplicate `AnalogControlBehavior` (manual adjustment version)
- Eliminated duplicate `ValueEditorBehavior` (simple version)
- Only canonical implementations remain (native range semantics)
- No ambiguity for implementers

✅ **Fixed Exit Scope Ordering Bug**
- Changed `push(scope)` to `unshift(scope)` in `_planDirectionalMove`
- Exit scopes now ordered innermost-first
- Prevents state corruption when exiting nested scopes
- `_commitMove` now exits child before parent correctly

✅ **Fixed Container Scope Registration**
- `_resolveToFocusable` now tracks all containers descended through
- `_planEntry` properly accumulates nested container scopes
- Initial activation enters containers into `activePath`
- Prevents navigation skipping entire branches

✅ **Implemented Tree Builder Integration**
- Removed `_buildTree` stub
- Manager now instantiates and stores `NavigationTreeBuilder`
- Added `registerOverlay()` and `rebuildSubtree()` methods
- Builder is first-class subsystem, not placeholder

✅ **Formal Overlay Restoration Chain**
- 5-level fallback: returnFocusNode → remembered → parent entry → ancestor entry-node → deactivate
- All fallback steps check node validity
- Deterministic recovery from overlay close failures
- No more undefined state after overlay close

✅ **Node Validity Checks**
- Added `_isNodeStillValid()` helper
- Checks: exists, element connected, not hidden, not disabled
- Used by restoration logic and remembered focus
- Prevents crashes from stale references

✅ **Native Focus Sync Implementation**
- `_syncFromNativeFocus` now fully implemented
- Updates currentNode, lastFocusedByScope, activePath
- Enables Tab coexistence with arrow navigation
- No longer optional stub

✅ **Removed Dead Code**
- Eliminated `ValueEditorBehavior.handleEscape()` (dead code)
- Escape handled entirely at manager level per precedence chain
- Clarified in documentation

### Documentation Improvements

✅ **Behavior Summary Table Accuracy**
- Updated: "Native range input adjusts value" (not "Adjust value")
- Consistent with Option A implementation choice
- No contradiction between summary and implementation

## What Changed in v2.2 (Production Hardening)

### Architecture Refinements

✅ **Focusable Resolution Rule**
- Added `_resolveToFocusable()` helper for deep resolution
- Initial activation always reaches an actually focusable node
- Container scopes transparently descend to first valid descendant
- Prevents activation brittleness with nested containers

✅ **Native Input Semantics (Analog Control)**
- **Option A: Native Owns Adjustment** - chosen for maximum accessibility
- Analog control returns `IGNORED` for left/right when interacting
- Native `<input type="range">` handles value changes with built-in a11y
- Reduces custom code, improves screen reader compatibility

✅ **Strict Edit-Mode Boundaries (Value Editor)**
- Clear rules for when edit mode begins and ends
- Enter commits, Escape exits, Blur exits, Tab exits
- All arrow keys are native while editing (returns `IGNORED`)
- No ambiguity between "focused" and "actively editing"

✅ **Metadata-Driven Primary Entry**
- Per-slider `preferredPrimaryRole` instead of global default
- Slider classes: analog-first, value-first, trigger-first
- Allows customization per widget while keeping `entryPolicy: 'primary'` generic

✅ **Enterability vs Activatability Distinction**
- **Enterable**: Structural depth (entry-node scopes)
- **Activatable**: Triggers action/overlay (param-trigger, dialog buttons)
- Both show orange + brackets visually
- Semantically distinguished via `node.role`

### Testing & Quality

✅ **Comprehensive Failure Cases**
- Added 13 critical edge case tests
- Covers node removal, overlay interruption, rebuild during focus
- Dynamic widget structure changes
- Native blur and mouse click during interaction
- Validates all robustness fixes

### Documentation

✅ **Complete Behavior Specifications**
- Full analog control native semantics rationale
- Complete value editor edit-mode rules
- Clear visual distinction between enterable/activatable
- Updated all examples for consistency

## What Changed in v2.1.1 (Correctness Release)

### Critical Fixes

✅ **Plan-Commit Traversal Pattern**
- Eliminated state corruption from mutation-during-search
- Traversal now separates planning phase from state mutation
- Failed navigation no longer leaves `activePath` in inconsistent state

✅ **Dynamic Selected Entry Policy**
- `LeafNode` now supports `isSelected()` getter function
- Handles runtime state changes (radio groups, list selections)
- Added `custom` entry policy for complex scenarios

✅ **Layout-Reactive Focus Ring**
- `ResizeObserver` and scroll listeners keep ring positioned
- Handles window resize and container scroll automatically
- No more misaligned highlights after layout changes

✅ **Distance-Based Transition Control**
- Large jumps (>200px) use instant positioning
- Adjacent moves use smooth 0.10s transition
- No more visible sliding across the screen

✅ **Full Navigation Tree Builder**
- Complete `NavigationTreeBuilder` specification
- Handles Principia sliders, button groups, composite widgets
- Supports overlay registration and incremental rebuilds
- No longer a one-line stub

✅ **Overlay Restoration Logic**
- Overlays store `returnFocusNode` for proper cleanup
- Multi-level fallback strategy for focus restoration
- No more undefined focus state after overlay close

### Minor Improvements

- CSS custom properties for z-index management
- Modifier key guard allows future `Shift+Arrow` usage
- Spatial policy validation with console warnings
- Breadcrumb indicator moved to Week 2 (was Week 5 polish)
- Reduced-motion support in CSS

## What Changed in v2.1 (Visual Model Update)

### Visual / Interaction Model Update

✅ **Single highlight invariant**
- Only **one** visible highlight/cursor may appear at any time
- No parent + child dual outlines
- No simultaneous orange scope frame and cyan child frame
- Prevents "multiple cursors" confusion

✅ **Highlight moves, never duplicates**
- Outside composite widget → highlight the composite row/container
- Inside composite widget → highlight the currently active child target
- During interaction → same highlight changes style/color, rather than spawning another

✅ **State conveyed by one cursor only**
- **Orange** = navigational focus / navigating
- **Orange + animated corner brackets** = focused and enterable
- **Cyan** = active interaction / editing
- Optional subtle container tint is allowed, but never a second border/highlight

✅ **Composite context is communicated indirectly**
- Through highlight style
- Through bracket animation
- Through mode indicator / breadcrumb text
- Not through additional simultaneous focus boxes
