/**
 * @fileoverview Dynamic Button Component
 * Buttons with automatic text fitting - adjusts font-size and letter-spacing
 * to fit text within container width.
 * 
 * Styling contract:
 * - dynamic-button.css defines maximum font-size and initial letter-spacing
 * - JS reads these CSS values and may reduce them dynamically
 * - CSS must be loaded via <link> tag in index.html
 * 
 * Usage:
 * ```javascript
 * // Option 1: Create new button
 * const btn = createDynamicButton({
 *   label: 'CONFIRM',
 *   role: 'primary',
 *   onClick: () => console.log('clicked')
 * });
 * 
 * // Option 2: Enhance existing button
 * const btn = document.querySelector('.btn');
 * attachDynamicBehavior(btn, { targetWidth: 'auto' });
 * ```
 */

import { fitTextToWidth } from '../../../utils/textFit.js';

/**
 * Create a new dynamic button with text-fitting behavior
 * @param {Object} options - Button configuration
 * @param {string} options.label - Button text
 * @param {string} [options.role='secondary'] - Button role: 'primary' | 'secondary' | 'danger'
 * @param {Function} [options.onClick] - Click handler
 * @param {boolean} [options.disabled=false] - Disabled state
 * @param {string} [options.id] - Button ID
 * @param {Object} [options.dataset] - Data attributes
 * @returns {HTMLButtonElement} Button element with dynamic behavior attached
 */
export function createDynamicButton(options = {}) {
  const {
    label = 'Button',
    role = 'secondary',
    onClick = null,
    disabled = false,
    id = null,
    dataset = {}
  } = options;
  
  const btn = document.createElement('button');
  btn.className = 'btn dynamic-btn';
  btn.textContent = label;
  
  // Apply role class
  if (role === 'primary') btn.classList.add('primary');
  if (role === 'danger') btn.classList.add('danger');
  
  // Apply disabled state
  if (disabled) btn.disabled = true;
  
  // Apply ID
  if (id) btn.id = id;
  
  // Apply data attributes
  Object.entries(dataset).forEach(([key, value]) => {
    btn.dataset[key] = value;
  });
  
  // Attach click handler
  if (onClick) {
    btn.addEventListener('click', onClick);
  }
  
  // Attach dynamic behavior
  attachDynamicBehavior(btn, {
    targetWidth: 'auto',
    internalMargin: 16
  });
  
  return btn;
}

/**
 * Attach dynamic text-fitting behavior to an existing button
 * Automatically resizes text to fit within button width on render and resize
 * 
 * @param {HTMLButtonElement} btn - Button element to enhance
 * @param {Object} [options] - Fitting configuration
 * @param {number|'auto'} [options.targetWidth='auto'] - Target width in pixels, or 'auto' to use button width
 * @param {number} [options.internalMargin=16] - Internal margin for breathing room (total, not per-side)
 * @returns {Object} Control object with update() and cleanup() methods
 */
export function attachDynamicBehavior(btn, options = {}) {
  const {
    targetWidth = 'auto',
    internalMargin = 16
  } = options;
  
  // Add dynamic class for CSS styling
  if (!btn.classList.contains('dynamic-btn')) {
    btn.classList.add('dynamic-btn');
  }
  
  // Fit function - updates button text sizing
  const fitButtonText = () => {
    console.log('[DynamicButton] Fitting button text:', btn.textContent.substring(0, 20));
    
    // Reset to CSS defaults by clearing inline styles
    btn.style.fontSize = '';
    btn.style.letterSpacing = '';
    
    // Wait for next frame to ensure layout is complete
    requestAnimationFrame(() => {
      // Calculate available width
      const btnRect = btn.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(btn);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      
      const availableWidth = targetWidth === 'auto'
        ? btnRect.width - paddingLeft - paddingRight - internalMargin
        : targetWidth - internalMargin;
      
      console.log('[DynamicButton] Fitting:', {
        buttonWidth: btnRect.width,
        padding: paddingLeft + paddingRight,
        availableWidth: availableWidth,
        textLength: btn.textContent.length,
        cssFontSize: computedStyle.fontSize,
        cssLetterSpacing: computedStyle.letterSpacing
      });
      
      if (availableWidth > 0) {
        fitTextToWidth(btn, availableWidth);
      }
    });
  };
  
  // Initial fit
  fitButtonText();
  
  // Re-fit on window resize
  const resizeHandler = () => {
    console.log('[DynamicButton] Resize event fired');
    fitButtonText();
  };
  
  window.addEventListener('resize', resizeHandler);
  
  // Store cleanup function on button element
  const cleanup = () => {
    console.log('[DynamicButton] Cleaning up resize handler');
    window.removeEventListener('resize', resizeHandler);
  };
  
  // Return control object
  return {
    update: fitButtonText,
    cleanup: cleanup
  };
}

/**
 * Attach dynamic behavior to multiple buttons
 * @param {HTMLButtonElement[]} buttons - Array of button elements
 * @param {Object} [options] - Fitting configuration (same as attachDynamicBehavior)
 * @returns {Object[]} Array of control objects
 */
export function attachDynamicBehaviorBatch(buttons, options = {}) {
  return buttons.map(btn => attachDynamicBehavior(btn, options));
}

/**
 * Create a button container and automatically fit buttons within it
 * Useful for dialog button groups
 * 
 * @param {Array<Object>} buttonConfigs - Array of button configurations (same as createDynamicButton)
 * @param {string} [containerClass='dialog-buttons'] - Container CSS class
 * @returns {HTMLElement} Container element with buttons
 */
export function createDynamicButtonGroup(buttonConfigs, containerClass = 'dialog-buttons') {
  const container = document.createElement('div');
  container.className = containerClass;
  
  const buttons = buttonConfigs.map(config => {
    const btn = createDynamicButton(config);
    container.appendChild(btn);
    return btn;
  });
  
  return container;
}
