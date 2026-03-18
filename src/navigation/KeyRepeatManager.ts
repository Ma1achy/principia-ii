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
    // Timing profiles for different contexts
    this.profiles = options.profiles || {
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
   * @param key - The key being pressed
   * @param action - Action to execute on repeat
   * @param profileName - Profile to use ('canvas', 'slider', 'navigation')
   */
  startRepeat(key: string, action: () => void, profileName: string = 'navigation'): void {
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
   * Update profile for a held key (e.g., when context changes mid-hold)
   * @param key - The key to update
   * @param profileName - New profile name
   */
  updateProfile(key: string, profileName: string): void {
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
