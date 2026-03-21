/**
 * @fileoverview Picker Keyboard Navigation Integration
 * Registers existing full-screen pickers with the keyboard navigation system
 */

import type { UITreeStore } from '../semantic-tree/store.js';

export interface PickerIntegrationConfig {
  uiTree: UITreeStore;
  pickerId: string;
  overlayElement: HTMLElement;
  listElement: HTMLElement;
  closeButtonElement: HTMLElement;
  itemCount: number;
  triggerId?: string;  // ID of the button that opened the picker
  onClose?: () => void;  // Callback to clean up picker state
}

/**
 * Register a full-screen picker overlay with keyboard navigation
 * Call this when the picker DOM opens
 */
export function registerPickerOverlay(config: PickerIntegrationConfig): void {
  const { uiTree, pickerId, overlayElement, listElement, closeButtonElement, itemCount, triggerId, onClose } = config;
  
  console.log('[PickerKN] Registering picker overlay:', pickerId, 'items:', itemCount, 'trigger:', triggerId);
  
  // Build menu item nodes
  const menuItemNodes: any[] = [];
  const menuItemButtons = listElement.querySelectorAll('.tilt-pick-btn');
  
  menuItemButtons.forEach((button, index) => {
    const itemId = `${pickerId}:item-${index}`;
    const isActive = button.classList.contains('active');
    
    const itemNode = {
      id: itemId,
      kind: 'menu-item',
      parentId: pickerId,  // Direct child of overlay, no intermediate grid
      children: [],
      focusMode: 'leaf',
      primary: isActive,
      role: 'menu-item',
      meta: {
        ariaRole: 'menuitemradio',
        ariaLabel: button.textContent || `Item ${index}`,
        label: button.textContent || `Item ${index}`,
        index
      }
    };
    
    menuItemNodes.push(itemNode);
  });
  
  // Build close button node
  const closeButtonNode = {
    id: `${pickerId}:close`,
    kind: 'picker-close-button',  // Special kind for picker close buttons
    parentId: pickerId,
    children: [],
    focusMode: 'leaf',
    role: 'picker-close-button',
    meta: {
      ariaRole: 'button',
      ariaLabel: 'Close',
      intent: 'cancel'
    }
  };
  
  // Build picker overlay node as a simple grid
  // Layout: close button at top, then all menu items
  const allChildren = [closeButtonNode.id, ...menuItemNodes.map(n => n.id)];
  const pickerNode = {
    id: pickerId,
    kind: 'grid',
    parentId: null,
    children: allChildren,
    rows: allChildren.length,
    cols: 1,
    cells: allChildren.map(id => ({ id, rowSpan: 1, colSpan: 1 })),
    focusMode: 'entry-node',
    entryPolicy: 'explicit',
    entryCell: 1, // Enter at first menu item, not close button
    isOverlay: true,
    overlay: true,
    closeOnEscape: true,
    wrapRows: true,
    meta: {
      modal: true,
      ariaRole: 'dialog',
      ariaLabel: 'Picker menu'
    }
  };
  
  // Add all nodes to tree
  uiTree.addNodes([pickerNode, closeButtonNode, ...menuItemNodes]);
  
  // Attach DOM elements
  uiTree.attachElement(pickerId, overlayElement);
  uiTree.attachElement(`${pickerId}:close`, closeButtonElement);
  
  menuItemButtons.forEach((button, index) => {
    uiTree.attachElement(`${pickerId}:item-${index}`, button as HTMLElement);
  });
  
  // Listen for KNM's overlay:before-close event to clean up picker
  if (onClose) {
    const closeHandler = (event: any) => {
      if (event.id === pickerId) {
        console.log('[PickerKN] overlay:before-close received, calling onClose');
        onClose();
        
        // Important: Complete the overlay close in KNM after picker is closed
        const navManager = (window as any).navManager;
        if (navManager) {
          console.log('[PickerKN] Calling completeOverlayClose on navManager');
          // Use setTimeout to ensure picker DOM updates complete first
          setTimeout(() => {
            navManager.completeOverlayClose(pickerId);
          }, 0);
        }
        
        // Remove this listener after it fires once
        uiTree._events.off('overlay:before-close', closeHandler);
      }
    };
    uiTree._events.on('overlay:before-close', closeHandler);
  }
  
  // Use new openOverlay method for stack-based rendering
  if ((window as any).navManager) {
    console.log('[PickerKN] Opening overlay via navManager:', pickerId, 'triggerId:', triggerId);
    (window as any).navManager.openOverlay(pickerId, triggerId, 'picker');
  } else {
    // Fallback to old event-based system
    console.log('[PickerKN] Emitting overlay:registered event with triggerId:', triggerId);
    uiTree._events.emit('overlay:registered', { id: pickerId, triggerId });
  }
}

/**
 * Unregister a picker overlay when it closes
 */
export function unregisterPickerOverlay(uiTree: UITreeStore, pickerId: string): void {
  console.log('[PickerKN] Unregistering picker overlay:', pickerId);
  
  // Use new closeOverlay method
  if ((window as any).navManager) {
    console.log('[PickerKN] Closing overlay via navManager:', pickerId);
    (window as any).navManager.closeOverlay(pickerId);
  }
  
  // Remove nodes from tree
  try {
    uiTree.removeSubtree(pickerId);
  } catch (err) {
    console.warn('[PickerKN] Failed to remove picker subtree:', err);
  }
}
