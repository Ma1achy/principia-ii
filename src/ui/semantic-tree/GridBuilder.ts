/**
 * GridBuilder.ts
 * Helper functions for building grid-based navigation structures
 */

import type { UINode, GridCell } from './store.js';

// ─── Type Definitions ───────────────────────────────────────────────────────

/**
 * Cell reference in a grid
 */
export interface CellRef {
  /** ID of the node this cell references */
  id: string;
  /** Number of rows this cell spans */
  rowSpan: number;
  /** Number of columns this cell spans */
  colSpan: number;
}

/**
 * Grid configuration options
 */
export interface GridConfig {
  /** Number of rows (or 'auto' to calculate) */
  rows?: number | 'auto';
  /** Number of columns (or 'auto' to calculate) */
  cols?: number | 'auto';
  /** Array of cells (flat or 2D) */
  cells?: Array<string | CellRef> | Array<Array<string | CellRef>>;
  /** Whether to wrap when navigating past the bottom row */
  wrapRows?: boolean;
  /** Whether to wrap when navigating past the rightmost column */
  wrapCols?: boolean;
  /** ID of node to escape to when navigating up from top row */
  escapeUp?: string | null;
  /** ID of node to escape to when navigating down from bottom row */
  escapeDown?: string | null;
  /** ID of node to escape to when navigating left from leftmost column */
  escapeLeft?: string | null;
  /** ID of node to escape to when navigating right from rightmost column */
  escapeRight?: string | null;
  /** Index of cell to enter by default */
  entryCell?: number;
  /** Policy for remembering entry position */
  entryPolicy?: 'remembered' | 'first' | 'last';
  /** Focus mode for grid */
  focusMode?: 'entry-node' | 'first-visible' | 'last-visible';
  /** Whether grid is initially hidden */
  hidden?: boolean;
  /** Whether grid is initially collapsed */
  collapsed?: boolean;
  /** Whether grid is an overlay */
  isOverlay?: boolean;
  /** Whether to close overlay on Escape key */
  closeOnEscape?: boolean;
  /** Whether overlay is modal */
  modal?: boolean;
  /** Parent node ID */
  parent?: string | null;
  /** Additional metadata */
  meta?: Record<string, any>;
}

/**
 * Grid dimensions result
 */
interface GridDimensions {
  rows: number;
  cols: number;
}

/**
 * Cell with position information
 */
export interface CellWithPosition {
  cellId: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

// ─── Grid Builder Functions ─────────────────────────────────────────────────

/**
 * Create a grid node
 */
export function grid(id: string, config: GridConfig = {}): UINode {
  const {
    rows = 'auto',
    cols = 'auto',
    cells = [],
    wrapRows = false,
    wrapCols = false,
    escapeUp = null,
    escapeDown = null,
    escapeLeft = null,
    escapeRight = null,
    entryCell = 0,
    entryPolicy = 'remembered',
    focusMode = 'entry-node',
    hidden = false,
    collapsed = false,
    isOverlay = false,
    closeOnEscape = true,
    modal = true,
    parent = null,
    meta = {}
  } = config;

  // Process cells - handle both flat and 2D array formats
  let processedCells: CellRef[];
  let is2DArray = false;
  let rowCount = 0;
  let colCount = 0;
  
  if (cells.length > 0 && Array.isArray(cells[0])) {
    // 2D array format: [[cell1, cell2], [cell3, cell4]]
    is2DArray = true;
    const cells2D = cells as Array<Array<string | CellRef>>;
    rowCount = cells2D.length;
    colCount = Math.max(...cells2D.map(row => row.length));
    
    // Flatten to 1D array
    processedCells = cells2D.flat().map(c => {
      if (typeof c === 'string') {
        return { id: c, rowSpan: 1, colSpan: 1 };
      } else if (c.id) {
        return {
          id: c.id,
          rowSpan: c.rowSpan || 1,
          colSpan: c.colSpan || 1
        };
      } else {
        throw new Error(`Invalid cell in grid ${id}: ${JSON.stringify(c)}`);
      }
    });
  } else {
    // Flat array format: [cell1, cell2, cell3]
    const cellsFlat = cells as Array<string | CellRef>;
    processedCells = cellsFlat.map(c => {
      if (typeof c === 'string') {
        return { id: c, rowSpan: 1, colSpan: 1 };
      } else if (c.id) {
        return {
          id: c.id,
          rowSpan: c.rowSpan || 1,
          colSpan: c.colSpan || 1
        };
      } else {
        throw new Error(`Invalid cell in grid ${id}: ${JSON.stringify(c)}`);
      }
    });
  }

  // Auto-calculate dimensions if needed
  const gridDims = calculateDimensions(processedCells, rows, cols, is2DArray, rowCount, colCount);
  
  // Validate grid structure
  validateGrid(id, gridDims.rows, gridDims.cols, processedCells);
  
  // Extract child IDs from cells
  const childIds = processedCells.map(cell => cell.id);

  return {
    id,
    kind: 'grid',
    parentId: parent,
    children: childIds,  // List of cell IDs for UITreeStore parent-child relationships
    
    // Grid structure
    rows: gridDims.rows,
    cols: gridDims.cols,
    cells: processedCells.map(c => ({
      id: c.id,
      rowSpan: c.rowSpan,
      colSpan: c.colSpan
    })),
    
    // Navigation behavior
    wrapRows,
    wrapCols,
    escapeUp,
    escapeDown,
    escapeLeft,
    escapeRight,
    
    // Entry behavior
    entryCell,
    entryPolicy,
    focusMode,
    
    // Visibility
    hidden,
    collapsed,
    
    // Overlay properties
    isOverlay,
    closeOnEscape,
    modal,
    
    // Metadata
    meta: {
      ...meta,
      gridLayout: true // Mark as grid for identification
    }
  };
}

/**
 * Create a cell reference
 */
export function cell(id: string, rowSpan: number = 1, colSpan: number = 1): CellRef {
  return {
    id,
    rowSpan,
    colSpan
  };
}

/**
 * Calculate grid dimensions from cells
 */
function calculateDimensions(
  cells: CellRef[],
  rows: number | 'auto',
  cols: number | 'auto',
  is2DArray: boolean = false,
  rowCount: number = 0,
  colCount: number = 0
): GridDimensions {
  // If both explicit, use them
  if (rows !== 'auto' && cols !== 'auto') {
    return { rows, cols };
  }

  // If 2D array was provided, use those dimensions (unless overridden)
  if (is2DArray) {
    return {
      rows: rows !== 'auto' ? rows : rowCount,
      cols: cols !== 'auto' ? cols : colCount
    };
  }

  // If one is auto, calculate it
  if (rows === 'auto' && cols !== 'auto') {
    // Calculate rows needed for given columns
    let currentRow = 0;
    let currentCol = 0;
    
    for (const cell of cells) {
      // If cell doesn't fit in current row, move to next row
      if (currentCol + cell.colSpan > cols) {
        currentRow++;
        currentCol = 0;
      }
      
      // Place cell
      currentCol += cell.colSpan;
      
      // If we filled the row, move to next
      if (currentCol >= cols) {
        currentRow++;
        currentCol = 0;
      }
    }
    
    // If we have any partial row, count it
    if (currentCol > 0) currentRow++;
    
    return { rows: currentRow, cols };
  }
  
  if (cols === 'auto' && rows !== 'auto') {
    // Calculate max columns needed
    let maxCols = 1;
    
    for (const cell of cells) {
      maxCols = Math.max(maxCols, cell.colSpan);
    }
    
    return { rows, cols: maxCols };
  }
  
  // Both auto - assume single column grid
  if (rows === 'auto' && cols === 'auto') {
    return {
      rows: cells.length,
      cols: 1
    };
  }

  // Fallback (should never reach here)
  return { rows: 1, cols: 1 };
}

/**
 * Validate grid structure
 */
function validateGrid(id: string, rows: number, cols: number, cells: CellRef[]): void {
  // Create grid matrix to track cell placement
  const matrix: boolean[][] = Array(rows).fill(null).map(() => Array(cols).fill(false));
  
  let currentRow = 0;
  let currentCol = 0;
  
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    
    // Find next available position
    while (currentRow < rows && matrix[currentRow][currentCol]) {
      currentCol++;
      if (currentCol >= cols) {
        currentCol = 0;
        currentRow++;
      }
    }
    
    // Check if cell fits
    if (currentRow + cell.rowSpan > rows) {
      console.warn(`[GridBuilder] Cell ${cell.id} in grid ${id} exceeds row bounds (${currentRow}+${cell.rowSpan} > ${rows})`);
    }
    
    if (currentCol + cell.colSpan > cols) {
      console.warn(`[GridBuilder] Cell ${cell.id} in grid ${id} exceeds column bounds (${currentCol}+${cell.colSpan} > ${cols})`);
    }
    
    // Mark cells as occupied
    for (let r = currentRow; r < Math.min(currentRow + cell.rowSpan, rows); r++) {
      for (let c = currentCol; c < Math.min(currentCol + cell.colSpan, cols); c++) {
        if (matrix[r][c]) {
          console.warn(`[GridBuilder] Cell ${cell.id} in grid ${id} overlaps at position (${r}, ${c})`);
        }
        matrix[r][c] = true;
      }
    }
    
    // Move to next position
    currentCol += cell.colSpan;
    if (currentCol >= cols) {
      currentCol = 0;
      currentRow++;
    }
  }
}

/**
 * Get cell at grid coordinates
 */
export function getCellAt(grid: UINode, row: number, col: number): CellRef | null {
  if (!grid.rows || !grid.cols || !grid.cells) {
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
 */
export function getCellCoords(grid: UINode, cellId: string): [number, number] | null {
  if (!grid.cols || !grid.cells) {
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
 * Convert flat index to row/col coordinates
 */
export function indexToCoords(index: number, cols: number): [number, number] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return [row, col];
}

/**
 * Convert row/col coordinates to flat index
 */
export function coordsToIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

/**
 * Check if a cell exists at coordinates
 */
export function hasCellAt(grid: UINode, row: number, col: number): boolean {
  return getCellAt(grid, row, col) !== null;
}

/**
 * Get all cells in a grid with their position information
 */
export function getAllCellsWithCoords(grid: UINode): CellWithPosition[] {
  if (!grid.cols || !grid.cells) {
    return [];
  }

  const result: CellWithPosition[] = [];
  let currentRow = 0;
  let currentCol = 0;
  
  for (const cell of grid.cells) {
    // Find next available position
    while (currentCol >= grid.cols) {
      currentCol = 0;
      currentRow++;
    }
    
    result.push({
      cellId: cell.id,
      row: currentRow,
      col: currentCol,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan
    });
    
    // Move to next position
    currentCol += cell.colSpan;
    if (currentCol >= grid.cols) {
      currentCol = 0;
      currentRow++;
    }
  }
  
  return result;
}

console.log('[GridBuilder] Grid builder utilities loaded');
