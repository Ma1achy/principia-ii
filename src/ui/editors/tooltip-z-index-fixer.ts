/**
 * CodeMirror Tooltip Z-Index Fixer
 * 
 * CodeMirror tooltips are created dynamically with inline styles that may override CSS.
 * This observer watches for tooltip creation and ensures they use the correct z-index.
 */

import { ZIndex } from '../core/z-index.js';

/**
 * Start observing for CodeMirror tooltip creation
 */
export function initTooltipZIndexFixer(): void {
  const tooltipZIndex = ZIndex.forTooltip();
  
  console.log('[TooltipZIndexFixer] Initializing with z-index:', tooltipZIndex);
  
  // Watch for tooltip elements being added to the DOM
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          // Check if this is a CodeMirror tooltip
          if (isTooltipElement(node)) {
            console.log('[TooltipZIndexFixer] Found tooltip element:', node.className);
            fixTooltipZIndex(node);
          }
          
          // Also check children (tooltips may be nested)
          const tooltips = node.querySelectorAll('[class*="cm-tooltip"]');
          if (tooltips.length > 0) {
            console.log('[TooltipZIndexFixer] Found', tooltips.length, 'nested tooltip(s)');
            tooltips.forEach((tooltip) => {
              if (tooltip instanceof HTMLElement) {
                fixTooltipZIndex(tooltip);
              }
            });
          }
        }
      });
    });
  });
  
  // Observe the entire document for tooltip additions
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also fix any existing tooltips immediately
  fixAllTooltips();
  
  console.log('[TooltipZIndexFixer] ✓ Initialized - watching for CodeMirror tooltips');
}

/**
 * Check if an element is a tooltip
 */
function isTooltipElement(element: HTMLElement): boolean {
  const classList = element.classList;
  const className = element.className;
  
  return (
    classList.contains('cm-tooltip') ||
    classList.contains('cm-tooltip-lint') ||
    classList.contains('cm-tooltip-hover') ||
    classList.contains('cm-tooltip-autocomplete') ||
    className.includes('cm-tooltip')
  );
}

/**
 * Fix z-index for a single tooltip element
 */
function fixTooltipZIndex(tooltip: HTMLElement): void {
  const tooltipZIndex = ZIndex.forTooltip();
  
  // Get current z-index for logging
  const currentZIndex = tooltip.style.zIndex || window.getComputedStyle(tooltip).zIndex;
  
  // Force z-index with !important via inline style
  tooltip.style.setProperty('z-index', String(tooltipZIndex), 'important');
  
  // Also set position to ensure it's in the correct stacking context
  if (!tooltip.style.position || tooltip.style.position === 'static') {
    tooltip.style.position = 'fixed';
  }
  
  // Force it to be a new stacking context
  tooltip.style.isolation = 'isolate';
  
  console.log('[TooltipZIndexFixer] Fixed tooltip:', {
    className: tooltip.className,
    oldZIndex: currentZIndex,
    newZIndex: tooltipZIndex,
    position: tooltip.style.position
  });
}

/**
 * Manually fix all existing tooltips (call after editor creation)
 */
export function fixAllTooltips(): void {
  const tooltips = document.querySelectorAll('[class*="cm-tooltip"]');
  
  if (tooltips.length > 0) {
    console.log('[TooltipZIndexFixer] Fixing', tooltips.length, 'existing tooltip(s)');
    
    tooltips.forEach((tooltip) => {
      if (tooltip instanceof HTMLElement) {
        fixTooltipZIndex(tooltip);
      }
    });
  }
}
