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
import { ChazyWatchdog } from './ChazyWatchdog.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChazyOptions {
  view?: any;
  textPath?: string;
  selector?: any;
  displayMinMs?: number;
  displayMaxMs?: number;
}

interface LayoutConstraints {
  maxFontSize?: number;
  availableWidth?: number;
  availableHeight?: number;
}

interface ShowLinesConfig {
  displayTime: number;
  idleTime: number;
  emotion: string;
  intensity: number;
  tone: string;
  themes: string[];
  isMultiLine?: boolean;
  isWelcome?: boolean;
  _source?: string;
  isLastInSequence?: boolean;
  inMultiLineSequence?: boolean;
  interrupt_style?: string;
  stage_pause?: number;
  onComplete?: () => void;
}

interface WatchdogSnapshot {
  fsmState: string;
  textContent: string;
  lockHeld: boolean;
  timestamp: number;
}

// ─── Chazy Class ──────────────────────────────────────────────────────────

export class Chazy {
  view: ChazyView;
  mind: ChazyMind;
  selector: TextSelector;
  router: ChazyEventRouter;
  running: boolean;
  cycleTimer: ReturnType<typeof setTimeout> | null;
  getCurrentMode: (() => string) | null;
  lastInterruptTime: number;
  currentTextToken: number;
  lastScheduledAmbient: number;
  lastTextLength: number;
  lastThemes: string[];
  inMultiLineSequence: boolean;
  multiLineSequenceToken: number | null;
  watchdog: ChazyWatchdog;
  displayMinMs: number;
  displayMaxMs: number;
  
  constructor(options: ChazyOptions = {}) {
    this.view = new ChazyView(options.view);
    this.mind = new ChazyMind();
    this.selector = new TextSelector(
      options.textPath || '/src/Chazy/lines/',
      options.selector
    );
    
    this.router = new ChazyEventRouter(this as any, this.mind, this.selector);
    
    this.running = false;
    this.cycleTimer = null;
    this.getCurrentMode = null;
    this.lastInterruptTime = 0;
    this.currentTextToken = 0;
    this.lastScheduledAmbient = 0;
    this.lastTextLength = 50;
    this.lastThemes = [];
    
    this.inMultiLineSequence = false;
    this.multiLineSequenceToken = null;
    
    this.watchdog = new ChazyWatchdog(this);
    
    this.displayMinMs = options.displayMinMs || 2000;
    this.displayMaxMs = options.displayMaxMs || 10000;
  }
  
  async init(container: HTMLElement, getCurrentMode: () => string): Promise<void> {
    await this.selector.load();
    this.view.mount(container);
    this.getCurrentMode = getCurrentMode;
    console.log('[Chazy] Initialized');
  }
  
  start(): void {
    if (this.running) return;
    this.running = true;
    
    if (this.watchdog) {
      this.watchdog.start();
    }
    
    this.scheduleAmbient(0, 'startup');
    
    console.log('[Chazy] Started');
  }
  
  stop(): void {
    this.running = false;
    this.cancelAmbient('stop');
    
    if (this.watchdog) {
      this.watchdog.stop();
    }
    
    console.log('[Chazy] Stopped');
  }
  
  updateLayout(constraints: LayoutConstraints): void {
    this.view.updateConstraints(constraints);
  }
  
  observe(eventType: string, data: any): any {
    return this.route(eventType, data);
  }
  
  route(eventType: string, data: any): any {
    return this.router.route(eventType, data);
  }
  
  interrupt(): boolean {
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
  
  scheduleAmbient(ms: number, reason: string = 'unknown'): void {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    
    if (!this.running) {
      console.log(`[Chazy] Skip schedule - not running (${reason})`);
      return;
    }
    
    if (this.router && (this.router as any).sessionFlags && (this.router as any).sessionFlags.pageHidden) {
      console.log(`[Chazy] Skip schedule - page hidden (${reason})`);
      return;
    }
    
    this.lastScheduledAmbient = Date.now();
    console.log(`[Chazy] Scheduled ambient in ${ms}ms (${reason})`);
    
    this.cycleTimer = setTimeout(() => {
      this.cycleTimer = null;
      this.route('ambient_cycle_ready', { reason });
    }, ms);
  }
  
  cancelAmbient(reason: string = 'unknown'): void {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
      console.log(`[Chazy] Cancelled ambient (${reason})`);
    }
  }
  
  selectAndShowAmbient(): void {
    if (!this.running) return;
    
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
      const mode = (this.selector as any).isFirstSelection ? 'welcome' : this.getCurrentMode();
      const isWelcome = (this.selector as any).isFirstSelection;
      const emotion = this.mind.emotion || 'NEUTRAL';
      const intensity = this.mind.intensity || 0.5;
      
      const stateRefs = getStateReferences();
      
      const selected = this.selector.select({
        mode,
        themes: this.mind.getPreferredThemes() || [],
        emotion: emotion.toLowerCase(),
        intensity,
        stateRefs
      });
      
      if (!selected) {
        console.warn('[Chazy] No text selected');
        this.scheduleAmbient(5000, 'no_selection');
        return;
      }
      
      if (!selected.lines || !Array.isArray(selected.lines) || selected.lines.length === 0) {
        console.error('[Chazy] Selected object has invalid lines');
        this.scheduleAmbient(5000, 'invalid_selection');
        return;
      }
      
      this.mind.reflectOnText(selected, selected.themes || []);
      
      const totalTextLength = selected.lines.reduce((sum: number, lineItem: any) => {
        const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
        if (typeof line !== 'string') return sum;
        
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
        isWelcome: isWelcome,
        _source: 'ambient'
      });
    } catch (error) {
      console.error('[Chazy] Error in selectAndShowAmbient:', error);
      this.scheduleAmbient(10000, 'error_recovery');
    }
  }
  
  _cycle(): void {
    this.selectAndShowAmbient();
  }
  
  _showLines(lines: any[], config: ShowLinesConfig): void {
    if (this.inMultiLineSequence && this.multiLineSequenceToken !== null) {
      console.warn('[Chazy] Blocked new text - multi-line sequence in progress');
      console.warn('[Chazy] Blocked details:', {
        currentToken: this.multiLineSequenceToken,
        requestedLines: lines?.length,
        requestedSource: config?._source
      });
      return;
    }
    
    console.log('[Chazy] _showLines() starting:', {
      lineCount: lines?.length,
      source: config?._source,
      multiLineActive: this.inMultiLineSequence
    });
    
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      console.error('[Chazy] Invalid lines array in _showLines');
      return;
    }
    
    if (!config) {
      console.error('[Chazy] Missing config in _showLines');
      return;
    }
    
    const token = ++this.currentTextToken;
    const isMultiLineSequence = lines.length > 1;
    
    const totalTextLength = lines.reduce((sum: number, lineItem: any) => {
      const line = typeof lineItem === 'object' && lineItem !== null && lineItem.t ? lineItem.t : lineItem;
      if (typeof line !== 'string') return sum;
      
      const cleanLine = line.replace(/(?<!\\)\\pause\{\d+\}/g, '');
      return sum + cleanLine.length;
    }, 0);
    
    this.lastTextLength = totalTextLength;
    this.lastThemes = config.themes || [];
    
    let watchdogRecordingInterval: ReturnType<typeof setInterval> | null = null;
    
    const showLine = (lineIndex: number): void => {
      if (token !== this.currentTextToken) {
        console.log(`[Chazy] Stale showLine callback ignored (token ${token})`);
        
        if (isMultiLineSequence && this.multiLineSequenceToken === token) {
          this.inMultiLineSequence = false;
          this.multiLineSequenceToken = null;
          console.log(`[Chazy] Cleared stale multi-line sequence (token ${token})`);
        }
        
        return;
      }
      
      if (lineIndex < 0 || lineIndex >= lines.length) {
        console.error(`[Chazy] Line index ${lineIndex} out of bounds (0-${lines.length - 1})`);
        
        if (isMultiLineSequence && this.multiLineSequenceToken === token) {
          this.inMultiLineSequence = false;
          this.multiLineSequenceToken = null;
          console.log(`[Chazy] Cleared multi-line sequence due to bounds error (token ${token})`);
        }
        
        this.route('text_complete', {
          type: config._source || 'ambient',
          token,
          textLength: this.lastTextLength,
          themes: this.lastThemes
        });
        return;
      }
      
      const lineItem = lines[lineIndex];
      
      if (lineItem === null || lineItem === undefined) {
        console.error(`[Chazy] Line item at index ${lineIndex} is null/undefined`);
        if (lineIndex < lines.length - 1) {
          showLine(lineIndex + 1);
        } else {
          if (isMultiLineSequence && this.multiLineSequenceToken === token) {
            this.inMultiLineSequence = false;
            this.multiLineSequenceToken = null;
            console.log(`[Chazy] Cleared multi-line sequence due to null line (token ${token})`);
          }
          
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
      
      if (isObject && lineItem.rarity !== undefined) {
        if (Math.random() > lineItem.rarity) {
          console.log(`[Chazy] Rare line skipped (rarity=${lineItem.rarity}), moving to line ${lineIndex + 1}`);
          
          if (lineIndex < lines.length - 1) {
            this._recordWatchdogState();
            showLine(lineIndex + 1);
          } else {
            if (isMultiLineSequence && this.multiLineSequenceToken === token) {
              this.inMultiLineSequence = false;
              this.multiLineSequenceToken = null;
              console.log(`[Chazy] Cleared multi-line sequence after last line skipped (token ${token})`);
            }
            
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
      
      const line = isObject ? lineItem.t : lineItem;
      
      // Validate line is a string
      if (typeof line !== 'string') {
        console.error(`[Chazy] Line is not a string at index ${lineIndex}:`, line);
        // Skip this line
        if (lineIndex < lines.length - 1) {
          showLine(lineIndex + 1);
        } else {
          // Clear multi-line state before emitting text_complete
          if (isMultiLineSequence && this.multiLineSequenceToken === token) {
            this.inMultiLineSequence = false;
            this.multiLineSequenceToken = null;
            console.log(`[Chazy] Cleared multi-line sequence due to invalid line type (token ${token})`);
          }
          
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
      const isLastLine = isMultiLineSequence && lineIndex === lines.length - 1;

      // Calculate idle time based on multi-line context
      let nextIdleTime: number;
      if (isMultiLineSequence) {
        if (!isLastLine) {
          // Not last line - check for staged interrupt pause
          if (config.interrupt_style === 'staged' && config.stage_pause) {
            nextIdleTime = config.stage_pause;
          } else {
            nextIdleTime = 500 + Math.random() * 500;
          }
        } else {
          // Last line of multi-line sequence
          nextIdleTime = config.idleTime || 2000;
        }
      } else {
        // Single line
        nextIdleTime = config.idleTime || 2000;
      }

      let nextCallback: (() => void) | undefined;
      
      if (!isLastLine) {
        nextCallback = () => {
          // Clean up watchdog recording interval
          if (watchdogRecordingInterval) {
            clearInterval(watchdogRecordingInterval);
            watchdogRecordingInterval = null;
          }
          
          // Validate token before continuing
          if (token !== this.currentTextToken) {
            console.log(`[Chazy] Stale multi-line callback ignored (token ${token})`);
            
            // CRITICAL: Clear multi-line state if this sequence is stale
            if (isMultiLineSequence && this.multiLineSequenceToken === token) {
              this.inMultiLineSequence = false;
              this.multiLineSequenceToken = null;
              console.log(`[Chazy] Cleared stale multi-line sequence (token ${token})`);
            }
            
            return;
          }
          showLine(lineIndex + 1);
        };
      } else {
        nextCallback = () => {
          // Clean up watchdog recording interval
          if (watchdogRecordingInterval) {
            clearInterval(watchdogRecordingInterval);
            watchdogRecordingInterval = null;
          }
          
          // Validate token before emitting
          if (token !== this.currentTextToken) {
            console.log(`[Chazy] Stale completion ignored (token ${token})`);
            
            // CRITICAL: Clear multi-line state if this sequence is stale
            if (isMultiLineSequence && this.multiLineSequenceToken === token) {
              this.inMultiLineSequence = false;
              this.multiLineSequenceToken = null;
              console.log(`[Chazy] Cleared stale multi-line sequence (token ${token})`);
            }
            
            return;
          }
          
          // Mark end of multi-line sequence
          if (isMultiLineSequence && this.multiLineSequenceToken === token) {
            this.inMultiLineSequence = false;
            this.multiLineSequenceToken = null;
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
      
      try {
        this.view.showText(line, {
          displayTime: (config.displayTime || 3000) * durationMult,
          idleTime: nextIdleTime,
          emotion: config.emotion,
          intensity: config.intensity,
          tone: lineTone || 'neutral',
          isWelcome: config.isWelcome || false,
          inMultiLineSequence: isMultiLineSequence,
          isLastInSequence: isLastLine,
          onComplete: nextCallback as () => void
        } as any);
        
        // WATCHDOG: Record state after starting display
        this._recordWatchdogState();
        
        watchdogRecordingInterval = setInterval(() => {
          if (token === this.currentTextToken) {
            this._recordWatchdogState();
          } else {
            if (watchdogRecordingInterval) {
              clearInterval(watchdogRecordingInterval);
            }
          }
        }, 5000);
        
      } catch (error) {
        console.error('[Chazy] Error in view.showText:', error);
        
        if (watchdogRecordingInterval) {
          clearInterval(watchdogRecordingInterval);
          watchdogRecordingInterval = null;
        }
        
        if (isMultiLineSequence && this.multiLineSequenceToken === token) {
          this.inMultiLineSequence = false;
          this.multiLineSequenceToken = null;
          console.log(`[Chazy] Cleared multi-line state due to error (token ${token})`);
        }
        
        if (nextCallback) {
          setTimeout(() => {
            if (token === this.currentTextToken) {
              nextCallback();
            } else {
              console.log(`[Chazy] Recovery callback stale (token ${token} vs ${this.currentTextToken})`);
            }
          }, 1000);
        }
      }
    };
    
    if (isMultiLineSequence) {
      this.inMultiLineSequence = true;
      this.multiLineSequenceToken = token;
      console.log(`[Chazy] Starting multi-line sequence (${lines.length} lines, token ${token})`);
      
      if (this.router && (this.router as any).queuedImmediate) {
        console.log('[Chazy] Clearing queued interrupt for multi-line sequence');
        (this.router as any).queuedImmediate = null;
      }
    }
    
    showLine(0);
    this._recordWatchdogState();
    console.log('[Chazy] Sequence started, watchdog recording initiated');
  }
  
  _tryInterrupt(): void {
    if (this.view.interrupt()) {
      console.log('[Chazy] Interrupted - selecting new text');
      this.selectAndShowAmbient();
    }
  }
  
  _recordWatchdogState(): void {
    if (!this.watchdog) {
      console.warn('[Chazy] Watchdog not initialized, skipping state recording');
      return;
    }
    
    try {
      const snapshot: WatchdogSnapshot = {
        fsmState: (this.view as any)?.textStateMachine?.currentState || 'UNKNOWN',
        textContent: (this.view as any)?.elements?.subtitle?.textContent || '',
        lockHeld: this.inMultiLineSequence,
        timestamp: Date.now()
      };
      
      this.watchdog.recordState(snapshot);
      
      if (typeof window !== 'undefined' && (window as any).chazyDebug?.orchestrator) {
        console.log('[Chazy] Watchdog state recorded:', snapshot);
      }
    } catch (error) {
      console.error('[Chazy] Error recording watchdog state:', error);
    }
  }
}
