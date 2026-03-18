/**
 * FocusEffects - DOM operations for focus management
 * Injected into KeyboardNavigationManager for testability
 */

interface FocusOptions {
  preventScroll?: boolean;
}

interface ScrollOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
}

interface CallRecord {
  method: string;
  element?: HTMLElement | null;
  options?: any;
  value?: number;
}

/**
 * DOM-based focus effects implementation
 */
export class DOMFocusEffects {
  /**
   * Apply focus to an element
   */
  applyFocus(element: HTMLElement | null, options: FocusOptions = {}): void {
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
   */
  removeFocus(element: HTMLElement | null): void {
    if (!element) return;
    
    try {
      element.blur();
    } catch (error) {
      console.warn('[FocusEffects] Blur failed:', error);
    }
  }

  /**
   * Set tabindex on an element
   */
  setTabindex(element: HTMLElement | null, value: number): void {
    if (!element) return;
    
    element.setAttribute('tabindex', String(value));
  }

  /**
   * Scroll element into view
   */
  scrollIntoView(element: HTMLElement | null, options: ScrollOptions = {}): void {
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
   */
  getActiveElement(): Element | null {
    return document.activeElement;
  }

  /**
   * Check if element is visible in viewport
   */
  isInViewport(element: HTMLElement | null): boolean {
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
  calls: CallRecord[];

  constructor() {
    this.calls = [];
  }

  applyFocus(element: HTMLElement | null, options: FocusOptions = {}): void {
    this.calls.push({ method: 'applyFocus', element, options });
  }

  removeFocus(element: HTMLElement | null): void {
    this.calls.push({ method: 'removeFocus', element });
  }

  setTabindex(element: HTMLElement | null, value: number): void {
    this.calls.push({ method: 'setTabindex', element, value });
  }

  scrollIntoView(element: HTMLElement | null, options: ScrollOptions = {}): void {
    this.calls.push({ method: 'scrollIntoView', element, options });
  }

  getActiveElement(): null {
    this.calls.push({ method: 'getActiveElement' });
    return null;
  }

  isInViewport(element: HTMLElement | null): boolean {
    this.calls.push({ method: 'isInViewport', element });
    return true;
  }

  /**
   * Clear recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Get calls for a specific method
   */
  getCallsFor(method: string): CallRecord[] {
    return this.calls.filter(call => call.method === method);
  }
}
