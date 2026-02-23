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
    if (!button || !(button instanceof HTMLElement)) {
      console.warn(`[ButtonTracker] Invalid button element: ${buttonName}`);
      return;
    }
    
    if (!buttonName || typeof buttonName !== 'string') {
      console.warn('[ButtonTracker] Invalid buttonName');
      return;
    }
    
    try {
      button.addEventListener('mouseenter', (e) => {
        this._onMouseEnter(buttonName, e);
      });
      
      button.addEventListener('mouseleave', (e) => {
        this._onMouseLeave(buttonName, e);
      });
      
      button.addEventListener('click', (e) => {
        this._onClick(buttonName, e);
      });
    } catch (error) {
      console.error(`[ButtonTracker] Error adding listeners to ${buttonName}:`, error);
    }
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
    // Cancel hesitation timer if running
    const hadHoverTimer = !!this.hoverTimer;
    const hoverDuration = this.activeHover ? Date.now() - this.activeHover.startTime : 0;
    
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    // NEW: Emit click event with urgency
    const clickEventType = `button_click_${this._getButtonAction(buttonName)}`;
    
    console.log(`[ButtonTracker] Click detected: ${buttonName} → ${clickEventType}`);
    
    this.router.route(clickEventType, {
      buttonId: buttonName,
      hadHovered: hadHoverTimer,
      hoverDuration
    });
    
    // NEW: Record prediction accuracy if predictor exists
    if (typeof window !== 'undefined' && window.chazy?.view?.textStateMachine?.interruptPredictor) {
      const predictor = window.chazy.view.textStateMachine.interruptPredictor;
      const wasPredicted = predictor.currentPrediction?.buttonId === buttonName;
      predictor.recordPredictionAccuracy(buttonName, wasPredicted, true);
    }
    
    this.activeHover = null;
  }
  
  /**
   * NEW: Map button names to action names for event types
   * Button names from main.js: 'render', 'share', 'savePng', 'copyJson', 'reset', etc.
   */
  _getButtonAction(buttonName) {
    const actionMap = {
      'render': 'render',
      'share': 'share',
      'reset': 'reset',
      'copyJson': 'copy',
      'savePng': 'save',
      'zero_z0': 'zero_z0',
      'randomize_z0': 'randomize_z0',
      'reset_tilts': 'reset_tilts',
      'apply_json': 'apply_json',
      'download_json': 'download_json'
    };
    return actionMap[buttonName] || buttonName; // Default to the button name itself
  }
  
  _emitHesitation(buttonName, startTime) {
    const duration = Date.now() - startTime;
    
    console.log(`[ButtonTracker] Hesitation detected: ${buttonName} (${duration}ms)`);
    
    // Map button ID to action name (same as click events)
    const action = this._getButtonAction(buttonName);
    
    // Emit event
    this.router.route('button_hesitation', {
      button: action,  // Send action name, not raw button ID
      buttonId: buttonName,  // Keep original ID for reference
      duration
    });
    
    // Set cooldown
    this.cooldowns.set(buttonName, Date.now() + this.cooldownDuration);
    
    // Clear hover state
    this.activeHover = null;
    this.hoverTimer = null;
  }
}
