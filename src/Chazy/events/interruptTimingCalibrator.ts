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

/**
 * Calibrator options
 */
export interface CalibratorOptions {
  maxHistorySize?: number;
}

/**
 * Interrupt timing record
 */
interface InterruptTiming {
  selectionDuration?: number;
  fadeDuration?: number;
}

/**
 * Interrupt history record
 */
interface InterruptRecord {
  emotion: string;
  timing: InterruptTiming;
  completionRate: number;
  timestamp: number;
}

/**
 * Serializable calibrator data
 */
interface CalibratorData {
  history: InterruptRecord[];
  timestamp: number;
}

export class InterruptTimingCalibrator {
  private userInterruptHistory: InterruptRecord[];
  private maxHistorySize: number;

  constructor(options: CalibratorOptions = {}) {
    this.userInterruptHistory = [];
    this.maxHistorySize = options.maxHistorySize || 50;
    
    // Load from localStorage if available
    this._loadFromStorage();
  }
  
  /**
   * Record an interrupt and whether user waited for it
   */
  recordInterrupt(emotion: string, timing: InterruptTiming | null, userWaitedForCompletion: boolean): void {
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
   * @returns Multiplier (0.8-1.0, where lower = faster)
   */
  getCalibrationMultiplier(emotion: string): number {
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
  reset(): void {
    this.userInterruptHistory = [];
    this._saveToStorage();
  }
  
  /**
   * Export data as JSON
   */
  toJSON(): CalibratorData {
    return {
      history: this.userInterruptHistory,
      timestamp: Date.now()
    };
  }
  
  /**
   * Import data from JSON
   */
  fromJSON(data: Partial<CalibratorData>): void {
    if (data && Array.isArray(data.history)) {
      this.userInterruptHistory = data.history;
    }
  }
  
  // ─── Storage ───────────────────────────────────────────────────────
  
  private _loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('chazyInterruptCalibration');
      if (stored) {
        const data = JSON.parse(stored) as CalibratorData;
        
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
  
  private _saveToStorage(): void {
    try {
      localStorage.setItem('chazyInterruptCalibration', JSON.stringify(this.toJSON()));
    } catch (e) {
      console.warn('[InterruptTimingCalibrator] Failed to save to storage:', e);
    }
  }
}
