/**
 * PatternDetector - Detect patterns in user UI interactions
 * 
 * Aggregates raw UI events into semantic patterns like:
 * - slider_exploration: User exploring multiple sliders
 * - preset_browsing: User trying different presets
 * - orientation_adjustment: User adjusting view angles
 */

export class PatternDetector {
  constructor(eventRouter, options = {}) {
    this.router = eventRouter;
    
    // Pattern thresholds
    this.sliderThreshold = options.sliderThreshold || 3; // unique sliders
    this.sliderWindow = options.sliderWindow || 15000; // 15s
    this.presetThreshold = options.presetThreshold || 3; // unique presets
    this.presetWindow = options.presetWindow || 20000; // 20s
    this.orientationThreshold = options.orientationThreshold || 3; // changes
    this.orientationWindow = options.orientationWindow || 15000; // 15s
    
    // Pattern cooldowns
    this.cooldownDuration = options.cooldownDuration || 25000; // 25s
    this.cooldowns = new Map();
    
    // Recent activity tracking
    this.recentSliders = [];
    this.recentPresets = [];
    this.recentOrientations = [];
  }
  
  /**
   * Record a slider change (from UI)
   */
  recordSliderChange(sliderName) {
    if (!sliderName || typeof sliderName !== 'string') {
      console.warn('[PatternDetector] Invalid sliderName:', sliderName);
      return;
    }
    
    const now = Date.now();
    
    // Clean old entries
    this.recentSliders = this.recentSliders.filter(
      e => now - e.time < this.sliderWindow
    );
    
    // Add new entry
    this.recentSliders.push({
      slider: sliderName,
      time: now
    });
    
    // Check for pattern
    this._checkSliderPattern();
  }
  
  /**
   * Record a preset change (from UI)
   */
  recordPresetChange(presetId) {
    if (!presetId) {
      console.warn('[PatternDetector] Invalid presetId:', presetId);
      return;
    }
    
    const now = Date.now();
    
    // Clean old entries
    this.recentPresets = this.recentPresets.filter(
      e => now - e.time < this.presetWindow
    );
    
    // Add new entry
    this.recentPresets.push({
      preset: presetId,
      time: now
    });
    
    // Check for pattern
    this._checkPresetPattern();
  }
  
  /**
   * Record an orientation change (from UI)
   */
  recordOrientationChange() {
    const now = Date.now();
    
    // Clean old entries
    this.recentOrientations = this.recentOrientations.filter(
      e => now - e.time < this.orientationWindow
    );
    
    // Add new entry
    this.recentOrientations.push({
      time: now
    });
    
    // Check for pattern
    this._checkOrientationPattern();
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _checkSliderPattern() {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get('slider_exploration') || 0;
    
    if (now < cooldownUntil) {
      return; // Still in cooldown
    }
    
    // Count unique sliders
    const uniqueSliders = new Set(this.recentSliders.map(e => e.slider));
    
    if (uniqueSliders.size >= this.sliderThreshold) {
      console.log(`[PatternDetector] Slider exploration detected: ${uniqueSliders.size} sliders`);
      
      // Emit pattern event
      this.router.route('slider_exploration', {
        sliders: Array.from(uniqueSliders),
        count: uniqueSliders.size
      });
      
      // Set cooldown
      this.cooldowns.set('slider_exploration', now + this.cooldownDuration);
      
      // Clear recent sliders
      this.recentSliders = [];
    }
  }
  
  _checkPresetPattern() {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get('preset_browsing') || 0;
    
    if (now < cooldownUntil) {
      return; // Still in cooldown
    }
    
    // Count unique presets
    const uniquePresets = new Set(this.recentPresets.map(e => e.preset));
    
    if (uniquePresets.size >= this.presetThreshold) {
      console.log(`[PatternDetector] Preset browsing detected: ${uniquePresets.size} presets`);
      
      // Emit pattern event
      this.router.route('preset_browsing', {
        presets: Array.from(uniquePresets),
        count: uniquePresets.size
      });
      
      // Set cooldown
      this.cooldowns.set('preset_browsing', now + this.cooldownDuration);
      
      // Clear recent presets
      this.recentPresets = [];
    }
  }
  
  _checkOrientationPattern() {
    // Check cooldown
    const now = Date.now();
    const cooldownUntil = this.cooldowns.get('orientation_adjustment') || 0;
    
    if (now < cooldownUntil) {
      return; // Still in cooldown
    }
    
    // Count changes
    const changeCount = this.recentOrientations.length;
    
    if (changeCount >= this.orientationThreshold) {
      console.log(`[PatternDetector] Orientation adjustment detected: ${changeCount} changes`);
      
      // Emit pattern event
      this.router.route('orientation_adjustment', {
        changes: changeCount
      });
      
      // Set cooldown
      this.cooldowns.set('orientation_adjustment', now + this.cooldownDuration);
      
      // Clear recent orientations
      this.recentOrientations = [];
    }
  }
}
