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
import type { ChazyMind } from '../mind/chazyMind.js';
import type { TextSelector } from '../content/textSelector.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface EventData {
  [key: string]: any;
}

interface RouteResult {
  responded: boolean;
  kind: string | null;
  reason: string;
  budgetCost?: number;
  metadata?: Record<string, any>;
  error?: string;
  scheduledAmbientInMs?: number;
}

interface RateLimitCheck {
  ok: boolean;
  reason?: string;
}

interface PendingInterrupt {
  eventType: string;
  data: EventData;
  queuedAt: number;
  expiresAt: number;
}

interface QueuedImmediate {
  eventType: string;
  data: EventData;
  urgency: number;
  priority: number;
  queuedAt: number;
}

interface RecentEvent {
  sig: string;
  time: number;
}

interface SessionFlags {
  pageHidden: boolean;
  userIdle: boolean;
  hasRendered: boolean;
}

interface SessionMetrics {
  startTime: number;
  totalEvents: number;
  shownAmbient: number;
  shownImmediateResponses: number;
  blockedResponses: number;
  missedResponses: number;
  blockReasonCounts: Record<string, number>;
}

// Orchestrator interface (minimal for type safety)
interface Orchestrator {
  view: any;
  scheduleAmbient(delay: number, reason: string): void;
  _showLines(lines: any[], config: any): void;
}

/**
 * Calculate actual text length from lines array, removing \pause{} markers
 */
function getCleanTextLength(lines: any[]): number {
  if (!Array.isArray(lines)) return 0;
  
  return lines.reduce((sum, lineItem) => {
    const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
    if (typeof line !== 'string') return sum;
    
    const cleanLine = line.replace(/(?<!\\)\\pause\{\d+\}/g, '');
    return sum + cleanLine.length;
  }, 0);
}

// ─── ChazyEventRouter Class ────────────────────────────────────────────────

export class ChazyEventRouter {
  orchestrator: Orchestrator;
  mind: ChazyMind;
  selector: TextSelector;
  systemHandlers: Map<string, (data: EventData) => RouteResult>;
  immediateHandlers: Map<string, (data: EventData, urgency: number, priority: number) => Promise<RouteResult>>;
  sessionFlags: SessionFlags;
  eventCooldowns: Map<string, number>;
  globalImmediateLock: boolean;
  globalImmediateLockUntil: number;
  responseBudget: number;
  maxBudget: number;
  budgetRefillRate: number;
  lastBudgetRefill: number;
  recentEvents: RecentEvent[];
  maxRecentEvents: number;
  pendingImmediate: PendingInterrupt | null;
  queuedImmediate: QueuedImmediate | null;
  sessionMetrics: SessionMetrics;
  sessionPhase: string;
  
  constructor(orchestrator: Orchestrator, mind: ChazyMind, selector: TextSelector) {
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
      ['button_click_render', this._handleButtonClick.bind(this)],
      ['button_click_share', this._handleButtonClick.bind(this)],
      ['button_click_reset', this._handleButtonClick.bind(this)],
      ['button_click_copy', this._handleButtonClick.bind(this)],
      ['button_click_save', this._handleButtonClick.bind(this)],
      ['button_click_zero_z0', this._handleButtonClick.bind(this)],
      ['button_click_randomize_z0', this._handleButtonClick.bind(this)],
      ['button_click_reset_tilts', this._handleButtonClick.bind(this)],
      ['button_click_apply_json', this._handleButtonClick.bind(this)],
      ['button_click_download_json', this._handleButtonClick.bind(this)],
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
    
    // Rate limiting state
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
    this.queuedImmediate = null;
    
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
  
  route(eventType: string, data: EventData = {}): RouteResult | Promise<RouteResult> {
    console.log(`[EventRouter] ${eventType}`, data);
    this.sessionMetrics.totalEvents++;
    
    const event = {
      eventType,
      data,
      _timestamp: Date.now(),
      _source: 'router'
    };
    
    if (this.systemHandlers.has(eventType)) {
      return this._routeSystem(eventType, data);
    }
    
    if (this.immediateHandlers.has(eventType)) {
      return this._routeImmediate(eventType, data);
    }
    
    if (this._shouldObserve(eventType)) {
      this.mind.observe(eventType, data);
    }
    
    return { responded: false, kind: null, reason: 'no_handler' };
  }
  
  private _routeSystem(eventType: string, data: EventData): RouteResult {
    const handler = this.systemHandlers.get(eventType);
    if (!handler) {
      return { responded: false, kind: null, reason: 'no_handler' };
    }
    
    const result = handler(data);
    
    if (['page_visible', 'user_returned'].includes(eventType)) {
      this.mind.observe(eventType, data);
    }
    
    return result;
  }
  
  private _routeImmediate(eventType: string, data: EventData): RouteResult | Promise<RouteResult> {
    const urgency = getEventUrgency(eventType);
    const priority = getEventPriority(eventType, urgency);
    
    console.log(`[EventRouter] ${eventType} - urgency: ${urgency}, priority: ${priority}`);
    
    if (this.pendingImmediate && this._shouldDrainPending()) {
      const pending = this.pendingImmediate;
      this.pendingImmediate = null;
      
      const result = this._routeImmediate(pending.eventType, pending.data);
      if (result instanceof Promise) {
        return result.then(res => {
          if (res.responded) {
            return {
              responded: false,
              kind: null,
              reason: 'pending_processed_instead'
            };
          }
          return res;
        });
      }
      if (result.responded) {
        return {
          responded: false,
          kind: null,
          reason: 'pending_processed_instead'
        };
      }
    }
    
    this._refillBudget();
    
    const rateCheck = this._checkRateLimits(eventType, data, urgency, priority);
    if (!rateCheck.ok) {
      this.sessionMetrics.blockedResponses++;
      const reason = rateCheck.reason || 'unknown';
      this.sessionMetrics.blockReasonCounts[reason] = 
        (this.sessionMetrics.blockReasonCounts[reason] || 0) + 1;
      
      if (reason === 'fsm_busy' && this._shouldQueueInterrupt(eventType)) {
        this.pendingImmediate = {
          eventType,
          data,
          queuedAt: Date.now(),
          expiresAt: Date.now() + 2000
        };
        console.log(`[EventRouter] Queued ${eventType} (FSM busy)`);
      }
      
      return {
        responded: false,
        kind: null,
        reason: rateCheck.reason || 'unknown'
      };
    }
    
    const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
    
    if (!interruptCheck.allowed) {
      if (interruptCheck.shouldWait) {
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
        console.log(`[EventRouter] Discarded: ${eventType} (${interruptCheck.reason})`);
        return {
          responded: false,
          kind: null,
          reason: interruptCheck.reason
        };
      }
    }
    
    const handler = this.immediateHandlers.get(eventType);
    if (!handler) {
      return {
        responded: false,
        kind: null,
        reason: 'no_handler'
      };
    }
    
    const resultPromise = handler(data, urgency, priority);
    
    return resultPromise.then(result => {
      if (result.responded) {
        this._applyCooldown(eventType, data);
        this._spendBudget(result.budgetCost || 1);
        this._recordRecentEvent(eventType, data);
        
        const lockDuration = 8000;
        this.globalImmediateLock = true;
        this.globalImmediateLockUntil = Date.now() + lockDuration;
        setTimeout(() => {
          this.globalImmediateLock = false;
        }, lockDuration);
        
        this.sessionMetrics.shownImmediateResponses++;
        
        this.route('immediate_response', {
          originalEvent: eventType,
          tone: result.metadata?.tone,
          wasSuccessful: true,
          button: data.button
        });
      } else if (result.reason === 'fsm_busy') {
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
    });
  }
  
  private _checkRateLimits(eventType: string, data: EventData, urgency: number, priority: number): RateLimitCheck {
    const now = Date.now();
    
    const cooldownKey = eventType + (data.button || '');
    const cooldown = this.eventCooldowns.get(cooldownKey);
    if (cooldown && now < cooldown) {
      return { ok: false, reason: 'event_cooldown' };
    }
    
    if (this.globalImmediateLock && now < this.globalImmediateLockUntil) {
      return { ok: false, reason: 'global_lock' };
    }
    
    if (this.responseBudget < 1) {
      return { ok: false, reason: 'budget_exhausted' };
    }
    
    const eventSig = eventType + (data.button || '');
    const SUPPRESSION_WINDOW = 60000;
    const recent = this.recentEvents.find(e => 
      e.sig === eventSig && now - e.time < SUPPRESSION_WINDOW
    );
    if (recent) {
      return { ok: false, reason: 'recent_suppression' };
    }
    
    return { ok: true };
  }
  
  private _applyCooldown(eventType: string, data: EventData): void {
    const cooldowns: Record<string, number> = {
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
  
  private _spendBudget(amount: number): void {
    this.responseBudget = Math.max(0, this.responseBudget - amount);
    console.log(`[EventRouter] Budget spent: ${amount}, remaining: ${this.responseBudget}`);
  }
  
  private _refillBudget(): void {
    const now = Date.now();
    const timeSinceRefill = now - this.lastBudgetRefill;
    
    if (timeSinceRefill >= this.budgetRefillRate) {
      const refills = Math.floor(timeSinceRefill / this.budgetRefillRate);
      this.responseBudget = Math.min(this.maxBudget, this.responseBudget + refills);
      
      const remainder = timeSinceRefill % this.budgetRefillRate;
      this.lastBudgetRefill = now - remainder;
      
      if (refills > 0) {
        console.log(`[EventRouter] Budget refilled: +${refills}, now: ${this.responseBudget}`);
      }
    }
  }
  
  private _recordRecentEvent(eventType: string, data: EventData): void {
    const eventSig = eventType + (data.button || '');
    this.recentEvents.push({ sig: eventSig, time: Date.now() });
    
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }
  }
  
  private _shouldDrainPending(): boolean {
    if (!this.pendingImmediate) return false;
    
    const now = Date.now();
    if (now > this.pendingImmediate.expiresAt) {
      console.log('[EventRouter] Pending immediate expired');
      this.pendingImmediate = null;
      this.sessionMetrics.missedResponses++;
      return false;
    }
    
    return this.orchestrator.view.canInterrupt();
  }
  
  private _shouldQueueInterrupt(eventType: string): boolean {
    return ['button_hesitation', 'slider_exploration', 'preset_browsing'].includes(eventType);
  }
  
  private _checkQueuedImmediate(): void {
    if (!this.queuedImmediate) return;
    
    const { eventType, data, urgency, priority, queuedAt } = this.queuedImmediate;
    
    if (Date.now() - queuedAt > 5000) {
      console.log('[EventRouter] Queued immediate expired');
      this.queuedImmediate = null;
      return;
    }
    
    const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
    
    if (interruptCheck.allowed) {
      console.log(`[EventRouter] Processing queued polite interrupt: ${eventType}`);
      this.queuedImmediate = null;
      this._routeImmediate(eventType, data);
    }
  }
  
  private _shouldObserve(eventType: string): boolean {
    return !eventType.startsWith('_') && eventType !== 'ambient_cycle_ready';
  }
  
  // ─── System Event Handlers ─────────────────────────────────────────────────
  
  private _handleAmbientCycle(data: EventData): RouteResult {
    const reason = data.reason || 'unknown';
    console.log(`[EventRouter] Ambient cycle triggered (${reason})`);

    // Check queued immediate events first
    this._checkQueuedImmediate();

    // NEVER suppress the welcome text (startup cycle)
    const isWelcome = reason === 'startup';
    
    // PRIMARY FIX: Block ambient if multi-line sequence in progress (but not for welcome)
    if (!isWelcome && this.orchestrator.inMultiLineSequence) {
      console.warn('[EventRouter] Deferred ambient - multi-line in progress');
      console.warn('[EventRouter] Multi-line details:', {
        token: this.orchestrator.multiLineSequenceToken,
        currentToken: this.orchestrator.currentTextToken,
        reason
      });

      // Don't reschedule - let sequence complete naturally
      return {
        responded: false,
        kind: null,
        reason: 'multi_line_in_progress'
      };
    }
    
    // Check if Mind wants to stay quiet (but not for welcome text)
    if (!isWelcome && this.mind.shouldSuppressAmbient()) {
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
    
    // Delegate to orchestrator to select and show ambient text
    this.orchestrator.selectAndShowAmbient();
    
    this.sessionMetrics.shownAmbient++;
    
    return {
      responded: true,
      kind: 'ambient',
      reason: 'ambient_shown'
    };
  }
  
  private _handleTextComplete(data: EventData): RouteResult {
    const { type, token, textLength, themes } = data;
    
    console.log(`[EventRouter] Text complete (${type}, token ${token})`);
    
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
    
    // PRIMARY FIX: Check multi-line BEFORE scheduling ambient
    // This prevents timer from being set during multi-line sequences
    if (this.orchestrator.inMultiLineSequence) {
      console.warn('[EventRouter] Multi-line in progress - blocking ambient schedule and interrupts');
      console.warn('[EventRouter] Multi-line details:', {
        token: this.orchestrator.multiLineSequenceToken,
        currentToken: this.orchestrator.currentTextToken
      });
      
      // WATCHDOG: Still record state even though not scheduling
      if (this.orchestrator._recordWatchdogState) {
        this.orchestrator._recordWatchdogState();
      }
      
      return {
        responded: false,
        kind: null,
        reason: 'multi_line_in_progress'
      };
    }
    
    // Now safe to check for queued polite interrupts (only if NOT in multi-line)
    this._checkQueuedImmediate();
    
    // Now safe to schedule ambient
    const delay = this._getEmotionalAmbientDelay(textLength || 50, themes || []);
    this.orchestrator.scheduleAmbient(delay, 'text_complete');
    
    console.log(`[EventRouter] Text complete (${type}), scheduling next ambient in ${delay}ms`);
    
    // WATCHDOG: Record state for watchdog
    if (this.orchestrator._recordWatchdogState) {
      this.orchestrator._recordWatchdogState();
      console.log('[EventRouter] Watchdog state recorded after text complete');
    }
    
    return {
      responded: false,
      kind: null,
      reason: type === 'ambient' ? 'scheduled_next' : 'immediate_complete',
      scheduledAmbientInMs: delay
    };
  }
  
  private _handlePageLoaded(data: EventData): RouteResult {
    return { responded: false, kind: null, reason: 'page_loaded' };
  }
  
  private _handlePageVisible(data: EventData): RouteResult {
    this.sessionFlags.pageHidden = false;
    return { responded: false, kind: null, reason: 'page_visible' };
  }
  
  private _handlePageHidden(data: EventData): RouteResult {
    this.sessionFlags.pageHidden = true;
    return { responded: false, kind: null, reason: 'page_hidden' };
  }
  
  private _handleUserIdle(data: EventData): RouteResult {
    this.sessionFlags.userIdle = true;
    return { responded: false, kind: null, reason: 'user_idle' };
  }
  
  private _handleUserReturned(data: EventData): RouteResult {
    this.sessionFlags.userIdle = false;
    return { responded: false, kind: null, reason: 'user_returned' };
  }
  
  private _handleMindSpeakRequest(data: EventData): RouteResult {
    this.orchestrator.scheduleAmbient(500, 'mind_request');
    return {
      responded: false,
      kind: null,
      reason: 'rescheduled_immediate',
      scheduledAmbientInMs: 500
    };
  }
  
  // ─── Immediate Event Handlers ──────────────────────────────────────────────
  
  private async _handleButtonHesitation(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    try {
      const { button, duration } = data;
      
      console.log(`[EventRouter] Handling button_hesitation: button=${button}, duration=${duration}ms`);
      
      if (!button) {
        console.error('[EventRouter] Missing button in button_hesitation');
        return { responded: false, kind: null, reason: 'invalid_data' };
      }
      
      const stateRefs = getStateReferences(data);
      
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
      
      const interruptCheck = this.orchestrator.view.textStateMachine.canInterrupt(urgency, priority);
      
      if (interruptCheck.allowed && interruptCheck.strategy !== 'direct') {
        await this.orchestrator.view.textStateMachine._executeClearStrategy(interruptCheck.strategy);
      }
      
      this.orchestrator._showLines(selected.lines, {
        displayTime: 3000,
        idleTime: 2000,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.lines.length > 1,
        _source: 'immediate',
        interrupt_style: (selected as any).interrupt_style,
        stage_pause: (selected as any).stage_pause,
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            getCleanTextLength(selected.lines),
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
    } catch (error: any) {
      console.error('[EventRouter] Error in _handleButtonHesitation:', error);
      return {
        responded: false,
        kind: null,
        reason: 'error',
        error: error.message
      };
    }
  }
  
  private async _handleButtonClick(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    try {
      const { buttonId } = data;
      
      console.log(`[EventRouter] Handling button_click: button=${buttonId}`);
      
      if (!buttonId) {
        console.error('[EventRouter] Missing buttonId in button_click');
        return { responded: false, kind: null, reason: 'invalid_data' };
      }
      
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
      
      const action = actionMap[buttonId] || buttonId;
      const eventName = `button_click_${action}`;
      
      const stateRefs = getStateReferences(data);
      
      const selected = this.selector.selectImmediate({
        event: eventName,
        emotion: this.mind.emotion,
        intensity: this.mind.intensity,
        button: action,
        stateRefs,
        data
      });
      
      if (!selected) {
        console.log(`[EventRouter] No content for ${eventName}`);
        return {
          responded: false,
          kind: null,
          reason: 'no_content'
        };
      }
      
      console.log('[EventRouter] Button click content selected, attempting ASSERTIVE interrupt...');
      
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
        interrupt_style: (selected as any).interrupt_style,
        stage_pause: (selected as any).stage_pause,
        onComplete: () => {
          const delay = this._getEmotionalAmbientDelay(
            getCleanTextLength(selected.lines),
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
          button: action
        }
      };
    } catch (error: any) {
      console.error('[EventRouter] Error in _handleButtonClick:', error);
      return {
        responded: false,
        kind: null,
        reason: 'error',
        error: error.message
      };
    }
  }
  
  private async _handleSliderHover(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    const { slider, duration } = data;
    
    console.log(`[EventRouter] Handling slider_hover: slider=${slider}, duration=${duration}ms`);
    
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
    
    this.mind.observe('slider_hover', data);
    
    return {
      responded: true,
      kind: 'observational',
      reason: 'acknowledged',
      budgetCost: 0
    };
  }
  
  private async _handleSliderChanged(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    // Placeholder - similar pattern to button handlers
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handleSelectHover(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handleSelectChanged(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handleStateReset(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handleSliderExploration(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handlePresetBrowsing(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  private async _handleOrientationAdjustment(data: EventData, urgency: number, priority: number): Promise<RouteResult> {
    return { responded: false, kind: null, reason: 'not_implemented' };
  }
  
  // ─── Helper Methods ────────────────────────────────────────────────────────
  
  private _getContentLengthMultiplier(textLength: number): number {
    const charCount = textLength || 50;
    
    if (charCount < 20) return 0.8;
    if (charCount < 50) return 1.0;
    if (charCount < 100) return 1.2;
    if (charCount < 200) return 1.5;
    return 1.8;
  }
  
  private _getContentTypeIdleFloor(themes: string[]): number {
    if (!themes || themes.length === 0) return 3000;
    
    if (themes.includes('mathematical')) return 3500;
    if (themes.includes('existential') || themes.includes('dark')) return 4000;
    if (themes.includes('infohazard') || themes.includes('boundary')) return 3500;
    if (themes.includes('observational') || themes.includes('amused')) return 3000;
    
    return 3000;
  }
  
  _getEmotionalAmbientDelay(lastTextLength: number = 50, lastThemes: string[] = []): number {
    const emotion = this.mind.emotion;
    const intensity = this.mind.intensity;
    
    const baseIdle = this.selector.getIdleTime(emotion, intensity, 5000);
    
    const rawMindMult = this.mind.getAmbientDelayMultiplier();
    const dampedMindMult = 1.0 + (rawMindMult - 1.0) * 0.5;
    
    const lengthMult = this._getContentLengthMultiplier(lastTextLength);
    
    const calculatedDelay = baseIdle * dampedMindMult * lengthMult;
    
    const themeFloor = this._getContentTypeIdleFloor(lastThemes);
    const flooredDelay = Math.max(themeFloor, calculatedDelay);
    
    const IDLE_MIN = 3000;
    const IDLE_MAX = 12000;
    const finalDelay = Math.max(IDLE_MIN, Math.min(IDLE_MAX, flooredDelay));
    
    if (dampedMindMult !== 1.0 || lengthMult !== 1.0) {
      console.log(`[EventRouter] Idle: base=${baseIdle}ms, mind=${dampedMindMult.toFixed(2)}x, length=${lengthMult.toFixed(2)}x, theme_floor=${themeFloor}ms = ${finalDelay}ms`);
    }
    
    return finalDelay;
  }
}

// Debug utilities
if (typeof window !== 'undefined') {
  (window as any).chazyDebug = (window as any).chazyDebug || {};
  
  (window as any).chazyDebug.testIdle = function(emotion: string, intensity: number, textLength: number, themes: string[]) {
    console.group('🕐 Idle Time Calculation Trace');
    console.log('Input:', { emotion, intensity, textLength, themes });
    console.log('Note: This requires access to the ChazyEventRouter instance');
    console.log('Use: window.chazy.router._getEmotionalAmbientDelay(textLength, themes)');
    console.groupEnd();
  };
}
