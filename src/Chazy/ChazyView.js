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
    
    this.container = container;
    this._createDOM();
    
    // Apply initial small layout (prevents huge title on page load)
    this.applyLayout();
    
    this._initTextStateMachine();
    this.mounted = true;
    
    console.log('[ChazyView] Mounted');
  }
  
  /**
   * Remove DOM and cleanup
   */
  unmount() {
    if (!this.mounted) return;
    
    if (this.textStateMachine) {
      this.textStateMachine.interrupt();
    }
    
    if (this.elements.wrapper) {
      this.elements.wrapper.remove();
    }
    
    this.mounted = false;
    console.log('[ChazyView] Unmounted');
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
  }
  
  /**
   * Show subtitle text (delegates to TextStateMachine)
   */
  showText(line, config) {
    if (!this.textStateMachine) {
      console.error('[ChazyView] TextStateMachine not initialized');
      return;
    }
    
    this.textStateMachine.processLine(line, config);
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
    const wrapper = document.createElement('div');
    wrapper.className = 'chazy-wrapper';
    wrapper.id = 'chazy-wrapper';
    
    const title = document.createElement('div');
    title.className = 'chazy-title';
    title.textContent = this.config.title;
    
    const subtitle = document.createElement('div');
    subtitle.className = 'chazy-subtitle';
    subtitle.style.cursor = 'pointer';
    
    wrapper.appendChild(title);
    wrapper.appendChild(subtitle);
    this.container.appendChild(wrapper);
    
    this.elements = { wrapper, title, subtitle };
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
    
    const { maxFontSize, availableWidth } = this.constraints;
    const { title, subtitle } = this.elements;
    
    // Reset font size to base size (might have been reduced on previous text)
    const subtitleFontSize = maxFontSize * this.config.subtitleFontRatio;
    subtitle.style.fontSize = `${subtitleFontSize}px`;
    
    // Force reflow to get accurate measurement
    subtitle.offsetHeight;
    
    const titleWidth = title.getBoundingClientRect().width;
    const opticalCorrection = maxFontSize * this.config.opticalCorrection;
    const subtitleMaxWidth = availableWidth - opticalCorrection;
    
    // Target width: smaller of title match or available space
    const idealTitleMatch = titleWidth * this.config.subtitleWidthRatio;
    const targetWidth = Math.min(idealTitleMatch, subtitleMaxWidth);
    
    // Re-adjust letter-spacing for the new content
    this._fitTrackingToWidth(subtitle, targetWidth);
  }
  
  applyLayout() {
    if (this.isApplyingLayout) return;
    this.isApplyingLayout = true;
    
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
    
    this.isApplyingLayout = false;
  }
  
  /**
   * Adjust letter-spacing to fit element to target width using binary search
   * If letter-spacing alone can't compress enough, reduce font size
   * @private
   */
  _fitTrackingToWidth(el, targetW) {
    // Save original font size
    const originalFontSize = parseFloat(window.getComputedStyle(el).fontSize);
    
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
  }
}
