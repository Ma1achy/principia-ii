/**
 * StackRenderer - Synchronizes DOM state with navigation stack
 * Ensures that visible overlays, focus state, and ARIA attributes match the current stack
 */

import type { NavigationFrame } from './NavigationStack.js';
import type { UITreeStore } from '../ui/semantic-tree/store.js';
import type { FocusVisualizer } from './FocusVisualizer.js';

/**
 * StackRenderer configuration
 */
export interface StackRendererConfig {
  uiTree: UITreeStore;
  visualizer?: FocusVisualizer;
}

/**
 * StackRenderer - renders DOM state based on navigation stack
 */
export class StackRenderer {
  private uiTree: UITreeStore;
  private visualizer: FocusVisualizer | null;
  private visibleOverlays: Set<string>;
  
  constructor(config: StackRendererConfig) {
    this.uiTree = config.uiTree;
    this.visualizer = config.visualizer || null;
    this.visibleOverlays = new Set();
  }
  
  /**
   * Render the current frame (called automatically after stack changes)
   */
  render(frame: NavigationFrame | null): void {
    console.log('[StackRenderer] Rendering frame:', frame?.type || 'null');
    
    if (!frame) {
      this.hideAll();
      return;
    }
    
    // Render based on frame type
    switch (frame.type) {
      case 'overlay':
        this.renderOverlay(frame);
        break;
      case 'interaction':
        this.renderInteraction(frame);
        break;
      case 'grid':
        this.renderGrid(frame);
        break;
    }
  }
  
  /**
   * Render an overlay frame
   */
  private renderOverlay(frame: NavigationFrame): void {
    const overlayId = frame.overlayId;
    if (!overlayId) {
      console.warn('[StackRenderer] Overlay frame missing overlayId');
      return;
    }
    
    // Show the overlay
    this.showOverlay(overlayId);
    
    // Update visualizer for focused element within overlay
    this.updateVisualizer(frame);
  }
  
  /**
   * Render an interaction frame
   */
  private renderInteraction(frame: NavigationFrame): void {
    // Interaction mode just updates the visualizer to cyan
    this.updateVisualizer(frame);
  }
  
  /**
   * Render a grid frame
   */
  private renderGrid(frame: NavigationFrame): void {
    // Grid frame just updates the visualizer to orange
    this.updateVisualizer(frame);
  }
  
  /**
   * Show an overlay element
   */
  showOverlay(overlayId: string): void {
    if (this.visibleOverlays.has(overlayId)) {
      console.log('[StackRenderer] Overlay already visible:', overlayId);
      return;
    }
    
    const element = this.uiTree.getElement(overlayId);
    if (!element) {
      console.warn('[StackRenderer] Overlay element not found:', overlayId);
      return;
    }
    
    console.log('[StackRenderer] Showing overlay:', overlayId);
    element.classList.add('open');
    element.setAttribute('aria-hidden', 'false');
    this.visibleOverlays.add(overlayId);
  }
  
  /**
   * Hide an overlay element
   */
  hideOverlay(overlayId: string): void {
    if (!this.visibleOverlays.has(overlayId)) {
      console.log('[StackRenderer] Overlay already hidden:', overlayId);
      return;
    }
    
    const element = this.uiTree.getElement(overlayId);
    if (!element) {
      console.warn('[StackRenderer] Overlay element not found:', overlayId);
      return;
    }
    
    console.log('[StackRenderer] Hiding overlay:', overlayId);
    element.classList.remove('open');
    element.setAttribute('aria-hidden', 'true');
    this.visibleOverlays.delete(overlayId);
  }
  
  /**
   * Update the focus visualizer based on the current frame
   */
  private updateVisualizer(frame: NavigationFrame): void {
    if (!this.visualizer) return;
    
    const element = this.uiTree.getElement(frame.cellId);
    if (!element) {
      console.warn('[StackRenderer] Element not found for cell:', frame.cellId);
      return;
    }
    
    const node = this.uiTree.getNode(frame.cellId);
    if (!node) {
      console.warn('[StackRenderer] Node not found for cell:', frame.cellId);
      return;
    }
    
    // Determine visualizer state
    const isInteracting = frame.type === 'interaction';
    const isEnterable = node.focusMode === 'entry-node' || node.kind === 'grid';
    
    this.visualizer.render({
      element,
      isEnterable,
      isInteracting
    });
  }
  
  /**
   * Hide all overlays and the visualizer
   */
  hideAll(): void {
    console.log('[StackRenderer] Hiding all overlays');
    
    // Hide all tracked overlays
    const overlaysToHide = Array.from(this.visibleOverlays);
    overlaysToHide.forEach(overlayId => {
      this.hideOverlay(overlayId);
    });
    
    // Hide visualizer
    if (this.visualizer) {
      this.visualizer.hide();
    }
  }
  
  /**
   * Sync renderer state with a complete stack
   * Ensures all overlays in the stack are visible
   */
  syncWithStack(frames: ReadonlyArray<NavigationFrame>): void {
    console.log('[StackRenderer] Syncing with stack of', frames.length, 'frames');
    
    // Collect all overlay IDs that should be visible
    const shouldBeVisible = new Set<string>();
    frames.forEach(frame => {
      if (frame.type === 'overlay' && frame.overlayId) {
        shouldBeVisible.add(frame.overlayId);
      }
    });
    
    // Hide overlays that shouldn't be visible
    this.visibleOverlays.forEach(overlayId => {
      if (!shouldBeVisible.has(overlayId)) {
        this.hideOverlay(overlayId);
      }
    });
    
    // Show overlays that should be visible
    shouldBeVisible.forEach(overlayId => {
      if (!this.visibleOverlays.has(overlayId)) {
        this.showOverlay(overlayId);
      }
    });
    
    // Render the top frame
    const topFrame = frames.length > 0 ? frames[frames.length - 1] : null;
    if (topFrame) {
      this.updateVisualizer(topFrame);
    }
  }
  
  /**
   * Check if an overlay is currently visible
   */
  isOverlayVisible(overlayId: string): boolean {
    return this.visibleOverlays.has(overlayId);
  }
  
  /**
   * Get all currently visible overlays
   */
  getVisibleOverlays(): string[] {
    return Array.from(this.visibleOverlays);
  }
}
