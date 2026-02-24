/**
 * Chazy - Main orchestrator for the subtitle system
 * 
 * Integrates:
 * - ChazyView (rendering)
 * - ChazyMind (emotional AI)
 * - TextSelector (text selection)
 * - External layout system (via updateLayout callback)
 */

import { ChazyView } from './animation/ChazyView.js';
import { ChazyMind } from './mind/chazyMind.js';
import { TextSelector } from './content/textSelector.js';
import { ChazyEventRouter } from './events/eventRouter.js';
import { getStateReferences } from './content/stateReferences.js';
import { TextSourceCoordinator } from './coordination/TextSourceCoordinator.js';

export class Chazy {
  constructor(options = {}) {
    this.view = new ChazyView(options.view);
    this.mind = new ChazyMind();
    this.selector = new TextSelector(
      options.textPath || '/src/Chazy/lines/',
      options.selector
    );
    
    // NEW: Text source coordinator (prevents multi-line interruptions)
    this.coordinator = new TextSourceCoordinator(this);
    
    // Wire up orchestrator reference for interrupt context
    this.view.orchestrator = this;
    
    // Event router (integrates mind + selector + coordinator)
    this.router = new ChazyEventRouter(this, this.mind, this.selector);
    
    this.running = false;
    this.cycleTimer = null;
    this.getCurrentMode = null;
    this.lastInterruptTime = 0;
    this.currentTextToken = 0;  // For stale callback protection
    this.lastScheduledAmbient = 0;
    this.lastTextLength = 50;  // Track last displayed text length
    this.lastThemes = [];       // Track last displayed themes
    
    // Track multi-line sequences to prevent premature ambient scheduling
    this.inMultiLineSequence = false;
    this.multiLineSequenceToken = null;
    
    this.displayMinMs = options.displayMinMs || 2000;
    this.displayMaxMs = options.displayMaxMs || 10000;
  }
  
  /**
   * Initialize and mount
   */
  async init(container, getCurrentMode) {
    await this.selector.load();
    this.view.mount(container);
    this.getCurrentMode = getCurrentMode;
    console.log('[Chazy] Initialized');
  }
  
  /**
   * Start the text cycle
   */
  start() {
    if (this.running) return;
    this.running = true;
    
    // Emit initial ambient cycle event
    this.scheduleAmbient(0, 'startup');
    
    console.log('[Chazy] Started');
  }
  
  /**
   * Stop the text cycle
   */
  stop() {
    this.running = false;
    this.cancelAmbient('stop');
    console.log('[Chazy] Stopped');
  }
  
  /**
   * Update layout constraints (called by external layout system)
   */
  updateLayout(constraints) {
    this.view.updateConstraints(constraints);
  }
  
  /**
   * React to external event (collision, drag, etc.)
   */
  observe(eventType, data) {
    this.route(eventType, data);
  }
  
  /**
   * Route event through event router
   */
  route(eventType, data) {
    return this.router.route(eventType, data);
  }
  
  /**
   * Try to interrupt and select new text
   */
  interrupt() {
    const now = Date.now();
    const timeSinceLastInterrupt = now - this.lastInterruptTime;
    if (timeSinceLastInterrupt < 10000) {
      console.log('[Chazy] Interrupt blocked - cooldown active');
      return false;
    }
    
    if (this.view.interrupt()) {
      this.lastInterruptTime = now;
      this.selectAndShowAmbient();
      return true;
    }
    
    console.log('[Chazy] Interrupt failed - FSM busy');
    return false;
  }
  
  // ─── Internal ─────────────────────────────────────────────────────────────
  
  /**
   * Centralized ambient scheduling (CRITICAL: prevents duplicate timers)
   */
  scheduleAmbient(ms, reason = 'unknown') {
    // ALWAYS clear first (prevents duplicates)
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    
    // Guards
    if (!this.running) {
      console.log(`[Chazy] Skip schedule - not running (${reason})`);
      return;
    }
    
    // Defensive null check for router
    if (this.router && this.router.sessionFlags && this.router.sessionFlags.pageHidden) {
      console.log(`[Chazy] Skip schedule - page hidden (${reason})`);
      return;
    }
    
    // Schedule
    this.lastScheduledAmbient = Date.now();
    console.log(`[Chazy] Scheduled ambient in ${ms}ms (${reason})`);
    
    this.cycleTimer = setTimeout(() => {
      this.cycleTimer = null;
      this.route('ambient_cycle_ready', { reason });
    }, ms);
  }
  
  /**
   * Cancel ambient scheduling
   */
  cancelAmbient(reason = 'unknown') {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
      console.log(`[Chazy] Cancelled ambient (${reason})`);
    }
  }
  
  /**
   * Select and show ambient text (extracted from _cycle)
   */
  selectAndShowAmbient() {
    if (!this.running) return;
    
    // Defensive null checks
    if (!this.selector) {
      console.error('[Chazy] Selector not initialized');
      return;
    }
    
    if (!this.mind) {
      console.error('[Chazy] Mind not initialized');
      return;
    }
    
    if (!this.getCurrentMode || typeof this.getCurrentMode !== 'function') {
      console.error('[Chazy] getCurrentMode not set or not a function');
      return;
    }
    
    try {
      // On first cycle, use 'welcome' mode to trigger welcome messages
      const mode = this.selector.isFirstSelection ? 'welcome' : this.getCurrentMode();
      const isWelcome = this.selector.isFirstSelection;
      const emotion = this.mind.emotion || 'NEUTRAL';
      const intensity = this.mind.intensity || 0.5;
      
      // Get state references for templates
      const stateRefs = getStateReferences();
      
      const selected = this.selector.select({
        mode,
        themes: this.mind.getPreferredThemes() || [],
        emotion: emotion.toLowerCase(),
        intensity,
        stateRefs  // Pass state references for template processing
      });
      
      if (!selected) {
        console.warn('[Chazy] No text selected');
        this.scheduleAmbient(5000, 'no_selection');
        return;
      }
      
      // Defensive check on selected object
      if (!selected.lines || !Array.isArray(selected.lines) || selected.lines.length === 0) {
        console.error('[Chazy] Selected object has invalid lines');
        this.scheduleAmbient(5000, 'invalid_selection');
        return;
      }
      
    this.mind.reflectOnText(selected, selected.themes || []);
    
    // Calculate total text length for display time scaling
    // NOTE: Text has \ref{} already replaced, but \pause{} markers still present
    const totalTextLength = selected.lines.reduce((sum, lineItem) => {
      const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
      if (typeof line !== 'string') return sum;
      
      // Remove \pause{} markers for accurate length calculation
      const cleanLine = line.replace(/(?<!\\)\\pause\{\d+\}/g, '');
      return sum + cleanLine.length;
    }, 0);
    
    const displayTime = this.selector.getDisplayTime(emotion, intensity, totalTextLength);
    const idleTime = this.selector.getIdleTime(emotion, intensity, displayTime);
      
      this._showLines(selected.lines, {
        displayTime,
        idleTime,
        emotion,
        intensity,
        tone: selected.tone || 'neutral',
        themes: selected.themes || [],
        isMultiLine: selected.isMultiLine,
        isWelcome: isWelcome, // Flag to protect welcome text from interrupts
        _source: 'ambient'
      });
    } catch (error) {
      console.error('[Chazy] Error in selectAndShowAmbient:', error);
      // Try to recover by rescheduling
      this.scheduleAmbient(10000, 'error_recovery');
    }
  }
  
  _cycle() {
    // Legacy method - now just calls selectAndShowAmbient
    this.selectAndShowAmbient();
  }
  
  _showLines(lines, config) {
    // Defensive null checks
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      console.error('[Chazy] Invalid lines array in _showLines');
      return;
    }
    
    if (!config) {
      console.error('[Chazy] Missing config in _showLines');
      return;
    }
    
    // Check if this is a multi-line sequence FIRST
    const isMultiLineSequence = lines.length > 1;
    
    // NEW: Early check - block if coordinator already locked
    if (isMultiLineSequence && this.coordinator.isLocked()) {
      console.log('[Chazy] Multi-line blocked - coordinator locked');
      return; // Don't increment token, don't do any work
    }
    
    // NEW: Try to acquire coordinator lock for multi-line
    if (isMultiLineSequence) {
      try {
        this.coordinator.lockForSequence(lines.length, config._source || 'ambient');
      } catch (error) {
        console.error('[Chazy] Failed to lock coordinator:', error);
        return; // Don't proceed if lock fails
      }
    }
    
    // NOW safe to increment token (after coordinator check)
    const token = ++this.currentTextToken;
    
    // Mark start of multi-line sequence (kept for backwards compatibility)
    if (isMultiLineSequence) {
      this.inMultiLineSequence = true;
      this.multiLineSequenceToken = token;
      console.log(`[Chazy] Starting multi-line sequence (${lines.length} lines, token ${token})`);
    }
    
    // Track total text length for idle calculation
    // NOTE: Text has \ref{} already replaced, but \pause{} markers still present
    const totalTextLength = lines.reduce((sum, lineItem) => {
      const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
      if (typeof line !== 'string') return sum;
      
      // Remove \pause{} markers for accurate length calculation
      const cleanLine = line.replace(/(?<!\\)\\pause\{\d+\}/g, '');
      return sum + cleanLine.length;
    }, 0);
    
    // Store for next ambient calculation
    this.lastTextLength = totalTextLength;
    this.lastThemes = config.themes || [];
    
    let index = 0;
    
    const showLine = (lineIndex) => {
      // Validate token (stale callback protection)
      if (token !== this.currentTextToken) {
        console.log(`[Chazy] Stale showLine callback ignored (token ${token})`);
        return;
      }
      
      // Bounds check
      if (lineIndex < 0 || lineIndex >= lines.length) {
        console.error(`[Chazy] Line index ${lineIndex} out of bounds (0-${lines.length - 1})`);
        // Emit text_complete to prevent hanging
        this.route('text_complete', {
          type: config._source || 'ambient',
          token,
          textLength: this.lastTextLength,
          themes: this.lastThemes
        });
        return;
      }
      
      // Handle string vs object line format
      const lineItem = lines[lineIndex];
      
      // Defensive null check
      if (lineItem === null || lineItem === undefined) {
        console.error(`[Chazy] Line item at index ${lineIndex} is null/undefined`);
        // Skip to next line or complete
        if (lineIndex < lines.length - 1) {
          showLine(lineIndex + 1);
        } else {
          this.route('text_complete', {
            type: config._source || 'ambient',
            token,
            textLength: this.lastTextLength,
            themes: this.lastThemes
          });
        }
        return;
      }
      
      const isObject = typeof lineItem === 'object' && lineItem !== null && lineItem.t;
      
      // Check rarity for object lines
      if (isObject && lineItem.rarity !== undefined) {
        if (Math.random() > lineItem.rarity) {
          console.log(`[Chazy] Rare line skipped (rarity=${lineItem.rarity})`);
          
          // Skip this line, try next
          if (lineIndex < lines.length - 1) {
            showLine(lineIndex + 1);
          } else {
            // No more lines, emit text_complete
            this.route('text_complete', {
              type: config._source || 'ambient',
              token,
              textLength: this.lastTextLength,
              themes: this.lastThemes
            });
          }
          return;
        }
      }
      
      // Extract line properties
      const line = isObject ? lineItem.t : lineItem;
      
      // Validate line is a string
      if (typeof line !== 'string') {
        console.error(`[Chazy] Line is not a string at index ${lineIndex}:`, line);
        // Skip this line
        if (lineIndex < lines.length - 1) {
          showLine(lineIndex + 1);
        } else {
          this.route('text_complete', {
            type: config._source || 'ambient',
            token,
            textLength: this.lastTextLength,
            themes: this.lastThemes
          });
        }
        return;
      }
      
      const lineTone = isObject ? (lineItem.tone || config.tone) : config.tone;
      const durationMult = isObject ? (lineItem.duration_mult || 1.0) : 1.0;
      
      let nextIdleTime;
      let nextCallback;
      
      // Check if this is multiline by looking at total lines
      const isMultiLine = lines.length > 1;
      
      if (isMultiLine) {
        if (lineIndex < lines.length - 1) {
          // Check if this is a staged interrupt with custom pause
          if (config.interrupt_style === 'staged' && config.stage_pause) {
            nextIdleTime = config.stage_pause;  // Use custom pause for staged interrupts
          } else {
            nextIdleTime = 500 + Math.random() * 500;  // Default multi-line pause
          }
          
          nextCallback = () => {
            // Validate token before continuing
            if (token !== this.currentTextToken) {
              console.log(`[Chazy] Stale multi-line callback ignored (token ${token})`);
              return;
            }
            showLine(lineIndex + 1);
          };
        } else {
          nextIdleTime = config.idleTime || 2000;
          nextCallback = () => {
            // Validate token before emitting
            if (token !== this.currentTextToken) {
              console.log(`[Chazy] Stale completion ignored (token ${token})`);
              return;
            }
            
            // Mark end of multi-line sequence
            if (isMultiLineSequence && this.multiLineSequenceToken === token) {
              this.inMultiLineSequence = false;
              this.multiLineSequenceToken = null;
              
              // NEW: Unlock coordinator
              this.coordinator.unlockSequence();
              
              console.log(`[Chazy] Completed multi-line sequence (token ${token})`);
            }
            
            this.route('text_complete', {
              type: config._source || 'ambient',
              token,
              textLength: this.lastTextLength,
              themes: this.lastThemes
            });
          };
        }
      } else {
        nextIdleTime = config.idleTime || 2000;
        nextCallback = () => {
          // Validate token before emitting
          if (token !== this.currentTextToken) {
            console.log(`[Chazy] Stale completion ignored (token ${token})`);
            return;
          }
          this.route('text_complete', {
            type: config._source || 'ambient',
            token,
            textLength: this.lastTextLength,
            themes: this.lastThemes
          });
        };
      }
      
      // Defensive check for view
      if (!this.view || !this.view.showText) {
        console.error('[Chazy] View or showText method not available');
        return;
      }
      
      try {
        this.view.showText(line, {
          displayTime: (config.displayTime || 3000) * durationMult,  // Apply duration multiplier with fallback
          idleTime: nextIdleTime,
          onComplete: nextCallback,
          emotion: config.emotion || 'NEUTRAL',
          intensity: config.intensity || 0.5,
          tone: lineTone || 'neutral',  // Pass tone (per-line or entry-level)
          themes: config.themes || [],
          isWelcome: config.isWelcome || false  // Pass welcome flag to protect from interrupts
        });
      } catch (error) {
        console.error('[Chazy] Error in view.showText:', error);
        
        // Clear multi-line state on error to prevent lock
        if (isMultiLineSequence && this.multiLineSequenceToken === token) {
          this.inMultiLineSequence = false;
          this.multiLineSequenceToken = null;
          
          // NEW: Unlock coordinator on error
          this.coordinator.unlockSequence();
          
          console.log(`[Chazy] Cleared multi-line state due to error (token ${token})`);
        }
        
        // NEW: Don't attempt recovery for multi-line (too complex)
        if (!isMultiLineSequence && nextCallback) {
          // Only recover single-line text
          setTimeout(() => {
            if (token === this.currentTextToken) {
              nextCallback();
            } else {
              console.log(`[Chazy] Recovery callback stale (token ${token} vs ${this.currentTextToken})`);
            }
          }, 1000);
        }
        
        // For multi-line, emit text_complete to unblock system
        if (isMultiLineSequence) {
          this.route('text_complete', {
            type: config._source || 'ambient',
            token,
            textLength: this.lastTextLength,
            themes: this.lastThemes
          });
        }
      }
    };
    
    showLine(0);
  }
  
  _tryInterrupt() {
    if (this.view.interrupt()) {
      console.log('[Chazy] Interrupted - selecting new text');
      this.selectAndShowAmbient();
    }
  }
}
