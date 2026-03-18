/**
 * Simplified UITreeStore - semantic UI tree for navigation
 * DOM-first approach: describes existing DOM structure without creating it
 */
import { EventEmitter } from './EventEmitter.ts';

/**
 * Grid cell definition
 */
export interface GridCell {
  id: string;
  row?: number;
  col?: number;
  rowSpan: number;
  colSpan: number;
}

/**
 * UI Tree Node
 */
export interface UINode {
  id: string;
  kind: string;
  parentId: string | null;
  children?: string[];
  focusMode?: string;
  role?: string;
  ariaRole?: string;
  ariaLabel?: string;
  meta?: Record<string, any>;
  hidden?: boolean;
  collapsed?: boolean;
  overlay?: boolean;
  transient?: boolean;
  primary?: boolean;
  disabled?: boolean;
  
  // Grid-specific properties
  rows?: number;
  cols?: number;
  cells?: GridCell[];
  wrapRows?: boolean;
  wrapCols?: boolean;
  entryCell?: number;
  entryPolicy?: string;
  escapeUp?: string;
  escapeDown?: string;
  escapeLeft?: string;
  escapeRight?: string;
  isOverlay?: boolean;
  closeOnEscape?: boolean;
  modal?: boolean;
}

/**
 * Remove node options
 */
export interface RemoveNodeOptions {
  /** Reparent children to parent instead of removing them */
  reparent?: boolean;
}

/**
 * Visible cell info
 */
export interface VisibleCellInfo {
  cellId: string;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
}

/**
 * Tree events
 */
interface TreeEvents {
  'nodes:added': { ids: string[] };
  'node:updated': { id: string; updates: Partial<UINode> };
  'node:removed': { id: string; parentId: string | null };
  'subtree:removed': { rootId: string; removedIds: string[] };
  'overlay:registered': { id: string; triggerId: string | null };
  'overlay:removed': { id: string; triggerId?: string | null };
}

export class UITreeStore {
  private _nodes: Map<string, UINode>;
  private _elementBindings: Map<string, HTMLElement>;
  _events: EventEmitter<TreeEvents>;
  private _root: string | null;

  constructor() {
    this._nodes = new Map();
    this._elementBindings = new Map();
    this._events = new EventEmitter<TreeEvents>();
    this._root = null;
  }

  // ── Node CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a single node to the tree
   */
  addNode(node: UINode): string {
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
   */
  addNodes(nodes: UINode[]): string[] {
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
   */
  getNode(id: string): UINode | null {
    return this._nodes.get(id) || null;
  }

  /**
   * Get root node
   */
  getRoot(): UINode | null {
    return this._root ? this._nodes.get(this._root) || null : null;
  }

  /**
   * Get children of a node (returns node objects, not IDs)
   */
  getChildren(id: string): UINode[] {
    const node = this._nodes.get(id);
    if (!node || !node.children) return [];
    return node.children
      .map(childId => this._nodes.get(childId))
      .filter((child): child is UINode => child !== undefined);
  }

  /**
   * Get parent of a node
   */
  getParent(id: string): UINode | null {
    const node = this._nodes.get(id);
    if (!node || !node.parentId) return null;
    return this._nodes.get(node.parentId) || null;
  }

  /**
   * Update a node with partial updates
   */
  updateNode(id: string, updates: Partial<UINode>): void {
    const node = this._nodes.get(id);
    if (!node) {
      throw new Error(`Node "${id}" not found`);
    }
    Object.assign(node, updates);
    this._events.emit('node:updated', { id, updates });
  }

  /**
   * Remove a single node
   */
  removeNode(id: string, options: RemoveNodeOptions = {}): void {
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
              ...(node.children || []),
              ...parent.children.slice(idx + 1)
            ];
            // Update children's parentId
            (node.children || []).forEach(childId => {
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
    if (!reparent && node.children && node.children.length > 0) {
      [...node.children].forEach(childId => this.removeNode(childId));
    }

    this._nodes.delete(id);
    this._elementBindings.delete(id);
    this._events.emit('node:removed', { id, parentId: node.parentId });
  }

  /**
   * Remove a node and all descendants
   */
  removeSubtree(rootId: string): void {
    const ids = this._collectSubtreeIds(rootId);
    ids.forEach(id => {
      this._nodes.delete(id);
      this._elementBindings.delete(id);
    });
    this._events.emit('subtree:removed', { rootId, removedIds: ids });
  }

  /**
   * Collect all IDs in a subtree (internal helper)
   */
  private _collectSubtreeIds(rootId: string): string[] {
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
   */
  attachElement(id: string, element: HTMLElement | null): void {
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
   */
  getElement(id: string): HTMLElement | null {
    return this._elementBindings.get(id) || null;
  }

  /**
   * Iterate all element bindings
   */
  forEachBinding(callback: (id: string, element: HTMLElement) => void): void {
    for (const [id, element] of this._elementBindings) {
      callback(id, element);
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────

  /**
   * Find first node matching predicate
   */
  findNode(predicate: (node: UINode) => boolean): UINode | null {
    for (const node of this._nodes.values()) {
      if (predicate(node)) return node;
    }
    return null;
  }

  /**
   * Get nearest ancestor ID (for focus restoration)
   */
  getNearestAncestor(id: string): string | null {
    const node = this._nodes.get(id);
    return node?.parentId || null;
  }

  /**
   * Find common ancestor of multiple nodes
   */
  findCommonAncestor(ids: string[]): string | null {
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
   */
  private _getAncestorChain(id: string): string[] {
    const chain: string[] = [];
    let current: string | null = id;
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
   */
  registerTransientOverlay(overlayNode: UINode, triggerId: string | null): void {
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
   */
  removeTransientOverlay(overlayId: string): void {
    const node = this._nodes.get(overlayId);
    if (!node) return;
    const triggerId = node.meta?.triggerId;
    this.removeSubtree(overlayId);
    this._events.emit('overlay:removed', { id: overlayId, triggerId });
  }

  // ── Events ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to tree events
   */
  on<K extends keyof TreeEvents>(event: K, handler: (data: TreeEvents[K]) => void): void {
    this._events.on(event, handler);
  }

  /**
   * Unsubscribe from tree events
   */
  off<K extends keyof TreeEvents>(event: K, handler?: (data: TreeEvents[K]) => void): void {
    this._events.off(event, handler);
  }

  // ── Serialization ──────────────────────────────────────────────────────

  /**
   * Serialize tree to JSON for debugging
   */
  toJSON(): { root: string | null; nodes: Partial<UINode>[] } {
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
   */
  getGridCell(gridId: string, row: number, col: number): GridCell | null {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return null;
    }
    
    if (!grid.rows || !grid.cols || row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
      return null;
    }
    
    if (!grid.cells) {
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
   */
  getCellCoords(gridId: string, cellId: string): [number, number] | null {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return null;
    }
    
    if (!grid.cells || !grid.cols) {
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
   */
  isNodeHidden(nodeId: string): boolean {
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
   */
  isInCollapsedSection(nodeId: string): boolean {
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
   */
  getVisibleCells(gridId: string): VisibleCellInfo[] {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid') {
      return [];
    }
    
    if (!grid.cells || !grid.cols) {
      return [];
    }
    
    const result: VisibleCellInfo[] = [];
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
   */
  getFirstVisibleCell(gridId: string): [number, number] | null {
    const visibleCells = this.getVisibleCells(gridId);
    if (visibleCells.length === 0) {
      return null;
    }
    return [visibleCells[0].row, visibleCells[0].col];
  }
  
  /**
   * Check if grid has cell at coordinates (and it's visible)
   */
  hasVisibleCellAt(gridId: string, row: number, col: number): boolean {
    const cell = this.getGridCell(gridId, row, col);
    if (!cell) return false;
    return !this.isNodeHidden(cell.id);
  }
  
  /**
   * Get all visible cells in a specific row
   */
  getVisibleCellsInRow(gridId: string, row: number): VisibleCellInfo[] {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid' || !grid.rows || !grid.cols || row < 0 || row >= grid.rows) {
      return [];
    }
    
    const cells: VisibleCellInfo[] = [];
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
   */
  getVisibleCellsInColumn(gridId: string, col: number): VisibleCellInfo[] {
    const grid = this.getNode(gridId);
    if (!grid || grid.kind !== 'grid' || !grid.rows || !grid.cols || col < 0 || col >= grid.cols) {
      return [];
    }
    
    const cells: VisibleCellInfo[] = [];
    for (let row = 0; row < grid.rows; row++) {
      const cell = this.getGridCell(gridId, row, col);
      if (cell && !this.isNodeHidden(cell.id)) {
        cells.push({ cellId: cell.id, row, col });
      }
    }
    return cells;
  }
}
