/**
 * TextSourceCoordinator - Single source of truth for text ownership and sequence locking
 * 
 * Prevents multi-line sequences from being interrupted by:
 * - Mind emotional transitions
 * - User interactions
 * - Ambient cycle triggers
 * 
 * Defers mind requests during sequences and flushes them after completion.
 */

export class TextSourceCoordinator {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    
    // Sequence lock state ONLY (no single-line tracking)
    this.sequenceLocked = false;
    this.sequenceId = 0;
    this.sequenceStartTime = null;
    this.sequenceLockOwner = null;  // 'ambient' | 'mind' | 'interaction'
    
    // Deferred requests (mind only)
    this.deferredMindRequest = null;
  }
  
  /**
   * Request permission to show text
   * ONLY checks sequence lock, NOT FSM state (FSM check happens separately)
   * @param {string} source - Source requesting text slot ('mind', 'interaction', 'ambient')
   * @returns {{ allowed: boolean, reason: string, shouldDefer: boolean, lockedBy?: string }}
   */
  requestTextSlot(source, options = {}) {
    if (this.sequenceLocked) {
      return {
        allowed: false,
        reason: 'sequence_locked',
        lockedBy: this.sequenceLockOwner,
        shouldDefer: source === 'mind'
      };
    }
    
    return { allowed: true, reason: 'approved' };
  }
  
  /**
   * Lock for multi-line sequence
   * Throws if already locked (reentrant protection)
   * @param {number} sequenceLength - Number of lines in sequence
   * @param {string} owner - Source that owns the sequence
   */
  lockForSequence(sequenceLength, owner) {
    if (this.sequenceLocked) {
      console.error('[Coordinator] Attempted to lock while already locked!');
      throw new Error('Coordinator already locked');
    }
    
    this.sequenceLocked = true;
    this.sequenceId++;
    this.sequenceLockOwner = owner;
    this.sequenceStartTime = Date.now();
    
    console.log(`[Coordinator] Locked for ${owner} sequence (${sequenceLength} lines, id: ${this.sequenceId})`);
  }
  
  /**
   * Unlock after sequence completes
   */
  unlockSequence() {
    const wasLocked = this.sequenceLocked;
    
    this.sequenceLocked = false;
    this.sequenceLockOwner = null;
    
    if (wasLocked) {
      console.log(`[Coordinator] Unlocked sequence (id: ${this.sequenceId})`);
      
      // Flush deferred requests with grace period (200ms)
      setTimeout(() => this._flushDeferredRequests(), 200);
    }
  }
  
  /**
   * Defer a mind request for later
   * @param {Object} data - Mind request data { emotion, reason }
   */
  deferMindRequest(data) {
    this.deferredMindRequest = {
      data,
      deferredAt: Date.now()
    };
    console.log('[Coordinator] Deferred mind request');
  }
  
  /**
   * Flush deferred requests (private)
   * Called after sequence completes with grace period
   */
  _flushDeferredRequests() {
    // Check if new sequence started
    if (this.sequenceLocked) {
      console.log('[Coordinator] Flush skipped - new sequence active');
      return;
    }
    
    // Check if page is hidden (don't flush when page hidden)
    if (this.orchestrator.router && this.orchestrator.router.sessionFlags && 
        this.orchestrator.router.sessionFlags.pageHidden) {
      console.log('[Coordinator] Flush skipped - page hidden');
      return;
    }
    
    if (!this.deferredMindRequest) return;
    
    const request = this.deferredMindRequest;
    
    // Clear BEFORE routing (prevents re-entry)
    this.deferredMindRequest = null;
    
    // Check TTL (5 seconds)
    if (Date.now() - request.deferredAt > 5000) {
      console.log('[Coordinator] Expired mind request');
      return;
    }
    
    // Flush to router
    console.log('[Coordinator] Flushing deferred mind request');
    this.orchestrator.router.route('mind_wants_to_speak', request.data);
  }
  
  /**
   * Get current lock state
   * @returns {boolean} True if sequence is currently locked
   */
  isLocked() {
    return this.sequenceLocked;
  }
  
  /**
   * Get current sequence ID
   * @returns {number} Current sequence ID (increments with each sequence)
   */
  getCurrentSequenceId() {
    return this.sequenceId;
  }
}
