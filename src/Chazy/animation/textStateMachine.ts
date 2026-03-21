/**
 * Text Animation State Machine (Enhanced with Interrupt System)
 * ────────────────────────────────────────────────────────────────
 * FSM States: IDLE → TYPING → DISPLAY → DELETING → IDLE
 *            ↓ (interrupt) ↓
 *        INTERRUPT_CLEARING
 * 
 * Manages the lifecycle of subtitle text animations with:
 * - Enhanced interrupt system (urgency levels, priorities)
 * - Interrupt prediction and pre-warming
 * - Adaptive timing calibration
 * - Multi-line text handling
 * - Momentum-based speed adjustments
 */

import { animateTextInTyping, animateTextOut } from './textAnimation.js';
import { InterruptTimingCalibrator } from '../events/interruptTimingCalibrator.js';
import { InterruptPredictor } from '../events/interruptPredictor.js';
import { INTERRUPT_URGENCY } from '../events/interruptUrgency.js';

// ─── Types ─────────────────────────────────────────────────────────────────

type FSMState = 'IDLE' | 'TYPING' | 'DISPLAY' | 'DELETING' | 'INTERRUPT_CLEARING';

type ClearStrategy = 
  | 'none'
  | 'direct'
  | 'normal_delete'
  | 'abort_and_clear'
  | 'fast_select_delete'
  | 'instant_abort'
  | 'instant_clear'
  | 'abort_delete_and_clear'
  | 'queue_after';

interface InterruptCheck {
  allowed: boolean;
  strategy: ClearStrategy;
  shouldWait: boolean;
  reason: string;
}

interface AnimationConfig {
  displayTime?: number;
  idleTime?: number;
  onComplete: () => void;
  isWelcome?: boolean;
  inMultiLineSequence?: boolean;
  isLastInSequence?: boolean;
  emotion?: string;
  intensity?: number;
  tone?: string;
  themes?: string[];
  _source?: string;
}

interface PendingInterrupt {
  lines: string;
  config: AnimationConfig;
  priority: number;
  queuedAt: number;
  emotionSnapshot?: {
    emotion: string;
    intensity: number;
  };
}

interface InterruptHistoryEntry {
  timestamp: number;
  emotion?: string;
}

// ─── TextStateMachine Class ────────────────────────────────────────────────

export class TextStateMachine {
  element: HTMLElement;
  onUpdateCallback: (() => void) | null;
  currentState: FSMState;
  currentAnimationCancel: ((partialOnly?: boolean) => void) | null;
  currentTimer: ReturnType<typeof setTimeout> | null;
  pendingLine: string | null;
  isFirstText: boolean;
  isWelcomeText: boolean;
  pendingInterrupts: PendingInterrupt[];
  currentLinePriority: number;
  currentEmotion: string;
  currentIntensity: number;
  interruptHistory: InterruptHistoryEntry[];
  timingCalibrator: InterruptTimingCalibrator;
  interruptPredictor: InterruptPredictor;
  interruptPrewarmed: boolean;
  prewarmSpeedMultiplier: number;
  interruptPausedForHidden: boolean;
  _visibilityHandler: () => void;
  currentLineSequence: string[];
  currentLineIndex: number;
  inMultiLineSequence: boolean;
  _clearInProgress: boolean;
  currentDisplayLine: string | null;
  _cleanupInterval: ReturnType<typeof setInterval> | null;
  _multiLineLockTimestamp: number | undefined;
  currentTextSource: string;
  
  constructor(element: HTMLElement, onUpdateCallback: (() => void) | null = null) {
    this.element = element;
    this.onUpdateCallback = onUpdateCallback;
    
    // FSM state
    this._enterIdle();
    this.currentAnimationCancel = null;
    this.currentTimer = null;
    this.pendingLine = null;
    this.isFirstText = true;
    this.isWelcomeText = false;
    
    // Enhanced interrupt system
    this.pendingInterrupts = [];
    this.currentLinePriority = 1;
    this.currentTextSource = 'ambient';
    this.currentEmotion = 'NEUTRAL';
    this.currentIntensity = 0.5;
    this.interruptHistory = [];
    
    // Adaptive systems
    this.timingCalibrator = new InterruptTimingCalibrator();
    this.interruptPredictor = new InterruptPredictor();
    this.interruptPredictor.onPrediction = (buttonId, confidence) => {
      this._handleInterruptPrediction(buttonId, confidence);
    };
    
    // Prediction pre-warm state
    this.interruptPrewarmed = false;
    this.prewarmSpeedMultiplier = 1.0;
    
    // Page visibility handling
    this.interruptPausedForHidden = false;
    this._visibilityHandler = this._handleVisibilityChange.bind(this);
    this._setupVisibilityListener();
    
    // Multi-line sequence tracking
    this.currentLineSequence = [];
    this.currentLineIndex = 0;
    this.inMultiLineSequence = false;
    
    // Clear strategy lock
    this._clearInProgress = false;
    
    // Full line currently being shown
    this.currentDisplayLine = null;
    
    // Cleanup interval
    this._cleanupInterval = setInterval(() => this._cleanupInterruptHistory(), 10000);
    
    this._showInitialCursor();
  }
  
  private _enterIdle(): void {
    this.currentState = 'IDLE';
    this.currentDisplayLine = null;
  }
  
  getCurrentFullLine(): string | null {
    return this.currentDisplayLine || null;
  }
  
  private _showInitialCursor(): void {
    this.element.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'text-cursor blinking';
    cursor.textContent = '█';
    this.element.appendChild(cursor);
  }
  
  private _setupVisibilityListener(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }
  
  private _handleVisibilityChange(): void {
    if (!document.hidden && this.interruptPausedForHidden) {
      console.log('[FSM] Page visible - resuming paused interrupt');
      this.interruptPausedForHidden = false;
      this._resumePausedInterrupt();
    }
  }
  
  destroy(): void {
    if (typeof document !== 'undefined' && this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    
    if (this.currentAnimationCancel) {
      this.currentAnimationCancel();
      this.currentAnimationCancel = null;
    }
    
    console.log('[FSM] Destroyed and cleaned up');
  }
  
  private _resumePausedInterrupt(): void {
    if (this.element.dataset.interruptPaused === 'true') {
      const fadeDuration = parseInt(this.element.dataset.interruptFadeDuration || '100');
      
      const charSpans = Array.from(this.element.querySelectorAll('span:not(.text-cursor)')) as HTMLElement[];
      this.element.classList.remove('has-selection');
      
      charSpans.forEach(span => {
        span.style.opacity = '0';
        span.style.transition = `opacity ${fadeDuration}ms ease-out`;
      });
      
      setTimeout(() => {
        charSpans.forEach(span => span.remove());
        this.element.style.minWidth = '';
        this.element.style.maxWidth = '';
        delete this.element.dataset.interruptPaused;
        delete this.element.dataset.interruptFadeDuration;
        
        this._processPendingInterrupts();
      }, fadeDuration);
    }
  }
  
  // ────────────────────────────────────────────────────────────────────
  // Enhanced Interrupt API
  // ────────────────────────────────────────────────────────────────────
  
  canInterrupt(urgency: number = INTERRUPT_URGENCY.ASSERTIVE, priority: number = 2, incomingSource?: string): InterruptCheck {
    const state = this.currentState;
    const currentPriority = this.currentLinePriority || 1;
    
    if (this.isWelcomeText) {
      console.log('[FSM] Welcome text protected from interrupt');
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: false,
        reason: 'welcome_protected'
      };
    }
    
    // BUG FIX: Safety timeout for stuck multi-line lock
    // If we're in IDLE state with multi-line lock for >45s, something went wrong
    if (this.inMultiLineSequence && state === 'IDLE') {
      // Check how long we've been in this state
      if (!this._multiLineLockTimestamp) {
        this._multiLineLockTimestamp = Date.now();
      } else {
        const lockDuration = Date.now() - this._multiLineLockTimestamp;
        if (lockDuration > 45000) {
          console.error(`[FSM] SAFETY: Multi-line lock stuck for ${(lockDuration / 1000).toFixed(1)}s in IDLE state - force clearing`);
          this.inMultiLineSequence = false;
          this._multiLineLockTimestamp = undefined;
        }
      }
    } else {
      this._multiLineLockTimestamp = undefined;
    }
    
    if (this.inMultiLineSequence && urgency !== INTERRUPT_URGENCY.FORCE) {
      console.log('[FSM] Multi-line sequence protected from interrupt (urgency=' + urgency + ')');
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: false,
        reason: 'multi_line_protected'
      };
    }
    
    if (urgency === INTERRUPT_URGENCY.OBSERVATIONAL) {
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: false,
        reason: 'observational_only'
      };
    }
    
    // Prevent ambient lines from interrupting other ambient lines
    if (this.currentTextSource === 'ambient' && incomingSource === 'ambient') {
      console.log('[FSM] Ambient line cannot interrupt another ambient line');
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: true,
        reason: 'ambient_self_protection'
      };
    }
    
    if (urgency === INTERRUPT_URGENCY.POLITE) {
      if (state === 'IDLE' || state === 'DISPLAY') {
        return {
          allowed: true,
          strategy: state === 'IDLE' ? 'direct' : 'normal_delete',
          shouldWait: false,
          reason: 'polite_good_moment'
        };
      } else {
        return {
          allowed: false,
          strategy: 'none',
          shouldWait: true,
          reason: 'polite_waiting'
        };
      }
    }
    
    if (urgency === INTERRUPT_URGENCY.ASSERTIVE) {
      if (priority <= currentPriority) {
        return {
          allowed: false,
          strategy: 'none',
          shouldWait: true,
          reason: 'priority_insufficient'
        };
      }
      
      switch (state) {
        case 'IDLE':
          return { 
            allowed: true, 
            strategy: 'direct', 
            shouldWait: false, 
            reason: 'idle_direct' 
          };
        
        case 'TYPING':
          return { 
            allowed: true, 
            strategy: 'abort_and_clear', 
            shouldWait: false, 
            reason: 'assertive_abort' 
          };
        
        case 'DISPLAY':
          return { 
            allowed: true, 
            strategy: 'fast_select_delete', 
            shouldWait: false, 
            reason: 'assertive_clear' 
          };
        
        case 'DELETING':
          return { 
            allowed: false, 
            strategy: 'queue_after', 
            shouldWait: true, 
            reason: 'deleting_queue' 
          };
        
        case 'INTERRUPT_CLEARING':
          return { 
            allowed: false, 
            strategy: 'none', 
            shouldWait: true, 
            reason: 'already_interrupting' 
          };
      }
    }
    
    if (urgency === INTERRUPT_URGENCY.FORCE) {
      switch (state) {
        case 'IDLE':
          return { 
            allowed: true, 
            strategy: 'direct', 
            shouldWait: false, 
            reason: 'force_idle' 
          };
        
        case 'TYPING':
          return { 
            allowed: true, 
            strategy: 'instant_abort', 
            shouldWait: false, 
            reason: 'force_abort' 
          };
        
        case 'DISPLAY':
          return { 
            allowed: true, 
            strategy: 'instant_clear', 
            shouldWait: false, 
            reason: 'force_clear' 
          };
        
        case 'DELETING':
          return { 
            allowed: true, 
            strategy: 'abort_delete_and_clear', 
            shouldWait: false, 
            reason: 'force_override' 
          };
        
        case 'INTERRUPT_CLEARING':
          return { 
            allowed: true, 
            strategy: 'instant_clear', 
            shouldWait: false, 
            reason: 'force_interrupt_override' 
          };
      }
    }
    
    return { allowed: false, strategy: 'none', shouldWait: false, reason: 'unknown_urgency' };
  }
  
  // ────────────────────────────────────────────────────────────────────
  // Helper Methods
  // ────────────────────────────────────────────────────────────────────
  
  _executeClearStrategy(strategy: ClearStrategy): Promise<void> {
    if (this._clearInProgress) {
      console.log('[FSM] Clear already in progress, skipping');
      return Promise.resolve();
    }
    
    this._clearInProgress = true;
    console.log(`[FSM] Executing clear strategy: ${strategy}`);
    
    return new Promise((resolve) => {
      try {
        if (this.currentAnimationCancel) {
          this.currentAnimationCancel(true);
          this.currentAnimationCancel = null;
        }
        if (this.currentTimer) {
          clearTimeout(this.currentTimer);
          this.currentTimer = null;
        }
        
        const element = this.element;
        
        if (!element) {
          console.error('[FSM] Element is null in _executeClearStrategy');
          this._clearInProgress = false;
          resolve();
          return;
        }
        
        switch (strategy) {
          case 'abort_and_clear':
          case 'fast_select_delete':
            element.classList.add('has-selection', 'interrupting');
            const charSpans = Array.from(element.querySelectorAll('span:not(.text-cursor)')) as HTMLElement[];
            
            if (charSpans.length > 0) {
              charSpans.forEach(span => {
                if (span && span.style) {
                  span.style.opacity = '0';
                  span.style.transition = 'opacity 100ms ease-out';
                }
              });
              
              setTimeout(() => {
                charSpans.forEach(span => {
                  if (span && span.parentNode) {
                    span.remove();
                  }
                });
                element.classList.remove('has-selection', 'interrupting');
                element.style.minWidth = '';
                element.style.maxWidth = '';
                this._enterIdle();
                this._clearInProgress = false;
                resolve();
              }, 120);
            } else {
              element.classList.remove('has-selection', 'interrupting');
              this._enterIdle();
              this._clearInProgress = false;
              resolve();
            }
            break;
          
          case 'abort_delete_and_clear':
          case 'instant_abort':
          case 'instant_clear':
            element.querySelectorAll('span').forEach(span => {
              if (span && span.parentNode) {
                span.remove();
              }
            });
            element.classList.remove('has-selection', 'interrupting');
            element.style.minWidth = '';
            element.style.maxWidth = '';
            element.textContent = '';
            this._enterIdle();
            this._clearInProgress = false;
            resolve();
            break;
          
          default:
            this._enterIdle();
            this._clearInProgress = false;
            resolve();
        }
      } catch (error) {
        console.error('[FSM] Error in _executeClearStrategy:', error);
        this._enterIdle();
        this._clearInProgress = false;
        resolve();
      }
    });
  }
  
  private _calculateInterruptMomentum(): number {
    const recentInterrupts = this.interruptHistory.filter(
      i => Date.now() - i.timestamp < 10000
    );
    
    if (recentInterrupts.length >= 3) {
      return 0.7;
    } else if (recentInterrupts.length >= 2) {
      return 0.85;
    }
    
    return 1.0;
  }
  
  private _cleanupInterruptHistory(): void {
    const now = Date.now();
    
    this.interruptHistory = this.interruptHistory.filter(
      i => now - i.timestamp < 30000
    );
    if (this.interruptHistory.length > 50) {
      this.interruptHistory = this.interruptHistory.slice(-50);
    }
    
    this.pendingInterrupts = this.pendingInterrupts.filter(
      item => now - item.queuedAt < 3000
    );
  }
  
  private _processPendingInterrupts(): void {
    if (!this.pendingInterrupts || this.pendingInterrupts.length === 0) return;
    
    try {
      this.pendingInterrupts.sort((a, b) => {
        if (!a || !b) return 0;
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.queuedAt || 0) - (b.queuedAt || 0);
      });
      
      const next = this.pendingInterrupts.shift();
      
      if (!next || !next.lines || !next.config) {
        console.error('[FSM] Invalid pending interrupt:', next);
        return;
      }
      
      console.log(`[FSM] Processing queued interrupt (priority ${next.priority})`);
      
      if (next.emotionSnapshot && next.emotionSnapshot.emotion) {
        this.timingCalibrator.recordInterrupt(next.emotionSnapshot.emotion, {}, true);
      }
      
      this.startTyping(next.lines, next.config);
    } catch (error) {
      console.error('[FSM] Error in _processPendingInterrupts:', error);
      this.pendingInterrupts = [];
    }
  }
  
  private _handleInterruptPrediction(buttonId: string, confidence: number): void {
    if (buttonId && this.currentState === 'TYPING') {
      this.interruptPrewarmed = true;
      this.prewarmSpeedMultiplier = 1.0 + (confidence * 0.2);
      
      const cursor = this.element.querySelector('.text-cursor');
      if (cursor) cursor.classList.add('prewarmed');
      
      console.log(`[FSM] Pre-warming for ${buttonId} (${(confidence * 100).toFixed(0)}%)`);
      
    } else {
      this.interruptPrewarmed = false;
      this.prewarmSpeedMultiplier = 1.0;
      
      const cursor = this.element.querySelector('.text-cursor');
      if (cursor) cursor.classList.remove('prewarmed');
    }
  }
  
  // ────────────────────────────────────────────────────────────────────
  // Original API (preserved for backward compatibility)
  // ────────────────────────────────────────────────────────────────────
  
  processLine(line: string, config: AnimationConfig): void {
    if (!line || typeof line !== 'string') {
      console.error('[FSM] Invalid line in processLine:', line);
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in processLine');
      return;
    }
    
    try {
      this.isWelcomeText = config.isWelcome || false;
      this.currentTextSource = config._source || 'ambient';
      
      if (this.currentAnimationCancel) {
        this.currentAnimationCancel();
        this.currentAnimationCancel = null;
      }
      if (this.currentTimer) {
        clearTimeout(this.currentTimer);
        this.currentTimer = null;
      }
      
      if (this.isFirstText) {
        this.isFirstText = false;
        const initialDelay = 3000 + Math.random() * 2000;
        this.currentTimer = setTimeout(() => {
          this.currentTimer = null;
          this.startTyping(line, config);
        }, initialDelay);
        return;
      }
      
      this.currentAnimationCancel = animateTextOut(this.element, () => {
        this.currentAnimationCancel = null;
        this.startTyping(line, config);
      });
    } catch (error) {
      console.error('[FSM] Error in processLine:', error);
      this._enterIdle();
    }
  }
  
  startTyping(line: string, config: AnimationConfig): void {
    if (!line || typeof line !== 'string') {
      console.error('[FSM] Invalid line in startTyping:', line);
      this._enterIdle();
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in startTyping');
      this._enterIdle();
      return;
    }
    
    if (!config.onComplete || typeof config.onComplete !== 'function') {
      console.error('[FSM] Missing or invalid onComplete callback');
      this._enterIdle();
      return;
    }
    
    try {
      this.currentState = 'TYPING';
      this.currentDisplayLine = line;
      this.inMultiLineSequence = config.inMultiLineSequence || false;
      
      this.element.querySelectorAll('.text-cursor').forEach(c => c.remove());
      
      this.element.style.minWidth = '';
      this.element.style.maxWidth = '';
      
      this.element.textContent = line;
      this.element.style.visibility = 'visible';
      
      if (this.onUpdateCallback && typeof this.onUpdateCallback === 'function') {
        this.onUpdateCallback();
      }
      
      const emotion = config.emotion || 'NEUTRAL';
      const intensity = Math.max(0, Math.min(1, config.intensity || 0.5));
      const tone = config.tone || 'neutral';
      
      this.currentEmotion = emotion;
      this.currentIntensity = intensity;
      
      this.currentAnimationCancel = animateTextInTyping(this.element, line, () => {
        this.currentAnimationCancel = null;
        this.currentState = 'DISPLAY';
        
        const displayTime = config.displayTime || 3000;
        this.currentTimer = setTimeout(() => {
          this.currentTimer = null;
          this.startDeleting(config);
        }, displayTime);
      }, {
        emotion,
        intensity,
        tone,
        speedMultiplier: this.prewarmSpeedMultiplier
      });
    } catch (error) {
      console.error('[FSM] Error in startTyping:', error);
      this._enterIdle();
      if (config.onComplete) {
        setTimeout(config.onComplete, 1000);
      }
    }
  }
  
  startDeleting(config: AnimationConfig): void {
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in startDeleting');
      this._enterIdle();
      // CRITICAL: Clear multi-line lock even on error
      this.inMultiLineSequence = false;
      this.isWelcomeText = false;
      return;
    }
    
    if (!config.onComplete || typeof config.onComplete !== 'function') {
      console.error('[FSM] Missing or invalid onComplete callback in startDeleting');
      this._enterIdle();
      // CRITICAL: Clear multi-line lock even on error
      this.inMultiLineSequence = false;
      this.isWelcomeText = false;
      return;
    }
    
    try {
      this.currentState = 'DELETING';
      
      const emotion = config.emotion || 'NEUTRAL';
      const intensity = Math.max(0, Math.min(1, config.intensity || 0.5));
      const themes = config.themes || [];
      
      this.currentAnimationCancel = animateTextOut(this.element, () => {
        this.currentAnimationCancel = null;
        this._enterIdle();
        
        this.isWelcomeText = false;
        
        // Clear multi-line flag once sequence completes (passed from orchestrator)
        if (config.isLastInSequence) {
          this.inMultiLineSequence = false;
          console.log('[FSM] Multi-line sequence completed');
        }
        
        this._processPendingInterrupts();
        
        const idleTime = config.idleTime || 2000;
        this.currentTimer = setTimeout(() => {
          this.currentTimer = null;
          config.onComplete();
        }, idleTime);
      }, {
        emotion,
        intensity,
        themes,
      });
    } catch (error) {
      console.error('[FSM] Error in startDeleting:', error);
      this._enterIdle();
      // CRITICAL: Clear multi-line lock on error to prevent permanent lockout
      this.inMultiLineSequence = false;
      this.isWelcomeText = false;
      if (config.onComplete) {
        setTimeout(config.onComplete, 1000);
      }
    }
  }
  
  interrupt(): boolean {
    const check = this.canInterrupt(INTERRUPT_URGENCY.ASSERTIVE, 2);
    
    if (check.allowed) {
      console.log('[FSM Interrupt] Success from state:', this.currentState);
      if (this.currentAnimationCancel) {
        this.currentAnimationCancel();
        this.currentAnimationCancel = null;
      }
      if (this.currentTimer) {
        clearTimeout(this.currentTimer);
        this.currentTimer = null;
      }
      this._enterIdle();
      return true;
    }
    console.log('[FSM Interrupt] Rejected - state:', this.currentState);
    return false;
  }
  
  getState(): FSMState {
    return this.currentState;
  }
}
