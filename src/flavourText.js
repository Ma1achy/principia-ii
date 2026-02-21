/**
 * Principia Flavour Text Selector — v4 (Chazy Integration)
 * ─────────────────────────────────────────────────────────
 * Now integrated with Chazy emotional AI system:
 *   - Text selection influenced by Chazy's emotional state
 *   - Mode weights adjusted based on personality reactions
 *   - Theme preferences driven by current emotion
 * 
 * Rules:
 *   - Each unit has a `lines` array.
 *   - 1 line  → shown once, sits until re-triggered externally.
 *   - N lines → sequences through all lines, then auto-picks a fresh unit.
 *   - Selection respects `modes`, `themes`, `weight` + Chazy's emotional state.
 *   - A recency buffer (default 32) prevents the same unit being picked again
 *     too soon. Buffer shrinks automatically if the candidate pool is small.
 *
 * Usage:
 *   import { FlavourText, attachFlavourText } from './flavourText.js';
 *
 *   const flavour = new FlavourText('/src/resources/flavour.json');
 *   await flavour.load();
 *
 *   // Start on page load:
 *   flavour.start('event', (line) => {
 *     document.querySelector('.subtitle').textContent = line;
 *   });
 *
 *   // Feed events to Chazy:
 *   flavour.chazy.observe('collision', { velocity: 1.5 });
 *
 *   // Stop all timers (e.g. page unload):
 *   flavour.stop();
 */

import { ChazyMind } from './Chazy/index.js';

/**
 * Calculate idle time based on emotion and intensity
 * @param {string} emotion - Current emotional state
 * @param {number} intensity - Current intensity (0.1-1.0)
 * @param {number} baseDisplayTime - Base display time for this line
 * @returns {number} - Idle time in milliseconds
 */
function getEmotionalIdleTime(emotion, intensity, baseDisplayTime) {
  let multiplier = 1.0;
  let minRange = 0.8;
  let maxRange = 1.2;
  
  switch(emotion.toUpperCase()) {
    case 'BORED':
      // Long pauses, dragging
      multiplier = 2.0;
      minRange = 1.5;
      maxRange = 3.0;
      // Very low intensity = even longer pauses
      if (intensity < 0.2) {
        multiplier = 3.5;
      }
      break;
      
    case 'EXCITED':
      // Barely pauses, wants to keep talking
      multiplier = 0.3;
      minRange = 0.1;
      maxRange = 0.5;
      // Very high intensity = almost no pause
      if (intensity > 0.8) {
        multiplier = 0.15;
      }
      break;
      
    case 'SURPRISED':
      // Quick turnaround, still processing
      multiplier = 0.5;
      minRange = 0.3;
      maxRange = 0.7;
      break;
      
    case 'ANALYTICAL':
      // Needs time to formulate next thought
      multiplier = 1.2;
      minRange = 0.8;
      maxRange = 1.5;
      break;
      
    case 'CONTEMPLATIVE':
      // Long thoughtful silences
      multiplier = 1.8;
      minRange = 1.3;
      maxRange = 2.5;
      break;
      
    case 'CONCERNED':
      // Moderate, tense
      multiplier = 0.9;
      minRange = 0.6;
      maxRange = 1.2;
      break;
      
    case 'AMUSED':
      // Normal conversational pace
      multiplier = 1.0;
      minRange = 0.7;
      maxRange = 1.3;
      break;
      
    case 'CURIOUS':
      // Engaged, steady flow
      multiplier = 0.9;
      minRange = 0.6;
      maxRange = 1.2;
      break;
      
    case 'NEUTRAL':
    default:
      // Baseline presence
      multiplier = 1.1;
      minRange = 0.9;
      maxRange = 1.4;
      break;
  }
  
  // Apply intensity modulation
  // Low intensity = longer pauses (less engaged)
  // High intensity = closer to base (more engaged)
  const intensityFactor = 0.7 + (intensity * 0.6); // 0.7x to 1.3x
  
  const variation = minRange + Math.random() * (maxRange - minRange);
  return baseDisplayTime * multiplier * variation * intensityFactor;
}

/**
 * Calculate display time based on emotion and intensity
 * @param {string} emotion - Current emotional state
 * @param {number} intensity - Current intensity (0.1-1.0)
 * @param {number} baseMin - Minimum base display time (ms)
 * @param {number} baseMax - Maximum base display time (ms)
 * @returns {number} - Display time in milliseconds
 */
function getEmotionalDisplayTime(emotion, intensity, baseMin, baseMax) {
  let multiplier = 1.0;
  let minRange = 0.8;
  let maxRange = 1.2;
  
  switch(emotion.toUpperCase()) {
    case 'BORED':
      // Brief display, doesn't linger (uninterested)
      multiplier = 0.6;
      minRange = 0.4;
      maxRange = 0.8;
      break;
      
    case 'EXCITED':
      // Quick display, eager to move on
      multiplier = 0.5;
      minRange = 0.3;
      maxRange = 0.7;
      break;
      
    case 'SURPRISED':
      // Short hold, reactive
      multiplier = 0.6;
      minRange = 0.4;
      maxRange = 0.8;
      break;
      
    case 'ANALYTICAL':
      // Moderate hold, lets you read and process
      multiplier = 1.3;
      minRange = 1.0;
      maxRange = 1.6;
      break;
      
    case 'CONTEMPLATIVE':
      // Long hold, letting thoughts sink in
      multiplier = 1.5;
      minRange = 1.2;
      maxRange = 1.8;
      break;
      
    case 'CONCERNED':
      // Moderate hold, tense but focused
      multiplier = 1.0;
      minRange = 0.8;
      maxRange = 1.2;
      break;
      
    case 'AMUSED':
      // Variable hold, playful timing
      multiplier = 1.0;
      minRange = 0.6;
      maxRange = 1.4;
      break;
      
    case 'CURIOUS':
      // Normal hold, engaged presentation
      multiplier = 1.0;
      minRange = 0.8;
      maxRange = 1.2;
      break;
      
    case 'NEUTRAL':
    default:
      // Baseline hold
      multiplier = 1.0;
      minRange = 0.9;
      maxRange = 1.1;
      break;
  }
  
  // Apply intensity modulation
  // High intensity = holds text longer (more engaged with what she's saying)
  // Low intensity = briefer display (less invested)
  const intensityFactor = 0.7 + (intensity * 0.6); // 0.7x to 1.3x
  
  // Calculate base display time with variation
  const baseDisplay = baseMin + Math.random() * (baseMax - baseMin);
  const variation = minRange + Math.random() * (maxRange - minRange);
  
  return baseDisplay * multiplier * variation * intensityFactor;
}

export class FlavourText {
  /**
   * @param {string} jsonPath
   * @param {object} [options]
   * @param {number} [options.defaultInterval=4000]  ms between lines in multi-line units (deprecated - now immediate)
   * @param {number} [options.crossfadeMs=600]       expose to CSS transition
   * @param {number} [options.bufferSize=32]         recency exclusion window
   * @param {number} [options.displayMinMs=2000]     min display time after typing (2s)
   * @param {number} [options.displayMaxMs=10000]    max display time after typing (10s)
   * @param {number} [options.multiLineMultiplier=2.5] multiplier for wait after multi-line units
   */
  constructor(jsonPath, options = {}) {
    this._path            = jsonPath;
    this._data            = null;
    this._timer           = null;
    this._defaultInterval = options.defaultInterval ?? 4000; // Kept for backwards compat
    this._crossfadeMs     = options.crossfadeMs     ?? 600;
    this._bufferSize      = options.bufferSize       ?? 32;
    this._displayMinMs    = options.displayMinMs     ?? 2000;
    this._displayMaxMs    = options.displayMaxMs     ?? 10000;
    this._multiLineMultiplier = options.multiLineMultiplier ?? 2.5;
    this._isFirstSelection = true; // Track first text selection for "welcome" mode
    this._isShowingWelcome = false; // Track if currently showing welcome (protected from interrupts)
    this._lastInterruptTime = 0; // Track last interrupt for cooldown

    // Recency buffer — stores indices of recently shown units
    this._recentBuffer    = [];
    
    // Chazy — The Voice
    this.chazy = new ChazyMind();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async load() {
    const res  = await fetch(this._path);
    this._data = await res.json();
    return this;
  }

  /**
   * Pick a unit and start playing its lines.
   * Safe to call again at any time — cancels the current cycle first.
   *
   * @param {string|Function} mode  Current render mode (e.g. 'diffusion') or function that returns it
   * @param {Function} onLine       Called with (lineText, onAnimationComplete) for each line
   * @param {string[]} [themes]     Optional theme filter — unit must share ≥1 theme
   */
  start(mode, onLine, themes = []) {
    this.stop();
    this._mode = mode; // Store mode getter for later use
    this._onLine = onLine;
    this._themes = themes;
    this._pickAndPlay();
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Force immediate mode re-evaluation and text selection
   * Used for reactive events like collision/ejection
   * Only interrupts during safe states (IDLE, DISPLAY)
   * Has 10s cooldown
   */
  interrupt() {
    // Never interrupt welcome text
    if (this._isShowingWelcome) {
      console.log('[Interrupt] Blocked - showing welcome');
      return false;
    }
    
    // Check cooldown (10 seconds)
    const now = Date.now();
    const timeSinceLastInterrupt = now - this._lastInterruptTime;
    if (timeSinceLastInterrupt < 10000) {
      console.log('[Interrupt] Blocked - cooldown active:', (10000 - timeSinceLastInterrupt) / 1000, 's remaining');
      return false; // Still in cooldown
    }
    
    // Try to interrupt (only succeeds in safe states)
    if (this._attachedInterrupt && this._attachedInterrupt()) {
      // Interrupt successful! Now activate cooldown
      const currentMode = this._getCurrentMode();
      console.log('[Interrupt] SUCCESS - mode:', currentMode);
      this._lastInterruptTime = now;
      this._pickAndPlay();
      return true;
    }
    
    // Interrupt failed (busy animating), don't activate cooldown
    console.log('[Interrupt] FAILED - FSM busy animating');
    return false;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _getCurrentMode() {
    return typeof this._mode === 'function' ? this._mode() : this._mode;
  }

  _pickAndPlay() {
    // On first selection, try "welcome" mode first
    let mode = this._getCurrentMode();
    console.log('[_pickAndPlay] Mode:', mode);
    
    if (this._isFirstSelection) {
      const welcomeIndex = this._pickIndexForWelcome(this._themes);
      if (welcomeIndex !== -1) {
        this._isFirstSelection = false;
        this._isShowingWelcome = true; // Flag to protect welcome from interrupts
        this._addToBuffer(welcomeIndex);
        const unit = this._data.subtitles[welcomeIndex];
        console.log('[_pickAndPlay] Selected WELCOME:', unit.lines[0]);
        this._cycle(unit);
        return;
      }
      this._isFirstSelection = false;
    }
    
    // Normal selection - exclude welcome texts
    this._isShowingWelcome = false; // No longer showing welcome
    const index = this._pickIndex(mode, this._themes, true); // excludeWelcome = true
    if (index === -1) {
      console.warn('[_pickAndPlay] NO TEXT found for mode:', mode);
      return;
    }

    this._addToBuffer(index);
    const unit = this._data.subtitles[index];
    console.log('[_pickAndPlay] Selected text:', unit.lines[0], '| when:', unit.when, '| what:', unit.what, '| emotion:', this.chazy.emotion);
    this._cycle(unit);
  }

  /**
   * Special picker for welcome texts - only checks "when" field
   */
  _pickIndexForWelcome(themes) {
    const all = this._data.subtitles;
    const chazyEmotion = this.chazy.emotion.toLowerCase();
    
    // Find all welcome texts (when includes "welcome")
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        u.when && u.when.includes('welcome') &&
        !this._recentBuffer.includes(i)
      );
    
    if (candidates.length === 0) {
      return -1;
    }
    
    return this._weightedRandom(candidates, chazyEmotion);
  }

  /**
   * Weighted random pick, excluding recently seen units.
   * Uses new schema: unit.weights (emotional), unit.when, unit.what
   * Returns the index into subtitles array, or -1 if pool is empty.
   */
  _pickIndex(visualMode, themes, excludeWelcome = false) {
    const all = this._data.subtitles;
    
    // Get Chazy's current emotional state
    const chazyEmotion = this.chazy.emotion.toLowerCase();
    const preferredThemes = this.chazy.getPreferredThemes();
    
    // Merge user themes with Chazy's emotional preferences
    const allThemes = [...themes, ...preferredThemes];
    
    // Determine current action mode from interactionState (passed via mode function)
    const currentMode = typeof this._mode === 'function' ? this._mode() : this._mode;
    
    // Build candidate list: when/what match, theme match, not in recency buffer
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        this._whenMatches(u, visualMode) &&
        this._whatMatches(u, currentMode) &&
        this._themeMatches(u, allThemes) &&
        !this._recentBuffer.includes(i) &&
        (!excludeWelcome || !this._isWelcomeText(u))
      );

    // If theme filter kills the pool, drop theme constraint
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) =>
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, currentMode) &&
          !this._recentBuffer.includes(i) &&
          (!excludeWelcome || !this._isWelcomeText(u))
        );
    }

    // If recency buffer kills the pool, clear it and retry
    if (candidates.length === 0) {
      this._recentBuffer = [];
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => 
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, currentMode) &&
          (!excludeWelcome || !this._isWelcomeText(u))
        );
    }

    // Last resort: everything (except welcome if excluded)
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => !excludeWelcome || !this._isWelcomeText(u));
    }

    return this._weightedRandom(candidates, chazyEmotion);
  }

  _weightedRandom(candidates, chazyEmotion) {
    const intensity = this.chazy.intensity;
    
    // Calculate total with intensity-modulated weights
    const total = candidates.reduce((sum, { u }) => {
      const emotionalWeights = u.weights || {};
      const rawWeight = emotionalWeights[chazyEmotion] || 1.0;
      
      // Modulate weight by intensity
      // At intensity 0: all weights → 1.0 (neutral)
      // At intensity 1: full emotional bias
      const effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity;
      
      return sum + effectiveWeight;
    }, 0);
    
    let r = Math.random() * total;
    for (const { u, i } of candidates) {
      const emotionalWeights = u.weights || {};
      const rawWeight = emotionalWeights[chazyEmotion] || 1.0;
      const effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity;
      
      r -= effectiveWeight;
      if (r <= 0) return i;
    }
    return candidates[candidates.length - 1].i;
  }

  _addToBuffer(index) {
    this._recentBuffer.push(index);
    // Effective buffer size: never more than half the total corpus
    const effectiveMax = Math.min(
      this._bufferSize,
      Math.floor(this._data.subtitles.length / 2)
    );
    while (this._recentBuffer.length > effectiveMax) {
      this._recentBuffer.shift();
    }
  }

  /**
   * Sequences through unit.lines.
   * Simple FSM: each line gets config with display/idle times and completion callback
   */
  _cycle(unit) {
    const lines = unit.lines;
    const isMultiLine = lines.length > 1;
    let index = 0;
    
    // Get current emotional state BEFORE reflecting (for this text's display)
    const emotion = this.chazy.emotion;
    const intensity = this.chazy.intensity;
    
    // Signal to Chazy what was selected (bidirectional feedback)
    // This creates emotional momentum - saying contemplative things makes you more contemplative
    this.chazy.reflectOnText(unit.weights, unit.themes);

    const showLine = (lineIndex) => {
      const line = lines[lineIndex];
      
      // Use emotion-driven display time instead of random
      const displayTime = getEmotionalDisplayTime(
        emotion, 
        intensity, 
        this._displayMinMs, 
        this._displayMaxMs
      );
      
      let idleTime;
      let onComplete;
      
      if (isMultiLine) {
        if (lineIndex < lines.length - 1) {
          // Not last line: brief pause before next line (0.5-1s)
          idleTime = 500 + Math.random() * 500; // 0.5-1 second
          onComplete = () => showLine(lineIndex + 1);
        } else {
          // Last line of multi-line: use emotional idle time
          const baseIdle = displayTime * this._multiLineMultiplier;
          idleTime = getEmotionalIdleTime(emotion, intensity, baseIdle);
          onComplete = () => this._pickAndPlay();
        }
      } else {
        // Single line: use emotional idle time
        idleTime = getEmotionalIdleTime(emotion, intensity, displayTime);
        onComplete = () => this._pickAndPlay();
      }
      
      this._onLine(line, {
        displayTime,
        idleTime,
        onComplete,
        emotion,      // Pass to TextStateMachine
        intensity,    // Pass to TextStateMachine
        themes: unit.themes || []  // Pass themes for context-aware animations
      });
    };

    showLine(0);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _normaliseMode(mode) {
    return mode.toLowerCase().replace(/\s+\+\s+/g, '+').trim();
  }

  /**
   * Check if unit's "when" (visual context) matches current visual mode
   */
  _whenMatches(unit, visualMode) {
    if (!unit.when || unit.when.length === 0) return true;
    if (unit.when.includes('any')) return true;
    
    const normalised = this._normaliseMode(visualMode);
    return unit.when.some(w => this._normaliseMode(w) === normalised);
  }

  /**
   * Check if unit's "what" (action context) matches current mode
   * Handles both visual modes and interactive modes (collision, drag, etc.)
   */
  _whatMatches(unit, currentMode) {
    if (!unit.what || unit.what.length === 0) return true;
    if (unit.what.includes('any')) return true;
    
    const normalised = this._normaliseMode(currentMode);
    
    // "welcome" is special - only match exact welcome texts
    if (normalised === 'welcome') {
      return unit.what.includes('welcome');
    }
    
    // Interactive modes (collision, ejection, stable, zoom, drag, render, idle)
    // match exactly
    const interactiveModes = ['collision', 'ejection', 'stable', 'zoom', 'drag', 'render', 'idle'];
    if (interactiveModes.includes(normalised)) {
      return unit.what.includes(normalised);
    }
    
    // For other modes, check what array
    return unit.what.some(w => this._normaliseMode(w) === normalised);
  }

  _modeMatches(unit, modeKey) {
    // Backward compatibility: check old "modes" field
    if (!unit.modes) return true;
    
    // "welcome" is special - only match exact welcome texts, not "any"
    if (modeKey === 'welcome') {
      return unit.modes.includes('welcome');
    }
    
    // Interactive modes (collision, ejection, stable, zoom, drag, render, idle)
    // should NOT match "any" - they need explicit mode tags
    const interactiveModes = ['collision', 'ejection', 'stable', 'zoom', 'drag', 'render', 'idle'];
    if (interactiveModes.includes(modeKey)) {
      return unit.modes.includes(modeKey);
    }
    
    // For render modes (event, diffusion, phase), "any" is a wildcard
    return unit.modes.includes('any') || unit.modes.includes(modeKey);
  }

  _themeMatches(unit, themes) {
    if (!themes || themes.length === 0) return true;
    if (!unit.themes) return false;
    return themes.some(t => unit.themes.includes(t));
  }

  _isWelcomeText(unit) {
    // Check new schema first
    if (unit.when && unit.when.includes('welcome')) return true;
    // Backward compat
    if (unit.modes && unit.modes.includes('welcome')) return true;
    return false;
  }
}


// ─── Convenience wrapper ───────────────────────────────────────────────────
//
// Handles animated text transitions on a DOM element using Chazy's FSM.
//
// Usage:
//   attachFlavourText(flavour, getCurrentMode, document.querySelector('.subtitle'));
//   attachFlavourText(flavour, () => 'event', el, ['chaos', 'boundary']);

import { TextStateMachine } from './Chazy/index.js';

export function attachFlavourText(flavourInstance, mode, element, themes = [], onUpdateCallback = null) {
  // Create text animation state machine
  const fsm = new TextStateMachine(element, onUpdateCallback);
  
  // Expose interrupt method
  flavourInstance._attachedInterrupt = () => fsm.interrupt();
  
  // Start the flavour text system with FSM's processLine method
  flavourInstance.start(mode, (line, config) => fsm.processLine(line, config), themes);
}
