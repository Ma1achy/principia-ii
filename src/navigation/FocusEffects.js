/**
 * FocusEffects - DOM operations for focus management
 * Injected into KeyboardNavigationManager for testability
 */

/**
 * DOM-based focus effects implementation
 */
export class DOMFocusEffects {
  /**
   * Apply focus to an element
   * @param {HTMLElement} element - Element to focus
   * @param {Object} options - Focus options
   */
  applyFocus(element, options = {}) {
    if (!element) return;
    
    const { preventScroll = false } = options;
    
    try {
      element.focus({ preventScroll });
    } catch (error) {
      console.warn('[FocusEffects] Focus failed:', error);
    }
  }

  /**
   * Remove focus from an element
   * @param {HTMLElement} element - Element to blur
   */
  removeFocus(element) {
    if (!element) return;
    
    try {
      element.blur();
    } catch (error) {
      console.warn('[FocusEffects] Blur failed:', error);
    }
  }

  /**
   * Set tabindex on an element
   * @param {HTMLElement} element - Element
   * @param {number} value - Tabindex value (0 or -1)
   */
  setTabindex(element, value) {
    if (!element) return;
    
    element.setAttribute('tabindex', String(value));
  }

  /**
   * Scroll element into view
   * @param {HTMLElement} element - Element to scroll to
   * @param {Object} options - Scroll options
   */
  scrollIntoView(element, options = {}) {
    if (!element) return;
    
    const {
      behavior = 'smooth',
      block = 'nearest',
      inline = 'nearest'
    } = options;
    
    try {
      element.scrollIntoView({ behavior, block, inline });
    } catch (error) {
      // Fallback for browsers that don't support options
      element.scrollIntoView();
    }
  }

  /**
   * Get currently focused element
   * @returns {HTMLElement|null} Currently focused element
   */
  getActiveElement() {
    return document.activeElement;
  }

  /**
   * Check if element is visible in viewport
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element is visible
   */
  isInViewport(element) {
    if (!element) return false;
    
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
}

/**
 * Null focus effects (for testing)
 * Records all calls without performing DOM operations
 */
export class NullFocusEffects {
  constructor() {
    this.calls = [];
  }

  applyFocus(element, options = {}) {
    this.calls.push({ method: 'applyFocus', element, options });
  }

  removeFocus(element) {
    this.calls.push({ method: 'removeFocus', element });
  }

  setTabindex(element, value) {
    this.calls.push({ method: 'setTabindex', element, value });
  }

  scrollIntoView(element, options = {}) {
    this.calls.push({ method: 'scrollIntoView', element, options });
  }

  getActiveElement() {
    this.calls.push({ method: 'getActiveElement' });
    return null;
  }

  isInViewport(element) {
    this.calls.push({ method: 'isInViewport', element });
    return true;
  }

  /**
   * Clear recorded calls
   */
  clearCalls() {
    this.calls = [];
  }

  /**
   * Get calls for a specific method
   * @param {string} method - Method name
   * @returns {Array} Array of call records
   */
  getCallsFor(method) {
    return this.calls.filter(call => call.method === method);
  }
}
