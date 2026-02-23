/**
 * SliderTracker - Track slider hover and value changes
 * 
 * Emits 'slider_hover' events when user hovers over a slider
 * for longer than threshold, and 'slider_changed' when value changes.
 */

export class SliderTracker {
  constructor(eventRouter, options = {}) {
    this.router = eventRouter;
    this.hesitationThreshold = options.hesitationThreshold || 500; // ms (shorter than buttons)
    this.cooldownDuration = options.cooldownDuration || 3000; // ms (shorter than buttons)
    
    this.activeHover = null;
    this.hoverTimer = null;
    this.cooldowns = new Map();
    this.lastValues = new Map(); // Track last value for each slider
  }
  
  /**
   * Attach tracking to a slider element
   */
  trackSlider(slider, sliderName, options = {}) {
    if (!slider || !(slider instanceof HTMLElement)) {
      console.warn(`[SliderTracker] Invalid slider element: ${sliderName}`);
      return;
    }
    
    if (!sliderName || typeof sliderName !== 'string') {
      console.warn('[SliderTracker] Invalid sliderName');
      return;
    }
    
    try {
      // Store initial value
      this.lastValues.set(sliderName, parseFloat(slider.value) || 0);
      
      slider.addEventListener('mouseenter', (e) => {
        this._onMouseEnter(sliderName, e);
      });
      
      slider.addEventListener('mouseleave', (e) => {
        this._onMouseLeave(sliderName, e);
      });
      
      // Track value changes during interaction
      slider.addEventListener('input', (e) => {
        this._onInput(sliderName, e);
      });
      
      // Track final value when user releases
      slider.addEventListener('change', (e) => {
        this._onChange(sliderName, e);
      });
    } catch (error) {
      console.error(`[SliderTracker] Error adding listeners to ${sliderName}:`, error);
    }
  }
  
  /**
   * Attach tracking to multiple sliders by selector
   */
  trackSliders(selector, getSliderName) {
    const sliders = document.querySelectorAll(selector);
    
    sliders.forEach((slider) => {
      const name = getSliderName ? getSliderName(slider) : slider.id;
      this.trackSlider(slider, name);
    });
    
    console.log(`[SliderTracker] Tracking ${sliders.length} sliders`);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _onMouseEnter(sliderName, event) {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(sliderName) || 0;
    
    if (now < cooldownUntil) {
      console.log(`[SliderTracker] ${sliderName} hover - still in cooldown`);
      return;
    }
    
    console.log(`[SliderTracker] ${sliderName} hover started - timer set for ${this.hesitationThreshold}ms`);
    
    // Start hesitation timer
    this.activeHover = {
      slider: sliderName,
      startTime: now,
      element: event.target
    };
    
    this.hoverTimer = setTimeout(() => {
      this._emitHover(sliderName, now);
    }, this.hesitationThreshold);
  }
  
  _onMouseLeave(sliderName, event) {
    console.log(`[SliderTracker] ${sliderName} hover ended`);
    
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  _onInput(sliderName, event) {
    // Cancel hover timer when user starts dragging
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }
  
  _onChange(sliderName, event) {
    const newValue = parseFloat(event.target.value) || 0;
    const oldValue = this.lastValues.get(sliderName) || 0;
    
    // Only emit if value actually changed
    if (newValue === oldValue) {
      return;
    }
    
    const delta = newValue - oldValue;
    const absDelta = Math.abs(delta);
    
    console.log(`[SliderTracker] ${sliderName} changed: ${oldValue} → ${newValue} (Δ${delta})`);
    
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(sliderName) || 0;
    
    if (now < cooldownUntil) {
      console.log(`[SliderTracker] ${sliderName} change - still in cooldown`);
      // Update value but don't emit
      this.lastValues.set(sliderName, newValue);
      return;
    }
    
    // Emit change event
    this.router.route('slider_changed', {
      slider: sliderName,
      oldValue,
      newValue,
      delta,
      absDelta,
      isIncrease: delta > 0,
      isBigChange: absDelta > (Math.abs(oldValue) * 0.5) // More than 50% change
    });
    
    // Update stored value
    this.lastValues.set(sliderName, newValue);
    
    // Set cooldown
    this.cooldowns.set(sliderName, Date.now() + this.cooldownDuration);
  }
  
  _emitHover(sliderName, startTime) {
    const duration = Date.now() - startTime;
    
    console.log(`[SliderTracker] Hover detected: ${sliderName} (${duration}ms)`);
    
    // Emit event
    this.router.route('slider_hover', {
      slider: sliderName,
      duration,
      currentValue: this.lastValues.get(sliderName) || 0
    });
    
    // Set cooldown
    this.cooldowns.set(sliderName, Date.now() + this.cooldownDuration);
    
    // Clear hover state
    this.activeHover = null;
    this.hoverTimer = null;
  }
}
