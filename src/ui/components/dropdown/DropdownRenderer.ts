/**
 * @fileoverview Dropdown Renderer
 * Renders inline dropdown menus from semantic tree nodes
 * Integrates with keyboard navigation system
 */

import type { UITreeStore } from '../../semantic-tree/store.js';
import type { KeyboardNavigationManager } from '../../../navigation/KeyboardNavigationManager.js';

export interface DropdownRendererConfig {
  uiTree: UITreeStore;
  navManager: KeyboardNavigationManager;
}

/**
 * Renders and manages inline dropdown menus
 */
export class DropdownRenderer {
  private uiTree: UITreeStore;
  private navManager: KeyboardNavigationManager;
  private activeDropdownId: string | null = null;
  private container: HTMLElement | null = null;

  constructor(config: DropdownRendererConfig) {
    this.uiTree = config.uiTree;
    this.navManager = config.navManager;
    
    // Listen for clicks outside dropdowns to close them
    document.addEventListener('click', (e) => this.handleDocumentClick(e), true);
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  /**
   * Open a dropdown menu
   */
  open(dropdownId: string, triggerElement: HTMLElement): void {
    console.log('[DropdownRenderer] Opening dropdown:', dropdownId);
    
    // Close any existing dropdown
    if (this.activeDropdownId) {
      this.close();
    }

    const dropdownNode = this.uiTree.getNode(dropdownId);
    if (!dropdownNode) {
      console.warn('[DropdownRenderer] Dropdown node not found:', dropdownId);
      return;
    }

    // Create dropdown container
    this.container = document.createElement('div');
    this.container.className = 'dropdown-menu';
    this.container.id = `dropdown-${dropdownId}`;
    
    // Create menu items
    const menuItems = dropdownNode.children || [];
    menuItems.forEach((itemId) => {
      const itemNode = this.uiTree.getNode(itemId);
      if (!itemNode) return;

      const button = document.createElement('button');
      button.className = 'dropdown-item';
      button.id = `dropdown-item-${itemId}`;
      button.textContent = itemNode.meta?.label || '';
      button.dataset.value = String(itemNode.meta?.value ?? '');
      
      // Mark active/selected item
      if (itemNode.primary || itemNode.meta?.selected) {
        button.classList.add('active');
      }

      // Handle click
      button.addEventListener('click', () => {
        console.log('[DropdownRenderer] Item clicked:', itemId, 'value:', itemNode.meta?.value);
        this.selectItem(dropdownId, itemId);
      });

      this.container!.appendChild(button);
      
      // Attach element to tree for keyboard navigation
      this.uiTree.attachElement(itemId, button);
    });

    // Position dropdown near trigger
    this.positionDropdown(this.container, triggerElement);

    // Add to DOM
    document.body.appendChild(this.container);
    this.activeDropdownId = dropdownId;

    // Register with keyboard navigation as an overlay
    // The dropdown is already a grid in the semantic tree, so KNM can navigate it
    console.log('[DropdownRenderer] Opening overlay in KNM:', dropdownId);
    this.navManager.openOverlayById(dropdownId, dropdownNode.meta?.triggerId || null);
  }

  /**
   * Close the active dropdown
   */
  close(): void {
    if (!this.activeDropdownId) return;

    console.log('[DropdownRenderer] Closing dropdown:', this.activeDropdownId);

    // Remove from KNM
    this.navManager.closeOverlay(this.activeDropdownId);

    // Detach elements from tree
    const dropdownNode = this.uiTree.getNode(this.activeDropdownId);
    if (dropdownNode) {
      (dropdownNode.children || []).forEach((itemId) => {
        this.uiTree.attachElement(itemId, null);
      });
    }

    // Remove from DOM
    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    this.activeDropdownId = null;
  }

  /**
   * Handle item selection
   */
  private selectItem(dropdownId: string, itemId: string): void {
    const itemNode = this.uiTree.getNode(itemId);
    if (!itemNode) return;

    const value = itemNode.meta?.value;
    const label = itemNode.meta?.label;

    console.log('[DropdownRenderer] Item selected:', { dropdownId, itemId, value, label });

    // Find the trigger element and update it
    const dropdownNode = this.uiTree.getNode(dropdownId);
    const triggerId = dropdownNode?.meta?.triggerId;
    if (triggerId) {
      const triggerElement = this.uiTree.getElement(triggerId);
      if (triggerElement) {
        // Update trigger's displayed value
        const nameElement = triggerElement.querySelector('.sl-dim-name');
        if (nameElement) {
          nameElement.textContent = label || '';
        }
      }

      // Dispatch a custom event that the app can listen to
      const event = new CustomEvent('dropdown-select', {
        detail: { dropdownId, itemId, value, label, triggerId },
        bubbles: true
      });
      document.dispatchEvent(event);
    }

    // Close dropdown
    this.close();
  }

  /**
   * Position dropdown near trigger element
   */
  private positionDropdown(dropdown: HTMLElement, trigger: HTMLElement): void {
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownHeight = 200; // Approximate max height
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    // Position below trigger if there's space, otherwise above
    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      dropdown.style.top = `${triggerRect.bottom + 2}px`;
    } else {
      dropdown.style.bottom = `${window.innerHeight - triggerRect.top + 2}px`;
    }

    dropdown.style.left = `${triggerRect.left}px`;
    dropdown.style.minWidth = `${triggerRect.width}px`;
  }

  /**
   * Handle clicks outside dropdown
   */
  private handleDocumentClick(e: MouseEvent): void {
    if (!this.activeDropdownId || !this.container) return;

    const target = e.target as HTMLElement;
    
    // Check if click is outside dropdown
    if (!this.container.contains(target)) {
      // Also check if it's not the trigger (which would toggle)
      const dropdownNode = this.uiTree.getNode(this.activeDropdownId);
      const triggerId = dropdownNode?.meta?.triggerId;
      if (triggerId) {
        const triggerElement = this.uiTree.getElement(triggerId);
        if (triggerElement && triggerElement.contains(target)) {
          return; // Let the trigger handle it
        }
      }

      this.close();
    }
  }

  /**
   * Handle keyboard events
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.activeDropdownId) return;

    // Escape closes dropdown
    if (e.key === 'Escape') {
      this.close();
      e.preventDefault();
      e.stopPropagation();
    }

    // Enter selects current item
    if (e.key === 'Enter') {
      const currentFocusId = (this.navManager as any).sessionState?.currentFocusId;
      if (currentFocusId && currentFocusId.startsWith(this.activeDropdownId)) {
        // KNM will handle the activation
      }
    }
  }

  /**
   * Check if a dropdown is currently open
   */
  isOpen(): boolean {
    return this.activeDropdownId !== null;
  }

  /**
   * Get the currently open dropdown ID
   */
  getActiveDropdownId(): string | null {
    return this.activeDropdownId;
  }
}
