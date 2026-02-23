/**
 * ChazyEventRouter - Central event routing and response control
 * 
 * Responsibilities:
 * - Route all Chazy events to appropriate handlers
 * - Apply rate limiting for immediate responses
 * - Track session metrics and state
 * - Coordinate between Mind, Selector, and Orchestrator
 * - Manage interrupt urgency levels (POLITE, ASSERTIVE, FORCE)
 */

import { getEventUrgency, getEventPriority } from './interruptUrgency.js';
import { getStateReferences } from '../content/stateReferences.js';

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
      ['slider_hover', this._handleSliderHover.bind(this)],
      ['slider_changed', this._handleSliderChanged.bind(this)],
      ['select_hover', this._handleSelectHover.bind(this)],
      ['select_changed', this._handleSelectChanged.bind(this)],
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
    
    // NEW: Enhanced interrupt system
    this.queuedImmediate = null;  // Polite interrupt queue
    
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
   * Route immediate events (with rate limiting and urgency system)
   */
  _routeImmediate(eventType, data) {
    // NEW: Determine urgency and priority
    const urgency = getEventUrgency(eventType);
    const priority = getEventPriority(eventType, urgency);
    
    console.log(`[EventRouter] ${eventType} - urgency: ${urgency}, priority: ${priority}`);
    
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
    const rateCheck = this._checkRateLimits(eventType, data, urgency, priority);
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
    
    // NEW: Check if FSM allows interrupt based on urgency
    const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
    
    if (!interruptCheck.allowed) {
      if (interruptCheck.shouldWait) {
        // Queue polite interrupt for later
        this.queuedImmediate = {
          eventType,
          data,
          urgency,
          priority,
          queuedAt: Date.now()
        };
        console.log(`[EventRouter] Queued polite interrupt: ${eventType} (${interruptCheck.reason})`);
        
        return {
          responded: false,
          kind: null,
          reason: 'queued'
        };
      } else {
        // Discard
        console.log(`[EventRouter] Discarded: ${eventType} (${interruptCheck.reason})`);
        return {
          responded: false,
          kind: null,
          reason: interruptCheck.reason
        };
      }
    }
    
    // Try to show immediate text
    const handler = this.immediateHandlers.get(eventType);
    if (!handler) {
      return {
        responded: false,
        kind: null,
        reason: 'no_handler'
      };
    }
    
    const result = handler(data, urgency, priority);
    
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
  _checkRateLimits(eventType, data, urgency, priority) {
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
    
    // Layer 5: FSM state check - now handled by urgency system
    // (removed old canInterrupt check, using urgency-aware check in _routeImmediate)
    
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
   * Refill budget over time (fixed timing drift)
   */
  _refillBudget() {
    const now = Date.now();
    const timeSinceRefill = now - this.lastBudgetRefill;
    
    if (timeSinceRefill >= this.budgetRefillRate) {
      const refills = Math.floor(timeSinceRefill / this.budgetRefillRate);
      this.responseBudget = Math.min(this.maxBudget, this.responseBudget + refills);
      
      // Fix timing drift: preserve fractional remainder
      const remainder = timeSinceRefill % this.budgetRefillRate;
      this.lastBudgetRefill = now - remainder;
      
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
  
  /**
   * NEW: Check and process queued polite interrupts
   */
  _checkQueuedImmediate() {
    if (!this.queuedImmediate) return;
    
    const { eventType, data, urgency, priority, queuedAt } = this.queuedImmediate;
    
    // Check TTL (5 seconds)
    if (Date.now() - queuedAt > 5000) {
      console.log('[EventRouter] Queued immediate expired');
      this.queuedImmediate = null;
      return;
    }
    
    // Check if now allowed
    const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
    
    if (interruptCheck.allowed) {
      console.log(`[EventRouter] Processing queued polite interrupt: ${eventType}`);
      this.queuedImmediate = null;
      
      // Process the queued event
      this._routeImmediate(eventType, data);
    }
  }
  
  // ─── Immediate Event Handlers ──────────────────────────────────────────────
  
  /**
   * Handle button_hesitation - user hovering over button
   */
  async _handleButtonHesitation(data, urgency, priority) {
    try {
      const { button, duration } = data;
      
      console.log(`[EventRouter] Handling button_hesitation: button=${button}, duration=${duration}ms`);
      
      // Defensive null checks
      if (!button) {
        console.error('[EventRouter] Missing button in button_hesitation');
        return { responded: false, kind: null, reason: 'invalid_data' };
      }
      
      // Get state references for templates
      const stateRefs = getStateReferences(data);
      
      // Try to select immediate text
      const selected = this.selector.selectImmediate({
        event: 'button_hesitation',
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        button,
        stateRefs,
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
      
      console.log('[EventRouter] Content selected, attempting interrupt...');
      
      // NEW: Use enhanced interrupt API
      // First check if interrupt is allowed and clear current text
      const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
      
      if (interruptCheck.allowed && interruptCheck.strategy !== 'direct') {
        // Execute clear strategy and wait for it to complete
        await this.orchestrator.view.textStateMachine._executeClearStrategy(interruptCheck.strategy);
      }
      
      // Now show the lines using Orchestrator (handles multi-line properly)
      this.orchestrator._showLines(selected.lines, {
        displayTime: 3000,
        idleTime: 2000,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.lines.length > 1,
        _source: 'immediate',
        interrupt_style: selected.interrupt_style,  // For staged interrupts
        stage_pause: selected.stage_pause,
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            JSON.stringify(selected.lines).length,
            selected.themes || []
          );
          this.orchestrator.scheduleAmbient(delay, 'immediate_complete');
        }
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
          tone: selected.tone,
          button
        }
      };
    } catch (error) {
      console.error('[EventRouter] Error in _handleButtonHesitation:', error);
      return {
        responded: false,
        kind: null,
        reason: 'error',
        error: error.message
      };
    }
  }
  
  /**
   * Handle slider_hover - user hovering over slider
   */
  async _handleSliderHover(data, urgency, priority) {
    const { slider, duration } = data;
    
    console.log(`[EventRouter] Handling slider_hover: slider=${slider}, duration=${duration}ms`);
    
    // Get state references for templates
    const stateRefs = getStateReferences(data);
    
    const selected = this.selector.selectImmediate({
      event: 'slider_hover',
      emotion: this.mind.emotion,
      intensity: this.mind.intensity,
      slider,
      stateRefs,
      data
    });
    
    if (!selected) {
      return { responded: false, kind: null, reason: 'no_content' };
    }
    
    // Observational - just acknowledge, don't interrupt
    this.mind.observe('slider_hover', data);
    
    return {
      responded: true,
      kind: 'observational',
      reason: 'acknowledged',
      budgetCost: 0
    };
  }
  
  /**
   * Handle slider_changed - slider value changed
   */
  async _handleSliderChanged(data, urgency, priority) {
    try {
      const { slider, oldValue, newValue, delta } = data;
      
      console.log(`[EventRouter] Handling slider_changed: slider=${slider}, ${oldValue}→${newValue}`);
      
      // Defensive null checks
      if (!slider) {
        console.error('[EventRouter] Missing slider in slider_changed');
        return { responded: false, kind: null, reason: 'invalid_data' };
      }
      
      // Get state references for templates
      const stateRefs = getStateReferences(data);
      
      const selected = this.selector.selectImmediate({
        event: 'slider_changed',
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        slider,
        stateRefs,
        data
      });
      
      if (!selected) {
        return { responded: false, kind: null, reason: 'no_content' };
      }
      
      // Polite - check if we can interrupt
      const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
      
      if (interruptCheck.allowed && interruptCheck.strategy !== 'direct') {
        await this.orchestrator.view.textStateMachine._executeClearStrategy(interruptCheck.strategy);
      }
      
      this.orchestrator._showLines(selected.lines, {
        displayTime: 2500,
        idleTime: 1500,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.lines.length > 1,
        _source: 'immediate',
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            JSON.stringify(selected.lines).length,
            selected.themes || []
          );
          this.orchestrator.scheduleAmbient(delay, 'immediate_complete');
        }
      });
      
      return {
        responded: true,
        kind: 'immediate',
        reason: 'success',
        budgetCost: 1,
        metadata: { tone: selected.tone, slider }
      };
    } catch (error) {
      console.error('[EventRouter] Error in _handleSliderChanged:', error);
      return { responded: false, kind: null, reason: 'error', error: error.message };
    }
  }
  
  /**
   * Handle select_hover - user hovering over dropdown
   */
  async _handleSelectHover(data, urgency, priority) {
    const { select, duration } = data;
    
    console.log(`[EventRouter] Handling select_hover: select=${select}, duration=${duration}ms`);
    
    // Get state references for templates
    const stateRefs = getStateReferences(data);
    
    const selected = this.selector.selectImmediate({
      event: 'select_hover',
      emotion: this.mind.emotion,
      intensity: this.mind.intensity,
      select,
      stateRefs,
      data
    });
    
    if (!selected) {
      return { responded: false, kind: null, reason: 'no_content' };
    }
    
    // Observational - just acknowledge
    this.mind.observe('select_hover', data);
    
    return {
      responded: true,
      kind: 'observational',
      reason: 'acknowledged',
      budgetCost: 0
    };
  }
  
  /**
   * Handle select_changed - dropdown value changed
   */
  async _handleSelectChanged(data, urgency, priority) {
    try {
      const { select, oldValue, newValue } = data;
      
      console.log(`[EventRouter] Handling select_changed: select=${select}, ${oldValue}→${newValue}`);
      
      // Defensive null checks
      if (!select) {
        console.error('[EventRouter] Missing select in select_changed');
        return { responded: false, kind: null, reason: 'invalid_data' };
      }
      
      // Get state references for templates
      const stateRefs = getStateReferences(data);
      
      const selected = this.selector.selectImmediate({
        event: 'select_changed',
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        select,
        stateRefs,
        data
      });
      
      if (!selected) {
        return { responded: false, kind: null, reason: 'no_content' };
      }
      
      // Polite - check if we can interrupt
      const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
      
      if (interruptCheck.allowed && interruptCheck.strategy !== 'direct') {
        await this.orchestrator.view.textStateMachine._executeClearStrategy(interruptCheck.strategy);
      }
      
      this.orchestrator._showLines(selected.lines, {
        displayTime: 2500,
        idleTime: 1500,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.lines.length > 1,
        _source: 'immediate',
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            JSON.stringify(selected.lines).length,
            selected.themes || []
          );
          this.orchestrator.scheduleAmbient(delay, 'immediate_complete');
        }
      });
      
      return {
        responded: true,
        kind: 'immediate',
        reason: 'success',
        budgetCost: 1,
        metadata: { tone: selected.tone, select }
      };
    } catch (error) {
      console.error('[EventRouter] Error in _handleSelectChanged:', error);
      return { responded: false, kind: null, reason: 'error', error: error.message };
    }
  }
  
  /**
   * Handle state_reset - reset button clicked
   */
  _handleStateReset(data, urgency, priority) {
    return this._handleGenericImmediate('state_reset', data, urgency, priority);
  }
  
  /**
   * Handle slider_exploration - pattern detected
   */
  _handleSliderExploration(data, urgency, priority) {
    // Observe for emotional transitions
    this.mind.observe('slider_exploration', data);
    
    return this._handleGenericImmediate('slider_exploration', data, urgency, priority);
  }
  
  /**
   * Handle preset_browsing - pattern detected
   */
  _handlePresetBrowsing(data, urgency, priority) {
    // Observe for emotional transitions
    this.mind.observe('preset_browsing', data);
    
    return this._handleGenericImmediate('preset_browsing', data, urgency, priority);
  }
  
  /**
   * Handle orientation_adjustment - pattern detected
   */
  _handleOrientationAdjustment(data, urgency, priority) {
    return this._handleGenericImmediate('orientation_adjustment', data, urgency, priority);
  }
  
  /**
   * Generic immediate handler (reduces duplication)
   */
  async _handleGenericImmediate(eventType, data, urgency, priority) {
    try {
      // Get state references for templates
      const stateRefs = getStateReferences(data);
      
      const selected = this.selector.selectImmediate({
        event: eventType,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        stateRefs,
        data
      });
      
      if (!selected) {
        return {
          responded: false,
          kind: null,
          reason: 'no_content'
        };
      }
      
      // Check if interrupt is allowed and execute clear strategy
      const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
      
      if (interruptCheck.allowed && interruptCheck.strategy !== 'direct') {
        await this.orchestrator.view.textStateMachine._executeClearStrategy(interruptCheck.strategy);
      }
      
      // Show lines using Orchestrator (handles multi-line)
      this.orchestrator._showLines(selected.lines, {
        displayTime: 3000,
        idleTime: 2000,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.lines.length > 1,
        _source: 'immediate',
        interrupt_style: selected.interrupt_style,
        stage_pause: selected.stage_pause,
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            JSON.stringify(selected.lines).length,
            selected.themes || []
          );
          this.orchestrator.scheduleAmbient(delay, 'immediate_complete');
        }
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
    } catch (error) {
      console.error(`[EventRouter] Error in _handleGenericImmediate for ${eventType}:`, error);
      return {
        responded: false,
        kind: null,
        reason: 'error',
        error: error.message
      };
    }
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
    
    // NEW: Check for queued polite interrupts
    this._checkQueuedImmediate();
    
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

