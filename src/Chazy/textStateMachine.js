/**
 * Text Animation State Machine
 * ─────────────────────────────
 * FSM States: IDLE → TYPING → DISPLAY → DELETING → IDLE
 * 
 * Manages the lifecycle of subtitle text animations:
 * - Coordinates timing between typing and deleting
 * - Handles interrupts during safe states (IDLE, DISPLAY)
 * - Manages DOM element updates and cursor visibility
 */

import { animateTextInTyping, animateTextOut } from './textAnimation.js';

export class TextStateMachine {
  /**
   * @param {HTMLElement} element - DOM element to animate
   * @param {Function} onUpdateCallback - Called when text content changes (optional)
   */
  constructor(element, onUpdateCallback = null) {
    this.element = element;
    this.onUpdateCallback = onUpdateCallback;
    
    // FSM state
    this.currentState = 'IDLE';
    this.currentAnimationCancel = null;
    this.currentTimer = null;
    this.pendingLine = null;
    this.isFirstText = true;
    
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
  
  /**
   * Process a new line of text
   * @param {string} line - Text content to display
   * @param {Object} config - Animation config { displayTime, idleTime, onComplete }
   */
  processLine(line, config) {
    // Cancel any ongoing operations
    if (this.currentAnimationCancel) {
      this.currentAnimationCancel();
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
  }
  
  startTyping(line, config) {
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
    if (this.onUpdateCallback) {
      this.onUpdateCallback();
    }
    
    // Get emotional state from Chazy (passed via config)
    const emotion = config.emotion || 'NEUTRAL';
    const intensity = config.intensity || 0.5;
    const tone = config.tone || 'neutral';  // NEW: Get tone from config
    
    // Now start typing animation (will use the width constraints fitTitle just set)
    this.currentAnimationCancel = animateTextInTyping(this.element, line, () => {
      this.currentAnimationCancel = null;
      this.currentState = 'DISPLAY';
      
      const displayTime = config.displayTime;
      this.currentTimer = setTimeout(() => {
        this.currentTimer = null;
        this.startDeleting(config);
      }, displayTime);
    }, {
      emotion,
      intensity,
      tone,  // NEW: Pass tone to animation
    });
  }
  
  startDeleting(config) {
    this.currentState = 'DELETING';
    
    // Get emotional state from Chazy (passed via config)
    const emotion = config.emotion || 'NEUTRAL';
    const intensity = config.intensity || 0.5;
    const themes = config.themes || [];
    
    this.currentAnimationCancel = animateTextOut(this.element, () => {
      this.currentAnimationCancel = null;
      this.currentState = 'IDLE';
      
      const idleTime = config.idleTime;
      this.currentTimer = setTimeout(() => {
        this.currentTimer = null;
        config.onComplete();
      }, idleTime);
    }, {
      emotion,
      intensity,
      themes,  // Pass themes for context-aware deletion
    });
  }
  
  /**
   * Check if interrupt would succeed (non-destructive)
   * @returns {boolean} True if currently in interruptible state
   */
  canInterrupt() {
    return this.currentState === 'IDLE' || this.currentState === 'DISPLAY';
  }
  
  /**
   * Attempt to interrupt current animation
   * Only succeeds during IDLE or DISPLAY states
   * @returns {boolean} True if interrupt succeeded
   */
  interrupt() {
    // Only interrupt during IDLE or DISPLAY states - not during animations
    if (this.canInterrupt()) {
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
   * @returns {string} Current state (IDLE, TYPING, DISPLAY, DELETING)
   */
  getState() {
    return this.currentState;
  }
}
