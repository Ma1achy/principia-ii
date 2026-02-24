/**
 * @fileoverview Text Fitting Utility
 * Provides methods to fit text to element width by adjusting letter-spacing and font-size
 * Used by Chazy subtitle system and dialog buttons
 */

/**
 * Fit text to element width by adjusting letter-spacing and/or font-size
 * Uses binary search to find optimal letter-spacing, then scales font-size if needed
 * 
 * @param {HTMLElement} el - Element containing text to fit
 * @param {number} targetWidth - Target width in pixels
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.minLetterSpacing=0.00] - Minimum letter-spacing in em
 * @param {number} [options.maxLetterSpacing=0.50] - Maximum letter-spacing in em
 * @param {number} [options.iterations=20] - Binary search iterations (more = more precise)
 * @param {boolean} [options.allowFontResize=true] - Allow font-size reduction if letter-spacing isn't enough
 * 
 * @example
 * // Fit button text to button width
 * const btn = document.querySelector('.btn');
 * const targetWidth = btn.clientWidth - paddingLeft - paddingRight;
 * fitTextToWidth(btn, targetWidth);
 * 
 * @example
 * // Fit subtitle to match title width
 * const subtitle = document.querySelector('.subtitle');
 * fitTextToWidth(subtitle, 400, { maxLetterSpacing: 0.50 });
 */
export function fitTextToWidth(el, targetWidth, options = {}) {
  // Defensive checks
  if (!el || !(el instanceof HTMLElement)) {
    console.warn('[textFit] Invalid element provided');
    return;
  }
  
  if (typeof targetWidth !== 'number' || targetWidth <= 0) {
    console.warn('[textFit] Invalid targetWidth:', targetWidth);
    return;
  }
  
  // Default options
  const config = {
    minLetterSpacing: options.minLetterSpacing ?? 0.00,
    maxLetterSpacing: options.maxLetterSpacing ?? 0.50,
    iterations: options.iterations ?? 20,
    allowFontResize: options.allowFontResize !== false
  };
  
  try {
    // Save original font size
    const originalFontSize = parseFloat(window.getComputedStyle(el).fontSize);
    if (!originalFontSize || isNaN(originalFontSize)) {
      console.warn('[textFit] Could not determine font size');
      return;
    }
    
    // Helper function to measure text width at a given letter-spacing
    // Create a temporary invisible element to get true text width
    const measureTextWidth = (emSpacing) => {
      // Create temporary span with same styles
      const temp = document.createElement('span');
      temp.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        font-size: ${window.getComputedStyle(el).fontSize};
        font-family: ${window.getComputedStyle(el).fontFamily};
        font-weight: ${window.getComputedStyle(el).fontWeight};
        letter-spacing: ${emSpacing}em;
      `;
      temp.textContent = el.textContent;
      document.body.appendChild(temp);
      const width = temp.getBoundingClientRect().width;
      document.body.removeChild(temp);
      return width;
    };
    
    // Helper function to measure width at a given letter-spacing
    const widthAt = (emSpacing) => {
      el.style.letterSpacing = `${emSpacing}em`;
      // Force reflow
      el.offsetWidth;
      // Measure actual text width using temporary element
      return measureTextWidth(emSpacing);
    };
    
    // Get current width
    const currentSpacing = parseFloat(window.getComputedStyle(el).letterSpacing) / originalFontSize || 0;
    const currentWidth = widthAt(currentSpacing);
    
    // Quick check: already fits
    if (currentWidth <= 0 || currentWidth <= targetWidth) {
      return;
    }
    
    // Try minimum letter-spacing
    const minWidth = widthAt(config.minLetterSpacing);
    if (minWidth > targetWidth) {
      if (!config.allowFontResize) {
        // Can't fit - set to minimum spacing and give up
        el.style.letterSpacing = `${config.minLetterSpacing}em`;
        console.warn('[textFit] Cannot fit text without font resize (disabled)');
        return;
      }
      
      // Letter-spacing alone can't fix it - reduce font size
      el.style.letterSpacing = `${config.minLetterSpacing}em`;
      const scaleFactor = targetWidth / minWidth;
      const newFontSize = originalFontSize * scaleFactor;
      el.style.fontSize = `${newFontSize}px`;
      
      console.log('[textFit] Font size reduced:', {
        original: originalFontSize,
        new: newFontSize,
        scale: scaleFactor
      });
      return;
    }
    
    // Check if it fits at max letter-spacing
    const maxWidth = widthAt(config.maxLetterSpacing);
    if (maxWidth < targetWidth) {
      // Already fits at maximum spacing
      el.style.letterSpacing = `${config.maxLetterSpacing}em`;
      return;
    }
    
    // Binary search for optimal letter-spacing
    let lo = config.minLetterSpacing;
    let hi = config.maxLetterSpacing;
    
    for (let i = 0; i < config.iterations; i++) {
      const mid = (lo + hi) / 2;
      if (widthAt(mid) > targetWidth) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    
    el.style.letterSpacing = `${lo}em`;
    
  } catch (error) {
    console.error('[textFit] Error in fitTextToWidth:', error);
  }
}

/**
 * Reset element to original text styling
 * @param {HTMLElement} el - Element to reset
 * @param {Object} [original] - Original styles to restore
 * @param {string} [original.fontSize] - Original font-size
 * @param {string} [original.letterSpacing] - Original letter-spacing
 */
export function resetTextFit(el, original = {}) {
  if (!el || !(el instanceof HTMLElement)) return;
  
  if (original.fontSize) {
    el.style.fontSize = original.fontSize;
  } else {
    el.style.fontSize = '';
  }
  
  if (original.letterSpacing) {
    el.style.letterSpacing = original.letterSpacing;
  } else {
    el.style.letterSpacing = '';
  }
}

/**
 * Batch fit multiple elements
 * @param {Array<{element: HTMLElement, targetWidth: number, options?: Object}>} items - Array of items to fit
 */
export function fitTextBatch(items) {
  if (!Array.isArray(items)) return;
  
  items.forEach(item => {
    if (item && item.element && typeof item.targetWidth === 'number') {
      fitTextToWidth(item.element, item.targetWidth, item.options);
    }
  });
}
