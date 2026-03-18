/**
 * Grid Rebuilder
 * Utilities for dynamically rebuilding grid structures based on visibility state
 */

import type { UITreeStore, GridCell } from './store.js';

/**
 * Rebuild the sidebar grid to only include visible items
 */
export function rebuildSidebarGrid(uiTree: UITreeStore): void {
  console.log('[GridRebuilder] Rebuilding sidebar grid...');
  
  const visibleCells: GridCell[] = [];
  
  // Always include control section
  visibleCells.push({ id: 'ctrl-section', rowSpan: 1, colSpan: 1 });
  
  // Add each section's header, and body if expanded
  const sections = [
    { headerId: 'sec-mode:header', bodyId: 'sec-mode-body' },
    { headerId: 'sec-presets:header', bodyId: 'sec-presets-body' },
    { headerId: 'sec-z0:header', bodyId: 'sec-z0-body' },
    { headerId: 'sec-orient:header', bodyId: 'sec-orient-body' },
    { headerId: 'sec-sim:header', bodyId: 'sec-sim-body' },
    { headerId: 'sec-state:header', bodyId: 'sec-state-body' }
  ];
  
  for (const section of sections) {
    // Always add header
    visibleCells.push({ id: section.headerId, rowSpan: 1, colSpan: 1 });
    
    // Add body if not hidden
    const bodyNode = uiTree.getNode(section.bodyId);
    if (bodyNode && !bodyNode.hidden) {
      visibleCells.push({ id: section.bodyId, rowSpan: 1, colSpan: 1 });
    }
  }
  
  console.log('[GridRebuilder] Sidebar cells:', visibleCells.length, 'visible');
  
  // Update sidebar grid
  uiTree.updateNode('sidebar', {
    cells: visibleCells,
    rows: visibleCells.length,
    cols: 1
  });
}

/**
 * Rebuild the presets grid based on whether custom preset is selected
 */
export function rebuildPresetsGrid(uiTree: UITreeStore, isCustomActive: boolean): void {
  console.log('[GridRebuilder] Rebuilding presets grid, custom active:', isCustomActive);
  
  const cells: GridCell[] = [
    { id: 'preset-shape', rowSpan: 1, colSpan: 1 },
    { id: 'preset-prho', rowSpan: 1, colSpan: 1 },
    { id: 'preset-plambda', rowSpan: 1, colSpan: 1 },
    { id: 'preset-shape_pl', rowSpan: 1, colSpan: 1 },
    { id: 'preset-custom', rowSpan: 1, colSpan: 2 }
  ];
  
  // Add custom controls if custom preset is active
  if (isCustomActive) {
    cells.push(
      { id: 'customDimH-picker:trigger', rowSpan: 1, colSpan: 1 },  // H-axis in left column
      { id: 'customDimV-picker:trigger', rowSpan: 1, colSpan: 1 },  // V-axis in right column
      { id: 'slider-customMag', rowSpan: 1, colSpan: 2 }  // Mag slider spans both columns
    );
  }
  
  console.log('[GridRebuilder] Presets cells:', cells.length);
  
  // Calculate rows by simulating grid layout
  let currentRow = 0;
  let currentCol = 0;
  const cols = 2;
  
  for (const cell of cells) {
    // Move to next row if we can't fit in current row
    while (currentCol >= cols) {
      currentCol = 0;
      currentRow++;
    }
    
    // Place cell
    currentCol += cell.colSpan;
    
    // If we filled the row, move to next
    if (currentCol >= cols) {
      currentCol = 0;
      currentRow++;
    }
  }
  
  const rows = currentRow;  // Total rows used
  console.log('[GridRebuilder] Calculated rows:', rows, 'for', cells.length, 'cells');
  
  uiTree.updateNode('sec-presets-body', {
    cells: cells,
    rows: rows,
    cols: 2
  });
}
