/**
 * Builder functions for semantic UI tree nodes
 * Pure functions that return node objects (no DOM creation)
 */

import { UINode, GridCell } from './store.js';

// Re-export grid builders
export { grid, cell, getCellAt, getCellCoords, indexToCoords, coordsToIndex, hasCellAt, getAllCellsWithCoords } from './GridBuilder.js';

// ── Utility ────────────────────────────────────────────────────────────────

/**
 * Extract IDs from array of node objects
 * Pass only TOP-LEVEL children (scope nodes), not their internal children
 */
function buildChildren(nodes: UINode[]): string[] {
  return nodes.map(n => n.id);
}

// ── Root ───────────────────────────────────────────────────────────────────

/**
 * Root node config
 */
export interface RootConfig {
  strategy?: string;
  entryPolicy?: string;
  wrap?: boolean;
}

/**
 * Create root node
 */
export function root(children: UINode[]): UINode {
  return {
    id: 'root',
    kind: 'root',
    parentId: null,
    children: buildChildren(children),
    focusMode: 'container',
    meta: {
      strategy: 'linear',
      entryPolicy: 'first',
      wrap: true // Allow wrapping between top-level regions
    }
  };
}

// ── Structural ─────────────────────────────────────────────────────────────

/**
 * Section config
 */
export interface SectionConfig {
  parent?: string | null;
  strategy?: string;
  entryPolicy?: string;
  wrap?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  meta?: Record<string, any>;
}

/**
 * Section result
 */
export interface SectionResult {
  header: UINode;
  section: UINode;
}

/**
 * Create a section node with navigable header
 * Returns object with header and section nodes
 */
export function section(id: string, label: string, children: UINode[], config: SectionConfig = {}): SectionResult {
  const headerId = `${id}:header`;
  const childIds = buildChildren(children);
  
  // Section header button (navigable, can be activated to toggle collapse)
  const header: UINode = {
    id: headerId,
    kind: 'section-header',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: 'section-header',
    meta: {
      ariaRole: 'button',
      ariaLabel: `${label} section`,
      label,
      sectionId: id,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,
      escapeLeftTo: 'canvas' // Left arrow escapes to canvas
    }
  };
  
  // Section scope (the body - focusable and enterable)
  const sectionNode: UINode = {
    id,
    kind: 'section',
    parentId: config.parent || null,
    children: childIds,
    focusMode: 'entry-node', // Can focus on it AND enter it
    disabled: config.disabled,
    hidden: config.hidden || false,
    meta: {
      strategy: config.strategy || 'linear',
      entryPolicy: config.entryPolicy || 'remembered',
      wrap: config.wrap ?? false,
      ariaRole: 'region',
      ariaLabel: label,
      label,
      headerId,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,
      escapeLeftTo: 'canvas', // Left arrow from section escapes to canvas
      ...config.meta
    }
  };
  
  return { header, section: sectionNode };
}

/**
 * Scope config
 */
export interface ScopeConfig {
  parent?: string | null;
  focusMode?: string;
  strategy?: string;
  entryPolicy?: string;
  wrap?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  meta?: Record<string, any>;
}

/**
 * Create a scope node (generic container)
 */
export function scope(id: string, children: UINode[], config: ScopeConfig = {}): UINode {
  return {
    id,
    kind: 'scope',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: config.focusMode || 'container',
    disabled: config.disabled,
    hidden: config.hidden || false,
    meta: {
      strategy: config.strategy || 'linear',
      entryPolicy: config.entryPolicy || 'first',
      wrap: config.wrap ?? false,
      ...config.meta
    }
  };
}

/**
 * Button group config
 */
export interface ButtonGroupConfig {
  parent?: string | null;
  strategy?: string;
  entryPolicy?: string;
  wrap?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  meta?: Record<string, any>;
}

/**
 * Create a button group node
 */
export function buttonGroup(id: string, children: UINode[], config: ButtonGroupConfig = {}): UINode {
  return {
    id,
    kind: 'button-group',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: 'passthrough', // Not enterable, just a grouping construct
    disabled: config.disabled,
    hidden: config.hidden || false,
    meta: {
      strategy: config.strategy || 'linear',
      entryPolicy: config.entryPolicy || 'first',
      wrap: config.wrap ?? false,
      ariaRole: 'group',
      ...config.meta
    }
  };
}

// ── Leaf ───────────────────────────────────────────────────────────────────

/**
 * Button config
 */
export interface ButtonConfig {
  parent?: string | null;
  role?: string;
  ariaRole?: string;
  ariaLabel?: string;
  primary?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  meta?: Record<string, any>;
}

/**
 * Create a button node
 */
export function button(id: string, config: ButtonConfig = {}): UINode {
  return {
    id,
    kind: 'button',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: config.role || 'button',
    primary: config.primary || false,
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      ariaRole: config.ariaRole || 'button',
      ariaLabel: config.ariaLabel || '',
      ...config.meta
    }
  };
}

/**
 * Checkbox config
 */
export interface CheckboxConfig {
  parent?: string | null;
  label?: string;
  ariaLabel?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  tip?: string;
}

/**
 * Create a checkbox node
 */
export function checkbox(id: string, config: CheckboxConfig = {}): UINode {
  return {
    id,
    kind: 'checkbox',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: 'checkbox',
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      ariaRole: 'checkbox',
      ariaLabel: config.ariaLabel || config.label || '',
      label: config.label || '',
      defaultChecked: config.defaultChecked || false,
      tip: config.tip || ''
    }
  };
}

// ── Composite ──────────────────────────────────────────────────────────────

/**
 * Slider config
 */
export interface SliderConfig {
  parent?: string | null;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  hasParamTrigger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  fastActions?: Record<string, any>;
  meta?: {
    tip?: string;
    preferredPrimaryRole?: string;
  };
}

/**
 * Create a slider composite widget
 * Returns array: [scopeNode, paramNode (optional), analogNode, valueNode]
 * ONLY scopeNode (nodes[0]) should be passed as child to parent containers
 */
export function slider(id: string, config: SliderConfig): UINode[] {
  const childIds: string[] = [];
  const childNodes: UINode[] = [];

  // Optional param trigger (label that opens menu)
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
      disabled: config.disabled || false,
      hidden: config.hidden || false,
      meta: {
        ariaLabel: `${config.label} parameter`,
        label: config.label
      }
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
    primary: true,  // Always primary (default entry point for all sliders)
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      ariaLabel: `${config.label} slider`
    }
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
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      ariaLabel: `${config.label} value`
    }
  });

  // Slider scope node - grid layout:
  // WITH param trigger: 2 rows × 2 cols
  //   Row 0: Param trigger (colSpan=2)
  //   Row 1: Analog | Value
  // WITHOUT param trigger: 1 row × 2 cols
  //   Row 0: Analog | Value
  const hasParam = config.hasParamTrigger;
  const rows = hasParam ? 2 : 1;
  const cols = 2;
  
  const cells: GridCell[] = hasParam
    ? [
        { id: childIds[0], rowSpan: 1, colSpan: 2 },  // Param trigger spans both columns
        { id: childIds[1], rowSpan: 1, colSpan: 1 },  // Analog (row 1, col 0)
        { id: childIds[2], rowSpan: 1, colSpan: 1 }   // Value (row 1, col 1)
      ]
    : [
        { id: childIds[0], rowSpan: 1, colSpan: 1 },  // Analog (row 0, col 0)
        { id: childIds[1], rowSpan: 1, colSpan: 1 }   // Value (row 0, col 1)
      ];
  
  const sliderNode: UINode = {
    id,
    kind: 'grid',  // Sliders are enterable grids with children
    role: 'slider',  // But semantically they're sliders
    parentId: config.parent || null,
    children: childIds,
    rows,
    cols,
    cells,
    focusMode: 'entry-node',
    wrapRows: false,
    wrapCols: false,
    entryPolicy: 'primary',  // Always default to analog control (marked primary)
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      fastActions: config.fastActions || {},
      label: config.label,
      min: config.min,
      max: config.max,
      step: config.step,
      value: config.value,
      tip: config.meta?.tip || '',
      hasParamTrigger: config.hasParamTrigger || false
    }
  };

  return [sliderNode, ...childNodes];
}

/**
 * Picker option
 */
export interface PickerOption {
  id: string;
  label: string;
  value: any;
}

/**
 * Picker config
 */
export interface PickerConfig {
  parent?: string | null;
  label: string;
  options: PickerOption[];
  selectedId?: string;
  triggerKind?: string;
  disabled?: boolean;
  hidden?: boolean;
  wrap?: boolean;
}

/**
 * Picker result
 */
export interface PickerResult {
  trigger: UINode;
  overlayNodes: UINode[];
}

/**
 * Create a picker composite widget
 * Returns { trigger, overlayNodes: [dropdown, ...menuItems] }
 * Trigger goes in parent's children, overlayNodes registered flat
 */
export function picker(id: string, config: PickerConfig): PickerResult {
  const triggerId = `${id}:trigger`;
  const dropdownId = `${id}:dropdown`;

  // Build menu items
  const menuItems: UINode[] = config.options.map(opt => ({
    id: `${dropdownId}:${opt.id}`,
    kind: 'menu-item',
    parentId: dropdownId,
    children: [],
    focusMode: 'leaf',
    primary: opt.id === config.selectedId,
    role: 'menu-item',
    disabled: config.disabled || false,
    hidden: false,
    meta: {
      ariaRole: 'menuitemradio',
      ariaLabel: opt.label,
      label: opt.label,
      value: opt.value,
      selected: opt.id === config.selectedId
    }
  }));

  // Build dropdown overlay scope (as a grid for keyboard navigation)
  const dropdown: UINode = {
    id: dropdownId,
    kind: 'grid',
    parentId: null, // Overlays have no structural parent
    children: menuItems.map(item => item.id),
    focusMode: 'entry-node',
    overlay: true,
    isOverlay: true,
    closeOnEscape: true,
    disabled: config.disabled || false,
    // Grid structure: vertical list of menu items (n rows × 1 col)
    rows: menuItems.length,
    cols: 1,
    cells: menuItems.map((item, idx) => ({
      id: item.id,
      rowSpan: 1,
      colSpan: 1
    })),
    wrapRows: config.wrap !== false,  // Default to true
    wrapCols: false,
    entryPolicy: config.selectedId ? 'primary' : 'first',
    role: 'menu',
    meta: {
      modal: true,
      ariaRole: 'menu',
      ariaLabel: `${config.label} menu`,
      triggerId,
      label: config.label
    }
  };

  // Build trigger button
  const trigger: UINode = {
    id: triggerId,
    kind: config.triggerKind || 'button',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: config.triggerKind || 'button',
    disabled: config.disabled || false,
    hidden: config.hidden || false,
    meta: {
      ariaRole: 'button',
      ariaLabel: config.label,
      label: config.label,
      opensOverlay: true,
      overlayId: dropdownId,
      selectedValue: config.options.find(o => o.id === config.selectedId)?.label || ''
    }
  };

  return {
    trigger,
    overlayNodes: [dropdown, ...menuItems]
  };
}

/**
 * Panel config
 */
export interface PanelConfig {
  triggerId?: string | null;
}

/**
 * Panel result
 */
export interface PanelResult {
  overlayNode: UINode;
  closeNode: UINode;
  nodes: UINode[];
}

/**
 * Create a panel overlay node
 * Returns { overlayNode, closeNode, nodes: [overlayNode, closeNode] }
 */
export function panel(id: string, title: string, children: UINode[], config: PanelConfig = {}): PanelResult {
  const closeId = `${id}:close`;
  const closeNode = button(closeId, {
    ariaLabel: `Close ${title}`,
    role: 'button'
  });

  const overlayNode: UINode = {
    id,
    kind: 'panel',
    parentId: null, // Overlays have no structural parent
    children: [closeId, ...buildChildren(children)],
    focusMode: 'container',
    overlay: true,
    meta: {
      modal: true,
      strategy: 'linear',
      entryPolicy: 'first',
      wrap: false,
      ariaRole: 'dialog',
      ariaLabel: title,
      title,
      triggerId: config.triggerId || null
    }
  };

  return {
    overlayNode,
    closeNode,
    nodes: [overlayNode, closeNode]
  };
}
