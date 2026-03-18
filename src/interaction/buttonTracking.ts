/**
 * ButtonTracker - Track button hover hesitation and emit events
 * 
 * Emits 'button_hesitation' events when user hovers over a button
 * for longer than threshold without clicking.
 */

/**
 * Event router interface
 */
interface EventRouter {
  route(eventType: string, data: any): void;
}

/**
 * Button tracker options
 */
export interface ButtonTrackerOptions {
  /** Time before hover is considered hesitation (ms) */
  hesitationThreshold?: number;
  /** Time before same button can trigger hesitation again (ms) */
  cooldownDuration?: number;
}

/**
 * Active hover state
 */
interface ActiveHover {
  button: string;
  startTime: number;
  element: EventTarget;
}

export class ButtonTracker {
  private router: EventRouter;
  private hesitationThreshold: number;
  private cooldownDuration: number;
  private activeHover: ActiveHover | null;
  private hoverTimer: number | null;
  private cooldowns: Map<string, number>;

  constructor(eventRouter: EventRouter, options: ButtonTrackerOptions = {}) {
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
  trackButton(button: HTMLElement | null, buttonName: string): void {
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
  trackButtons(selector: string, getButtonName?: (button: Element) => string): void {
    const buttons = document.querySelectorAll(selector);
    
    buttons.forEach((button) => {
      const name = getButtonName ? getButtonName(button) : (button as HTMLElement).id;
      this.trackButton(button as HTMLElement, name);
    });
    
    console.log(`[ButtonTracker] Tracking ${buttons.length} buttons`);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  private _onMouseEnter(buttonName: string, event: Event): void {
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
      element: event.target!
    };
    
    this.hoverTimer = window.setTimeout(() => {
      this._emitHesitation(buttonName, now);
    }, this.hesitationThreshold);
  }
  
  private _onMouseLeave(buttonName: string, event: Event): void {
    console.log(`[ButtonTracker] ${buttonName} hover ended (cancelled timer)`);
    
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  private _onClick(buttonName: string, event: Event): void {
    // Cancel hesitation timer if running
    const hadHoverTimer = !!this.hoverTimer;
    const hoverDuration = this.activeHover ? Date.now() - this.activeHover.startTime : 0;
    
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    // Emit click event with urgency
    const clickEventType = `button_click_${this._getButtonAction(buttonName)}`;
    
    console.log(`[ButtonTracker] Click detected: ${buttonName} → ${clickEventType}`);
    
    this.router.route(clickEventType, {
      buttonId: buttonName,
      hadHovered: hadHoverTimer,
      hoverDuration
    });
    
    // Record prediction accuracy if predictor exists
    if (typeof window !== 'undefined' && (window as any).chazy?.view?.textStateMachine?.interruptPredictor) {
      const predictor = (window as any).chazy.view.textStateMachine.interruptPredictor;
      const wasPredicted = predictor.currentPrediction?.buttonId === buttonName;
      predictor.recordPredictionAccuracy(buttonName, wasPredicted, true);
    }
    
    this.activeHover = null;
  }
  
  /**
   * Map button names to action names for event types
   * Button names from main.js: 'render', 'share', 'savePng', 'copyJson', 'reset', etc.
   */
  private _getButtonAction(buttonName: string): string {
    const actionMap: Record<string, string> = {
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
  
  private _emitHesitation(buttonName: string, startTime: number): void {
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
