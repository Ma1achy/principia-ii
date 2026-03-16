/**
 * GridBuilder.js
 * Helper functions for building grid-based navigation structures
 */

/**
 * Create a grid node
 * @param {string} id - Grid ID
 * @param {Object} config - Grid configuration
 * @returns {Object} Grid node
 */
export function grid(id, config = {}) {
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
  let processedCells;
  let is2DArray = false;
  let rowCount = 0;
  let colCount = 0;
  
  if (cells.length > 0 && Array.isArray(cells[0])) {
    // 2D array format: [[cell1, cell2], [cell3, cell4]]
    is2DArray = true;
    rowCount = cells.length;
    colCount = Math.max(...cells.map(row => row.length));
    
    // Flatten to 1D array
    processedCells = cells.flat().map(c => {
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
    processedCells = cells.map(c => {
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
    cells: processedCells,
    
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
 * @param {string} id - Cell ID (node ID to reference)
 * @param {number} rowSpan - Number of rows cell spans (default 1)
 * @param {number} colSpan - Number of cols cell spans (default 1)
 * @returns {Object} Cell reference
 */
export function cell(id, rowSpan = 1, colSpan = 1) {
  return {
    id,
    rowSpan,
    colSpan
  };
}

/**
 * Calculate grid dimensions from cells
 * @param {Array} cells - Array of cell objects
 * @param {number|string} rows - Explicit rows or 'auto'
 * @param {number|string} cols - Explicit cols or 'auto'
 * @param {boolean} is2DArray - Whether cells came from 2D array
 * @param {number} rowCount - Row count from 2D array
 * @param {number} colCount - Col count from 2D array
 * @returns {Object} { rows, cols }
 */
function calculateDimensions(cells, rows, cols, is2DArray = false, rowCount = 0, colCount = 0) {
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
}

/**
 * Validate grid structure
 * @param {string} id - Grid ID (for error messages)
 * @param {number} rows - Number of rows
 * @param {number} cols - Number of columns
 * @param {Array} cells - Array of cell objects
 */
function validateGrid(id, rows, cols, cells) {
  // Create grid matrix to track cell placement
  const matrix = Array(rows).fill(null).map(() => Array(cols).fill(false));
  
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
 * @param {Object} grid - Grid node
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {Object|null} Cell at coordinates or null
 */
export function getCellAt(grid, row, col) {
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
 * @param {Object} grid - Grid node
 * @param {string} cellId - Cell ID to find
 * @returns {[number, number]|null} [row, col] or null
 */
export function getCellCoords(grid, cellId) {
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
 * @param {number} index - Flat cell index
 * @param {number} cols - Number of columns
 * @returns {[number, number]} [row, col]
 */
export function indexToCoords(index, cols) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return [row, col];
}

/**
 * Convert row/col coordinates to flat index
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} cols - Number of columns
 * @returns {number} Flat index
 */
export function coordsToIndex(row, col, cols) {
  return row * cols + col;
}

/**
 * Check if a cell exists at coordinates
 * @param {Object} grid - Grid node
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {boolean} True if cell exists
 */
export function hasCellAt(grid, row, col) {
  return getCellAt(grid, row, col) !== null;
}

/**
 * Get all cells in a grid
 * @param {Object} grid - Grid node
 * @returns {Array} Array of {cellId, row, col, rowSpan, colSpan}
 */
export function getAllCellsWithCoords(grid) {
  const result = [];
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
