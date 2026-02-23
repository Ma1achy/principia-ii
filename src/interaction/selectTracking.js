/**
 * SelectTracker - Track dropdown/select hover and changes
 * 
 * Emits 'select_hover' events when user hovers over a select element
 * for longer than threshold, and 'select_changed' when selection changes.
 */

export class SelectTracker {
  constructor(eventRouter, options = {}) {
    this.router = eventRouter;
    this.hesitationThreshold = options.hesitationThreshold || 600; // ms
    this.cooldownDuration = options.cooldownDuration || 2000; // ms
    
    this.activeHover = null;
    this.hoverTimer = null;
    this.cooldowns = new Map();
    this.lastValues = new Map(); // Track last value for each select
  }
  
  /**
   * Attach tracking to a select element
   */
  trackSelect(select, selectName, options = {}) {
    if (!select) {
      console.warn(`[SelectTracker] Select element not found: ${selectName}`);
      return;
    }
    
    // Store initial value
    this.lastValues.set(selectName, select.value);
    
    select.addEventListener('mouseenter', (e) => {
      this._onMouseEnter(selectName, e);
    });
    
    select.addEventListener('mouseleave', (e) => {
      this._onMouseLeave(selectName, e);
    });
    
    // Track selection changes
    select.addEventListener('change', (e) => {
      this._onChange(selectName, e);
    });
    
    // Also track focus (for keyboard navigation)
    select.addEventListener('focus', (e) => {
      this._onFocus(selectName, e);
    });
  }
  
  /**
   * Attach tracking to multiple selects by selector
   */
  trackSelects(selector, getSelectName) {
    const selects = document.querySelectorAll(selector);
    
    selects.forEach((select) => {
      const name = getSelectName ? getSelectName(select) : select.id;
      this.trackSelect(select, name);
    });
    
    console.log(`[SelectTracker] Tracking ${selects.length} selects`);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _onMouseEnter(selectName, event) {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(selectName) || 0;
    
    if (now < cooldownUntil) {
      console.log(`[SelectTracker] ${selectName} hover - still in cooldown`);
      return;
    }
    
    console.log(`[SelectTracker] ${selectName} hover started - timer set for ${this.hesitationThreshold}ms`);
    
    // Start hesitation timer
    this.activeHover = {
      select: selectName,
      startTime: now,
      element: event.target
    };
    
    this.hoverTimer = setTimeout(() => {
      this._emitHover(selectName, now);
    }, this.hesitationThreshold);
  }
  
  _onMouseLeave(selectName, event) {
    console.log(`[SelectTracker] ${selectName} hover ended`);
    
    // Cancel hesitation timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    
    this.activeHover = null;
  }
  
  _onFocus(selectName, event) {
    // When select gets focus (keyboard or click), cancel hover timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }
  
  _onChange(selectName, event) {
    const newValue = event.target.value;
    const oldValue = this.lastValues.get(selectName);
    
    // Only emit if value actually changed
    if (newValue === oldValue) {
      return;
    }
    
    console.log(`[SelectTracker] ${selectName} changed: "${oldValue}" → "${newValue}"`);
    
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(selectName) || 0;
    
    if (now < cooldownUntil) {
      console.log(`[SelectTracker] ${selectName} change - still in cooldown`);
      // Update value but don't emit
      this.lastValues.set(selectName, newValue);
      return;
    }
    
    // Get human-readable labels if available
    const selectedOption = event.target.options[event.target.selectedIndex];
    const newLabel = selectedOption?.text || newValue;
    
    // Emit change event
    this.router.route('select_changed', {
      select: selectName,
      oldValue,
      newValue,
      newLabel,
      selectedIndex: event.target.selectedIndex
    });
    
    // Update stored value
    this.lastValues.set(selectName, newValue);
    
    // Set cooldown
    this.cooldowns.set(selectName, Date.now() + this.cooldownDuration);
  }
  
  _emitHover(selectName, startTime) {
    const duration = Date.now() - startTime;
    
    console.log(`[SelectTracker] Hover detected: ${selectName} (${duration}ms)`);
    
    // Emit event
    this.router.route('select_hover', {
      select: selectName,
      duration,
      currentValue: this.lastValues.get(selectName)
    });
    
    // Set cooldown
    this.cooldowns.set(selectName, Date.now() + this.cooldownDuration);
    
    // Clear hover state
    this.activeHover = null;
    this.hoverTimer = null;
  }
}
