/**
 * KeyRepeatManager - Manages DAS (Delayed Auto Shift) and ARR (Auto Repeat Rate)
 * for keyboard navigation with configurable timing profiles
 */

export class KeyRepeatManager {
  constructor(options = {}) {
    // Timing profiles for different contexts
    this.profiles = {
      canvas: { das: 400, arr: 80 },      // Slower for precision control (~12.5 actions/sec)
      slider: { das: 300, arr: 60 },      // Medium speed for value adjustment (~16.7 actions/sec)
      navigation: { das: 200, arr: 50 }   // Fast for UI traversal (20 actions/sec)
    };
    
    // Track currently held keys
    // Map<key, { dasTimer, arrInterval, action, profile }>
    this.heldKeys = new Map();
    
    // Bound handlers for cleanup
    this._boundBlurHandler = this._handleBlur.bind(this);
    
    // Listen for tab blur to clear all repeats
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._boundBlurHandler);
    }
    
    console.log('[KeyRepeatManager] Initialized with profiles:', this.profiles);
  }
  
  /**
   * Start repeat for a key press
   * @param {string} key - The key being pressed
   * @param {Function} action - Action to execute on repeat
   * @param {string} profileName - Profile to use ('canvas', 'slider', 'navigation')
   */
  startRepeat(key, action, profileName = 'navigation') {
    // If key is already being held, ignore (browser repeat already filtered)
    if (this.heldKeys.has(key)) {
      return;
    }
    
    const profile = this.profiles[profileName] || this.profiles.navigation;
    
    console.log('[KeyRepeatManager] Starting repeat for key:', key, 'profile:', profileName, profile);
    
    // Start DAS timer (initial delay before repeat starts)
    const dasTimer = setTimeout(() => {
      this._onDASExpire(key);
    }, profile.das);
    
    // Store key state
    this.heldKeys.set(key, {
      dasTimer,
      arrInterval: null,
      action,
      profile,
      profileName
    });
  }
  
  /**
   * Stop repeat for a key release
   * @param {string} key - The key being released
   */
  stopRepeat(key) {
    const keyState = this.heldKeys.get(key);
    if (!keyState) {
      return;
    }
    
    console.log('[KeyRepeatManager] Stopping repeat for key:', key);
    
    // Clear DAS timer if still waiting
    if (keyState.dasTimer) {
      clearTimeout(keyState.dasTimer);
    }
    
    // Clear ARR interval if active
    if (keyState.arrInterval) {
      clearInterval(keyState.arrInterval);
    }
    
    // Remove from held keys
    this.heldKeys.delete(key);
  }
  
  /**
   * Stop all repeats (e.g., on focus change or context switch)
   */
  stopAll() {
    console.log('[KeyRepeatManager] Stopping all repeats');
    
    for (const key of this.heldKeys.keys()) {
      this.stopRepeat(key);
    }
  }
  
  /**
   * Check if a key is currently held and repeating
   * @param {string} key - The key to check
   * @returns {boolean}
   */
  isKeyHeld(key) {
    return this.heldKeys.has(key);
  }
  
  /**
   * Get current profile name for a held key
   * @param {string} key - The key to check
   * @returns {string|null} Profile name or null if not held
   */
  getKeyProfile(key) {
    const keyState = this.heldKeys.get(key);
    return keyState ? keyState.profileName : null;
  }
  
  /**
   * Update profile for a held key (e.g., when context changes mid-hold)
   * @param {string} key - The key to update
   * @param {string} profileName - New profile name
   */
  updateProfile(key, profileName) {
    const keyState = this.heldKeys.get(key);
    if (!keyState) {
      return;
    }
    
    const newProfile = this.profiles[profileName] || this.profiles.navigation;
    
    // Only update if profile actually changed
    if (keyState.profileName === profileName) {
      return;
    }
    
    console.log('[KeyRepeatManager] Updating profile for key:', key, 'from', keyState.profileName, 'to', profileName);
    
    keyState.profile = newProfile;
    keyState.profileName = profileName;
    
    // If ARR is active, restart interval with new rate
    if (keyState.arrInterval) {
      clearInterval(keyState.arrInterval);
      keyState.arrInterval = setInterval(() => {
        this._executeRepeat(key);
      }, newProfile.arr);
    }
  }
  
  /**
   * Handle DAS timer expiration - transition to ARR phase
   * @private
   * @param {string} key - The key that expired DAS
   */
  _onDASExpire(key) {
    const keyState = this.heldKeys.get(key);
    if (!keyState) {
      return;
    }
    
    console.log('[KeyRepeatManager] DAS expired for key:', key, '- starting ARR');
    
    // Clear DAS timer reference
    keyState.dasTimer = null;
    
    // Execute first repeat immediately
    this._executeRepeat(key);
    
    // Start ARR interval
    keyState.arrInterval = setInterval(() => {
      this._executeRepeat(key);
    }, keyState.profile.arr);
  }
  
  /**
   * Execute the repeat action for a key
   * @private
   * @param {string} key - The key to repeat
   */
  _executeRepeat(key) {
    const keyState = this.heldKeys.get(key);
    if (!keyState) {
      return;
    }
    
    try {
      keyState.action();
    } catch (error) {
      console.error('[KeyRepeatManager] Error executing repeat action for key:', key, error);
      // Stop repeat on error to prevent infinite error loops
      this.stopRepeat(key);
    }
  }
  
  /**
   * Handle window blur - stop all repeats
   * @private
   */
  _handleBlur() {
    console.log('[KeyRepeatManager] Window blur detected - stopping all repeats');
    this.stopAll();
  }
  
  /**
   * Cleanup and remove listeners
   */
  destroy() {
    console.log('[KeyRepeatManager] Destroying');
    
    // Stop all active repeats
    this.stopAll();
    
    // Remove blur listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._boundBlurHandler);
    }
  }
}

console.log('[KeyRepeatManager] Module loaded');
