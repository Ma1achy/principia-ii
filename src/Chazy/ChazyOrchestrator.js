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

export class Chazy {
  constructor(options = {}) {
    this.view = new ChazyView(options.view);
    this.mind = new ChazyMind();
    this.selector = new TextSelector(
      options.textPath || '/src/Chazy/flavour.json',
      options.selector
    );
    
    this.running = false;
    this.cycleTimer = null;
    this.getCurrentMode = null;
    this.lastInterruptTime = 0;
    
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
    this._cycle();
    console.log('[Chazy] Started');
  }
  
  /**
   * Stop the text cycle
   */
  stop() {
    this.running = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
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
    this.mind.observe(eventType, data);
    this._tryInterrupt();
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
      this._cycle();
      return true;
    }
    
    console.log('[Chazy] Interrupt failed - FSM busy');
    return false;
  }
  
  // ─── Internal ─────────────────────────────────────────────────────────────
  
  _cycle() {
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
      this._scheduleNext(5000);
      return;
    }
    
    this.mind.reflectOnText(selected, selected.themes);
    
    const displayTime = this.selector.getDisplayTime(emotion, intensity);
    const idleTime = this.selector.getIdleTime(emotion, intensity, displayTime);
    
    this._showLines(selected.lines, {
      displayTime,
      idleTime,
      emotion,
      intensity,
      tone: selected.tone || 'neutral',  // NEW: Pass tone from selection
      themes: selected.themes,
      isMultiLine: selected.isMultiLine
    });
  }
  
  _showLines(lines, config) {
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
            // No more lines, go to next cycle
            this._cycle();
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
      
      if (config.isMultiLine) {
        if (lineIndex < lines.length - 1) {
          nextIdleTime = 500 + Math.random() * 500;
          nextCallback = () => showLine(lineIndex + 1);
        } else {
          nextIdleTime = config.idleTime;
          nextCallback = () => this._cycle();
        }
      } else {
        nextIdleTime = config.idleTime;
        nextCallback = () => this._cycle();
      }
      
      this.view.showText(line, {
        displayTime: config.displayTime * durationMult,  // Apply duration multiplier
        idleTime: nextIdleTime,
        onComplete: nextCallback,
        emotion: config.emotion,
        intensity: config.intensity,
        tone: lineTone,  // NEW: Pass tone (per-line or entry-level)
        themes: config.themes
      });
    };
    
    showLine(0);
  }
  
  _tryInterrupt() {
    if (this.view.interrupt()) {
      console.log('[Chazy] Interrupted - selecting new text');
      this._cycle();
    }
  }
  
  _scheduleNext(ms) {
    this.cycleTimer = setTimeout(() => this._cycle(), ms);
  }
}
