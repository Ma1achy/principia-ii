/**
 * ChazyWatchdog - Detects and recovers from stuck states
 * 
 * Monitors:
 * - FSM state transitions (IDLE → TYPING → DISPLAY → DELETING)
 * - Text content changes
 * - Multi-line lock duration
 * 
 * Triggers recovery if no progress for 30s while lock held
 */

/**
 * State snapshot for watchdog monitoring
 */
export interface WatchdogSnapshot {
  fsmState: string;
  textContent: string;
  lockHeld: boolean;
  timestamp: number;
}

/**
 * Watchdog diagnostics result
 */
export interface WatchdogDiagnostics {
  isRunning: boolean;
  historySize: number;
  timeSinceLastProgress: number | null;
  recoveryCount: number;
  currentState: WatchdogSnapshot | null;
  threshold: number;
  checkInterval: number;
}

/**
 * Minimal orchestrator interface for watchdog
 */
interface ChazyOrchestratorLike {
  inMultiLineSequence: boolean;
  multiLineSequenceToken: number | null;
  currentTextToken: number;
  running: boolean;
  scheduleAmbient(delay: number, reason: string): void;
}

export class ChazyWatchdog {
  private orchestrator: ChazyOrchestratorLike;
  private history: WatchdogSnapshot[];
  private maxHistory: number;
  private checkInterval: number;
  private stuckThreshold: number;
  private timer: number | null;
  private isRunning: boolean;
  private recoveryCount: number;

  constructor(orchestrator: ChazyOrchestratorLike) {
    // Defensive null check
    if (!orchestrator) {
      throw new Error('[Watchdog] Orchestrator required');
    }
    
    this.orchestrator = orchestrator;
    this.history = [];
    this.maxHistory = 10;
    this.checkInterval = 10000; // Check every 10s
    this.stuckThreshold = 30000; // 30s without progress = stuck
    this.timer = null;
    this.isRunning = false;
    this.recoveryCount = 0;
    
    console.log('[Watchdog] Initialized (check: 10s, threshold: 30s)');
  }
  
  start(): void {
    // Prevent double-start
    if (this.isRunning) {
      console.warn('[Watchdog] Already running, ignoring start()');
      return;
    }
    
    this.isRunning = true;
    this.timer = window.setInterval(() => this._checkProgress(), this.checkInterval);
    console.log('[Watchdog] Started monitoring');
  }
  
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    this.isRunning = false;
    console.log(`[Watchdog] Stopped (recoveries triggered: ${this.recoveryCount})`);
  }
  
  recordState(snapshot: Partial<WatchdogSnapshot>): void {
    // Defensive validation
    if (!snapshot || typeof snapshot !== 'object') {
      console.warn('[Watchdog] Invalid snapshot, skipping');
      return;
    }
    
    // Ensure required fields
    const state: WatchdogSnapshot = {
      fsmState: snapshot.fsmState || 'UNKNOWN',
      textContent: snapshot.textContent || '',
      lockHeld: Boolean(snapshot.lockHeld),
      timestamp: snapshot.timestamp || Date.now()
    };
    
    // Add to history
    this.history.push(state);
    
    // Trim history
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // Log if debug enabled
    if (this._isDebugEnabled()) {
      console.log('[Watchdog] State recorded:', {
        fsmState: state.fsmState,
        textLength: state.textContent.length,
        lockHeld: state.lockHeld,
        historySize: this.history.length
      });
    }
  }
  
  private _checkProgress(): void {
    // Need at least 2 snapshots to compare
    if (this.history.length < 2) {
      if (this._isDebugEnabled()) {
        console.log('[Watchdog] Check: insufficient history');
      }
      return;
    }
    
    const latest = this.history[this.history.length - 1];
    const lastProgressTime = this._getLastProgressTime();
    const timeSinceLastChange = Date.now() - lastProgressTime;
    
    // Log progress check
    console.log(`[Watchdog] Progress check: ${(timeSinceLastChange / 1000).toFixed(1)}s since change (lock: ${latest.lockHeld}, FSM: ${latest.fsmState})`);
    
    // Only trigger if lock is held (multi-line sequence stuck)
    if (!latest.lockHeld) {
      if (this._isDebugEnabled()) {
        console.log('[Watchdog] Check: no lock held, skipping');
      }
      return;
    }
    
    // Check if stuck
    if (timeSinceLastChange > this.stuckThreshold) {
      console.error(`[Watchdog] STUCK DETECTED - no progress for ${(timeSinceLastChange / 1000).toFixed(1)}s`);
      console.error('[Watchdog] Stuck state:', {
        fsmState: latest.fsmState,
        textContent: latest.textContent.substring(0, 50),
        lockHeld: latest.lockHeld,
        historySize: this.history.length
      });
      
      this._forceRecovery();
    }
  }
  
  private _getLastProgressTime(): number {
    // Traverse history backwards to find last change
    for (let i = this.history.length - 1; i >= 1; i--) {
      const curr = this.history[i];
      const prev = this.history[i - 1];
      
      // Check for any change
      const stateChanged = curr.fsmState !== prev.fsmState;
      const textChanged = curr.textContent !== prev.textContent;
      const lockChanged = curr.lockHeld !== prev.lockHeld;
      
      if (stateChanged || textChanged || lockChanged) {
        if (this._isDebugEnabled()) {
          console.log('[Watchdog] Last progress at index', i, {
            stateChanged,
            textChanged,
            lockChanged,
            timestamp: curr.timestamp
          });
        }
        return curr.timestamp;
      }
    }
    
    // No changes found, return first timestamp
    return this.history[0].timestamp;
  }
  
  private _forceRecovery(): void {
    console.error('[Watchdog] ========================================');
    console.error('[Watchdog] FORCING RECOVERY');
    console.error('[Watchdog] ========================================');
    
    // Defensive checks
    if (!this.orchestrator) {
      console.error('[Watchdog] ERROR: No orchestrator reference, cannot recover');
      return;
    }
    
    // Log pre-recovery state
    console.error('[Watchdog] Pre-recovery state:', {
      inMultiLineSequence: this.orchestrator.inMultiLineSequence,
      multiLineSequenceToken: this.orchestrator.multiLineSequenceToken,
      currentTextToken: this.orchestrator.currentTextToken,
      running: this.orchestrator.running
    });
    
    try {
      // Force clear multi-line lock
      this.orchestrator.inMultiLineSequence = false;
      this.orchestrator.multiLineSequenceToken = null;
      
      // Increment token to invalidate any stale callbacks
      this.orchestrator.currentTextToken++;
      
      // Clear history (fresh start)
      this.history = [];
      
      // Schedule ambient recovery
      if (this.orchestrator.running) {
        this.orchestrator.scheduleAmbient(2000, 'watchdog_recovery');
        console.error('[Watchdog] Recovery complete - ambient scheduled in 2s');
      } else {
        console.error('[Watchdog] Recovery complete - orchestrator not running, no ambient scheduled');
      }
      
      // Track recovery count
      this.recoveryCount++;
      
    } catch (error) {
      console.error('[Watchdog] ERROR during recovery:', error);
      console.error('[Watchdog] Recovery failed - manual intervention may be required');
    }
    
    console.error('[Watchdog] ========================================');
  }
  
  private _isDebugEnabled(): boolean {
    // Check for debug flag (can be set via window.chazyDebug.watchdog = true)
    return typeof window !== 'undefined' && 
           (window as any).chazyDebug?.watchdog === true;
  }
  
  /**
   * Get diagnostic info for debugging
   */
  getDiagnostics(): WatchdogDiagnostics {
    const lastProgressTime = this.history.length >= 2 ? this._getLastProgressTime() : null;
    
    return {
      isRunning: this.isRunning,
      historySize: this.history.length,
      timeSinceLastProgress: lastProgressTime ? Date.now() - lastProgressTime : null,
      recoveryCount: this.recoveryCount,
      currentState: this.history.length > 0 ? this.history[this.history.length - 1] : null,
      threshold: this.stuckThreshold,
      checkInterval: this.checkInterval
    };
  }
}

// Debug utilities
if (typeof window !== 'undefined') {
  const w = window as any;
  w.chazyDebug = w.chazyDebug || {};
  
  // Enable verbose watchdog logging
  w.chazyDebug.enableWatchdogDebug = () => {
    w.chazyDebug.watchdog = true;
    console.log('[Watchdog] Debug logging enabled');
  };
  
  // Get watchdog diagnostics
  w.chazyDebug.watchdogStatus = () => {
    if (w.chazy?.watchdog) {
      console.table(w.chazy.watchdog.getDiagnostics());
    } else {
      console.warn('Watchdog not available');
    }
  };
}
