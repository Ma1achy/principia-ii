/**
 * Chazy - Main orchestrator for the subtitle system
 * 
 * Integrates:
 * - ChazyView (rendering)
 * - ChazyMind (emotional AI)
 * - TextSelector (text selection)
 * - External layout system (via updateLayout callback)
 */

import { ChazyView } from './ChazyView.js';
import { ChazyMind } from './chazyMind.js';
import { TextSelector } from './textSelector.js';
import { ChazyEventRouter } from './eventRouter.js';

export class Chazy {
  constructor(options = {}) {
    this.view = new ChazyView(options.view);
    this.mind = new ChazyMind();
    this.selector = new TextSelector(
      options.textPath || '/src/Chazy/flavour.json',
      options.selector
    );
    
    // Event router (integrates mind + selector)
    this.router = new ChazyEventRouter(this, this.mind, this.selector);
    
    this.running = false;
    this.cycleTimer = null;
    this.getCurrentMode = null;
    this.lastInterruptTime = 0;
    this.currentTextToken = 0;  // For stale callback protection
    this.lastScheduledAmbient = 0;
    this.lastTextLength = 50;  // Track last displayed text length
    this.lastThemes = [];       // Track last displayed themes
    
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
    if (this.router?.sessionFlags.pageHidden) {
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
    
    // On first cycle, use 'welcome' mode to trigger welcome messages
    const mode = this.selector.isFirstSelection ? 'welcome' : this.getCurrentMode();
    const emotion = this.mind.emotion;
    const intensity = this.mind.intensity;
    
    const selected = this.selector.select({
      mode,
      themes: this.mind.getPreferredThemes(),
      emotion: emotion.toLowerCase(),
      intensity,
      excludeWelcome: false  // Always allow welcome messages on first selection
    });
    
    if (!selected) {
      console.warn('[Chazy] No text selected');
      this.scheduleAmbient(5000, 'no_selection');
      return;
    }
    
    this.mind.reflectOnText(selected, selected.themes);
    
    // Calculate total text length for display time scaling
    const totalTextLength = selected.lines.reduce((sum, lineItem) => {
      const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
      return sum + (typeof line === 'string' ? line.length : 0);
    }, 0);
    
    const displayTime = this.selector.getDisplayTime(emotion, intensity, totalTextLength);
    const idleTime = this.selector.getIdleTime(emotion, intensity, displayTime);
    
    this._showLines(selected.lines, {
      displayTime,
      idleTime,
      emotion,
      intensity,
      tone: selected.tone || 'neutral',
      themes: selected.themes,
      isMultiLine: selected.isMultiLine,
      _source: 'ambient'
    });
  }
  
  _cycle() {
    // Legacy method - now just calls selectAndShowAmbient
    this.selectAndShowAmbient();
  }
  
  _showLines(lines, config) {
    // Generate token for stale callback protection
    const token = ++this.currentTextToken;
    
    // Track total text length for idle calculation
    const totalTextLength = lines.reduce((sum, lineItem) => {
      const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
      return sum + (typeof line === 'string' ? line.length : 0);
    }, 0);
    
    // Store for next ambient calculation
    this.lastTextLength = totalTextLength;
    this.lastThemes = config.themes || [];
    
    let index = 0;
    
    const showLine = (lineIndex) => {
      // Handle string vs object line format
      const lineItem = lines[lineIndex];
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
      const lineTone = isObject ? (lineItem.tone || config.tone) : config.tone;
      const durationMult = isObject ? (lineItem.duration_mult || 1.0) : 1.0;
      
      let nextIdleTime;
      let nextCallback;
      
      // Check if this is multiline by looking at total lines
      const isMultiLine = lines.length > 1;
      
      if (isMultiLine) {
        if (lineIndex < lines.length - 1) {
          nextIdleTime = 500 + Math.random() * 500;
          nextCallback = () => {
            // Validate token before continuing
            if (token !== this.currentTextToken) {
              console.log(`[Chazy] Stale multi-line callback ignored (token ${token})`);
              return;
            }
            showLine(lineIndex + 1);
          };
        } else {
          nextIdleTime = config.idleTime;
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
      } else {
        nextIdleTime = config.idleTime;
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
      
      this.view.showText(line, {
        displayTime: config.displayTime * durationMult,  // Apply duration multiplier
        idleTime: nextIdleTime,
        onComplete: nextCallback,
        emotion: config.emotion,
        intensity: config.intensity,
        tone: lineTone,  // Pass tone (per-line or entry-level)
        themes: config.themes
      });
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
