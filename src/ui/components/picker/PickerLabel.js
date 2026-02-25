/**
 * @fileoverview Picker Label Component
 * Applies dynamic text-fitting to picker dropdown labels
 */

import { fitTextToWidth } from '../../../utils/textFit.js';

/**
 * Apply dynamic text-fitting behavior to a picker label
 * @param {HTMLElement} label - The .sl-dim-label element
 */
function attachDynamicBehavior(label) {
  if (!label) return;
  
  // Add the dynamic class
  label.classList.add('dynamic-picker-label');
  
  // Find the text element (child with .sl-dim-text)
  const textEl = label.querySelector('.sl-dim-text');
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
  
  // Apply text fitting with max font-size 11px and initial letter-spacing 0.04em
  fitTextToWidth(textEl, availableWidth, 11, 0.04);
}

/**
 * Apply dynamic text-fitting to multiple picker labels
 * @param {HTMLElement[]|NodeList} labels - Array or NodeList of .sl-dim-label elements
 */
export function attachDynamicBehaviorBatch(labels) {
  labels.forEach(label => attachDynamicBehavior(label));
}

/**
 * Initialize all picker labels on the page with dynamic behavior
 */
export function initializePickerLabels() {
  // Wait for next frame to ensure layout is complete
  requestAnimationFrame(() => {
    const labels = document.querySelectorAll('.sl-dim-label');
    attachDynamicBehaviorBatch(labels);
    
    // Re-fit on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        attachDynamicBehaviorBatch(labels);
      }, 150);
    });
  });
}
