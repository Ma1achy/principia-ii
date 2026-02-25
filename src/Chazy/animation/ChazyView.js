/**
 * ChazyView - Self-contained title + subtitle component
 * 
 * Responsibilities:
 * - Create/mount DOM structure (title + subtitle)
 * - Apply layout constraints from external layout system
 * - Integrate with TextStateMachine for animations
 * - Expose clean API for lifecycle management
 */

import { TextStateMachine } from './textStateMachine.js';

export class ChazyView {
  constructor(options = {}) {
    this.config = {
      title: options.title || 'Principia',
      titleFontRatio: options.titleFontRatio || 1.0,
      subtitleFontRatio: options.subtitleFontRatio || 0.135,
      gapRatio: options.gapRatio || 0.18,
      subtitleWidthRatio: options.subtitleWidthRatio || 0.97,
      opticalCorrection: options.opticalCorrection || 0.088,
      ...options
    };
    
    this.mounted = false;
    this.container = null;
    this.elements = {
      wrapper: null,
      title: null,
      subtitle: null
    };
    
    this.textStateMachine = null;
    
    this.constraints = {
      maxFontSize: 40,  // Start very small until layout is calculated
      availableWidth: 400,
      availableHeight: 100
    };
    
    this.isApplyingLayout = false; // Prevent recursive layout
  }
  
  /**
   * Create DOM and mount into container
   */
  mount(container) {
    if (this.mounted) {
      console.warn('[ChazyView] Already mounted');
      return;
    }
    
    // Defensive null checks
    if (!container || !(container instanceof HTMLElement)) {
      console.error('[ChazyView] Invalid container element');
      return;
    }
    
    try {
      this.container = container;
      this._createDOM();
      
      // Apply initial small layout (prevents huge title on page load)
      this.applyLayout();
      
      this._initTextStateMachine();
      this.mounted = true;
      
      console.log('[ChazyView] Mounted');
    } catch (error) {
      console.error('[ChazyView] Error during mount:', error);
      this.mounted = false;
    }
  }
  
  /**
   * Remove DOM and cleanup
   */
  unmount() {
    if (!this.mounted) return;
    
    try {
      if (this.textStateMachine && this.textStateMachine.destroy) {
        this.textStateMachine.destroy();
      } else if (this.textStateMachine && this.textStateMachine.interrupt) {
        this.textStateMachine.interrupt();
      }
      
      if (this.elements.wrapper && this.elements.wrapper.parentNode) {
        this.elements.wrapper.remove();
      }
      
      this.mounted = false;
      console.log('[ChazyView] Unmounted');
    } catch (error) {
      console.error('[ChazyView] Error during unmount:', error);
      this.mounted = false;
    }
  }
  
  /**
   * Update layout constraints (called by external layout system)
   */
  updateConstraints(constraints) {
    // Prevent recursive layout updates
    if (this.isApplyingLayout) {
      return;
    }
    
    this.constraints = { ...this.constraints, ...constraints };
    this.applyLayout();
    
    // If subtitle has content, refit it to new constraints
    // (Only if not already handled by applyLayout)
    if (!this.isApplyingLayout && 
        this.elements.subtitle && 
        this.elements.subtitle.textContent.trim().length > 0) {
      // Use requestAnimationFrame to ensure layout is settled
      requestAnimationFrame(() => {
        if (!this.isApplyingLayout) {
          this._refitSubtitleToConstraints();
        }
      });
    }
  }
  
  /**
   * Show subtitle text (delegates to TextStateMachine)
   */
  showText(line, config) {
    if (!this.textStateMachine) {
      console.error('[ChazyView] TextStateMachine not initialized');
      return;
    }
    
    // Defensive null checks
    if (!line || typeof line !== 'string') {
      console.error('[ChazyView] Invalid line in showText');
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[ChazyView] Invalid config in showText');
      return;
    }
    
    try {
      this.textStateMachine.processLine(line, config);
    } catch (error) {
      console.error('[ChazyView] Error in showText:', error);
    }
  }
  
  /**
   * Check if can interrupt (non-destructive)
   */
  canInterrupt() {
    return this.textStateMachine ? this.textStateMachine.canInterrupt() : true;
  }
  
  /**
   * Interrupt current animation (if in safe state)
   */
  interrupt() {
    return this.textStateMachine ? this.textStateMachine.interrupt() : false;
  }
  
  // ─── Internal Methods ─────────────────────────────────────────────────────
  
  _createDOM() {
    try {
      const wrapper = document.createElement('div');
      wrapper.className = 'chazy-wrapper';
      wrapper.id = 'chazy-wrapper';
      
      const title = document.createElement('div');
      title.className = 'chazy-title';
      title.textContent = this.config.title || 'Principia';
      
      const subtitle = document.createElement('div');
      subtitle.className = 'chazy-subtitle';
      subtitle.style.cursor = 'pointer';
      
      wrapper.appendChild(title);
      wrapper.appendChild(subtitle);
      
      if (!this.container || !this.container.appendChild) {
        throw new Error('Invalid container');
      }
      
      this.container.appendChild(wrapper);
      
      this.elements = { wrapper, title, subtitle };
    } catch (error) {
      console.error('[ChazyView] Error in _createDOM:', error);
      throw error;
    }
  }
  
  _initTextStateMachine() {
    this.textStateMachine = new TextStateMachine(
      this.elements.subtitle,
      () => this._onSubtitleUpdate()
    );
  }
  
  _onSubtitleUpdate() {
    // Called when subtitle content changes - re-adjust letter-spacing for new text
    if (!this.mounted || this.isApplyingLayout) return;
    
    this._refitSubtitleToConstraints();
  }
  
  /**
   * Refit subtitle to current constraints (extracted for reuse)
   * @private
   */
  _refitSubtitleToConstraints() {
    // Defensive checks
    if (!this.elements || !this.elements.subtitle || !this.elements.title) {
      console.warn('[ChazyView] Missing elements in _refitSubtitleToConstraints');
      return;
    }
    
    try {
      const { maxFontSize, availableWidth } = this.constraints;
      const { title, subtitle } = this.elements;
      
      // Reset font size to base size (might have been reduced on previous text)
      const subtitleFontSize = maxFontSize * this.config.subtitleFontRatio;
      subtitle.style.fontSize = `${subtitleFontSize}px`;
      
      // Update max-width constraint (important for resize)
      const opticalCorrection = maxFontSize * this.config.opticalCorrection;
      const subtitleMaxWidth = availableWidth - opticalCorrection;
      subtitle.style.maxWidth = `${subtitleMaxWidth}px`;
      
      // Force reflow to get accurate measurement
      subtitle.offsetHeight;
      
      const titleWidth = title.getBoundingClientRect().width;
      
      // Target width: smaller of title match or available space
      const idealTitleMatch = titleWidth * this.config.subtitleWidthRatio;
      const targetWidth = Math.min(idealTitleMatch, subtitleMaxWidth);
      
      // Re-adjust letter-spacing for the new content
      this._fitTrackingToWidth(subtitle, targetWidth);
    } catch (error) {
      console.error('[ChazyView] Error in _refitSubtitleToConstraints:', error);
    }
  }
  
  applyLayout() {
    if (this.isApplyingLayout) return;
    this.isApplyingLayout = true;
    
    // Defensive checks
    if (!this.elements || !this.elements.title || !this.elements.subtitle) {
      console.warn('[ChazyView] Missing elements in applyLayout');
      this.isApplyingLayout = false;
      return;
    }
    
    try {
      const { maxFontSize, availableWidth } = this.constraints;
      const { title, subtitle } = this.elements;
      
      // Set title font size first
      title.style.fontSize = `${maxFontSize}px`;
      
      // Force a reflow to ensure title has rendered before measuring
      title.offsetHeight;
      
      // Measure the actual rendered title width (optical width)
      const titleWidth = title.getBoundingClientRect().width;
      
      // Set subtitle font size
      const subtitleFontSize = maxFontSize * this.config.subtitleFontRatio;
      subtitle.style.fontSize = `${subtitleFontSize}px`;
      
      // Gap between title and subtitle
      const gapPx = Math.round(maxFontSize * this.config.gapRatio);
      subtitle.style.marginTop = `${gapPx}px`;
      
      // Optical correction (left margin to align with title's visual edge)
      const opticalCorrection = maxFontSize * this.config.opticalCorrection;
      subtitle.style.marginLeft = `${opticalCorrection}px`;
      
      // Subtitle max-width based on available space minus optical correction
      const subtitleMaxWidth = availableWidth - opticalCorrection;
      subtitle.style.maxWidth = `${subtitleMaxWidth}px`;
      
      // Target width for subtitle: smaller of title width or available space
      // This ensures we match the title aesthetically but don't overflow
      const idealTitleMatch = titleWidth * this.config.subtitleWidthRatio;
      const targetWidth = Math.min(idealTitleMatch, subtitleMaxWidth);
      
      // Adjust letter-spacing to fit subtitle under title
      this._fitTrackingToWidth(subtitle, targetWidth);
      
      console.log('[ChazyView] Layout applied:', { 
        maxFontSize, 
        subtitleFontSize,
        availableWidth, 
        titleWidth, 
        subtitleMaxWidth,
        targetWidth,
        gapPx, 
        opticalCorrection 
      });
    } catch (error) {
      console.error('[ChazyView] Error in applyLayout:', error);
    } finally {
      this.isApplyingLayout = false;
    }
  }
  
  /**
   * Adjust letter-spacing to fit element to target width using binary search
   * If letter-spacing alone can't compress enough, reduce font size
   * @private
   */
  _fitTrackingToWidth(el, targetW) {
    // Defensive null checks
    if (!el || !(el instanceof HTMLElement)) {
      console.warn('[ChazyView] Invalid element in _fitTrackingToWidth');
      return;
    }
    
    if (typeof targetW !== 'number' || targetW <= 0) {
      console.warn('[ChazyView] Invalid targetW in _fitTrackingToWidth:', targetW);
      return;
    }
    
    try {
      // Save original font size
      const originalFontSize = parseFloat(window.getComputedStyle(el).fontSize);
      
      if (!originalFontSize || isNaN(originalFontSize)) {
        console.warn('[ChazyView] Could not determine font size');
        return;
      }
      
      // Helper function to measure width at a given letter-spacing
      const widthAt = (em) => {
        el.style.letterSpacing = `${em}em`;
        return el.getBoundingClientRect().width;
      };
      
      // Quick measurement check
      const w0 = widthAt(0.02); // Start with default 0.02em from CSS
      if (w0 <= 0) return;
      
      // Check if text is too wide even at minimum letter-spacing
      const minWidth = widthAt(0.00);
      if (minWidth > targetW) {
        // Letter-spacing alone can't fix it - need to reduce font size
        el.style.letterSpacing = "0em";
        const scaleFactor = targetW / minWidth;
        const newFontSize = originalFontSize * scaleFactor;
        el.style.fontSize = `${newFontSize}px`;
        return;
      }
      
      // If it fits at max letter-spacing, use that
      if (widthAt(0.50) < targetW) { 
        el.style.letterSpacing = "0.50em"; 
        return; 
      }
      
      // Binary search for optimal letter-spacing (0.00em to 0.50em)
      let lo = 0.00, hi = 0.50;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (widthAt(mid) > targetW) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      
      el.style.letterSpacing = `${lo}em`;
    } catch (error) {
      console.error('[ChazyView] Error in _fitTrackingToWidth:', error);
    }
  }
}
