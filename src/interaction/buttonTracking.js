/**
 * ButtonTracker - Track button hover hesitation and emit events
 * 
 * Emits 'button_hesitation' events when user hovers over a button
 * for longer than threshold without clicking.
 */

export class ButtonTracker {
  constructor(eventRouter, options = {}) {
    this.router = eventRouter;
    this.hesitationThreshold = options.hesitationThreshold || 800; // ms
    this.cooldownDuration = options.cooldownDuration || 15000; // ms
    
    this.activeHover = null;
    this.hoverTimer = null;
    this.cooldowns = new Map();
  }
  
  /**
   * Attach tracking to a button element
   */
  trackButton(button, buttonName) {
    if (!button) {
      console.warn(`[ButtonTracker] Button element not found: ${buttonName}`);
      return;
    }
    
    button.addEventListener('mouseenter', (e) => {
      this._onMouseEnter(buttonName, e);
    });
    
    button.addEventListener('mouseleave', (e) => {
      this._onMouseLeave(buttonName, e);
    });
    
    button.addEventListener('click', (e) => {
      this._onClick(buttonName, e);
    });
  }
  
  /**
   * Attach tracking to multiple buttons by selector
   */
  trackButtons(selector, getButtonName) {
    const buttons = document.querySelectorAll(selector);
    
    buttons.forEach((button) => {
      const name = getButtonName ? getButtonName(button) : button.id;
      this.trackButton(button, name);
    });
    
    console.log(`[ButtonTracker] Tracking ${buttons.length} buttons`);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _onMouseEnter(buttonName, event) {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(buttonName) || 0;
    
    if (now < cooldownUntil) {
      console.log(`[ButtonTracker] ${buttonName} hover - still in cooldown`);
      return; // Still in cooldown
    }
    
    console.log(`[ButtonTracker] ${buttonName} hover started - timer set for ${this.hesitationThreshold}ms`);
    
    // Start hesitation timer
    this.activeHover = {
      button: buttonName,
      startTime: now,
      element: event.target
    };
    
    this.hoverTimer = setTimeout(() => {
      this._emitHesitation(buttonName, now);
    }, this.hesitationThreshold);
  }
  
  _onMouseLeave(buttonName, event) {
    console.log(`[ButtonTracker] ${buttonName} hover ended (cancelled timer)`);
    
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  _onClick(buttonName, event) {
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  _emitHesitation(buttonName, startTime) {
    const duration = Date.now() - startTime;
    
    console.log(`[ButtonTracker] Hesitation detected: ${buttonName} (${duration}ms)`);
    
    // Emit event
    this.router.route('button_hesitation', {
      button: buttonName,
      duration
    });
    
    // Set cooldown
    this.cooldowns.set(buttonName, Date.now() + this.cooldownDuration);
    
    // Clear hover state
    this.activeHover = null;
    this.hoverTimer = null;
  }
}
