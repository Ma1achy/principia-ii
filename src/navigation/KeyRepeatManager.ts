/**
 * KeyRepeatManager - Manages DAS (Delayed Auto Shift) and ARR (Auto Repeat Rate)
 * for keyboard navigation with configurable timing profiles
 */

export interface RepeatProfile {
  das: number;
  arr: number;
}

interface KeyState {
  dasTimer: ReturnType<typeof setTimeout> | null;
  arrInterval: ReturnType<typeof setInterval> | null;
  action: () => void;
  profile: RepeatProfile;
  profileName: string;
}

export interface KeyRepeatManagerOptions {
  profiles?: Record<string, RepeatProfile>;
}

export class KeyRepeatManager {
  profiles: Record<string, RepeatProfile>;
  heldKeys: Map<string, KeyState>;
  private _boundBlurHandler: () => void;

  constructor(options: KeyRepeatManagerOptions = {}) {
    // Single unified profile - all keyboard repeat uses the same timing
    // Profile values are updated dynamically from navPrefs (see updateFromNavPrefs method)
    this.profiles = options.profiles || {
      navigation: { das: 200, arr: 50 }
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
    
    console.log('[KeyRepeatManager] Initialized with profile:', this.profiles.navigation);
  }
  
  /**
   * Start repeat for a key press
   * @param key - The key being pressed
   * @param action - Action to execute on repeat
   * @param profileName - Profile to use (always 'navigation' now)
   */
  startRepeat(key: string, action: () => void, profileName: string = 'navigation'): void {
    // If key is already being held, ignore (browser repeat already filtered)
    if (this.heldKeys.has(key)) {
      return;
    }
    
    // Use single unified profile for all keyboard repeat
    const profile = this.profiles.navigation;
    
    console.log('[KeyRepeatManager] Starting repeat for key:', key, profile);
    
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
      profileName: 'navigation'
    });
  }
  
  /**
   * Stop repeat for a key release
   * @param key - The key being released
   */
  stopRepeat(key: string): void {
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
  stopAll(): void {
    console.log('[KeyRepeatManager] Stopping all repeats');
    
    for (const key of this.heldKeys.keys()) {
      this.stopRepeat(key);
    }
  }
  
  /**
   * Check if a key is currently held and repeating
   * @param key - The key to check
   * @returns {boolean}
   */
  isKeyHeld(key: string): boolean {
    return this.heldKeys.has(key);
  }
  
  /**
   * Get current profile name for a held key
   * @param key - The key to check
   * @returns Profile name or null if not held
   */
  getKeyProfile(key: string): string | null {
    const keyState = this.heldKeys.get(key);
    return keyState ? keyState.profileName : null;
  }
  
  /**
   * Update profile timing from user preferences (called when settings change)
   * @param das - Delayed Auto Shift in milliseconds
   * @param arr - Auto Repeat Rate in milliseconds
   */
  updateFromNavPrefs(das: number, arr: number): void {
    this.profiles.navigation.das = das;
    this.profiles.navigation.arr = arr;
    
    console.log('[KeyRepeatManager] Updated profile from navPrefs:', this.profiles.navigation);
    
    // Update any currently active ARR intervals with new rate
    for (const [key, keyState] of this.heldKeys.entries()) {
      if (keyState.arrInterval) {
        clearInterval(keyState.arrInterval);
        keyState.arrInterval = setInterval(() => {
          this._executeRepeat(key);
        }, arr);
        console.log('[KeyRepeatManager] Updated active ARR for key:', key);
      }
    }
  }
  
  /**
   * Handle DAS timer expiration - transition to ARR phase
   * @private
   * @param key - The key that expired DAS
   */
  private _onDASExpire(key: string): void {
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
   * @param key - The key to repeat
   */
  private _executeRepeat(key: string): void {
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
  private _handleBlur(): void {
    console.log('[KeyRepeatManager] Window blur detected - stopping all repeats');
    this.stopAll();
  }
  
  /**
   * Cleanup and remove listeners
   */
  destroy(): void {
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
