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
 * ```typescript
 * // Option 1: Create new button
 * const btn = createDynamicButton({
 *   label: 'CONFIRM',
 *   role: 'primary',
 *   onClick: () => console.log('clicked')
 * });
 * 
 * // Option 2: Enhance existing button
 * const btn = document.querySelector('.btn') as HTMLButtonElement;
 * attachDynamicBehavior(btn, { targetWidth: 'auto' });
 * ```
 */

import { fitTextToWidth } from '../../../utils/textFit.js';

/**
 * Button role variants
 */
export type ButtonRole = 'primary' | 'secondary' | 'danger';

/**
 * Button configuration options
 */
export interface DynamicButtonOptions {
  /** Button text */
  label?: string;
  /** Button role: 'primary' | 'secondary' | 'danger' */
  role?: ButtonRole;
  /** Click handler */
  onClick?: (() => void) | null;
  /** Disabled state */
  disabled?: boolean;
  /** Button ID */
  id?: string | null;
  /** Data attributes */
  dataset?: Record<string, string>;
}

/**
 * Dynamic behavior options
 */
export interface DynamicBehaviorOptions {
  /** Target width in pixels, or 'auto' to use button width */
  targetWidth?: number | 'auto';
  /** Internal margin for breathing room (total, not per-side) */
  internalMargin?: number;
}

/**
 * Control object returned by attachDynamicBehavior
 */
export interface DynamicBehaviorControl {
  /** Update/refit the button text */
  update: () => void;
  /** Remove resize listener and cleanup */
  cleanup: () => void;
}

/**
 * Create a new dynamic button with text-fitting behavior
 * @param options - Button configuration
 * @returns Button element with dynamic behavior attached
 */
export function createDynamicButton(options: DynamicButtonOptions = {}): HTMLButtonElement {
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
 * @param btn - Button element to enhance
 * @param options - Fitting configuration
 * @returns Control object with update() and cleanup() methods
 */
export function attachDynamicBehavior(
  btn: HTMLButtonElement,
  options: DynamicBehaviorOptions = {}
): DynamicBehaviorControl {
  const {
    targetWidth = 'auto',
    internalMargin = 16
  } = options;
  
  // Add dynamic class for CSS styling
  if (!btn.classList.contains('dynamic-btn')) {
    btn.classList.add('dynamic-btn');
  }
  
  // Fit function - updates button text sizing
  const fitButtonText = (): void => {
    console.log('[DynamicButton] Fitting button text:', btn.textContent?.substring(0, 20));
    
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
        textLength: btn.textContent?.length,
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
  const resizeHandler = (): void => {
    console.log('[DynamicButton] Resize event fired');
    fitButtonText();
  };
  
  window.addEventListener('resize', resizeHandler);
  
  // Store cleanup function on button element
  const cleanup = (): void => {
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
 * @param buttons - Array of button elements
 * @param options - Fitting configuration (same as attachDynamicBehavior)
 * @returns Array of control objects
 */
export function attachDynamicBehaviorBatch(
  buttons: HTMLButtonElement[],
  options: DynamicBehaviorOptions = {}
): DynamicBehaviorControl[] {
  return buttons.map(btn => attachDynamicBehavior(btn, options));
}

/**
 * Create a button container and automatically fit buttons within it
 * Useful for dialog button groups
 * 
 * @param buttonConfigs - Array of button configurations (same as createDynamicButton)
 * @param containerClass - Container CSS class
 * @returns Container element with buttons
 */
export function createDynamicButtonGroup(
  buttonConfigs: DynamicButtonOptions[],
  containerClass: string = 'dialog-buttons'
): HTMLElement {
  const container = document.createElement('div');
  container.className = containerClass;
  
  const buttons = buttonConfigs.map(config => {
    const btn = createDynamicButton(config);
    container.appendChild(btn);
    return btn;
  });
  
  return container;
}
