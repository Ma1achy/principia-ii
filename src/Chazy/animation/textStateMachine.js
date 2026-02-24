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

export class TextStateMachine {
  /**
   * @param {HTMLElement} element - DOM element to animate
   * @param {Function} onUpdateCallback - Called when text content changes (optional)
   * @param {Function} getInterruptContext - Returns interrupt context (optional)
   */
  constructor(element, onUpdateCallback = null, getInterruptContext = null) {
    this.element = element;
    this.onUpdateCallback = onUpdateCallback;
    this.getInterruptContext = getInterruptContext;  // NEW: context provider
    
    // FSM state
    this.currentState = 'IDLE';
    this.currentAnimationCancel = null;
    this.currentTimer = null;
    this.pendingLine = null;
    this.isFirstText = true;
    this.isWelcomeText = false;  // Flag to protect welcome text from interrupts
    
    // NEW: Enhanced interrupt system
    this.pendingInterrupts = [];  // Priority queue (array of queued interrupts)
    this.currentLinePriority = 1;  // Default priority
    this.currentEmotion = 'NEUTRAL';
    this.currentIntensity = 0.5;
    this.interruptHistory = [];  // For momentum calculation
    
    // NEW: Adaptive systems
    this.timingCalibrator = new InterruptTimingCalibrator();
    this.interruptPredictor = new InterruptPredictor();
    this.interruptPredictor.onPrediction = (buttonId, confidence) => {
      this._handleInterruptPrediction(buttonId, confidence);
    };
    
    // NEW: Prediction pre-warm state
    this.interruptPrewarmed = false;
    this.prewarmSpeedMultiplier = 1.0;  // 1.0-1.2x (slowdown for prediction)
    
    // NEW: Page visibility handling
    this.interruptPausedForHidden = false;
    this._visibilityHandler = this._handleVisibilityChange.bind(this);
    this._setupVisibilityListener();
    
    // NEW: Multi-line sequence tracking
    this.currentLineSequence = [];
    this.currentLineIndex = 0;
    
    // NEW: Clear strategy lock (prevent concurrent clears)
    this._clearInProgress = false;
    
    // NEW: Cleanup interval for interrupt history
    this._cleanupInterval = setInterval(() => this._cleanupInterruptHistory(), 10000); // Every 10s
    
    // Show blinking cursor immediately on construction
    this._showInitialCursor();
  }
  
  _showInitialCursor() {
    // Clear element and show blinking cursor
    this.element.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'text-cursor blinking';
    cursor.textContent = '█';
    this.element.appendChild(cursor);
  }
  
  _setupVisibilityListener() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }
  
  _handleVisibilityChange() {
    if (!document.hidden && this.interruptPausedForHidden) {
      console.log('[FSM] Page visible - resuming paused interrupt');
      this.interruptPausedForHidden = false;
      this._resumePausedInterrupt();
    }
  }
  
  /**
   * Cleanup method - call when destroying FSM instance
   */
  destroy() {
    // Remove event listener to prevent memory leak
    if (typeof document !== 'undefined' && this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    
    // Clear timers
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    
    // Clear cleanup interval
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    
    // Cancel animations
    if (this.currentAnimationCancel) {
      this.currentAnimationCancel();
      this.currentAnimationCancel = null;
    }
    
    console.log('[FSM] Destroyed and cleaned up');
  }
  
  _resumePausedInterrupt() {
    // Resume interrupt that was paused when page went hidden
    if (this.element.dataset.interruptPaused === 'true') {
      const fadeDuration = parseInt(this.element.dataset.interruptFadeDuration) || 100;
      
      // Continue with fade and deletion
      const charSpans = Array.from(this.element.querySelectorAll('span:not(.text-cursor)'));
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
        
        // Continue with pending interrupt
        this._processPendingInterrupts();
      }, fadeDuration);
    }
  }
  
  // ────────────────────────────────────────────────────────────────────
  // Enhanced Interrupt API
  // ────────────────────────────────────────────────────────────────────
  
  /**
   * Check if interrupt is allowed based on urgency and priority
   * @param {number} urgency - Urgency level (0-3, from INTERRUPT_URGENCY)
   * @param {number} priority - Priority level (1-3)
   * @returns {Object} { allowed, strategy, shouldWait, reason }
   */
  canInterrupt(urgency = INTERRUPT_URGENCY.ASSERTIVE, priority = 2) {
    const state = this.currentState;
    const currentPriority = this.currentLinePriority || 1;
    
    // NEW: Get interrupt context if available
    const context = this.getInterruptContext ? this.getInterruptContext() : {};
    
    // NEW: Check sequence lock from context (highest priority check)
    if (context.sequenceLocked) {
      console.log('[FSM] Interrupt blocked - sequence locked');
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: true,
        reason: 'sequence_locked'
      };
    }
    
    // NEVER interrupt welcome text
    if (this.isWelcomeText) {
      console.log('[FSM] Welcome text protected from interrupt');
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: false,  // Don't queue, just discard
        reason: 'welcome_protected'
      };
    }
    
    // Level 0: Observational - never interrupt
    if (urgency === INTERRUPT_URGENCY.OBSERVATIONAL) {
      return {
        allowed: false,
        strategy: 'none',
        shouldWait: false,  // Don't wait, just discard
        reason: 'observational_only'
      };
    }
    
    // Level 1: Polite - only interrupt during IDLE or DISPLAY
    if (urgency === INTERRUPT_URGENCY.POLITE) {
      if (state === 'IDLE' || state === 'DISPLAY') {
        return {
          allowed: true,
          strategy: state === 'IDLE' ? 'direct' : 'normal_delete',
          shouldWait: false,
          reason: 'polite_good_moment'
        };
      } else {
        // Currently typing or deleting - queue for later
        return {
          allowed: false,
          strategy: 'none',
          shouldWait: true,  // Queue for when state allows
          reason: 'polite_waiting'
        };
      }
    }
    
    // Level 2: Assertive - interrupt TYPING/DISPLAY, queue during DELETING
    if (urgency === INTERRUPT_URGENCY.ASSERTIVE) {
      // Priority check still applies
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
    
    // Level 3: Force - ALWAYS interrupt, even during deletion
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
          // NEW: Force interrupts even during deletion
          return { 
            allowed: true, 
            strategy: 'abort_delete_and_clear', 
            shouldWait: false, 
            reason: 'force_override' 
          };
        
        case 'INTERRUPT_CLEARING':
          // Force can override another interrupt
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
  
  /**
   * Execute a clear strategy without showing new text
   * Used by EventRouter to clear before calling Orchestrator._showLines()
   * @returns {Promise} Resolves when clear animation completes
   */
  _executeClearStrategy(strategy) {
    // Prevent concurrent clears (race condition protection)
    if (this._clearInProgress) {
      console.log('[FSM] Clear already in progress, skipping');
      return Promise.resolve();
    }
    
    this._clearInProgress = true;
    console.log(`[FSM] Executing clear strategy: ${strategy}`);
    
    return new Promise((resolve) => {
      try {
        // Cancel any ongoing operations
        if (this.currentAnimationCancel) {
          this.currentAnimationCancel();
          this.currentAnimationCancel = null;
        }
        if (this.currentTimer) {
          clearTimeout(this.currentTimer);
          this.currentTimer = null;
        }
        
        const element = this.element;
        
        // Defensive null check
        if (!element) {
          console.error('[FSM] Element is null in _executeClearStrategy');
          this._clearInProgress = false;
          resolve();
          return;
        }
        
        switch (strategy) {
          case 'abort_and_clear':
          case 'fast_select_delete':
            // Fast visual clear with selection
            element.classList.add('has-selection', 'interrupting');
            const charSpans = Array.from(element.querySelectorAll('span:not(.text-cursor)'));
            
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
                this.currentState = 'IDLE';
                this._clearInProgress = false;
                resolve();
              }, 120);
            } else {
              element.classList.remove('has-selection', 'interrupting');
              this.currentState = 'IDLE';
              this._clearInProgress = false;
              resolve();
            }
            break;
          
          case 'abort_delete_and_clear':
          case 'instant_abort':
          case 'instant_clear':
            // Instant clear - no animation
            element.querySelectorAll('span').forEach(span => {
              if (span && span.parentNode) {
                span.remove();
              }
            });
            element.classList.remove('has-selection', 'interrupting');
            element.style.minWidth = '';
            element.style.maxWidth = '';
            element.textContent = '';
            this.currentState = 'IDLE';
            this._clearInProgress = false;
            resolve();
            break;
          
          default:
            // Unknown strategy, just go to IDLE
            this.currentState = 'IDLE';
            this._clearInProgress = false;
            resolve();
        }
      } catch (error) {
        console.error('[FSM] Error in _executeClearStrategy:', error);
        this.currentState = 'IDLE';
        this._clearInProgress = false;
        resolve();
      }
    });
  }
  
  _calculateInterruptMomentum() {
    const recentInterrupts = this.interruptHistory.filter(
      i => Date.now() - i.timestamp < 10000  // Last 10 seconds
    );
    
    if (recentInterrupts.length >= 3) {
      // User is actively interacting - be more responsive
      return 0.7;  // 30% faster
    } else if (recentInterrupts.length >= 2) {
      return 0.85; // 15% faster
    }
    
    return 1.0; // Normal
  }
  
  _cleanupInterruptHistory() {
    const now = Date.now();
    
    // Clean history (keep last 50, or last 30 seconds)
    this.interruptHistory = this.interruptHistory.filter(
      i => now - i.timestamp < 30000
    );
    if (this.interruptHistory.length > 50) {
      this.interruptHistory = this.interruptHistory.slice(-50);
    }
    
    // Clean pending queue (TTL: 3 seconds)
    this.pendingInterrupts = this.pendingInterrupts.filter(
      item => now - item.queuedAt < 3000
    );
  }
  
  _processPendingInterrupts() {
    if (!this.pendingInterrupts || this.pendingInterrupts.length === 0) return;
    
    try {
      // Sort by priority (highest first), then by queue time (oldest first)
      this.pendingInterrupts.sort((a, b) => {
        if (!a || !b) return 0; // Defensive null check
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.queuedAt || 0) - (b.queuedAt || 0);
      });
      
      // Take highest priority interrupt
      const next = this.pendingInterrupts.shift();
      
      // Defensive null checks
      if (!next || !next.lines || !next.config) {
        console.error('[FSM] Invalid pending interrupt:', next);
        return;
      }
      
      console.log(`[FSM] Processing queued interrupt (priority ${next.priority})`);
      
      // Record that user waited for completion (for adaptive timing)
      if (next.emotionSnapshot && next.emotionSnapshot.emotion) {
        this.timingCalibrator.recordInterrupt(next.emotionSnapshot.emotion, {}, true);
      }
      
      // Show the text
      this.startTyping(next.lines, next.config);
    } catch (error) {
      console.error('[FSM] Error in _processPendingInterrupts:', error);
      // Clear the queue on error to prevent repeated failures
      this.pendingInterrupts = [];
    }
  }
  
  _handleInterruptPrediction(buttonId, confidence) {
    if (buttonId && this.currentState === 'TYPING') {
      // Pre-warm interrupt system
      this.interruptPrewarmed = true;
      
      // Slow down typing slightly (higher confidence = more slowdown)
      this.prewarmSpeedMultiplier = 1.0 + (confidence * 0.2);  // 1.0-1.2x (up to 20% slower)
      
      // Add visual feedback
      const cursor = this.element.querySelector('.text-cursor');
      if (cursor) cursor.classList.add('prewarmed');
      
      console.log(`[FSM] Pre-warming for ${buttonId} (${(confidence * 100).toFixed(0)}%)`);
      
    } else {
      // Clear pre-warming
      this.interruptPrewarmed = false;
      this.prewarmSpeedMultiplier = 1.0;
      
      const cursor = this.element.querySelector('.text-cursor');
      if (cursor) cursor.classList.remove('prewarmed');
    }
  }
  
  // ────────────────────────────────────────────────────────────────────
  // Original API (preserved for backward compatibility)
  // ────────────────────────────────────────────────────────────────────
  
  /**
   * Process a new line of text
   * @param {string} line - Text content to display
   * @param {Object} config - Animation config { displayTime, idleTime, onComplete }
   */
  processLine(line, config) {
    // Defensive null checks
    if (!line || typeof line !== 'string') {
      console.error('[FSM] Invalid line in processLine:', line);
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in processLine');
      return;
    }
    
    try {
      // Store welcome flag to protect from interrupts
      this.isWelcomeText = config.isWelcome || false;
      
      // Cancel any ongoing operations
      if (this.currentAnimationCancel) {
        // NEW: Determine cancel mode based on strategy
        let cancelMode = 'clear';
        
        switch (strategy) {
          case 'abort_and_clear':
          case 'fast_select_delete':
          case 'abort_delete_and_clear':
          case 'instant_clear':
            cancelMode = 'clear';
            break;
            
          case 'instant_complete':  // If we add this strategy
            cancelMode = 'complete';
            break;
            
          case 'freeze':  // If we add this strategy
            cancelMode = 'freeze';
            break;
        }
        
        // NEW: Use new API if available, fallback to old
        if (typeof this.currentAnimationCancel === 'function') {
          // Check if it has the new cancel method
          if (this.currentAnimationCancel.cancel) {
            // New API
            this.currentAnimationCancel.cancel(cancelMode);
          } else {
            // Old API
            this.currentAnimationCancel();
          }
        }
        
        this.currentAnimationCancel = null;
      }
      if (this.currentTimer) {
        clearTimeout(this.currentTimer);
        this.currentTimer = null;
      }
      
      // First text: wait a random 3-5 seconds with blinking cursor before typing
      if (this.isFirstText) {
        this.isFirstText = false;
        const initialDelay = 3000 + Math.random() * 2000; // 3-5 seconds
        this.currentTimer = setTimeout(() => {
          this.currentTimer = null;
          this.startTyping(line, config);
        }, initialDelay);
        return;
      }
      
      // Subsequent: delete old, then type new
      this.currentAnimationCancel = animateTextOut(this.element, () => {
        this.currentAnimationCancel = null;
        this.startTyping(line, config);
      });
    } catch (error) {
      console.error('[FSM] Error in processLine:', error);
      this.currentState = 'IDLE';
    }
  }
  
  startTyping(line, config) {
    // Defensive null checks
    if (!line || typeof line !== 'string') {
      console.error('[FSM] Invalid line in startTyping:', line);
      this.currentState = 'IDLE';
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in startTyping');
      this.currentState = 'IDLE';
      return;
    }
    
    if (!config.onComplete || typeof config.onComplete !== 'function') {
      console.error('[FSM] Missing or invalid onComplete callback');
      this.currentState = 'IDLE';
      return;
    }
    
    try {
      this.currentState = 'TYPING';
      
      // Remove any existing cursors before starting animation
      this.element.querySelectorAll('.text-cursor').forEach(c => c.remove());
      
      // Clear old width constraints from previous line
      this.element.style.minWidth = '';
      this.element.style.maxWidth = '';
      
      // Set text content so fitTitle can measure it
      this.element.textContent = line;
      this.element.style.visibility = 'visible';
      
      // Call fitTitle to calculate new width constraints for this line
      if (this.onUpdateCallback && typeof this.onUpdateCallback === 'function') {
        this.onUpdateCallback();
      }
      
      // Get emotional state from Chazy (passed via config)
      const emotion = config.emotion || 'NEUTRAL';
      const intensity = Math.max(0, Math.min(1, config.intensity || 0.5)); // Clamp to 0-1
      const tone = config.tone || 'neutral';
      
      // Store current emotion/intensity for interrupt decisions
      this.currentEmotion = emotion;
      this.currentIntensity = intensity;
      
      // Now start typing animation (will use the width constraints fitTitle just set)
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
        speedMultiplier: this.prewarmSpeedMultiplier  // Apply prediction slowdown
      });
    } catch (error) {
      console.error('[FSM] Error in startTyping:', error);
      this.currentState = 'IDLE';
      // Try to call onComplete to prevent hanging
      if (config.onComplete) {
        setTimeout(config.onComplete, 1000);
      }
    }
  }
  
  startDeleting(config) {
    // Defensive null checks
    if (!config || typeof config !== 'object') {
      console.error('[FSM] Invalid config in startDeleting');
      this.currentState = 'IDLE';
      return;
    }
    
    if (!config.onComplete || typeof config.onComplete !== 'function') {
      console.error('[FSM] Missing or invalid onComplete callback in startDeleting');
      this.currentState = 'IDLE';
      return;
    }
    
    try {
      this.currentState = 'DELETING';
      
      // Get emotional state from Chazy (passed via config)
      const emotion = config.emotion || 'NEUTRAL';
      const intensity = Math.max(0, Math.min(1, config.intensity || 0.5));
      const themes = config.themes || [];
      
      this.currentAnimationCancel = animateTextOut(this.element, () => {
        this.currentAnimationCancel = null;
        this.currentState = 'IDLE';
        
        // Clear welcome flag once text completes (allows future interrupts)
        this.isWelcomeText = false;
        
        // Check for pending interrupts before idle
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
      this.currentState = 'IDLE';
      // Try to call onComplete to prevent hanging
      if (config.onComplete) {
        setTimeout(config.onComplete, 1000);
      }
    }
  }
  
  /**
   * Attempt to interrupt current animation (legacy API)
   * Only succeeds during IDLE or DISPLAY states
   * @returns {boolean} True if interrupt succeeded
   */
  interrupt() {
    // Use new API with ASSERTIVE urgency
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
      this.currentState = 'IDLE';
      return true;
    }
    console.log('[FSM Interrupt] Rejected - state:', this.currentState);
    return false;
  }
  
  /**
   * Get current FSM state
   * @returns {string} Current state (IDLE, TYPING, DISPLAY, DELETING, INTERRUPT_CLEARING)
   */
  getState() {
    return this.currentState;
  }
}
