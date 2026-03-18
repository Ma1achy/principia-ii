/**
 * @fileoverview Picker Label Component
 * Applies dynamic text-fitting to picker dropdown labels
 */

import { fitTextToWidth } from '../../../utils/textFit.js';

/**
 * Apply dynamic text-fitting behavior to a picker label
 * @param label - The .sl-dim-label element
 */
function attachDynamicBehavior(label: HTMLElement | null): void {
  if (!label) return;
  
  // Add the dynamic class
  label.classList.add('dynamic-picker-label');
  
  // Find the text element (child with .sl-dim-text)
  const textEl = label.querySelector('.sl-dim-text') as HTMLElement | null;
  if (!textEl) return;
  
  // Force layout recalculation
  label.offsetHeight;
  
  // Get computed styles for accurate measurements
  const labelStyle = window.getComputedStyle(label);
  const paddingLeft = parseFloat(labelStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(labelStyle.paddingRight) || 0;
  const borderLeft = parseFloat(labelStyle.borderLeftWidth) || 0;
  const borderRight = parseFloat(labelStyle.borderRightWidth) || 0;
  
  // Arrow has fixed width of 12px + 4px margin-left = 16px total
  const arrowWidth = 16;
  
  // Gap between text and arrow (from flex gap)
  const gap = 2;
  
  // Calculate available width for text
  const labelWidth = label.offsetWidth;
  const availableWidth = labelWidth - paddingLeft - paddingRight - borderLeft - borderRight - arrowWidth - gap;
  
  // Skip if layout hasn't completed yet (invalid width)
  if (availableWidth <= 0 || !isFinite(availableWidth)) {
    return;
  }
  
  // Apply text fitting with max font-size 11px and initial letter-spacing 0.04em
  fitTextToWidth(textEl, availableWidth, {
    maxLetterSpacing: 0.04
  });
}

/**
 * Apply dynamic text-fitting to multiple picker labels
 * @param labels - Array or NodeList of .sl-dim-label elements
 */
export function attachDynamicBehaviorBatch(labels: HTMLElement[] | NodeListOf<Element>): void {
  labels.forEach(label => attachDynamicBehavior(label as HTMLElement));
}

/**
 * Initialize all picker labels on the page with dynamic behavior
 */
export function initializePickerLabels(): void {
  // Wait for next frame to ensure layout is complete
  requestAnimationFrame(() => {
    const labels = document.querySelectorAll('.sl-dim-label');
    attachDynamicBehaviorBatch(labels);
    
    // Retry after a short delay for dynamically created pickers that may not be laid out yet
    setTimeout(() => {
      attachDynamicBehaviorBatch(labels);
    }, 50);
    
    // Re-fit on window resize
    let resizeTimeout: number | undefined;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        attachDynamicBehaviorBatch(labels);
      }, 150);
    });
  });
}
