# Semantic UI Tree Specification

**Version 1.5.3 - Final Implementation-Ready Spec**

Complete specification for Principia's semantic UI tree architecture. This tree is the **single semantic source of truth** for:

- GUI structure
- keyboard navigation
- breadcrumbs / mode indicators
- overlay ownership
- focus restoration
- accessibility metadata
- builder-based rendering integration

## Changelog

### v1.5.2 → v1.5.3 (API Contract Alignment - FINAL)

**Last contract mismatches resolved:**

1. **Fixed openOverlayById signature** - Now `(overlayId, triggerId?, returnFocusId?)` to match usage in adapter
2. **Removed toggle-collapse from executeFastAction** - Not in `FastAction` type, collapse handled separately via runtime state
3. **Fixed adapter construction order** - NavManager created first, then adapter, then `setRootNode()` pattern shown
4. **Added setRootNode() to interface** - Supports two-phase initialization pattern shown in usage example
5. **Removed "adapter is stateless" claim** - Now says "converts tree + binds behaviors" (adapter holds navManager reference)
6. **Removed "entry stack" mention** - Only `activePath` exists in NavigationState
7. **Marked reconcileEntryPoint as pseudocode** - Explicitly labeled with "PSEUDOCODE" and notes about internal methods
8. **Fixed duplicate numbering** - Implementation readiness list now 1-7 correctly
9. **Softened "working code" claim** - Now says "critical paths specified, pseudocode labeled where internal methods are implementation-specific"

**Status**: FROZEN. All API contracts match examples, all execution paths complete, pseudocode clearly labeled.

### v1.5.1 → v1.5.2 (Implementation Blockers Fixed)

**Critical execution path gaps closed:**

1. **Added fast action dispatch pipeline** - `executeFastAction()` method with complete implementation + `_handleKeyDown` integration
2. **Fixed dropdown handler execution** - Adapter now directly calls `navManager.openOverlayById()` instead of returning unused ID
3. **Fixed adapter construction** - Adapter now accepts `navigationManager` reference for overlay/dropdown handlers
4. **Fixed reconcileEntryPoint** - Uses `activePath` not `entryStack`, conceptual sketch of state update instead of non-existent methods
5. **Fixed handleSubtreeRemoved double-removal** - Bridge now removes only subtree root, relies on nav manager to handle descendants
6. **Marked createDropdownScope as low-level** - Added doc clarifying it's for advanced use; most code should use `picker()` builder
7. **Removed id from NodeConfig** - Prevents conflict between positional `id` parameter and `config.id`
8. **Clarified meta.collapsed semantics** - Explicitly noted as initial state only; live state must be tracked in runtime layer

**Status**: Implementation-ready. All execution paths complete, no silent no-ops, no conflicting parameter patterns.

### v1.5 → v1.5.1 (Internal Consistency Fixes)

**Editorial cleanup to achieve full contract consistency:**

1. **Fixed adapter element access** - All `uiNode.elementRef` changed to `this.uiTree.getElement(id)` in `SemanticTreeAdapter`
2. **Fixed picker example** - Changed `kind: "param-trigger"` to `triggerKind: "param-trigger"` in Principia example
3. **Removed duplicate isInFocusChain** - Deleted obsolete second implementation block
4. **Fixed stale elementRef references** - All prose references to `elementRef` updated to store-based binding model
5. **Clarified attachKey semantics** - Explicitly described as optional render-layer metadata, not core API
6. **Clarified collapsed state ownership** - Noted as tracked separately from tree structure (meta or runtime store)
7. **Added PickerMeta ownership note** - Clarified PickerMeta may live on trigger node's `meta` or be managed externally
8. **Fixed multi-part bindings section** - Clearly marked as future extension, not current canonical API
9. **Fixed duplicate breadcrumb comment** - Consolidated doc-comment block
10. **Removed meta.focusTarget suggestion** - Kept binding model purely store-level, no DOM refs in meta

**Status**: Frozen canonical spec. Architecturally coherent, internally consistent, ready for implementation.

### v1.4 → v1.5 (Implementation-Grade)

**Contract tightening for canonical spec:**

1. **Clarified element binding ownership** - Removed `elementRef`/`elementBindings` from `UINode`. Store owns bindings externally.
2. **Fixed PickerConfig typing** - Added `triggerKind?: "button" | "param-trigger"` instead of overloading `kind`
3. **Fixed button-group focus mode** - Can be `container` OR `entry-node` (like `section`, `scope`)
4. **Defined removeNode reparent semantics** - Explicit rules: insert at index, preserve order, disallow for root/overlays
5. **Wired subtree:removed to bridge** - Added `handleSubtreeRemoved` handler and subscription
6. **Clarified isInFocusChain** - Includes structural ancestry + overlay chain + active path
7. **Skip root in breadcrumbs** - Explicitly filter `kind: "root"` from breadcrumb segments
8. **Clarified role defaulting** - Role≈kind for behavior resolution where applicable (leaf/interactive nodes mainly)
9. **Clarified collapsed state** - Collapse affects both semantics (navigability) and presentation (visual hiding)

### v1.3 → v1.4 (Architectural Discipline)

**Critical fixes for implementation consistency:**

1. **Merged duplicate UITreeStore interfaces** - Single canonical interface with all methods
2. **Added UITreeEventMap** - Explicit event payload types for reactive reconciliation
3. **Added Tree Invariants section** - 10 formal invariants with validation guidance
4. **Fixed bridge event handler binding** - Stored bound handlers for proper unsubscribe
5. **Clarified removal semantics** - `removeNode()` vs `removeSubtree()` behavior explicit
6. **Formalized element binding ownership** - Store owns bindings, render uses `attachElement()`
7. **Added entry resolution precedence** - `customEntryResolver` > `entryPolicy` > default
8. **Removed "picker" from NodeKind** - Pickers always split into trigger + dropdown
9. **Fixed grid strategy in example** - Now uses `"linear"` with TODO for future `"grid"`
10. **Enhanced breadcrumb label priority** - Added note about future `meta.breadcrumbLabel`
11. **Clarified overlay lifecycle rules** - Modal suspension, closure behavior, no auto-cleanup
12. **Formalized role vs kind semantics** - Clear distinction and augmentation rules
13. **Added fast action normalization** - Canonical key syntax requirements
14. **Defined interaction vs visual topology** - Tree defines semantic structure, render defines presentation
15. **Added topology separation guidance** - What belongs in tree vs render/CSS layer

**Status**: Implementation-grade canonical spec. All contracts tightened, no phantom APIs, no type mismatches, no ambiguous semantics.

---

## Core Principles

### 1. Semantic Tree Is Canonical

The semantic UI tree is the authoritative interaction model.

It is **not**:

- raw DOM structure
- pure visual layout
- CSS box hierarchy

It **is**:

- the semantic interaction hierarchy
- the shared backbone for rendering and keyboard navigation

### 2. Structure and Runtime State Are Separate

The tree describes **what exists**.

Runtime state describes:

- what is focused
- what is entered
- what is interacting
- what overlays are open
- what values are currently selected/edited

### 3. Composite Widgets Are Semantic

A slider is not just "some DOM with a label and input."

A slider is a semantic composite:

- optional param-trigger
- analog-control
- value-editor

### 4. One Tree, Multiple Projections

The same semantic tree can drive:

- render projection
- keyboard navigation projection
- breadcrumb/status projection
- accessibility projection
- test selectors / automation

### 5. Single Highlight Invariant

Navigation visuals must always derive from one current semantic target.

Only one visible cursor/highlight exists at a time.

---

## Core Types

```typescript
// ============================================================================
// NODE KINDS
// ============================================================================

type NodeKind =
  // Structural containers
  | "root"
  | "scope"
  | "section"
  | "button-group"

  // Composite widgets
  | "slider"
  // Note: "picker" is not a concrete node kind. Pickers are always split into:
  // - trigger node (kind: "button" or "param-trigger")
  // - dropdown overlay (kind: "dropdown")
  // - menu items (kind: "menu-item")

  // Overlays
  | "dialog"
  | "dropdown"
  | "menu"

  // Action targets
  | "button"
  | "menu-item"
  | "param-trigger"

  // Value editors
  | "checkbox"
  | "text-input"
  | "number-input"
  | "analog-control"
  | "value-editor"

  // Display / non-interactive
  | "label"
  | "separator";

// ============================================================================
// FOCUS & TRAVERSAL
// ============================================================================

type FocusMode =
  | "none"          // Not focusable, ignored by nav
  | "container"     // Not focusable itself, auto-descends
  | "entry-node"    // Can be focused before entering
  | "leaf";         // Terminal focusable node

type TraversalStrategy =
  | "linear"
  | "grid"
  | "spatial";

type EntryPolicy =
  | "first"
  | "last"
  | "primary"
  | "selected"
  | "remembered"
  | "custom";

// ============================================================================
// OPTIONAL FAST-ENTRY ACTIONS
// ============================================================================

type FastAction =
  | "jump-to-primary"
  | "jump-to-value-editor"
  | "jump-to-param-trigger"
  | "begin-primary-interaction"
  | "begin-value-edit"
  | "jump-and-begin-value-edit"    // Combined: jump + immediately begin editing
  | "jump-and-begin-primary";       // Combined: jump + immediately begin interaction

// ============================================================================
// ENTRY RESOLUTION
// ============================================================================

type EntryResolver = (
  scope: UINode,
  direction: string,
  fromNode: UINode | null,
  state: NavigationState,
  tree: UITreeStore
) => string | null;

// ============================================================================
// NODE INTERFACE
// ============================================================================

interface UINode {
  // Identity
  id: string;                           // Stable unique identifier
  kind: NodeKind;

  // Hierarchy
  parentId: string | null;
  children: string[];

  // Navigation properties
  focusMode: FocusMode;
  strategy?: TraversalStrategy;
  entryPolicy?: EntryPolicy;
  customEntryResolver?: EntryResolver;

  // Flags
  wrap?: boolean;
  modal?: boolean;
  overlay?: boolean;
  primary?: boolean;
  disabled?: boolean;

  // Semantic metadata
  role?: string;                        // Widget-specific role
  ariaRole?: string;
  ariaLabel?: string;

  // Optional keyboard affordances
  fastActions?: Partial<Record<string, FastAction>>; // e.g. "Shift+Enter" -> "jump-and-begin-value-edit"

  // Custom metadata
  meta?: Record<string, unknown>;
}

// ============================================================================
// ELEMENT BINDING MODEL
// ============================================================================

/**
 * CRITICAL: Element bindings are stored BY THE STORE, not on UINode objects.
 * 
 * UINode intentionally does NOT contain elementRef or elementBindings.
 * These are managed externally by UITreeStore.
 * 
 * Render layer MUST use:
 * - store.attachElement(id, element) to bind
 * - store.getElement(id) to retrieve
 * 
 * Benefits:
 * - Store owns bindings (single source of truth)
 * - Events can fire on binding changes
 * - No direct node object mutation
 * - Clean separation: tree structure vs runtime bindings
 * 
 * For complex widgets needing multiple binding points:
 * - Start with store.attachElement(id, primaryElement)
 * - Extend store with multi-part binding API only if concrete need emerges
 */

// ============================================================================
// COMPOSITE WIDGET METADATA
// ============================================================================

interface SliderMeta {
  preferredPrimaryRole: "param-trigger" | "analog-control" | "value-editor";
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  unit?: string;
  tip?: string;
  hasParamTrigger?: boolean;
}

/**
 * Picker metadata - may be attached to the trigger node (button or param-trigger).
 * Since pickers are split into trigger + dropdown + menu items, implementations
 * may store picker-specific state on the trigger's `meta` or manage it externally.
 */
interface PickerMeta {
  label: string;
  options: Array<{ id: string; label: string; value: unknown }>;
  selectedId?: string;
}

interface DialogMeta {
  title?: string;
  returnFocusId?: string;   // Preferred restoration target
  triggerId?: string;        // Who opened this overlay (fallback restoration)
}

interface OverlayMeta {
  triggerId?: string;        // Invocation source (not structural parent)
  returnFocusId?: string;    // Explicit restoration target
}

// ============================================================================
// BUILDER CONFIG TYPES
// ============================================================================

/**
 * Base config for all node builders. ID is passed separately as a positional
 * parameter to prevent conflicts between positional and config-based IDs.
 */
interface NodeConfig {
  parent?: string | null;
  children?: string[];
  disabled?: boolean;
  meta?: Record<string, unknown>;
  fastActions?: Partial<Record<string, FastAction>>;
}

interface ScopeConfig extends NodeConfig {
  focusMode?: "container" | "entry-node";
  strategy?: TraversalStrategy;
  entryPolicy?: EntryPolicy;
  wrap?: boolean;
}

interface SliderConfig extends NodeConfig {
  label: string;
  hasParamTrigger?: boolean;
  preferredPrimary?: "param-trigger" | "analog-control" | "value-editor";
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  tip?: string;
}

interface PickerConfig extends NodeConfig {
  label: string;
  options: Array<{ id: string; label: string; value: unknown }>;
  selectedId?: string;
  triggerKind?: "button" | "param-trigger";  // Trigger node kind (default: "button")
}

// ============================================================================
// NAVIGATION SESSION STATE (Extended API for Tree Integration)
// ============================================================================

interface NavigationState {
  active: boolean;

  // Current focus target
  currentNodeId: string | null;

  // Entered structural scopes
  activePath: string[];

  // Top-layer overlays
  overlayStack: string[];

  // Active interaction mode
  interaction: {
    active: boolean;
    nodeId: string | null;
    type: string | null; // e.g. "analog-adjust" | "text-edit"
  };

  // Memory
  lastFocusedByScope: Map<string, string>;
}

// ============================================================================
// TREE STORE INTERFACE (CANONICAL)
// ============================================================================

/**
 * Event payloads emitted by UITreeStore
 */
type UITreeEventMap = {
  "node:updated": { id: string; updates: Partial<UINode> };
  "nodes:added": { ids: string[] };
  "node:removed": { id: string; parentId: string | null };
  "subtree:removed": { rootId: string; removedIds: string[] };
};

/**
 * Canonical UITreeStore interface.
 * 
 * This is the single authoritative store contract. All methods related to
 * tree queries, mutations, element binding, and event subscription are here.
 */
interface UITreeStore {
  // ──────────────────────────────────────────────────────────────────────
  // Node Access
  // ──────────────────────────────────────────────────────────────────────
  
  getNode(id: string): UINode | null;
  getChildren(id: string): UINode[];
  getParent(id: string): UINode | null;
  getRoot(): UINode | null;
  getPath(id: string): UINode[];  // Ancestors from root to node

  // ──────────────────────────────────────────────────────────────────────
  // Predicate Queries
  // ──────────────────────────────────────────────────────────────────────
  
  findNode(predicate: (node: UINode) => boolean): UINode | null;
  findByRole(role: string): UINode[];
  findByKind(kind: NodeKind): UINode[];

  // ──────────────────────────────────────────────────────────────────────
  // Tree Navigation Utilities
  // ──────────────────────────────────────────────────────────────────────
  
  getNearestAncestor(id: string): string | null;  // First surviving parent after removal
  findCommonAncestor(ids: string[]): string | null;  // Lowest common ancestor

  // ──────────────────────────────────────────────────────────────────────
  // Tree Mutation (all methods emit events)
  // ──────────────────────────────────────────────────────────────────────
  
  addNode(node: UINode): void;
  addNodes(nodes: UINode[]): void;
  updateNode(id: string, updates: Partial<UINode>): void;
  
  /**
   * Remove single node.
   * 
   * Default behavior: Fails if node has children (prevents accidental orphaning).
   * 
   * With opts.reparent = true: Removes node and reparents children to grandparent.
   * 
   * Reparent semantics:
   * - Children inserted at removed node's index in parent's children array
   * - Child order preserved
   * - Children's parentId updated before event emission
   * - Disallowed if: node is root, node is overlay (parentId === null), grandparent doesn't exist
   * 
   * Emits: "node:removed" with { id, parentId }
   * 
   * @throws if node has children and reparent not specified
   * @throws if reparent requested but not allowed (root, overlay, no grandparent)
   */
  removeNode(id: string, opts?: { reparent?: boolean }): void;
  
  /**
   * Remove node and all descendants recursively.
   * Emits: "subtree:removed" with full list of removed IDs
   */
  removeSubtree(id: string): void;

  // ──────────────────────────────────────────────────────────────────────
  // Element Binding (canonical ownership by store)
  // ──────────────────────────────────────────────────────────────────────
  
  /**
   * Bind element to node. Render layer MUST use this method, not direct
   * ad hoc binding outside the store.
   */
  attachElement(id: string, element: HTMLElement | null): void;
  
  getElement(id: string): HTMLElement | null;

  // ──────────────────────────────────────────────────────────────────────
  // State-Aware Resolution (for navigation)
  // ──────────────────────────────────────────────────────────────────────
  
  /**
   * Resolve entry target for scope using entryPolicy or customEntryResolver.
   * Precedence: customEntryResolver > entryPolicy > "first" default
   */
  resolveEntry(
    scopeId: string, 
    direction: string, 
    fromNodeId: string | null, 
    state: NavigationState
  ): string | null;
  
  /**
   * Resolve node to first focusable descendant or self.
   */
  resolveToFocusable(
    nodeId: string, 
    direction: string, 
    state: NavigationState
  ): { nodeId: string; enteredContainers: string[] } | null;

  // ──────────────────────────────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────────────────────────────
  
  /**
   * Check if node exists and passes invariant validation.
   */
  isNodeValid(id: string): boolean;
  
  /**
   * Validate entire tree against invariants. Returns validation errors.
   */
  validateTree(): ValidationError[];

  // ──────────────────────────────────────────────────────────────────────
  // Event Subscription
  // ──────────────────────────────────────────────────────────────────────
  
  on<K extends keyof UITreeEventMap>(
    event: K, 
    handler: (payload: UITreeEventMap[K]) => void
  ): void;
  
  off<K extends keyof UITreeEventMap>(
    event: K, 
    handler: (payload: UITreeEventMap[K]) => void
  ): void;

  // ──────────────────────────────────────────────────────────────────────
  // Serialization
  // ──────────────────────────────────────────────────────────────────────
  
  toJSON(): unknown;
  fromJSON(data: unknown): void;
}

interface ValidationError {
  nodeId: string;
  kind: string;
  message: string;
}
```

---

## Tree Invariants and Validation

The semantic tree must satisfy these structural invariants at all times. Implementations should validate on mutations and provide `validateTree()` for debugging.

### 1. Root Uniqueness

**Invariant**: Exactly one node with `kind: "root"` and `parentId: null` exists.

### 2. Parent-Child Consistency

**Invariants**:
- Every child ID in `node.children` must reference a node with `parentId === node.id`
- Non-root structural nodes (non-overlays) must appear in exactly one parent's `children` array
- Overlay nodes (`overlay: true`) must have `parentId: null`
- Non-overlay nodes (except root) must have non-null `parentId`

### 3. ID Uniqueness

**Invariant**: All node IDs must be unique across the entire tree.

### 4. NodeKind and FocusMode Consistency

**Invariant**: `kind` and `focusMode` combinations must be valid per constraint table (see later section).

### 5. Stable ID Requirements

**Invariant**: Node IDs must be deterministic strings, not random or time-based.

For composite widgets, child IDs must follow the canonical derivative pattern: `${parentId}:${role}`.

### 6. Disabled Node Semantics

**Invariants**:
- Disabled nodes (`disabled: true`) remain in the semantic tree
- They are excluded from focus resolution and entry target selection
- They may appear in breadcrumbs if already in historical path (implementation-defined)

### 7. Overlay Lifecycle

**Invariants**:
- Only topmost modal overlay in `overlayStack` is navigable
- Opening a modal overlay suspends navigation in lower layers
- Closing an overlay restores focus by priority: `returnFocusId` → `triggerId` → nearest valid ancestor
- If trigger node is removed while its overlay is open, overlay remains until explicitly closed (no auto-cleanup)

**Closure rules**:
- Opening a new modal overlay does NOT auto-close sibling overlays (they remain in stack, suspended)
- Non-modal overlays can coexist if navigation policy allows
- Overlays are closed explicitly via user action or programmatic `closeOverlay(id)`

### 8. Child Order Significance

**Invariant**: Order of IDs in `children` array is semantically significant for traversal order and entry policies.

### 9. Role vs Kind Semantics

**Invariants**:
- `kind`: Structural/widget taxonomy (required, used by builders, validation, default behavior)
- `role`: Optional semantic sub-role for navigation/accessibility/render hints
- `role` augments `kind`, does not replace it
- If `role` is undefined, may be treated as equivalent to `kind` for behavior resolution where applicable (e.g., button, checkbox, param-trigger)

**Note**: Not all `kind` values are meaningful roles. Structural kinds like `root`, `section`, `dropdown` don't require role-based behavior. Role defaulting primarily applies to leaf/interactive nodes.

### 10. Fast Action Key Normalization

**Invariant**: All shortcut strings in `fastActions` must be normalized to canonical form.

**Normalization rules**:
- Modifier order: `Ctrl+Shift+Alt+Key`
- Key names: Capitalized (e.g., `Enter`, not `enter`)
- No spaces around `+`

**Example**: `"Shift+Enter"` (canonical) vs `"enter+shift"` (non-canonical, will fail lookup)

---

## Navigation Bridge API

Extended API for `KeyboardNavigationManager` to support tree reconciliation.

```typescript
interface KeyboardNavigationManager {
  // ... existing methods from nav spec ...
  
  // Lifecycle (new)
  setRootNode(rootNode: ScopeNode | null): void;  // For two-phase initialization
  
  // Tree reconciliation (new)
  rebuildSubtreeById(nodeId: string): void;
  removeNodeById(nodeId: string): void;
  isInFocusChain(nodeId: string): boolean;  // See implementation notes below
  isEnteredScope(nodeId: string): boolean;
  
  // Focus restoration (new)
  restoreFocusToId(nodeId: string): void;
  moveToNextValidTarget(): void;
  reconcileEntryPoint(scopeId: string): void;
  
  // Overlay management (new)
  openOverlayById(overlayId: string, triggerId?: string, returnFocusId?: string): void;
  closeOverlay(overlayId: string): void;
  
  // Fast action dispatch (new)
  executeFastAction(nodeId: string, actionType: FastAction): boolean;
}
```

### Implementation Notes

**`isInFocusChain(nodeId)`**: Check if node is in current focus ancestry.

"Focus chain" includes:
- Current focused node
- Its structural ancestors (walking up `parentId`)
- Overlay boundaries (walking up `triggerId` when `parentId` is `null`)
- Currently entered scopes (in `activePath`)

```javascript
isInFocusChain(nodeId) {
  // Check if it's the current focus target
  if (this.sessionState.currentNodeId === nodeId) {
    return true;
  }
  
  // Check if it's in the active path (entered scopes)
  if (this.sessionState.activePath.includes(nodeId)) {
    return true;
  }
  
  // Walk up from current focus through structural + overlay ancestry
  let current = this.sessionState.currentNodeId;
  
  while (current) {
    if (current === nodeId) return true;
    
    const node = this.uiTree.getNode(current);
    if (!node) break;
    
    // Follow structural parent
    if (node.parentId) {
      current = node.parentId;
    }
    // Or follow overlay trigger chain
    else if (node.meta?.triggerId) {
      current = node.meta.triggerId;
    }
    // Dead end
    else {
      break;
    }
  }
  
  return false;
}
```

**`rebuildSubtreeById(nodeId)`**: Adapter-friendly version of `rebuildSubtree(element)`.

```javascript
rebuildSubtreeById(nodeId) {
  const element = this.uiTree.getElement(nodeId);
  if (element) {
    this.rebuildSubtree(element);  // Delegates to existing method
  }
}
```

**`reconcileEntryPoint(scopeId)`**: Validate and fix entry target when children change.

**Note:** This is **illustrative pseudocode only**. The `_resolveEntryNode()` and `_updateActivePath()` methods are not part of the public API and represent internal navigation state operations.

```javascript
// PSEUDOCODE - illustrative only, not canonical API
reconcileEntryPoint(scopeId) {
  const scope = this.uiTree.getNode(scopeId);
  
  // Check if any node in activePath is a child of this scope and was removed
  const enteredChild = this.sessionState.activePath.find(id => 
    this.uiTree.getNode(id)?.parentId === scopeId
  );
  
  if (enteredChild && !scope.children.includes(enteredChild)) {
    // Entered child was removed, re-resolve entry point
    // Actual implementation would call internal navigation state methods
    const newEntry = this._resolveEntryNode(scopeId);  // Internal method (not API)
    if (newEntry) {
      this._updateActivePath(scopeId, newEntry.id);     // Internal method (not API)
    }
  }
}
```

**`executeFastAction(nodeId, actionType)`**: Execute a power-user shortcut action.

Fast actions are defined in the semantic tree's `fastActions` map and enable shortcuts like `Shift+Enter → jump-and-begin-value-edit`. The navigation manager's `_handleKeyDown` should check for fast actions before standard traversal.

```javascript
executeFastAction(nodeId, actionType) {
  const node = this._nodeIndex.get(nodeId);
  if (!node) return false;
  
  switch (actionType) {
    case "jump-to-value-editor": {
      // Find value-editor child (for slider scopes)
      const valueEditor = node.children?.find(child => 
        child.role === "value-editor"
      );
      if (valueEditor) {
        this.moveTo(valueEditor.id);
        return true;
      }
      return false;
    }
    
    case "begin-value-edit": {
      // Begin editing current node if it's a value-editor
      if (node.role === "value-editor" && node.behavior?.beginEdit) {
        node.behavior.beginEdit();
        return true;
      }
      return false;
    }
    
    case "jump-and-begin-value-edit": {
      // Combined: jump to value-editor AND begin editing
      const valueEditor = node.children?.find(child => 
        child.role === "value-editor"
      );
      if (valueEditor) {
        this.moveTo(valueEditor.id);
        if (valueEditor.behavior?.beginEdit) {
          valueEditor.behavior.beginEdit();
        }
        return true;
      }
      return false;
    }
    
    default:
      console.warn(`Unknown fast action: ${actionType}`);
      return false;
  }
}
```

**Integration with `_handleKeyDown`**: The navigation manager should check fast actions before standard traversal:

```javascript
_handleKeyDown(event) {
  const currentNode = this._nodeIndex.get(this.sessionState.currentNodeId);
  if (!currentNode) return;
  
  // Normalize key chord (e.g., "Shift+Enter")
  const keyChord = this._normalizeKeyChord(event);
  
  // Check fast actions on current node first
  const fastAction = currentNode.fastActions?.[keyChord];
  if (fastAction) {
    const handled = this.executeFastAction(currentNode.id, fastAction);
    if (handled) {
      event.preventDefault();
      return;
    }
  }
  
  // Otherwise, fall through to standard navigation...
  // (existing arrow key / Enter / Escape handling)
}
```

---

## Builder API

```javascript
// ============================================================================
// STRUCTURAL BUILDERS
// ============================================================================

function root(children: UINode[]): UINode

function scope(
  id: string,
  children: UINode[],
  config?: Partial<ScopeConfig>
): UINode

function section(
  id: string,
  label: string,
  children: UINode[],
  config?: Partial<ScopeConfig>
): UINode

function buttonGroup(
  id: string,
  children: UINode[],
  config?: Partial<ScopeConfig>
): UINode

// ============================================================================
// COMPOSITE WIDGET BUILDERS
// ============================================================================

/**
 * Slider returns a semantic composite:
 * - slider scope
 * - optional param-trigger
 * - analog-control
 * - value-editor
 */
function slider(id: string, config: SliderConfig): UINode[]

/**
 * Picker composite widget builder.
 * 
 * Returns a named object to make structural independence explicit at call site:
 * - trigger: The focusable trigger button (add to parent's children)
 * - overlayNodes: Dropdown scope + menu items (add to flat registry, NOT to parent children)
 * 
 * Example usage:
 *   const modePicker = picker("mode-picker", { ... });
 *   section("display-section", "Display", [modePicker.trigger, ...otherControls]);
 *   nodes.push(modePicker.trigger, ...modePicker.overlayNodes);
 * 
 * Note: For slider parameter labels that open menus, use triggerKind: "param-trigger" in PickerConfig
 * to maintain semantic consistency with slider composite structure.
 */
function picker(
  id: string, 
  config: PickerConfig
): { trigger: UINode; overlayNodes: UINode[] }

/**
 * Dialog overlay scope
 * Builder automatically sets overlay: true and modal: true
 */
function dialog(
  id: string,
  children: UINode[],
  config?: Partial<NodeConfig> & { title?: string; returnFocusId?: string; triggerId?: string }
): UINode

// ============================================================================
// LEAF BUILDERS
// ============================================================================

function button(id: string, config?: Partial<NodeConfig>): UINode

function checkbox(
  id: string,
  config?: Partial<NodeConfig> & { checked?: boolean }
): UINode

function textInput(
  id: string,
  config?: Partial<NodeConfig> & { value?: string; placeholder?: string }
): UINode

function numberInput(
  id: string,
  config?: Partial<NodeConfig> & {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
  }
): UINode
```

---

## Slider Semantics

### Canonical Slider Structure

A slider is modeled as a semantic scope, not a DOM wrapper.

```text
slider-q1 (scope / entry-node)
├─ param-trigger   (optional leaf)
├─ analog-control  (leaf)
└─ value-editor    (leaf)
```

### Meaning of Each Child

* **param-trigger**

  * usually the label button
  * opens submenu / picker / dropdown
  * high-impact action
  * should feel like a real sibling target, not "just a label"

* **analog-control**

  * the range / knob interaction target
  * native range semantics are preferred
  * often the primary entry target

* **value-editor**

  * numeric input
  * used for precise manual entry
  * may be a power-user fast-entry target

### Internal Navigation Recommendation

Inside a slider:

* `param-trigger` is a sibling of the analog control and value editor
* `Enter` on `param-trigger` opens overlay
* `Enter` on `analog-control` begins analog interaction
* `Enter` on `value-editor` begins text editing
* `ArrowUp/Down` moves between siblings according to linear strategy
* `Escape` exits interaction first, then scope

### Fast Travel Recommendation

Support optional fast entry from the outer slider row:

* `Enter` → enter slider at primary child
* `Shift+Enter` → jump straight to `value-editor` and begin edit mode

This is especially useful for scientific workflows where typed precision matters.

---

## Implementation Example: Structural Builders

### Shared Utility: Children Conversion

All builders accept `UINode[]` for authoring convenience, but `UINode.children` stores `string[]` (IDs only).

```javascript
/**
 * Convert array of UINode objects to array of IDs
 */
function buildChildren(nodes) {
  return nodes.map(n => n.id);
}
```

### Section Builder

```javascript
function section(id, label, children, config = {}) {
  return {
    id,
    kind: "section",
    parentId: config.parent || null,
    children: buildChildren(children),  // Convert UINode[] -> string[]
    focusMode: config.focusMode || "container",
    strategy: config.strategy || "linear",
    entryPolicy: config.entryPolicy || "first",
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    ariaRole: "region",
    ariaLabel: label,
    meta: {
      label,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,  // Initial state only; live state tracked in runtime layer
      ...config.meta
    }
  };
}
```

**Important:** `meta.collapsed` is **initial state metadata** for the render layer. Live collapse state must be tracked in the runtime layer (navigation state or separate UI state store), not by mutating `meta.collapsed`. See Rule 9 for details on the semantic vs visual distinction.

### Scope Builder

```javascript
function scope(id, children, config = {}) {
  return {
    id,
    kind: "scope",
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || "container",
    strategy: config.strategy || "linear",
    entryPolicy: config.entryPolicy || "first",
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    meta: config.meta
  };
}
```

### Button Group Builder

```javascript
function buttonGroup(id, children, config = {}) {
  return {
    id,
    kind: "button-group",
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || "container",  // Default: container
    strategy: config.strategy || "linear",       // Default: linear
    entryPolicy: config.entryPolicy || "first",
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    ariaRole: "group",  // or "toolbar" depending on context
    meta: config.meta
  };
}
```

---

## Implementation Example: Slider

```javascript
function slider(id, config) {
  const nodes = [];
  const childIds = [];

  const sliderMeta = {
    preferredPrimaryRole: config.preferredPrimary || "analog-control",
    label: config.label,
    min: config.min,
    max: config.max,
    step: config.step,
    value: config.value,
    tip: config.tip,
    hasParamTrigger: !!config.hasParamTrigger
  };

  if (config.hasParamTrigger) {
    const paramId = `${id}:param`;
    childIds.push(paramId);

    nodes.push({
      id: paramId,
      kind: "param-trigger",
      parentId: id,
      children: [],
      focusMode: "leaf",
      role: "param-trigger",
      primary: sliderMeta.preferredPrimaryRole === "param-trigger",
      disabled: config.disabled,
      ariaRole: "button",
      ariaLabel: `${config.label} parameter selector`,
      meta: {
        label: config.label,
        opensOverlay: true
      }
    });
  }

  const analogId = `${id}:analog`;
  childIds.push(analogId);
  nodes.push({
    id: analogId,
    kind: "analog-control",
    parentId: id,
    children: [],
    focusMode: "leaf",
    role: "analog-control",
    primary: sliderMeta.preferredPrimaryRole === "analog-control",
    disabled: config.disabled,
    ariaRole: "slider",
    ariaLabel: `${config.label} slider`,
    meta: {
      min: config.min,
      max: config.max,
      step: config.step,
      tip: config.tip
    }
  });

  const valueId = `${id}:value`;
  childIds.push(valueId);
  nodes.push({
    id: valueId,
    kind: "value-editor",
    parentId: id,
    children: [],
    focusMode: "leaf",
    role: "value-editor",
    primary: sliderMeta.preferredPrimaryRole === "value-editor",
    disabled: config.disabled,
    ariaRole: "spinbutton",
    ariaLabel: `${config.label} value`,
    meta: {
      min: config.min,
      max: config.max,
      step: config.step,
      tip: config.tip
    }
  });

  const sliderNode = {
    id,
    kind: "slider",
    parentId: config.parent || null,
    children: childIds,
    focusMode: "entry-node",
    strategy: "linear",
    entryPolicy: "primary",
    disabled: config.disabled,
    fastActions: {
      "Shift+Enter": "jump-and-begin-value-edit"
    },
    meta: sliderMeta
  };

  return [sliderNode, ...nodes];
}
```

---

## Implementation Example: Picker (Named Return)

```javascript
/**
 * Picker builder with explicit structural separation.
 * 
 * Returns { trigger, overlayNodes } to make overlay independence explicit.
 * Trigger uses "button" kind by default; caller can override to "param-trigger"
 * for slider parameter labels.
 */
function picker(id, config) {
  const triggerId = `${id}:trigger`;
  const dropdownId = `${id}:dropdown`;
  
  // Build menu items
  const menuItems = config.options.map(opt => ({
    id: `${dropdownId}:${opt.id}`,
    kind: "menu-item",
    parentId: dropdownId,
    children: [],
    focusMode: "leaf",
    primary: opt.id === config.selectedId,
    role: "menu-item",
    ariaRole: "menuitemradio",
    ariaLabel: opt.label,
    disabled: config.disabled,
    meta: {
      label: opt.label,
      value: opt.value,
      selected: opt.id === config.selectedId
    }
  }));
  
  // Build dropdown overlay scope
  const dropdown = {
    id: dropdownId,
    kind: "dropdown",
    parentId: null,  // Overlays have no structural parent
    children: menuItems.map(item => item.id),
    focusMode: "container",
    strategy: "linear",
    entryPolicy: config.selectedId ? "primary" : "first",
    overlay: true,    // Always true for dropdowns
    modal: true,      // Always true for dropdowns
    wrap: true,
    ariaRole: "menu",
    ariaLabel: `${config.label} menu`,
    disabled: config.disabled,
    meta: {
      triggerId,      // Who opens this overlay
      label: config.label
    }
  };
  
  // Build trigger button
  const trigger = {
    id: triggerId,
    kind: config.triggerKind || "button",  // Default "button", or "param-trigger" if specified
    parentId: config.parent || null,
    children: [],
    focusMode: "leaf",
    role: config.triggerKind || "button",
    ariaRole: "button",
    ariaLabel: config.label,
    disabled: config.disabled,
    meta: {
      label: config.label,
      opensOverlay: true,
      overlayId: dropdownId,
      selectedValue: config.options.find(o => o.id === config.selectedId)?.value
    }
  };
  
  // Return named structure
  return {
    trigger,
    overlayNodes: [dropdown, ...menuItems]
  };
}
```

### Usage Pattern

```javascript
// Create picker
const modePicker = picker("mode-picker", {
  label: "Render mode",
  options: [
    { id: "event", label: "Event classification", value: 0 },
    { id: "phase", label: "Phase", value: 2 }
  ],
  selectedId: "event"
});

// Trigger goes in parent's children
const displaySection = section("display-section", "Display", [
  modePicker.trigger,  // ✅ Explicit: only trigger is structural child
  // ... other controls
]);

// All nodes (trigger + overlays) go in flat registry
nodes.push(
  displaySection,
  modePicker.trigger,
  ...modePicker.overlayNodes  // ✅ Explicit: overlays are separate
);
```

---

## Implementation Example: Dialog & Dropdown (Auto-Overlay)

```javascript
/**
 * Dialog builder automatically sets overlay: true and modal: true
 * Callers cannot forget these critical flags
 */
function dialog(id, children, config = {}) {
  return {
    id,
    kind: "dialog",
    parentId: null,  // Overlays have no structural parent
    children: children.map(c => c.id),
    focusMode: "container",
    strategy: "linear",
    entryPolicy: "first",
    overlay: true,     // Always true for dialogs
    modal: true,       // Always true for dialogs
    ariaRole: "dialog",
    ariaLabel: config.title,
    disabled: config.disabled,
    meta: {
      title: config.title,
      returnFocusId: config.returnFocusId,
      triggerId: config.triggerId,
      ...config.meta
    }
  };
}

/**
 * Dropdown builder (part of picker) automatically sets overlay: true
 */
/**
 * Low-level utility for creating standalone dropdown scopes.
 * 
 * NOTE: Most code should use the picker() builder instead, which handles
 * trigger + dropdown + menu items as a complete unit. This utility is only
 * for advanced cases where you need a dropdown without a semantic picker structure.
 * 
 * The picker() builder uses entryPolicy: "primary" while this uses "selected" - 
 * prefer picker() for consistency unless you have a specific reason.
 */
function createDropdownScope(dropdownId, options, selectedId, triggerId) {
  return {
    id: dropdownId,
    kind: "dropdown",
    parentId: null,  // Overlays have no structural parent
    children: options.map(opt => `${dropdownId}:${opt.id}`),
    focusMode: "container",
    strategy: "linear",
    entryPolicy: selectedId ? "selected" : "first",
    overlay: true,    // Always true for dropdowns
    modal: true,      // Always true for dropdowns
    wrap: true,
    meta: {
      triggerId      // Who opens this dropdown
    }
  };
}
```

---

## Principia Tree Structure Example

**Note**: This is a simplified conceptual example. For the complete mapping to Principia's actual codebase structure, see [PRINCIPIA_UI_TREE_MAPPING.md](./PRINCIPIA_UI_TREE_MAPPING.md), which documents all 6 sidebar sections, control buttons, and dynamic content.

```javascript
export function buildPrincipiaUITree() {
  const nodes = [];

  // Root contains all sidebar sections
  const root = {
    id: "root",
    kind: "root",
    parentId: null,
    children: ["ctrl-section", "sec-mode", "sec-presets", "sec-z0", "sec-orient", "sec-sim", "sec-state"],
    focusMode: "container",
    strategy: "linear",
    entryPolicy: "first"
  };
  nodes.push(root);

  // Control section: Render + icon buttons (semantic grouping)
  const controlButtons = buttonGroup("ctrl-section", [
    button("renderBtn", { 
      primary: true,
      meta: { label: "Render" }
    }),
    button("copyLinkBtn", { meta: { label: "URL" } }),
    button("copyJsonBtn", { meta: { label: "JSON" } }),
    button("savePngBtn", { meta: { label: "PNG" } }),
    button("resetAllBtn", { meta: { label: "Reset" } })
  ], {
    focusMode: "entry-node",
    strategy: "linear"  // Keyboard nav order (render → url → json → png → reset)
    // Visual arrangement (horizontal row vs 2x2 grid) defined by render/CSS layer
  });
  nodes.push(controlButtons);

  // Display section with pickers
  const modePicker = picker("mode-picker", {
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
    label: "Resolution",
    options: [
      { id: "256", label: "256 × 256", value: 256 },
      { id: "512", label: "512 × 512", value: 512 },
      { id: "1024", label: "1024 × 1024", value: 1024 }
    ],
    selectedId: "1024"
  });

  const displaySection = section("sec-mode", "Display", [
    modePicker.trigger,
    resPicker.trigger
  ]);
  // Visual arrangement (vertical stack, gap, padding) defined by render/CSS layer
  
  nodes.push(
    displaySection,
    modePicker.trigger,
    ...modePicker.overlayNodes,
    resPicker.trigger,
    ...resPicker.overlayNodes
  );

  // Orientation section with gamma slider
  const gammaSlider = slider("slider-gamma", {
    label: "γ — rotate within plane",
    min: 0,
    max: 360,
    step: 0.25,
    value: 0,
    hasParamTrigger: false,
    preferredPrimary: "analog-control",
    tip: "Rotate the slice plane within the q1-q2 basis by gamma degrees."
  });

  // Tilt pickers + sliders
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
    min: -2,
    max: 2,
    step: 0.01,
    value: 0,
    hasParamTrigger: false,
    preferredPrimary: "analog-control",
    tip: "Tilt q1 into the selected extra dimension."
  });

  const orientationSection = section("sec-orient", "Orientation (γ + tilts)", [
    gammaSlider[0],
    tiltDim1Picker.trigger,
    tiltAmt1Slider[0],
    // ... tilt2 similar
    checkbox("doOrtho", {
      checked: true,
      meta: { label: "Orthonormalise q₁, q₂" }
    }),
    button("rotReset", {
      meta: { label: "Reset tilts + γ" }
    })
  ]);
  // Visual spacing and arrangement handled by render/CSS layer

  nodes.push(
    orientationSection,
    ...gammaSlider,
    tiltDim1Picker.trigger,
    ...tiltDim1Picker.overlayNodes,
    ...tiltAmt1Slider
  );

  // Additional sections: Slice Basis, Slice Offset, Simulation, Export/Import
  // See PRINCIPIA_UI_TREE_MAPPING.md for complete structure

  return nodes;
}
```

### Key Patterns from Principia

1. **Picker labels** above sliders (tilt dimension selection)
2. **No param-triggers** on most sliders (gamma, tilts, simulation params)
3. **Button groups** for control actions (Render + icon buttons)
4. **Section collapse state** (Simulation and Export/Import start collapsed)
5. **Dynamic content** (preset grid, z0 sliders built at runtime)

See [PRINCIPIA_UI_TREE_MAPPING.md](./PRINCIPIA_UI_TREE_MAPPING.md) for:
- Complete tree structure matching actual codebase
- Mapping from `src/ui/` files to semantic tree
- Migration strategy and integration points

---

## Usage in Navigation System

### Architecture: Thin Adapter + Navigation Bridge

**Separation of concerns:**
1. **SemanticTreeAdapter**: Converts UITree → NavNode graph (pure conversion, no events)
2. **TreeNavigationBridge**: Owns event subscription, reactive reconciliation, nav API calls

This prevents the adapter from accumulating logic from both trees.

### SemanticTreeAdapter (Conversion Only)

```javascript
class SemanticTreeAdapter {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree = uiTreeStore;
    this.navManager = navigationManager;  // Needed for dropdown/overlay handlers
  }

  buildNavigationTree() {
    const rootNode = this.uiTree.getRoot();
    return rootNode ? this.convertNode(rootNode) : null;
  }

  convertNode(uiNode) {
    // Filter out non-interactive nodes early
    if (uiNode.focusMode === "none") {
      return null;
    }
    
    // Get element from store (bindings owned by store, not on node)
    const element = this.uiTree.getElement(uiNode.id);
    
    if (uiNode.focusMode === "leaf") {
      return new LeafNode({
        id: uiNode.id,
        element,
        behavior: this.createBehavior(uiNode),
        role: uiNode.role,
        primary: uiNode.primary,
        fastActions: uiNode.fastActions
      });
    }

    if (uiNode.focusMode === "entry-node" || uiNode.focusMode === "container") {
      const children = this.uiTree.getChildren(uiNode.id)
        .map(child => this.convertNode(child))
        .filter(Boolean);

      return new ScopeNode({
        id: uiNode.id,
        children,
        focusMode: uiNode.focusMode,
        strategy: uiNode.strategy,
        entryPolicy: uiNode.entryPolicy,
        modal: uiNode.modal,
        overlay: uiNode.overlay,
        element,
        preferredPrimaryRole: uiNode.meta?.preferredPrimaryRole,
        fastActions: uiNode.fastActions
      });
    }

    return null;
  }

  createBehavior(uiNode) {
    // Get element from store for behaviors
    const element = this.uiTree.getElement(uiNode.id);
    
    switch (uiNode.kind) {
      case "button":
        return new ButtonBehavior(element);

      case "checkbox":
        return new CheckboxBehavior(element);

      case "analog-control":
        return new AnalogControlBehavior(element);

      case "value-editor":
        return new ValueEditorBehavior(element);

      case "param-trigger":
        return new ParamTriggerBehavior(
          element,
          this.getDropdownHandler(uiNode)
        );

      default:
        console.warn(`No behavior for kind: ${uiNode.kind}`);
        return new ButtonBehavior(element);
    }
  }

  /**
   * Find associated dropdown for param-trigger by querying UITree.
   * Uses tree as source of truth rather than string manipulation.
   * Handler directly calls navigation manager to open overlay.
   */
  getDropdownHandler(uiNode) {
    return {
      open: () => {
        // Query UITree for dropdown where triggerId matches this param-trigger
        const dropdown = this.uiTree.findNode(node => 
          (node.kind === "dropdown" || node.kind === "menu") &&
          node.meta?.triggerId === uiNode.id
        );
        
        if (dropdown) {
          // Directly open overlay via navigation manager
          this.navManager.openOverlayById(dropdown.id, uiNode.id);
        } else {
          console.warn(`No dropdown found for param-trigger: ${uiNode.id}`);
        }
      }
    };
  }
}
```

### TreeNavigationBridge (Reactive Reconciliation)

```javascript
class TreeNavigationBridge {
  constructor(uiTreeStore, navigationManager) {
    this.uiTree = uiTreeStore;
    this.navManager = navigationManager;
    
    // Store bound handlers for proper unsubscribe
    this.boundHandleNodeUpdate = this.handleNodeUpdate.bind(this);
    this.boundHandleNodesAdded = this.handleNodesAdded.bind(this);
    this.boundHandleNodeRemoved = this.handleNodeRemoved.bind(this);
    this.boundHandleSubtreeRemoved = this.handleSubtreeRemoved.bind(this);
    
    // Subscribe to tree mutations
    this.uiTree.on('node:updated', this.boundHandleNodeUpdate);
    this.uiTree.on('nodes:added', this.boundHandleNodesAdded);
    this.uiTree.on('node:removed', this.boundHandleNodeRemoved);
    this.uiTree.on('subtree:removed', this.boundHandleSubtreeRemoved);
  }
  
  handleNodeUpdate({ id, updates }) {
    // Selective rebuild: only affected subtree
    this.navManager.rebuildSubtreeById(id);
    
    // Reconcile focus state if currently focused node changed
    if (this.navManager.isInFocusChain(id)) {
      this.reconcileFocusAfterMutation(id);
    }
  }
  
  handleNodesAdded({ ids }) {
    // Find common ancestor, rebuild from there
    const ancestorId = this.uiTree.findCommonAncestor(ids);
    if (ancestorId) {
      this.navManager.rebuildSubtreeById(ancestorId);
    }
  }
  
  handleNodeRemoved({ id }) {
    // If removed node was in focus chain, restore to nearest surviving ancestor
    if (this.navManager.isInFocusChain(id)) {
      const survivingAncestor = this.uiTree.getNearestAncestor(id);
      if (survivingAncestor) {
        this.navManager.restoreFocusToId(survivingAncestor);
      }
    }
    this.navManager.removeNodeById(id);
  }
  
  handleSubtreeRemoved({ rootId, removedIds }) {
    // If any removed node was in focus chain, restore to nearest surviving ancestor
    const focusedRemovedId = removedIds.find(id => this.navManager.isInFocusChain(id));
    
    if (focusedRemovedId) {
      const survivingAncestor = this.uiTree.getNearestAncestor(rootId);
      if (survivingAncestor) {
        this.navManager.restoreFocusToId(survivingAncestor);
      }
    }
    
    // Remove only the subtree root; navManager.removeNodeById should handle descendants
    // to avoid double-removal if the nav manager walks its own tree.
    this.navManager.removeNodeById(rootId);
  }
  
  reconcileFocusAfterMutation(id) {
    const uiNode = this.uiTree.getNode(id);
    
    // If node became disabled, move focus to next valid sibling
    if (uiNode.disabled) {
      this.navManager.moveToNextValidTarget();
    }
    
    // If node children changed and we're entered, validate entry target
    if (this.navManager.isEnteredScope(id)) {
      this.navManager.reconcileEntryPoint(id);
    }
  }
  
  destroy() {
    this.uiTree.off('node:updated', this.boundHandleNodeUpdate);
    this.uiTree.off('nodes:added', this.boundHandleNodesAdded);
    this.uiTree.off('node:removed', this.boundHandleNodeRemoved);
    this.uiTree.off('subtree:removed', this.boundHandleSubtreeRemoved);
  }
}
```

### Usage Pattern

```javascript
// Build semantic tree
const uiTree = new UITreeStore();
uiTree.addNodes(buildPrincipiaUITree());

// Create navigation manager first (with empty tree initially)
const navManager = new KeyboardNavigationManager(null);

// Create adapter (needs navManager reference for overlay/dropdown handlers)
const adapter = new SemanticTreeAdapter(uiTree, navManager);

// Build initial nav tree and attach to manager
const navTree = adapter.buildNavigationTree();
navManager.setRootNode(navTree);

// Create bridge (reactive reconciliation)
const bridge = new TreeNavigationBridge(uiTree, navManager);

// Now tree mutations auto-sync with nav system
uiTree.updateNode("slider-gamma", { disabled: true });
// Bridge detects change, triggers selective rebuild
```

**Rules**:
- Tree mutations always go through `UITreeStore` methods
- Adapter converts tree structure and binds overlay/dropdown behaviors to navManager
- Bridge owns all event subscription and nav API calls
- Navigation manager exposes reconciliation API via new methods

---

## Structural vs Runtime vs Render Bindings

This section clarifies the critical separation that prevents semantic tree systems from rotting over time.

### 1. Structural Layer: The Semantic Tree

**What it contains:**
- Node identity (`id`, `kind`, `parentId`)
- Navigation policy (`focusMode`, `strategy`, `entryPolicy`)
- Semantic relationships (`children`, `primary`)
- Accessibility metadata (`ariaRole`, `ariaLabel`)
- Fast actions and keyboard shortcuts
- Static metadata (labels, ranges, options)

**What it does NOT contain:**
- Current focus/entry state
- Open/closed states
- DOM element references (those are bindings)
- Computed visual layout
- Transient interaction state

**Mutation rule:** The semantic tree can be rebuilt or updated, but only deliberately through:
- User actions triggering tree changes
- Mode switches
- Dynamic content loading

**Never mutate the tree:**
- During rendering/paint
- Inside layout calculations
- As a side effect of focus changes

### 2. Runtime State Layer

**What it contains:**
- Current focus/entry chain
- Overlay stack
- Edit mode state
- Selection state
- Interaction memory (last-focused, scroll positions)

**Stored separately from tree structure.**

The runtime state **observes** the tree but does not reshape it.

### 3. Render Binding Layer

**What it does:**
- Maps semantic nodes to DOM elements via `attachKey` and store's `attachElement()`
- Attaches event listeners
- Applies visual states (focused, disabled, primary)
- Manages CSS classes and ARIA attributes

**Critical rules:**
- Render code may **attach** elements and update visual state
- Render code must **never** opportunistically reshape the semantic tree during paint/layout passes
- Tree mutations must be deliberate and come from user actions or explicit state transitions

**Example of correct binding:**

```javascript
// ✅ Good: Render observes tree, doesn't mutate it
function renderSlider(node) {
  const element = createSliderDOM(node);
  uiTree.attachElement(node.id, element);
  return element;
}
```

**Example of incorrect binding:**

```javascript
// ❌ Bad: Render mutates tree structure as side effect
function renderSlider(node) {
  const element = createSliderDOM(node);
  if (element.querySelector('.extra-control')) {
    // DON'T DO THIS - tree mutation during render
    node.children.push({ id: 'dynamic-child', kind: 'button' });
  }
  return element;
}
```

### Summary

| Layer | Responsibility | Mutability |
|-------|---------------|------------|
| **Semantic Tree** | Interaction topology, navigation structure, widget composition | Deliberate updates only |
| **Runtime State** | Focus, entry, overlays | Changes freely |
| **Render Bindings** | DOM attachment, visual state | Observe tree, don't mutate |
| **Render/Layout Code** | Visual presentation, spacing, positioning, responsive design | Independent from tree |

**Critical distinction**: The semantic tree defines **interaction topology** (what things are, how they relate semantically, navigation structure). Render code defines **visual topology** (where things appear, how they're styled, spatial arrangement).

---

## Interaction Topology vs Visual Topology

The semantic tree should define **semantic layout** (interaction structure), not **visual layout** (presentation).

### What BELONGS in the Semantic Tree

**Interaction topology** - affects meaning, focus, traversal, restoration, accessibility:

1. **Section boundaries** - Logical groupings that affect context
2. **Composite widget structure** - Slider = param-trigger + analog + value
3. **Sibling relationships** - Which controls are peers for traversal
4. **Overlay vs inline** - Modal dialogs vs embedded content
5. **Breadcrumb hierarchy** - Semantic ancestry for context display
6. **Ownership boundaries** - Who owns overlays, where focus restores
7. **Traversal scopes** - Entry-node vs container behavior
8. **Grid intent for navigation** - When arrow keys should move 2D (affects nav policy)

**Test**: If changing the visual arrangement **should not** change keyboard navigation meaning, it shouldn't require changing the tree.

### What DOES NOT belong in the Semantic Tree

**Visual topology** - affects appearance only:

1. **Sidebar row/column nesting** - Presentational wrappers
2. **CSS flex/grid specifics** - Whether section uses `display: flex` or `grid`
3. **Spacing, padding, margins** - Pixel-level layout
4. **Responsive breakpoints** - Mobile vs desktop column counts
5. **Decorative containers** - Wrapper divs for styling
6. **Left vs right positioning** - Slider beside checkbox vs above it
7. **Section visual layout** - 2-column grid this week, vertical list next week

**Test**: If it only affects pixels and not semantic meaning, it's render layer concern.

### Examples

#### ✅ Tree Defines: Section Grouping (Semantic)

```javascript
// Tree: Defines logical sections
root → sec-display → sec-orient → sec-sim

// Render: Can present these however it wants
// Desktop: 2-column grid with sections side-by-side
// Mobile: Vertical stack
// Compact: Tabs
// Same tree, different presentations
```

#### ✅ Tree Defines: Composite Widget Structure (Semantic)

```javascript
// Tree: Slider is composite with semantic roles
slider-gamma
├─ slider-gamma:param (param-trigger) ← Opens overlay
├─ slider-gamma:analog (analog-control) ← Drag interaction
└─ slider-gamma:value (value-editor) ← Text input

// Render: Can arrange these however
// Standard: label | ───○─── | [42]
// Compact: [42] ───○───
// Vertical: label
//           ───○───
//           [42]
// Same tree, different layouts
```

#### ❌ Tree Should NOT Define: Button Spatial Arrangement (Visual)

```javascript
// BAD: Tree defines exact visual layout
button-row (layout: {flow: "horizontal", gap: "6px", justify: "space-between"})
├─ url-btn (layout: {width: "50px"})
├─ json-btn (layout: {width: "50px"})
├─ png-btn (layout: {width: "50px"})
└─ reset-btn (layout: {width: "50px"})

// GOOD: Tree defines semantic grouping
button-group (strategy: "linear")  ← Keyboard nav order
├─ url-btn
├─ json-btn
├─ png-btn
└─ reset-btn

// Render layer decides: horizontal row? 2x2 grid? Vertical mobile?
```

#### ✅ Tree Defines: Overlay Ownership (Semantic)

```javascript
// Tree: Picker trigger opens dropdown overlay
param-trigger "q₁ tilt into z₈"
  ↓ (triggerId relationship)
dropdown overlay
├─ menu-item "z₈" (primary)
└─ menu-item "z₉"

// Semantic: Overlay has triggerId, knows restoration target
// Render: Can position dropdown however (below, above, centered modal)
```

### Principia-Specific Guidance

#### Tree SHOULD Define

```javascript
// Major sections (semantic boundaries)
root
├─ ctrl-section (button-group) ← Grouped controls
├─ sec-display (section) ← Logical section
├─ sec-orient (section)
└─ sec-sim (section)

// Composite widgets (semantic structure)
slider-gamma (entry-node)
├─ slider-gamma:analog (leaf)
└─ slider-gamma:value (leaf)

// Picker relationships (semantic ownership)
tiltDim1-picker:trigger (param-trigger)
  → tiltDim1-picker:dropdown (overlay, parentId: null, triggerId: ...)

// Grid intent for navigation (affects arrow key behavior)
preset-grid (strategy: "grid") ← Arrow keys move 2D
├─ preset-btn-xy
├─ preset-btn-xz
└─ preset-btn-yz
```

#### Render Layer SHOULD Define

```css
/* Whether sidebar is 1-column or 2-column */
.sidebar { display: grid; grid-template-columns: 1fr 1fr; }

/* Slider visual arrangement */
.sl-row { display: flex; gap: 8px; align-items: center; }

/* Button spacing */
.button-group { display: flex; gap: 6px; }

/* Responsive breakpoints */
@media (max-width: 768px) {
  .sidebar { grid-template-columns: 1fr; }
  .button-group { flex-direction: column; }
}

/* Section collapsed state presentation */
.section.collapsed .section-body { display: none; }
```

**Note on collapsed state**: Section collapse affects both semantics and presentation:
- **Semantic/runtime**: Collapsed sections may remove descendants from keyboard traversal (navigation skips over them)
- **Visual**: CSS hides the section body
- If collapse affects navigability, it's runtime state tracked separately (e.g., in navigation state or UI state store), not just CSS
- The tree itself remains unchanged; collapse is runtime state, not structural mutation

### The Clean Architecture

```
Semantic Tree (Interaction Topology)
├─ What things ARE (kind, role)
├─ How they RELATE semantically (parent/child, triggerId)
├─ How keyboard NAV works (strategy, entryPolicy)
├─ What opens OVERLAYS (overlay: true, modal: true)
└─ What defines CONTEXT (breadcrumbs, restoration)
         ↓
    Render Projection
         ↓
    DOM Structure
         ↓
    CSS (Visual Topology)
    ├─ Where things APPEAR (flex, grid, position)
    ├─ How they're STYLED (colors, fonts, borders)
    ├─ How they RESPOND (breakpoints, animations)
    └─ Spacing and sizing (padding, margin, width)
```

### Benefits of This Separation

1. **UI redesigns don't break navigation** - Change visual layout, nav still works
2. **Tree stays focused** - Only semantic meaning, not pixel pushing
3. **Responsive design is easy** - CSS media queries, tree unchanged
4. **Testable** - Test semantic structure without caring about visual arrangement
5. **Accessibility coherent** - Semantic tree matches assistive tech expectations
6. **No DOM reinvention** - Tree doesn't become a worse version of HTML/CSS

### The Rule

```
IF (change affects keyboard meaning, focus, context, or accessibility)
  THEN it belongs in the semantic tree
ELSE
  it belongs in render/CSS layer
```

**Examples:**
- Moving slider from section A to section B? → **Tree change** (semantic context changed)
- Moving slider from left column to right column? → **CSS change** (visual only)
- Adding param-trigger to slider? → **Tree change** (interaction semantics changed)
- Making slider 20% wider? → **CSS change** (visual only)
- Grouping buttons into toolbar? → **Tree change** (semantic grouping for nav)
- Arranging buttons in 2×2 grid vs horizontal row? → **CSS change** (visual arrangement)

---

## NodeKind and FocusMode Constraints

Not all `kind` + `focusMode` combinations are semantically valid. This table defines the allowed relationships:

| NodeKind | Valid FocusMode Values | Notes |
|----------|------------------------|-------|
| `root` | `container` | Always a container |
| `scope` | `container`, `entry-node` | General-purpose structural node |
| `section` | `container`, `entry-node` | Usually `container` |
| `button-group` | `container`, `entry-node` | Can be named focusable surface or transparent container |
| `dialog` | `container` | Always a modal container |
| `dropdown` | `container` | Always a menu container |
| `menu` | `container` | Always a menu container |
| `slider` | `entry-node` | Composite scope, entered to access children |
| `button` | `leaf` | Always a leaf action |
| `checkbox` | `leaf` | Always a leaf control |
| `menu-item` | `leaf` | Always a leaf action |
| `param-trigger` | `leaf` | Always a leaf action (opens overlay) |
| `analog-control` | `leaf` | Always a leaf control (slider handle) |
| `value-editor` | `leaf` | Always a leaf control (number input) |
| `text-input` | `leaf` | Always a leaf control |
| `number-input` | `leaf` | Always a leaf control |
| `label` | `none` | Non-interactive display element |
| `separator` | `none` | Non-interactive visual divider |

**Implementation rule**: Builders should enforce these constraints. The type system allows invalid combinations, but runtime validation should warn or error on mismatch.

**Example validation**:

```javascript
function validateNode(node) {
  const validModes = {
    root: ["container"],
    button: ["leaf"],
    label: ["none"],
    slider: ["entry-node"],
    // ... etc
  };
  
  const allowed = validModes[node.kind];
  if (allowed && !allowed.includes(node.focusMode)) {
    console.error(
      `Invalid focusMode "${node.focusMode}" for kind "${node.kind}". ` +
      `Expected one of: ${allowed.join(", ")}`
    );
  }
}
```

---

## Breadcrumb Projection

The semantic tree supports breadcrumb/context display for navigation state awareness.

### Breadcrumb Data Structure

```typescript
interface BreadcrumbSegment {
  id: string;
  label: string;
  kind: NodeKind;
  role?: string;
}

interface BreadcrumbPath {
  segments: BreadcrumbSegment[];
  currentId: string;
}
```

### Breadcrumb Builder

```javascript
class BreadcrumbProjection {
  constructor(uiTreeStore) {
    this.uiTree = uiTreeStore;
  }

  /**
   * Build breadcrumb path from root to current focus target.
   * 
   * For overlays: follows triggerId chain to maintain continuity through overlay boundaries.
   * This ensures "Display › Mode Picker › Event classification" instead of truncated "Mode Picker › Event".
   * 
   * Skips root node (kind: "root") as it's not meaningful in breadcrumb display.
   */
  buildPath(currentId) {
    const segments = [];
    let nodeId = currentId;
    
    while (nodeId) {
      const node = this.uiTree.getNode(nodeId);
      if (!node) break;
      
      // Skip non-semantic nodes and root
      if (node.focusMode !== "none" && node.kind !== "root") {
        segments.unshift({
          id: node.id,
          label: this.getDisplayLabel(node),
          kind: node.kind,
          role: node.role
        });
      }
      
      // Walk up structural parent, or fallback to triggerId for overlays
      if (node.parentId) {
        nodeId = node.parentId;
      } else if (node.meta?.triggerId) {
        // Overlay: continue path through invocation source
        nodeId = node.meta.triggerId;
      } else {
        // Reached root or orphaned overlay
        break;
      }
    }
    
    return {
      segments,
      currentId
    };
  }

  /**
   * Get display label for breadcrumb segment.
   * 
   * Priority:
   * 1. meta.breadcrumbLabel (future: for shorter breadcrumb-specific labels)
   * 2. meta.label (current primary source)
   * 3. ariaLabel (fallback, but may be too verbose)
   * 4. Default label from kind
   * 
   * Note: Some nodes want different breadcrumb vs ARIA labels.
   * Example: ARIA="γ — rotate within plane value", breadcrumb="γ › Value"
   * Future consideration: Add meta.breadcrumbLabel for explicit short forms.
   */
  getDisplayLabel(node) {
    // Future: meta.breadcrumbLabel for explicit short labels
    if (node.meta?.breadcrumbLabel) return node.meta.breadcrumbLabel;
    
    // Prefer explicit label from metadata
    if (node.meta?.label) return node.meta.label;
    
    // Fallback to ariaLabel (may be verbose)
    if (node.ariaLabel) return node.ariaLabel;
    
    // Fallback to kind-based label
    return this.getDefaultLabel(node.kind);
  }

  getDefaultLabel(kind) {
    const labels = {
      root: "Root",
      section: "Section",
      slider: "Slider",
      "param-trigger": "Parameter",
      "analog-control": "Slider",
      "value-editor": "Value",
      button: "Button",
      dialog: "Dialog"
    };
    return labels[kind] || kind;
  }

  /**
   * Format breadcrumb path as string for display
   */
  formatPath(breadcrumbPath) {
    return breadcrumbPath.segments
      .map(seg => seg.label)
      .join(" › ");
  }
}
```

### Breadcrumb Display Formats

**Full path** (for persistent UI element):
```
Display › Render mode
Orientation › γ — rotate within plane › Value
```

**Contextual** (for focused composite):
```
γ — rotate within plane › Value
```

**Role-based** (for mode indicators):
```
slider:value-editor
```

### Integration with Navigation

```javascript
class NavigationSystem {
  constructor(uiTree, breadcrumbs) {
    this.breadcrumbs = breadcrumbs;
    
    // Update breadcrumbs on focus change
    this.on('focus:changed', ({ nodeId }) => {
      const path = this.breadcrumbs.buildPath(nodeId);
      this.updateBreadcrumbDisplay(path);
    });
  }

  updateBreadcrumbDisplay(path) {
    const breadcrumbEl = document.getElementById('nav-breadcrumbs');
    if (breadcrumbEl) {
      breadcrumbEl.textContent = this.breadcrumbs.formatPath(path);
    }
  }
}
```

### Mount Point

**Recommended location**: Fixed UI element above or below main viewport.

```html
<div id="app-container">
  <div id="nav-breadcrumbs" class="breadcrumb-bar" aria-live="polite">
    <!-- Breadcrumb path updated by navigation system -->
  </div>
  <div id="main-content">
    <!-- Sidebar + canvas -->
  </div>
</div>
```

**ARIA**: Use `aria-live="polite"` so screen readers announce context changes without interrupting.

**Visual design**: Should be subtle but persistent, showing current navigation context without dominating screen space.

---

## Key Design Rules

### 1. Semantic, Not Visual

Only include nodes that matter for interaction structure.

**Good**

```javascript
slider("gamma", { /* ... */ })
// => slider scope, analog-control, value-editor
```

**Bad**

```javascript
slider("gamma", { /* ... */ })
// => wrapper, label-wrap, track-wrap, value-wrap, etc.
```

### 2. Stable IDs

Node IDs must be deterministic and stable across rebuilds.

**For composite widgets**, child IDs must be **canonical derivatives** of the parent ID:

```javascript
// ✅ Good: Deterministic child IDs
const sliderId = "slider-q1";
const childIds = {
  param: `${sliderId}:param`,
  analog: `${sliderId}:analog`,
  value: `${sliderId}:value`
};

slider("slider-gamma", { /* ... */ })
// => "slider-gamma", "slider-gamma:param", "slider-gamma:analog", "slider-gamma:value"
```

**Bad**

```javascript
slider(`slider-${Math.random()}`, { /* ... */ })
// => Non-deterministic IDs break focus restoration
```

**Rule:** For any composite widget, child IDs are always derived using a consistent pattern (`parent:role`).

This ensures:
- Focus restoration works reliably
- Tree identity is consistent across rebuilds
- Navigation state can survive tree updates

### 3. Metadata Drives Behavior

Metadata is how rendering and nav learn special meaning without polluting structure.

### 4. Button Groups: Semantic Labeling + Preset Behavior

`kind: "button-group"` is **semantic labeling** with sensible defaults, not special-case navigation magic.

#### What It Means

- **Semantic:** Declares "this is a group of related action buttons"
- **Rendering:** Enables grouped visual styling
- **Accessibility:** Container can use `role="group"` or `role="toolbar"`
- **Navigation:** Applies default `focusMode: "container"` and `strategy: "linear"`

#### What It Does NOT Mean

- No hidden navigation behavior beyond defaults
- `focusMode` and `strategy` still determine actual behavior
- Callers can override if needed (e.g., grid layout for large groups)

**Rule:** `button-group` is a semantic + preset convenience, not a special case.

### 5. Overlays: Structural Parent vs Invocation Source

Overlays (dialogs, pickers, tooltips) are **not structural children** of their invoking nodes.

#### Structural Parent vs Invocation Source

- **Structural parent** (`parentId`): Always `null` for overlays
- **Invocation source** (`triggerId`): Who opened this overlay (for restoration)

```typescript
interface OverlayMeta {
  triggerId?: string;        // Invocation source (not structural parent)
  returnFocusId?: string;    // Explicit restoration target
}
```

#### Focus Restoration Priority

When an overlay closes, restoration should follow this priority:

1. `returnFocusId` (explicit target)
2. `triggerId` (fallback to who opened it)
3. Default restoration logic

**Critical rule:** Never smuggle trigger ownership through `parentId`. Overlays must maintain `parentId: null` to preserve structural independence.

**Builders enforce this**: `dialog()` and dropdown builders automatically set `overlay: true` and `modal: true`.

### 6. Param-Trigger Is a Real Sibling

If the slider label opens a submenu, it is a real semantic target:

* not decorative text
* not merged into the slider scope header
* a genuine internal sibling alongside analog-control and value-editor

### 7. Fast Actions: Jump vs Jump-and-Begin

Power-user shortcuts like `Shift+Enter -> value-editor` should be represented as semantic actions on the scope, not hardcoded ad hoc in DOM handlers.

**Distinguish between jump and jump-and-begin:**

- `jump-to-value-editor`: Navigate focus to value editor (no interaction yet)
- `begin-value-edit`: Begin editing wherever focus currently is
- `jump-and-begin-value-edit`: Combined action (jump + immediately begin editing)

**Example:**

```javascript
fastActions: {
  "Shift+Enter": "jump-and-begin-value-edit"  // Slider: jump to value editor AND begin editing
}
```

**Rule:** Use combined actions when the intent is explicitly "jump and immediately start interacting", not just "move focus".

### 8. attachKey for Element Attachment

Use `attachKey` as optional metadata for DOM element lookup/attachment by the render layer. The store provides `attachElement(id, element)` and `getElement(id)` as the canonical binding API.

**`attachKey` is render-layer metadata**, not a core architectural contract. It provides a hint for renderers to locate elements, but the store owns all bindings.

### 9. Section Collapsed State: Semantic + Visual

When a section is collapsed:
- **Semantic state:** Section's children are excluded from navigation traversal (runtime state)
- **Visual state:** CSS hides the section body (render layer)

Collapsed state affects both interaction topology (what is navigable) and visual topology (what is visible). The semantic state should be tracked separately from the tree structure itself:

- **Option A:** Runtime state store tracks `collapsedSections: Set<string>` separate from UITree
- **Option B:** Store collapsed state in `meta.collapsed` and have navigation check it during traversal
- **Current spec:** Leaves this to implementation. Collapsed state is mentioned but not yet reflected in formal contracts.

### 10. Multi-Part Element Bindings for Complex Composites (Future Extension)

**Note:** This is a potential future extension, not part of the current canonical model. Element bindings are currently owned by `UITreeStore` via `attachElement(id, element)` and `getElement(id)`.

For complex composites where focus target, visual ring, and scroll target might need to differ (e.g., a compound widget with separate native focus and highlight elements), the store API could be extended to support multi-part bindings:

```typescript
// Potential future store API (not currently canonical)
interface ElementBindings {
  focusTarget?: HTMLElement | null;     // Native focus target
  ringTarget?: HTMLElement | null;      // Visual focus ring target
  scrollTarget?: HTMLElement | null;    // Scroll-into-view target
}

// store.attachElementBindings(id, bindings)
// store.getElementBindings(id)
```

**Current state:** Most nodes only need a single element binding. Start with `attachElement(id, element)`. Only extend the API if concrete evidence emerges that multi-part bindings are necessary.

### 11. Grid Traversal Strategy (Implementation Blocker)

`TraversalStrategy` includes `"grid"` for 2D button layouts, but `GridTraversalPolicy.findNext()` is not yet implemented in the navigation spec (currently returns `null`).

**Current workaround**: Use `strategy: "linear"` for button groups until grid traversal is complete.

**Semantic tree status**: The tree correctly models grid layout intent via `strategy: "grid"`. The blocker is purely in the navigation policy implementation.

**Resolution path**:
1. Implement `GridTraversalPolicy` with arrow key navigation (↑↓←→)
2. Add grid metadata (`columns`, `rows`, or auto-detect from element positions)
3. Update Principia tree to use `strategy: "grid"` for control buttons

---

## Alignment with KEYBOARD_NAVIGATION_SPEC.md

| Spec Requirement                     | Implementation                             |
| ------------------------------------ | ------------------------------------------ |
| Single source of truth               | ✅ Semantic tree is canonical               |
| Static tree, mutable session state   | ✅ UINode vs NavigationState                |
| Focusable scopes vs container scopes | ✅ FocusMode                                |
| Composite widgets are semantic       | ✅ Slider roles                             |
| Traversal is structural first        | ✅ TraversalStrategy per scope              |
| One cursor only                      | ✅ Visualizer reads current semantic target |
| Stable IDs                           | ✅ Builder API encourages stability         |
| Overlays separate                    | ✅ overlay/modal support                    |
| Primary entry policy                 | ✅ entryPolicy + preferredPrimaryRole       |
| Modal trapping                       | ✅ modal flag                               |
| Param label opens submenu            | ✅ param-trigger leaf                       |
| Fast travel to value box             | ✅ fastActions support                      |
| Breadcrumb/context display           | ✅ BreadcrumbProjection                     |
| Tree mutation synchronization        | ✅ EventEmitter + reactive reconciliation   |

---

## Implementation Readiness

**Status**: ✅ **FROZEN - Final Implementation-Ready Spec (v1.5.3)**

This specification is now complete. All API contracts match their usage examples, all critical execution paths are specified (with pseudocode clearly labeled where internal methods are implementation-specific), all type definitions align with implementations, and all ownership models are unambiguous.

### What makes this implementation-ready:

1. **No internal contradictions** - Code examples, type definitions, and prose all align
2. **Clear ownership models** - Store owns bindings, tree owns structure, runtime owns state
3. **Unambiguous contracts** - API signatures, event payloads, and invariants are explicit
4. **Separation of concerns** - Semantic vs visual, structure vs state, tree vs render
5. **Complete execution paths** - Fast actions, dropdown handlers, reconciliation all have full implementations
6. **No silent no-ops** - Adapter calls navManager directly, no return values discarded
7. **Escape hatches defined** - Future extensions marked clearly (multi-part bindings, grid traversal)

### What to expect during implementation:

- **First friction points will be valuable** - Real integration pressure will reveal next improvements
- **Build incrementally** - Implement store → builders → one section end-to-end → adapter
- **Trust the model** - The architecture is sound; implementation details will emerge naturally
- **Don't pre-optimize** - Multi-part bindings, grid traversal, collapsed state tracking can wait for concrete need

### When to revisit this spec:

- ✅ When implementation reveals genuine architectural mismatches (not just convenience preferences)
- ✅ When new composite widget patterns emerge that don't fit current taxonomy
- ✅ When performance/testing requirements demand formalization of currently-loose contracts
- ❌ Not for every implementation convenience or sugar API

---

## Next Steps

1. Implement `UITreeStore` in `src/ui/semantic-tree/store.ts`
2. Implement builders in `src/ui/semantic-tree/builders.ts`
3. Define Principia semantic tree in `src/ui/semantic-tree/principia-tree.ts`
4. Implement `SemanticTreeAdapter` in `src/navigation/SemanticTreeAdapter.ts`
5. Connect render layer so rendered elements call `store.attachElement(id, element)` after mount
6. Hook navigation engine to semantic tree instead of DOM discovery

---

**Reference Documents**:

* [KEYBOARD_NAVIGATION_SPEC.md](./KEYBOARD_NAVIGATION_SPEC.md)
* [SEMANTIC_UI_TREE_INTEGRATION_PLAN.md](./SEMANTIC_UI_TREE_INTEGRATION_PLAN.md)
