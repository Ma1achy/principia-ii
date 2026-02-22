/**
 * ChazyEventRouter - Central event routing and response control
 * 
 * Responsibilities:
 * - Route all Chazy events to appropriate handlers
 * - Apply rate limiting for immediate responses
 * - Track session metrics and state
 * - Coordinate between Mind, Selector, and Orchestrator
 */

export class ChazyEventRouter {
  constructor(orchestrator, mind, selector) {
    this.orchestrator = orchestrator;
    this.mind = mind;
    this.selector = selector;
    
    // Handler maps
    this.systemHandlers = new Map([
      ['ambient_cycle_ready', this._handleAmbientCycle.bind(this)],
      ['text_complete', this._handleTextComplete.bind(this)],
      ['page_loaded', this._handlePageLoaded.bind(this)],
      ['page_visible', this._handlePageVisible.bind(this)],
      ['page_hidden', this._handlePageHidden.bind(this)],
      ['user_idle', this._handleUserIdle.bind(this)],
      ['user_returned', this._handleUserReturned.bind(this)],
      ['mind_wants_to_speak', this._handleMindSpeakRequest.bind(this)],
    ]);
    
    this.immediateHandlers = new Map([
      ['button_hesitation', this._handleButtonHesitation.bind(this)],
      ['state_reset', this._handleStateReset.bind(this)],
      ['slider_exploration', this._handleSliderExploration.bind(this)],
      ['preset_browsing', this._handlePresetBrowsing.bind(this)],
      ['orientation_adjustment', this._handleOrientationAdjustment.bind(this)],
    ]);
    
    // Session state
    this.sessionFlags = {
      pageHidden: false,
      userIdle: false,
      hasRendered: false
    };
    
    // Rate limiting state (for Phase 3)
    this.eventCooldowns = new Map();
    this.globalImmediateLock = false;
    this.globalImmediateLockUntil = 0;
    this.responseBudget = 3;
    this.maxBudget = 3;
    this.budgetRefillRate = 45000;
    this.lastBudgetRefill = Date.now();
    this.recentEvents = [];
    this.maxRecentEvents = 5;
    this.pendingImmediate = null;
    
    // Session metrics
    this.sessionMetrics = {
      startTime: Date.now(),
      totalEvents: 0,
      shownAmbient: 0,
      shownImmediateResponses: 0,
      blockedResponses: 0,
      missedResponses: 0,
      blockReasonCounts: {}
    };
    
    this.sessionPhase = 'startup';
  }
  
  /**
   * Main routing entry point
   */
  route(eventType, data = {}) {
    // Logging & metrics
    console.log(`[EventRouter] ${eventType}`, data);
    this.sessionMetrics.totalEvents++;
    
    // Add metadata
    const event = {
      eventType,
      data,
      _timestamp: Date.now(),
      _source: 'router'
    };
    
    // Route to appropriate handler
    if (this.systemHandlers.has(eventType)) {
      return this._routeSystem(eventType, data);
    }
    
    if (this.immediateHandlers.has(eventType)) {
      return this._routeImmediate(eventType, data);
    }
    
    // No handler, just observe
    if (this._shouldObserve(eventType)) {
      this.mind.observe(eventType, data);
    }
    
    return { responded: false, kind: null, reason: 'no_handler' };
  }
  
  /**
   * Route system events (no rate limiting)
   */
  _routeSystem(eventType, data) {
    const handler = this.systemHandlers.get(eventType);
    const result = handler(data);
    
    // Some system events still observed by Mind
    if (['page_visible', 'user_returned'].includes(eventType)) {
      this.mind.observe(eventType, data);
    }
    
    return result;
  }
  
  /**
   * Route immediate events (with rate limiting)
   */
  _routeImmediate(eventType, data) {
    // Check pending interrupt queue first
    if (this.pendingImmediate && this._shouldDrainPending()) {
      const pending = this.pendingImmediate;
      this.pendingImmediate = null;
      
      // Try to process pending
      const result = this._routeImmediate(pending.eventType, pending.data);
      if (result.responded) {
        // Pending processed, defer current event
        return {
          responded: false,
          kind: null,
          reason: 'pending_processed_instead'
        };
      }
    }
    
    // Refill budget if needed
    this._refillBudget();
    
    // Apply 5-layer rate limiting
    const rateCheck = this._checkRateLimits(eventType, data);
    if (!rateCheck.ok) {
      this.sessionMetrics.blockedResponses++;
      const reason = rateCheck.reason;
      this.sessionMetrics.blockReasonCounts[reason] = 
        (this.sessionMetrics.blockReasonCounts[reason] || 0) + 1;
      
      // Try to queue if soft interrupt failure
      if (reason === 'fsm_busy' && this._shouldQueueInterrupt(eventType)) {
        this.pendingImmediate = {
          eventType,
          data,
          queuedAt: Date.now(),
          expiresAt: Date.now() + 2000  // 2s TTL
        };
        console.log(`[EventRouter] Queued ${eventType} (FSM busy)`);
      }
      
      return {
        responded: false,
        kind: null,
        reason: rateCheck.reason
      };
    }
    
    // Try to show immediate text
    const handler = this.immediateHandlers.get(eventType);
    const result = handler(data);
    
    if (result.responded) {
      // Success - apply cooldowns and budget
      this._applyCooldown(eventType, data);
      this._spendBudget(result.budgetCost || 1);
      this._recordRecentEvent(eventType, data);
      
      // Set global immediate lock
      const lockDuration = 8000;
      this.globalImmediateLock = true;
      this.globalImmediateLockUntil = Date.now() + lockDuration;
      setTimeout(() => {
        this.globalImmediateLock = false;
      }, lockDuration);
      
      this.sessionMetrics.shownImmediateResponses++;
      
      // Emit immediate_response observational event
      this.route('immediate_response', {
        originalEvent: eventType,
        tone: result.metadata?.tone,
        wasSuccessful: true,
        button: data.button
      });
    } else if (result.reason === 'fsm_busy') {
      // Queue on soft interrupt failure
      if (this._shouldQueueInterrupt(eventType)) {
        this.pendingImmediate = {
          eventType,
          data,
          queuedAt: Date.now(),
          expiresAt: Date.now() + 2000
        };
        console.log(`[EventRouter] Queued ${eventType} (FSM busy)`);
      }
    }
    
    return result;
  }
  
  /**
   * Check all rate limiting layers
   */
  _checkRateLimits(eventType, data) {
    const now = Date.now();
    
    // Layer 1: Per-event cooldown
    const cooldownKey = eventType + (data.button || '');
    const cooldown = this.eventCooldowns.get(cooldownKey);
    if (cooldown && now < cooldown) {
      return { ok: false, reason: 'event_cooldown' };
    }
    
    // Layer 2: Global immediate lock
    if (this.globalImmediateLock && now < this.globalImmediateLockUntil) {
      return { ok: false, reason: 'global_lock' };
    }
    
    // Layer 3: Response budget
    if (this.responseBudget < 1) {
      return { ok: false, reason: 'budget_exhausted' };
    }
    
    // Layer 4: Recent suppression
    const eventSig = eventType + (data.button || '');
    const SUPPRESSION_WINDOW = 60000;
    const recent = this.recentEvents.find(e => 
      e.sig === eventSig && now - e.time < SUPPRESSION_WINDOW
    );
    if (recent) {
      return { ok: false, reason: 'recent_suppression' };
    }
    
    // Layer 5: FSM state check (soft interrupt)
    if (!this.orchestrator.view.canInterrupt()) {
      return { ok: false, reason: 'fsm_busy' };
    }
    
    return { ok: true };
  }
  
  /**
   * Apply cooldown after successful immediate
   */
  _applyCooldown(eventType, data) {
    const cooldowns = {
      'button_hesitation': 15000,
      'state_reset': 20000,
      'slider_exploration': 25000,
      'preset_browsing': 25000,
      'orientation_adjustment': 25000,
    };
    
    const cooldownKey = eventType + (data.button || '');
    const duration = cooldowns[eventType] || 15000;
    this.eventCooldowns.set(cooldownKey, Date.now() + duration);
  }
  
  /**
   * Spend response budget
   */
  _spendBudget(amount) {
    this.responseBudget = Math.max(0, this.responseBudget - amount);
    console.log(`[EventRouter] Budget spent: ${amount}, remaining: ${this.responseBudget}`);
  }
  
  /**
   * Refill budget over time
   */
  _refillBudget() {
    const now = Date.now();
    const timeSinceRefill = now - this.lastBudgetRefill;
    
    if (timeSinceRefill >= this.budgetRefillRate) {
      const refills = Math.floor(timeSinceRefill / this.budgetRefillRate);
      this.responseBudget = Math.min(this.maxBudget, this.responseBudget + refills);
      this.lastBudgetRefill = now;
      
      if (refills > 0) {
        console.log(`[EventRouter] Budget refilled: +${refills}, now: ${this.responseBudget}`);
      }
    }
  }
  
  /**
   * Record recent event for suppression
   */
  _recordRecentEvent(eventType, data) {
    const eventSig = eventType + (data.button || '');
    this.recentEvents.push({ sig: eventSig, time: Date.now() });
    
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }
  }
  
  /**
   * Check if pending interrupt should be processed
   */
  _shouldDrainPending() {
    if (!this.pendingImmediate) return false;
    
    const now = Date.now();
    if (now > this.pendingImmediate.expiresAt) {
      console.log('[EventRouter] Pending immediate expired');
      this.pendingImmediate = null;
      this.sessionMetrics.missedResponses++;
      return false;
    }
    
    // Can drain if FSM is ready
    return this.orchestrator.view.canInterrupt();
  }
  
  /**
   * Check if event should be queued on soft interrupt
   */
  _shouldQueueInterrupt(eventType) {
    return ['button_hesitation', 'slider_exploration', 'preset_browsing'].includes(eventType);
  }
  
  // ─── Immediate Event Handlers ──────────────────────────────────────────────
  
  /**
   * Handle button_hesitation - user hovering over button
   */
  _handleButtonHesitation(data) {
    const { button, duration } = data;
    
    console.log(`[EventRouter] Handling button_hesitation: button=${button}, duration=${duration}ms`);
    
    // Try to select immediate text
    const selected = this.selector.selectImmediate({
      event: 'button_hesitation',
      emotion: this.mind.emotion,
      intensity: this.mind.intensity,
      button,
      data
    });
    
    if (!selected) {
      console.log('[EventRouter] No content selected - returning no_content');
      return {
        responded: false,
        kind: null,
        reason: 'no_content'
      };
    }
    
    console.log('[EventRouter] Content selected, attempting to show...');
    
    // Show immediate text (interrupt ambient)
    if (this.orchestrator.view.interrupt()) {
      console.log('[EventRouter] Interrupt successful, showing immediate text');
      this.orchestrator._showLines(selected.lines, {
        displayTime: 3000,
        idleTime: 2000,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: false,
        _source: 'immediate'
      });
      
      // Reflect on immediate text
      if (selected.reflect_pull) {
        this.mind.reflectOnText(selected, selected.themes);
      }
      
      return {
        responded: true,
        kind: 'immediate',
        reason: 'success',
        budgetCost: 1,
        metadata: {
          tone: selected.tone,
          button
        }
      };
    }
    
    return {
      responded: false,
      kind: null,
      reason: 'fsm_busy'
    };
  }
  
  /**
   * Handle state_reset - reset button clicked
   */
  _handleStateReset(data) {
    return this._handleGenericImmediate('state_reset', data);
  }
  
  /**
   * Handle slider_exploration - pattern detected
   */
  _handleSliderExploration(data) {
    // Observe for emotional transitions
    this.mind.observe('slider_exploration', data);
    
    return this._handleGenericImmediate('slider_exploration', data);
  }
  
  /**
   * Handle preset_browsing - pattern detected
   */
  _handlePresetBrowsing(data) {
    // Observe for emotional transitions
    this.mind.observe('preset_browsing', data);
    
    return this._handleGenericImmediate('preset_browsing', data);
  }
  
  /**
   * Handle orientation_adjustment - pattern detected
   */
  _handleOrientationAdjustment(data) {
    return this._handleGenericImmediate('orientation_adjustment', data);
  }
  
  /**
   * Generic immediate handler (reduces duplication)
   */
  _handleGenericImmediate(eventType, data) {
    const selected = this.selector.selectImmediate({
      event: eventType,
      emotion: this.mind.emotion,
      intensity: this.mind.intensity,
      data
    });
    
    if (!selected) {
      return {
        responded: false,
        kind: null,
        reason: 'no_content'
      };
    }
    
    if (this.orchestrator.view.interrupt()) {
      this.orchestrator._showLines(selected.lines, {
        displayTime: 3000,
        idleTime: 2000,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: false,
        _source: 'immediate'
      });
      
      if (selected.reflect_pull) {
        this.mind.reflectOnText(selected, selected.themes);
      }
      
      return {
        responded: true,
        kind: 'immediate',
        reason: 'success',
        budgetCost: 1,
        metadata: {
          tone: selected.tone
        }
      };
    }
    
    return {
      responded: false,
      kind: null,
      reason: 'fsm_busy'
    };
  }
  
  /**
   * Check if event should be observed by Mind
   */
  _shouldObserve(eventType) {
    const observableEvents = [
      // Simulation events (Phase 6 - deferred)
      'collision', 'ejection', 'stable', 'zoom', 'drag', 'sim_idle',
      // GUI informational
      'mode_changed', 'preset_changed', 'render_completed',
      // Observational
      'immediate_response'
    ];
    return observableEvents.includes(eventType);
  }
  
  // ─── System Event Handlers ────────────────────────────────────────────────
  
  /**
   * Handle ambient_cycle_ready - time to show ambient text
   */
  _handleAmbientCycle(data) {
    const reason = data.reason || 'unknown';
    console.log(`[EventRouter] Ambient cycle triggered (${reason})`);
    
    // Check if Mind wants to stay quiet
    if (this.mind.shouldSuppressAmbient()) {
      console.log('[EventRouter] Mind vetoed ambient, rescheduling');
      
      // Reschedule for later (short delay, check again)
      this.orchestrator.scheduleAmbient(3000, 'mind_veto');
      
      return {
        responded: false,
        kind: null,
        reason: 'mind_suppressed',
        scheduledAmbientInMs: 3000
      };
    }
    
    // Delegate to orchestrator
    this.orchestrator.selectAndShowAmbient();
    
    this.sessionMetrics.shownAmbient++;
    
    return {
      responded: true,
      kind: 'ambient',
      reason: 'ambient_shown'
    };
  }
  
  /**
   * Handle text_complete - text finished displaying
   */
  _handleTextComplete(data) {
    const { type, token, textLength, themes } = data;
    
    // Validate token (stale callback protection)
    if (token && token !== this.orchestrator.currentTextToken) {
      console.log(`[EventRouter] Stale text_complete ignored (token ${token} vs ${this.orchestrator.currentTextToken})`);
      return {
        responded: false,
        kind: null,
        reason: 'stale_text_complete',
        metadata: { token, current: this.orchestrator.currentTextToken }
      };
    }
    
    // Schedule next ambient cycle (for both ambient and immediate)
    const delay = this._getEmotionalAmbientDelay(textLength, themes);
    this.orchestrator.scheduleAmbient(delay, 'text_complete');
    
    console.log(`[EventRouter] Text complete (${type}), scheduling next ambient in ${delay}ms`);
    
    return {
      responded: false,
      kind: null,
      reason: type === 'ambient' ? 'scheduled_next' : 'immediate_complete',
      scheduledAmbientInMs: delay
    };
  }
  
  /**
   * Handle page_loaded - initial boot
   */
  _handlePageLoaded(data) {
    console.log('[EventRouter] Page loaded');
    this.sessionPhase = 'active';
    
    return {
      responded: false,
      kind: null,
      reason: 'boot_complete'
    };
  }
  
  /**
   * Handle page_visible - tab/window became visible
   */
  _handlePageVisible(data) {
    console.log('[EventRouter] Page visible - resuming ambient');
    this.sessionFlags.pageHidden = false;
    
    // Resume ambient cycle with short delay
    const delay = 2000;
    this.orchestrator.scheduleAmbient(delay, 'page_visible');
    
    return {
      responded: false,
      kind: null,
      reason: 'resumed_ambient',
      scheduledAmbientInMs: delay
    };
  }
  
  /**
   * Handle page_hidden - tab/window hidden
   */
  _handlePageHidden(data) {
    console.log('[EventRouter] Page hidden - suppressing ambient');
    this.sessionFlags.pageHidden = true;
    
    // Cancel ambient scheduling
    this.orchestrator.cancelAmbient('page_hidden');
    
    return {
      responded: false,
      kind: null,
      reason: 'ambient_suppressed'
    };
  }
  
  /**
   * Handle user_idle - user inactive for threshold
   */
  _handleUserIdle(data) {
    console.log('[EventRouter] User idle detected');
    this.sessionFlags.userIdle = true;
    
    return {
      responded: false,
      kind: null,
      reason: 'idle_noted'
    };
  }
  
  /**
   * Handle user_returned - user active again after idle
   */
  _handleUserReturned(data) {
    console.log('[EventRouter] User returned from idle');
    this.sessionFlags.userIdle = false;
    
    return {
      responded: false,
      kind: null,
      reason: 'returned_noted'
    };
  }
  
  /**
   * Handle mind_wants_to_speak - Mind requests immediate ambient
   */
  _handleMindSpeakRequest(data) {
    const { emotion, reason } = data;
    
    console.log(`[EventRouter] Mind wants to speak (${reason}, emotion: ${emotion})`);
    
    // Cancel current ambient timer
    this.orchestrator.cancelAmbient('mind_request');
    
    // Schedule immediate ambient (short delay for urgency)
    this.orchestrator.scheduleAmbient(500, reason);
    
    return {
      responded: false,
      kind: null,
      reason: 'rescheduled_immediate',
      scheduledAmbientInMs: 500
    };
  }
  
  /**
   * Calculate idle multiplier based on message length
   * Longer content deserves more breathing room
   */
  _getContentLengthMultiplier(textLength) {
    const charCount = textLength || 50;
    
    if (charCount < 20) return 0.8;      // Short quips can come faster
    if (charCount < 50) return 1.0;      // Normal
    if (charCount < 100) return 1.2;     // Medium - give a moment
    if (charCount < 200) return 1.5;     // Long - definitely pause
    return 1.8;                          // Very long - substantial pause
  }
  
  /**
   * Get minimum idle time based on content themes
   * Some topics inherently need more processing time
   */
  _getContentTypeIdleFloor(themes) {
    if (!themes || themes.length === 0) return 3000;  // Default: 3s minimum
    
    // Mathematical proofs/formulas need thinking time
    if (themes.includes('mathematical')) return 3500;
    
    // Existential/dark content needs space to land emotionally
    if (themes.includes('existential') || themes.includes('dark')) return 4000;
    
    // Infohazards/warnings need emphasis pause
    if (themes.includes('infohazard') || themes.includes('boundary')) return 3500;
    
    // Observational humor/light content - still give breathing room
    if (themes.includes('observational') || themes.includes('amused')) return 3000;
    
    return 3000;  // Default floor: 3s
  }

  /**
   * Calculate ambient delay based on emotion
   */
  _getEmotionalAmbientDelay(lastTextLength = 50, lastThemes = []) {
    const emotion = this.mind.emotion;
    const intensity = this.mind.intensity;
    
    // Base idle from emotion
    const baseIdle = this.selector.getIdleTime(emotion, intensity, 5000);
    
    // Mind autonomy multiplier (damped - only 75% effective)
    const rawMindMult = this.mind.getAmbientDelayMultiplier();
    const dampedMindMult = 1.0 + (rawMindMult - 1.0) * 0.75;
    
    // Content length multiplier
    const lengthMult = this._getContentLengthMultiplier(lastTextLength);
    
    // Compound all multipliers
    const calculatedDelay = baseIdle * dampedMindMult * lengthMult;
    
    // Apply theme-based minimum
    const themeFloor = this._getContentTypeIdleFloor(lastThemes);
    const flooredDelay = Math.max(themeFloor, calculatedDelay);
    
    // Apply hard bounds (defined in textAnimation.js, but we use local constants)
    const IDLE_MIN = 3000;   // 3 seconds minimum between complete messages
    const IDLE_MAX = 30000;
    const finalDelay = Math.max(IDLE_MIN, Math.min(IDLE_MAX, flooredDelay));
    
    if (dampedMindMult !== 1.0 || lengthMult !== 1.0) {
      console.log(`[EventRouter] Idle: base=${baseIdle}ms, mind=${dampedMindMult.toFixed(2)}x, length=${lengthMult.toFixed(2)}x, theme_floor=${themeFloor}ms = ${finalDelay}ms`);
    }
    
    return finalDelay;
  }
}

// Debug utilities
if (typeof window !== 'undefined') {
  window.chazyDebug = window.chazyDebug || {};
  
  window.chazyDebug.testIdle = function(emotion, intensity, textLength, themes) {
    console.group('🕐 Idle Time Calculation Trace');
    console.log('Input:', { emotion, intensity, textLength, themes });
    
    // This is a simplified trace - in reality would need access to router instance
    console.log('Note: This requires access to the ChazyEventRouter instance');
    console.log('Use: window.chazy.router._getEmotionalAmbientDelay(textLength, themes)');
    
    console.groupEnd();
  };
}

