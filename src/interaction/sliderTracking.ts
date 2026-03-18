/**
 * SliderTracker - Track slider hover and value changes
 * 
 * Emits 'slider_hover' events when user hovers over a slider
 * for longer than threshold, and 'slider_changed' when value changes.
 */

/**
 * Event router interface
 */
interface EventRouter {
  route(eventType: string, data: any): void;
}

/**
 * Slider tracker options
 */
export interface SliderTrackerOptions {
  /** Time before hover triggers event (ms) */
  hesitationThreshold?: number;
  /** Time before same slider can trigger again (ms) */
  cooldownDuration?: number;
}

/**
 * Active hover state
 */
interface ActiveHover {
  slider: string;
  startTime: number;
  element: EventTarget;
}

export class SliderTracker {
  private router: EventRouter;
  private hesitationThreshold: number;
  private cooldownDuration: number;
  private activeHover: ActiveHover | null;
  private hoverTimer: number | null;
  private cooldowns: Map<string, number>;
  private lastValues: Map<string, number>;

  constructor(eventRouter: EventRouter, options: SliderTrackerOptions = {}) {
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
  trackSlider(slider: HTMLInputElement | null, sliderName: string, options: SliderTrackerOptions = {}): void {
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
        this._onChange(sliderName, e as Event);
      });
    } catch (error) {
      console.error(`[SliderTracker] Error adding listeners to ${sliderName}:`, error);
    }
  }
  
  /**
   * Attach tracking to multiple sliders by selector
   */
  trackSliders(selector: string, getSliderName?: (slider: Element) => string): void {
    const sliders = document.querySelectorAll(selector);
    
    sliders.forEach((slider) => {
      const name = getSliderName ? getSliderName(slider) : (slider as HTMLElement).id;
      this.trackSlider(slider as HTMLInputElement, name);
    });
    
    console.log(`[SliderTracker] Tracking ${sliders.length} sliders`);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  private _onMouseEnter(sliderName: string, event: Event): void {
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
      element: event.target!
    };
    
    this.hoverTimer = window.setTimeout(() => {
      this._emitHover(sliderName, now);
    }, this.hesitationThreshold);
  }
  
  private _onMouseLeave(sliderName: string, event: Event): void {
    console.log(`[SliderTracker] ${sliderName} hover ended`);
    
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  private _onInput(sliderName: string, event: Event): void {
    // Cancel hover timer when user starts dragging
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }
  
  private _onChange(sliderName: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const newValue = parseFloat(target.value) || 0;
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
  
  private _emitHover(sliderName: string, startTime: number): void {
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
