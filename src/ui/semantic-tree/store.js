/**
 * Simplified UITreeStore - semantic UI tree for navigation
 * DOM-first approach: describes existing DOM structure without creating it
 */
import { EventEmitter } from './EventEmitter.js';

export class UITreeStore {
  constructor() {
    this._nodes = new Map();
    this._elementBindings = new Map();
    this._events = new EventEmitter();
    this._root = null;
  }

  // ── Node CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a single node to the tree
   * @param {Object} node - Node object with id, kind, parentId, children, etc.
   * @returns {string} Node ID
   */
  addNode(node) {
    if (this._nodes.has(node.id)) {
      console.error('[UITreeStore] Node already exists:', node.id, 'existing:', this._nodes.get(node.id));
      throw new Error(`Node "${node.id}" already exists`);
    }
    this._nodes.set(node.id, { ...node });
    if (node.kind === 'root') {
      this._root = node.id;
    }
    return node.id;
  }

  /**
   * Add multiple nodes at once
   * Infers parentId from children arrays after all nodes added
   * @param {Object[]} nodes - Array of node objects
   * @returns {string[]} Array of node IDs
   */
  addNodes(nodes) {
    const ids = nodes.map(node => this.addNode(node));

    // Infer parentId from children arrays
    // Scan ALL stored nodes so dynamic additions work correctly
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

  /**
   * Get a node by ID
   * @param {string} id - Node ID
   * @returns {Object|null} Node object or null
   */
  getNode(id) {
    return this._nodes.get(id) || null;
  }

  /**
   * Get root node
   * @returns {Object|null} Root node or null
   */
  getRoot() {
    return this._root ? this._nodes.get(this._root) : null;
  }

  /**
   * Get children of a node (returns node objects, not IDs)
   * @param {string} id - Parent node ID
   * @returns {Object[]} Array of child node objects
   */
  getChildren(id) {
    const node = this._nodes.get(id);
    if (!node || !node.children) return [];
    return node.children
      .map(childId => this._nodes.get(childId))
      .filter(Boolean);
  }

  /**
   * Get parent of a node
   * @param {string} id - Node ID
   * @returns {Object|null} Parent node or null
   */
  getParent(id) {
    const node = this._nodes.get(id);
    if (!node || !node.parentId) return null;
    return this._nodes.get(node.parentId) || null;
  }

  /**
   * Update a node with partial updates
   * @param {string} id - Node ID
   * @param {Object} updates - Partial node updates
   */
  updateNode(id, updates) {
    const node = this._nodes.get(id);
    if (!node) {
      throw new Error(`Node "${id}" not found`);
    }
    Object.assign(node, updates);
    this._events.emit('node:updated', { id, updates });
  }

  /**
   * Remove a single node
   * @param {string} id - Node ID
   * @param {Object} options - Options: { reparent: boolean }
   */
  removeNode(id, options = {}) {
    const node = this._nodes.get(id);
    if (!node) return;

    const { reparent = false } = options;

    // Remove from parent's children array
    if (node.parentId) {
      const parent = this._nodes.get(node.parentId);
      if (parent && parent.children) {
        const idx = parent.children.indexOf(id);
        if (idx !== -1) {
          if (reparent) {
            // Insert this node's children at its position
            parent.children = [
              ...parent.children.slice(0, idx),
              ...node.children,
              ...parent.children.slice(idx + 1)
            ];
            // Update children's parentId
            node.children.forEach(childId => {
              const child = this._nodes.get(childId);
              if (child) child.parentId = node.parentId;
            });
          } else {
            parent.children.splice(idx, 1);
          }
        }
      }
    }

    // Recursively remove children (unless reparented)
    if (!reparent && node.children?.length > 0) {
      [...node.children].forEach(childId => this.removeNode(childId));
    }

    this._nodes.delete(id);
    this._elementBindings.delete(id);
    this._events.emit('node:removed', { id, parentId: node.parentId });
  }

  /**
   * Remove a node and all descendants
   * @param {string} rootId - Root node ID
   */
  removeSubtree(rootId) {
    const ids = this._collectSubtreeIds(rootId);
    ids.forEach(id => {
      this._nodes.delete(id);
      this._elementBindings.delete(id);
    });
    this._events.emit('subtree:removed', { rootId, removedIds: ids });
  }

  /**
   * Collect all IDs in a subtree (internal helper)
   * @param {string} rootId - Root node ID
   * @returns {string[]} Array of all IDs in subtree
   */
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

  // ── Element Binding ────────────────────────────────────────────────────

  /**
   * Attach a DOM element to a node
   * @param {string} id - Node ID
   * @param {HTMLElement|null} element - DOM element
   */
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

  /**
   * Get the DOM element for a node
   * @param {string} id - Node ID
   * @returns {HTMLElement|null} DOM element or null
   */
  getElement(id) {
    return this._elementBindings.get(id) || null;
  }

  /**
   * Iterate all element bindings
   * @param {Function} callback - (id, element) => void
   */
  forEachBinding(callback) {
    for (const [id, element] of this._elementBindings) {
      callback(id, element);
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────

  /**
   * Find first node matching predicate
   * @param {Function} predicate - (node) => boolean
   * @returns {Object|null} Node or null
   */
  findNode(predicate) {
    for (const node of this._nodes.values()) {
      if (predicate(node)) return node;
    }
    return null;
  }

  /**
   * Get nearest ancestor ID (for focus restoration)
   * @param {string} id - Node ID
   * @returns {string|null} Parent ID or null
   */
  getNearestAncestor(id) {
    const node = this._nodes.get(id);
    return node?.parentId || null;
  }

  /**
   * Find common ancestor of multiple nodes
   * @param {string[]} ids - Array of node IDs
   * @returns {string|null} Common ancestor ID or null
   */
  findCommonAncestor(ids) {
    if (ids.length === 0) return null;
    if (ids.length === 1) return this.getNearestAncestor(ids[0]);
    
    const chains = ids.map(id => this._getAncestorChain(id));
    for (const ancestorId of chains[0]) {
      if (chains.every(chain => chain.includes(ancestorId))) {
        return ancestorId;
      }
    }
    return this._root;
  }

  /**
   * Get ancestor chain from root to node (internal helper)
   * @param {string} id - Node ID
   * @returns {string[]} Array of ancestor IDs
   */
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

  // ── Transient Overlay API ──────────────────────────────────────────────

  /**
   * Register a transient overlay (dialogs, dynamic popups)
   * @param {Object} overlayNode - Overlay node object
   * @param {string} triggerId - ID of node that opened this overlay
   */
  registerTransientOverlay(overlayNode, triggerId) {
    this.addNode({
      ...overlayNode,
      parentId: null,
      overlay: true,
      transient: true,
      meta: { ...overlayNode.meta, triggerId }
    });
    this._events.emit('overlay:registered', { id: overlayNode.id, triggerId });
  }

  /**
   * Remove a transient overlay
   * @param {string} overlayId - Overlay node ID
   */
  removeTransientOverlay(overlayId) {
    const node = this._nodes.get(overlayId);
    if (!node) return;
    const triggerId = node.meta?.triggerId;
    this.removeSubtree(overlayId);
    this._events.emit('overlay:removed', { id: overlayId, triggerId });
  }

  // ── Events ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to tree events
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   */
  on(event, handler) {
    this._events.on(event, handler);
  }

  /**
   * Unsubscribe from tree events
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   */
  off(event, handler) {
    this._events.off(event, handler);
  }

  // ── Serialization ──────────────────────────────────────────────────────

  /**
   * Serialize tree to JSON for debugging
   * @returns {Object} Serialized tree
   */
  toJSON() {
    return {
      root: this._root,
      nodes: Array.from(this._nodes.values()).map(n => ({
        id: n.id,
        kind: n.kind,
        parentId: n.parentId,
        children: n.children,
        focusMode: n.focusMode,
        role: n.role,
        meta: n.meta
      }))
    };
  }
  
  // ── Grid Navigation Methods ────────────────────────────────────────────────
  
  /**
   * Get cell at grid coordinates
   * @param {string} gridId - Grid node ID
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {Object|null} Cell object or null
   */
  getGridCell(gridId, row, col) {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return null;
    }
    
    if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
      return null;
    }
    
    let currentRow = 0;
    let currentCol = 0;
    
    for (const cell of grid.cells) {
      // Find next available position
      while (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
      
      // Check if target coordinates fall within this cell's span
      const inRowSpan = row >= currentRow && row < currentRow + cell.rowSpan;
      const inColSpan = col >= currentCol && col < currentCol + cell.colSpan;
      
      if (inRowSpan && inColSpan) {
        return cell;
      }
      
      // Move to next position
      currentCol += cell.colSpan;
      if (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
    }
    
    return null;
  }
  
  /**
   * Get coordinates of cell in grid
   * @param {string} gridId - Grid node ID
   * @param {string} cellId - Cell ID to find
   * @returns {[number, number]|null} [row, col] or null
   */
  getCellCoords(gridId, cellId) {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return null;
    }
    
    let currentRow = 0;
    let currentCol = 0;
    
    for (const cell of grid.cells) {
      // Find next available position
      while (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
      
      if (cell.id === cellId) {
        return [currentRow, currentCol];
      }
      
      // Move to next position
      currentCol += cell.colSpan;
      if (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
    }
    
    return null;
  }
  
  /**
   * Check if node is hidden (directly or in collapsed parent)
   * @param {string} nodeId - Node ID to check
   * @returns {boolean} True if hidden
   */
  isNodeHidden(nodeId) {
    let current = this.getNode(nodeId);
    if (!current) return true;
    
    // Check if node itself is hidden
    if (current.hidden === true) {
      return true;
    }
    
    // Check if any parent is collapsed
    while (current) {
      if (current.collapsed === true) {
        return true;
      }
      current = current.parentId ? this.getNode(current.parentId) : null;
    }
    
    return false;
  }
  
  /**
   * Check if node is in a collapsed section
   * @param {string} nodeId - Node ID to check
   * @returns {boolean} True if in collapsed section
   */
  isInCollapsedSection(nodeId) {
    let current = this.getNode(nodeId);
    if (!current) return false;
    
    // Walk up parent chain
    while (current) {
      if (current.kind === 'section' && current.collapsed === true) {
        return true;
      }
      if (current.kind === 'grid' && current.collapsed === true) {
        return true;
      }
      current = current.parentId ? this.getNode(current.parentId) : null;
    }
    
    return false;
  }
  
  /**
   * Get all visible cells in a grid (not hidden, not in collapsed parent)
   * @param {string} gridId - Grid node ID
   * @returns {Array} Array of {cellId, row, col, rowSpan, colSpan}
   */
  getVisibleCells(gridId) {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return [];
    }
    
    const result = [];
    let currentRow = 0;
    let currentCol = 0;
    
    for (const cell of grid.cells) {
      // Find next available position
      while (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
      
      // Check if cell is visible
      if (!this.isNodeHidden(cell.id)) {
        result.push({
          cellId: cell.id,
          row: currentRow,
          col: currentCol,
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan
        });
      }
      
      // Move to next position
      currentCol += cell.colSpan;
      if (currentCol >= grid.cols) {
        currentCol = 0;
        currentRow++;
      }
    }
    
    return result;
  }
  
  /**
   * Find first visible cell in grid
   * @param {string} gridId - Grid node ID
   * @returns {[number, number]|null} [row, col] of first visible cell or null
   */
  getFirstVisibleCell(gridId) {
    const visibleCells = this.getVisibleCells(gridId);
    if (visibleCells.length === 0) {
      return null;
    }
    return [visibleCells[0].row, visibleCells[0].col];
  }
  
  /**
   * Check if grid has cell at coordinates (and it's visible)
   * @param {string} gridId - Grid node ID
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {boolean} True if visible cell exists at coordinates
   */
  hasVisibleCellAt(gridId, row, col) {
    const cell = this.getGridCell(gridId, row, col);
    if (!cell) return false;
    return !this.isNodeHidden(cell.id);
  }
  
  /**
   * Get all visible cells in a specific row
   * @param {string} gridId - Grid ID
   * @param {number} row - Row index
   * @returns {Array} Array of {cellId, row, col} objects
   */
  getVisibleCellsInRow(gridId, row) {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid' || row < 0 || row >= grid.rows) {
      return [];
    }
    
    const cells = [];
    for (let col = 0; col < grid.cols; col++) {
      const cell = this.getGridCell(gridId, row, col);
      if (cell && !this.isNodeHidden(cell.id)) {
        cells.push({ cellId: cell.id, row, col });
      }
    }
    return cells;
  }
  
  /**
   * Get all visible cells in a specific column
   * @param {string} gridId - Grid ID
   * @param {number} col - Column index
   * @returns {Array} Array of {cellId, row, col} objects
   */
  getVisibleCellsInColumn(gridId, col) {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid' || col < 0 || col >= grid.cols) {
      return [];
    }
    
    const cells = [];
    for (let row = 0; row < grid.rows; row++) {
      const cell = this.getGridCell(gridId, row, col);
      if (cell && !this.isNodeHidden(cell.id)) {
        cells.push({ cellId: cell.id, row, col });
      }
    }
    return cells;
  }
}
