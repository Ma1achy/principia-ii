/**
 * Interrupt Predictor
 * ─────────────────────────────────────────────────────────
 * Predicts button clicks based on mouse trajectory.
 * 
 * Tracks mouse position, calculates velocity, and predicts if
 * the user is heading toward a button. Pre-warms the interrupt
 * system by slowing typing speed when prediction confidence is high.
 * 
 * Learns user's mouse behavior over time with adaptive threshold.
 * Persists prediction threshold to localStorage.
 */

/**
 * Predictor configuration options
 */
export interface PredictorOptions {
  maxHistoryLength?: number;
  historyTimeWindow?: number;
}

/**
 * Mouse history point
 */
interface MousePoint {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * Current prediction state
 */
interface PredictionState {
  buttonId: string;
  confidence: number;
  timestamp: number;
}

/**
 * Prediction accuracy record
 */
interface PredictionRecord {
  predicted: boolean;
  correct: boolean;
}

/**
 * Mouse velocity
 */
interface Velocity {
  vx: number;
  vy: number;
  speed: number;
}

/**
 * Intersection prediction result
 */
interface IntersectionPrediction {
  willIntersect: boolean;
  confidence: number;
  eta: number | null;
}

export class InterruptPredictor {
  private mouseHistory: MousePoint[];
  private maxHistoryLength: number;
  private historyTimeWindow: number;
  private buttonBounds: Map<string, DOMRect>;
  private currentPrediction: PredictionState | null;
  private predictionThreshold: number;
  private recentPredictions: PredictionRecord[];
  private maxRecentPredictions: number;
  
  public onPrediction: ((buttonId: string | null, confidence: number) => void) | null;

  constructor(options: PredictorOptions = {}) {
    // Mouse tracking
    this.mouseHistory = [];
    this.maxHistoryLength = options.maxHistoryLength || 10;
    this.historyTimeWindow = options.historyTimeWindow || 500; // ms
    
    // Button tracking
    this.buttonBounds = new Map();
    
    // Prediction state
    this.currentPrediction = null;
    
    // Adaptive threshold (learns from accuracy)
    this.predictionThreshold = this._loadThresholdFromStorage() || 0.7;
    this.recentPredictions = [];
    this.maxRecentPredictions = 20;
    
    // Callbacks
    this.onPrediction = null;
  }
  
  /**
   * Track mouse position (call from throttled mousemove handler)
   */
  trackMousePosition(x: number, y: number): void {
    // Defensive validation
    if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
      console.warn('[InterruptPredictor] Invalid mouse coordinates:', x, y);
      return;
    }
    
    const now = performance.now();
    
    this.mouseHistory.push({ x, y, timestamp: now });
    
    // Keep only recent history (last 500ms or 10 positions)
    const cutoff = now - this.historyTimeWindow;
    this.mouseHistory = this.mouseHistory.filter(p => p.timestamp > cutoff);
    
    if (this.mouseHistory.length > this.maxHistoryLength) {
      this.mouseHistory.shift();
    }
    
    // Calculate prediction if enough data
    if (this.mouseHistory.length >= 3) {
      this._calculatePrediction(x, y, now);
    }
  }
  
  /**
   * Update button bounds (call on resize or layout change)
   */
  updateButtonBounds(buttonId: string, element: HTMLElement | null): void {
    // Defensive checks
    if (!buttonId || typeof buttonId !== 'string') {
      console.warn('[InterruptPredictor] Invalid buttonId:', buttonId);
      return;
    }
    
    if (element && element instanceof HTMLElement) {
      try {
        this.buttonBounds.set(buttonId, element.getBoundingClientRect());
      } catch (error) {
        console.error('[InterruptPredictor] Error getting button bounds:', error);
      }
    } else {
      console.warn('[InterruptPredictor] Invalid element for button:', buttonId);
    }
  }
  
  /**
   * Record prediction accuracy for learning
   */
  recordPredictionAccuracy(buttonId: string, predicted: boolean, actuallyInterrupted: boolean): void {
    this.recentPredictions.push({ predicted, correct: actuallyInterrupted });
    
    // Keep last 20
    if (this.recentPredictions.length > this.maxRecentPredictions) {
      this.recentPredictions.shift();
    }
    
    // Adjust threshold every 10 samples
    if (this.recentPredictions.length >= 10) {
      const predictions = this.recentPredictions.filter(p => p.predicted);
      
      if (predictions.length > 0) {
        const accuracy = predictions.filter(p => p.correct).length / predictions.length;
        
        if (accuracy < 0.6) {
          // Too many false positives - be more conservative
          this.predictionThreshold = Math.min(0.9, this.predictionThreshold + 0.05);
          this._saveThresholdToStorage();
          console.log(`[InterruptPredictor] Increased threshold to ${this.predictionThreshold.toFixed(2)} (accuracy: ${(accuracy * 100).toFixed(0)}%)`);
        } else if (accuracy > 0.85) {
          // Very accurate - can be more aggressive
          this.predictionThreshold = Math.max(0.5, this.predictionThreshold - 0.05);
          this._saveThresholdToStorage();
          console.log(`[InterruptPredictor] Decreased threshold to ${this.predictionThreshold.toFixed(2)} (accuracy: ${(accuracy * 100).toFixed(0)}%)`);
        }
      }
      
      // Clear after adjustment
      this.recentPredictions = [];
    }
  }
  
  /**
   * Reset predictor state
   */
  reset(): void {
    this.mouseHistory = [];
    this.currentPrediction = null;
    this.recentPredictions = [];
  }
  
  // ─── Internal ──────────────────────────────────────────────────────
  
  private _calculatePrediction(currentX: number, currentY: number, now: number): void {
    const velocity = this._calculateMouseVelocity();
    
    // If moving too slowly, clear prediction
    if (velocity.speed < 50) {
      this._clearPrediction();
      return;
    }
    
    // Check each button for intersection
    for (const [buttonId, bounds] of this.buttonBounds) {
      const prediction = this._predictIntersection(
        currentX, currentY, velocity, bounds
      );
      
      if (prediction.willIntersect && 
          prediction.confidence > this.predictionThreshold) {
        this._setPrediction(buttonId, prediction.confidence, now);
        return;
      }
    }
    
    // No predictions
    this._clearPrediction();
  }
  
  private _calculateMouseVelocity(): Velocity {
    if (!Array.isArray(this.mouseHistory) || this.mouseHistory.length < 2) {
      return { vx: 0, vy: 0, speed: 0 };
    }
    
    try {
      // Use last 3 points for smoothing (reduces jitter)
      const recent = this.mouseHistory.slice(-3);
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      
      if (!oldest || !newest) {
        return { vx: 0, vy: 0, speed: 0 };
      }
      
      const dt = newest.timestamp - oldest.timestamp;
      if (dt === 0) return { vx: 0, vy: 0, speed: 0 };
      
      const dx = newest.x - oldest.x;
      const dy = newest.y - oldest.y;
      
      // Velocity in pixels/second
      const vx = dx / dt * 1000;
      const vy = dy / dt * 1000;
      const speed = Math.sqrt(vx * vx + vy * vy);
      
      return { vx, vy, speed };
    } catch (error) {
      console.error('[InterruptPredictor] Error calculating velocity:', error);
      return { vx: 0, vy: 0, speed: 0 };
    }
  }
  
  private _predictIntersection(x: number, y: number, velocity: Velocity, bounds: DOMRect): IntersectionPrediction {
    const { vx, vy, speed } = velocity;
    
    // Normalize velocity to unit vector
    const dirX = vx / speed;
    const dirY = vy / speed;
    
    // Button center
    const buttonCenterX = bounds.left + bounds.width / 2;
    const buttonCenterY = bounds.top + bounds.height / 2;
    
    // Vector from mouse to button center
    const toButtonX = buttonCenterX - x;
    const toButtonY = buttonCenterY - y;
    const distanceToButton = Math.sqrt(toButtonX * toButtonX + toButtonY * toButtonY);
    
    // Dot product: how aligned is velocity with button direction?
    // Ranges from -1 (away) to 1 (directly toward)
    const alignment = (dirX * toButtonX + dirY * toButtonY) / distanceToButton;
    
    // Confidence is alignment (0-1 range)
    const confidence = Math.max(0, alignment);
    
    // Will intersect if:
    // - Heading generally toward button (alignment > 0.5, within 90° cone)
    // - Close enough (< 300px)
    // - Moving with intent (> 100px/s)
    const willIntersect = alignment > 0.5 && 
                          distanceToButton < 300 && 
                          speed > 100;
    
    return {
      willIntersect,
      confidence,
      eta: willIntersect ? (distanceToButton / speed) * 1000 : null  // ms
    };
  }
  
  private _setPrediction(buttonId: string, confidence: number, timestamp: number): void {
    // Only trigger if new or different button
    if (!this.currentPrediction || this.currentPrediction.buttonId !== buttonId) {
      console.log(`[InterruptPredictor] Predicting: ${buttonId} (${(confidence * 100).toFixed(0)}%)`);
      
      this.currentPrediction = { buttonId, confidence, timestamp };
      
      // Trigger callback
      if (this.onPrediction) {
        this.onPrediction(buttonId, confidence);
      }
    }
  }
  
  private _clearPrediction(): void {
    if (this.currentPrediction) {
      this.currentPrediction = null;
      
      // Clear prediction (confidence = 0)
      if (this.onPrediction) {
        this.onPrediction(null, 0);
      }
    }
  }
  
  // ─── Storage ───────────────────────────────────────────────────────
  
  private _loadThresholdFromStorage(): number | null {
    try {
      const stored = localStorage.getItem('chazyPredictionThreshold');
      if (stored) {
        const threshold = parseFloat(stored);
        if (!isNaN(threshold) && threshold >= 0.5 && threshold <= 0.9) {
          console.log(`[InterruptPredictor] Restored threshold: ${threshold}`);
          return threshold;
        }
      }
    } catch (e) {
      console.warn('[InterruptPredictor] Failed to load threshold:', e);
    }
    return null;
  }
  
  private _saveThresholdToStorage(): void {
    try {
      localStorage.setItem('chazyPredictionThreshold', this.predictionThreshold.toString());
    } catch (e) {
      console.warn('[InterruptPredictor] Failed to save threshold:', e);
    }
  }
}
