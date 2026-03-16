/**
 * Builder functions for semantic UI tree nodes
 * Pure functions that return node objects (no DOM creation)
 */

// Re-export grid builders
export { grid, cell, getCellAt, getCellCoords, indexToCoords, coordsToIndex, hasCellAt, getAllCellsWithCoords } from './GridBuilder.js';

// ── Utility ────────────────────────────────────────────────────────────────

/**
 * Extract IDs from array of node objects
 * Pass only TOP-LEVEL children (scope nodes), not their internal children
 * @param {Object[]} nodes - Array of node objects
 * @returns {string[]} Array of node IDs
 */
function buildChildren(nodes) {
  return nodes.map(n => n.id);
}

// ── Root ───────────────────────────────────────────────────────────────────

/**
 * Create root node
 * @param {Object[]} children - Array of top-level child nodes
 * @returns {Object} Root node
 */
export function root(children) {
  return {
    id: 'root',
    kind: 'root',
    parentId: null,
    children: buildChildren(children),
    focusMode: 'container',
    strategy: 'linear',
    entryPolicy: 'first',
    wrap: true // Allow wrapping between top-level regions
  };
}

// ── Structural ─────────────────────────────────────────────────────────────

/**
 * Create a section node with navigable header
 * Returns object with header and section nodes
 * @param {string} id - Section ID
 * @param {string} label - Section label
 * @param {Object[]} children - Array of child nodes
 * @param {Object} config - Additional configuration
 * @returns {Object} { header, section } - Header button and section scope
 */
export function section(id, label, children, config = {}) {
  const headerId = `${id}:header`;
  const childIds = buildChildren(children);
  
  // Section header button (navigable, can be activated to toggle collapse)
  const header = {
    id: headerId,
    kind: 'section-header',
    parentId: config.parent || null,
    children: [],
    focusMode: 'leaf',
    role: 'section-header',
    ariaRole: 'button',
    ariaLabel: `${label} section`,
    meta: {
      label,
      sectionId: id,
      collapsible: config.collapsible ?? true,
      collapsed: config.collapsed ?? false,
      escapeLeftTo: 'canvas' // Left arrow escapes to canvas
    }
  };
  
  // Section scope (the body - focusable and enterable)
  const sectionNode = {
    id,
    kind: 'section',
    parentId: config.parent || null,
    children: childIds,
    focusMode: 'entry-node', // Can focus on it AND enter it
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'remembered',
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    hidden: config.hidden || false,
    ariaRole: 'region',
    ariaLabel: label,
    meta: {
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
 * Create a scope node (generic container)
 * @param {string} id - Scope ID
 * @param {Object[]} children - Array of child nodes
 * @param {Object} config - Additional configuration
 * @returns {Object} Scope node
 */
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

/**
 * Create a button group node
 * @param {string} id - Button group ID
 * @param {Object[]} children - Array of button nodes
 * @param {Object} config - Additional configuration
 * @returns {Object} Button group node
 */
export function buttonGroup(id, children, config = {}) {
  return {
    id,
    kind: 'button-group',
    parentId: config.parent || null,
    children: buildChildren(children),
    focusMode: 'passthrough', // Not enterable, just a grouping construct
    strategy: config.strategy || 'linear',
    entryPolicy: config.entryPolicy || 'first',
    wrap: config.wrap ?? false,
    disabled: config.disabled,
    hidden: config.hidden || false,
    ariaRole: 'group',
    meta: config.meta || {}
  };
}

// ── Leaf ───────────────────────────────────────────────────────────────────

/**
 * Create a button node
 * @param {string} id - Button ID
 * @param {Object} config - Configuration
 * @returns {Object} Button node
 */
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

/**
 * Create a checkbox node
 * @param {string} id - Checkbox ID
 * @param {Object} config - Configuration
 * @returns {Object} Checkbox node
 */
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

// ── Composite ──────────────────────────────────────────────────────────────

/**
 * Create a slider composite widget
 * Returns array: [scopeNode, paramNode (optional), analogNode, valueNode]
 * ONLY scopeNode (nodes[0]) should be passed as child to parent containers
 * @param {string} id - Slider ID
 * @param {Object} config - Configuration
 * @returns {Object[]} Array of slider nodes
 */
export function slider(id, config) {
  const childIds = [];
  const childNodes = [];

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
    primary: true,  // Always primary (default entry point for all sliders)
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

  // Slider scope node - grid layout:
  // WITH param trigger: 2 rows × 2 cols
  //   Row 0: Param trigger (colSpan=2)
  //   Row 1: Analog | Value
  // WITHOUT param trigger: 1 row × 2 cols
  //   Row 0: Analog | Value
  const hasParam = config.hasParamTrigger;
  const rows = hasParam ? 2 : 1;
  const cols = 2;
  
  const cells = hasParam
    ? [
        { id: childIds[0], rowSpan: 1, colSpan: 2 },  // Param trigger spans both columns
        { id: childIds[1], rowSpan: 1, colSpan: 1 },  // Analog (row 1, col 0)
        { id: childIds[2], rowSpan: 1, colSpan: 1 }   // Value (row 1, col 1)
      ]
    : [
        { id: childIds[0], rowSpan: 1, colSpan: 1 },  // Analog (row 0, col 0)
        { id: childIds[1], rowSpan: 1, colSpan: 1 }   // Value (row 0, col 1)
      ];
  
  const sliderNode = {
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

  return [sliderNode, ...childNodes];
}

/**
 * Create a picker composite widget
 * Returns { trigger, overlayNodes: [dropdown, ...menuItems] }
 * Trigger goes in parent's children, overlayNodes registered flat
 * @param {string} id - Picker ID
 * @param {Object} config - Configuration
 * @returns {Object} { trigger, overlayNodes }
 */
export function picker(id, config) {
  const triggerId = `${id}:trigger`;
  const dropdownId = `${id}:dropdown`;

  // Build menu items
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

  // Build dropdown overlay scope
  const dropdown = {
    id: dropdownId,
    kind: 'dropdown',
    parentId: null, // Overlays have no structural parent
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
    meta: {
      triggerId,
      label: config.label
    }
  };

  // Build trigger button
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
 * Create a panel overlay node
 * Returns { overlayNode, closeNode, nodes: [overlayNode, closeNode] }
 * @param {string} id - Panel ID
 * @param {string} title - Panel title
 * @param {Object[]} children - Panel content nodes
 * @param {Object} config - Configuration
 * @returns {Object} { overlayNode, closeNode, nodes }
 */
export function panel(id, title, children, config = {}) {
  const closeId = `${id}:close`;
  const closeNode = button(closeId, {
    ariaLabel: `Close ${title}`,
    role: 'button'
  });

  const overlayNode = {
    id,
    kind: 'panel',
    parentId: null, // Overlays have no structural parent
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
      triggerId: config.triggerId || null
    }
  };

  return {
    overlayNode,
    closeNode,
    nodes: [overlayNode, closeNode]
  };
}
