/**
 * Interrupt Timing Calibrator
 * ─────────────────────────────────────────────────────────
 * Learns user's interrupt speed preferences over time.
 * 
 * Tracks whether user waits for interrupts to complete or triggers
 * new ones immediately. Adjusts timing multiplier based on patience.
 * 
 * Persists to localStorage for cross-session learning.
 */

export class InterruptTimingCalibrator {
  constructor(options = {}) {
    this.userInterruptHistory = [];
    this.maxHistorySize = options.maxHistorySize || 50;
    
    // Load from localStorage if available
    this._loadFromStorage();
  }
  
  /**
   * Record an interrupt and whether user waited for it
   * @param {string} emotion - Emotion state during interrupt
   * @param {Object} timing - { selectionDuration, fadeDuration }
   * @param {boolean} userWaitedForCompletion - Did user wait or trigger another?
   */
  recordInterrupt(emotion, timing, userWaitedForCompletion) {
    // Defensive null checks
    if (!emotion || typeof emotion !== 'string') {
      console.warn('[InterruptTimingCalibrator] Invalid emotion:', emotion);
      emotion = 'NEUTRAL';
    }
    
    if (typeof userWaitedForCompletion !== 'boolean') {
      console.warn('[InterruptTimingCalibrator] Invalid userWaitedForCompletion:', userWaitedForCompletion);
      userWaitedForCompletion = false;
    }
    
    this.userInterruptHistory.push({
      emotion,
      timing: timing || {},
      completionRate: userWaitedForCompletion ? 1 : 0,
      timestamp: Date.now()
    });
    
    // Keep only most recent entries
    if (this.userInterruptHistory.length > this.maxHistorySize) {
      this.userInterruptHistory.shift();
    }
    
    // Persist to storage
    this._saveToStorage();
  }
  
  /**
   * Get calibration multiplier for this emotion
   * @param {string} emotion - Current emotion state
   * @returns {number} Multiplier (0.8-1.0, where lower = faster)
   */
  getCalibrationMultiplier(emotion) {
    // Defensive checks
    if (!emotion || typeof emotion !== 'string') {
      console.warn('[InterruptTimingCalibrator] Invalid emotion:', emotion);
      return 1.0;
    }
    
    if (!Array.isArray(this.userInterruptHistory)) {
      console.error('[InterruptTimingCalibrator] Invalid history');
      return 1.0;
    }
    
    // Filter to interrupts for this emotion
    const emotionInterrupts = this.userInterruptHistory.filter(
      h => h && h.emotion === emotion
    );
    
    // Need at least 5 samples to calibrate
    if (emotionInterrupts.length < 5) {
      return 1.0; // Not enough data, use normal speed
    }
    
    // Calculate average completion rate
    const avgCompletion = emotionInterrupts.reduce(
      (sum, h) => sum + (h.completionRate || 0), 0
    ) / emotionInterrupts.length;
    
    // Low completion rate = user is impatient = speed up
    if (avgCompletion < 0.3) {
      return 0.8;  // 20% faster (user very impatient)
    }
    if (avgCompletion < 0.5) {
      return 0.9;  // 10% faster (user somewhat impatient)
    }
    
    return 1.0; // Normal speed (user patient)
  }
  
  /**
   * Reset calibration data
   */
  reset() {
    this.userInterruptHistory = [];
    this._saveToStorage();
  }
  
  /**
   * Export data as JSON
   * @returns {Object} Serializable data
   */
  toJSON() {
    return {
      history: this.userInterruptHistory,
      timestamp: Date.now()
    };
  }
  
  /**
   * Import data from JSON
   * @param {Object} data - Data to import
   */
  fromJSON(data) {
    if (data && Array.isArray(data.history)) {
      this.userInterruptHistory = data.history;
    }
  }
  
  // ─── Storage ───────────────────────────────────────────────────────
  
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem('chazyInterruptCalibration');
      if (stored) {
        const data = JSON.parse(stored);
        
        // Only load if recent (< 7 days)
        const age = Date.now() - (data.timestamp || 0);
        if (age < 7 * 24 * 60 * 60 * 1000) {
          this.fromJSON(data);
          console.log('[InterruptTimingCalibrator] Restored from localStorage');
        }
      }
    } catch (e) {
      console.warn('[InterruptTimingCalibrator] Failed to load from storage:', e);
    }
  }
  
  _saveToStorage() {
    try {
      localStorage.setItem('chazyInterruptCalibration', JSON.stringify(this.toJSON()));
    } catch (e) {
      console.warn('[InterruptTimingCalibrator] Failed to save to storage:', e);
    }
  }
}
