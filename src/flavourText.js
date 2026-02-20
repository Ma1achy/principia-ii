/**
 * Principia Flavour Text Selector — v3
 * ─────────────────────────────────────
 * Rules:
 *   - Each unit has a `lines` array.
 *   - 1 line  → shown once, sits until re-triggered externally.
 *   - N lines → sequences through all lines, then auto-picks a fresh unit.
 *   - Selection respects `modes`, `themes`, `weight`.
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
 *   // Re-trigger on mode change:
 *   flavour.start('diffusion', onLine);
 *
 *   // Stop all timers (e.g. page unload):
 *   flavour.stop();
 */

export class FlavourText {
  /**
   * @param {string} jsonPath
   * @param {object} [options]
   * @param {number} [options.defaultInterval=4000]  ms between lines in multi-line units
   * @param {number} [options.crossfadeMs=600]       expose to CSS transition
   * @param {number} [options.bufferSize=32]         recency exclusion window
   * @param {number} [options.randomMinMs=8000]      min random delay for single-line units
   * @param {number} [options.randomMaxMs=15000]     max random delay for single-line units
   */
  constructor(jsonPath, options = {}) {
    this._path            = jsonPath;
    this._data            = null;
    this._timer           = null;
    this._defaultInterval = options.defaultInterval ?? 4000;
    this._crossfadeMs     = options.crossfadeMs     ?? 600;
    this._bufferSize      = options.bufferSize       ?? 32;
    this._randomMinMs     = options.randomMinMs      ?? 8000;
    this._randomMaxMs     = options.randomMaxMs      ?? 15000;

    // Recency buffer — stores indices of recently shown units
    this._recentBuffer    = [];
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
   * @param {Function} onLine       Called with (lineText, crossfadeMs) for each line
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

  // ─── Internal ──────────────────────────────────────────────────────────────

  _getCurrentMode() {
    return typeof this._mode === 'function' ? this._mode() : this._mode;
  }

  _pickAndPlay() {
    const mode = this._getCurrentMode();
    const index = this._pickIndex(mode, this._themes);
    if (index === -1) return;

    this._addToBuffer(index);
    const unit = this._data.subtitles[index];
    this._cycle(unit);
  }

  /**
   * Weighted random pick, excluding recently seen units.
   * Returns the index into subtitles array, or -1 if pool is empty.
   */
  _pickIndex(mode, themes) {
    const all        = this._data.subtitles;
    const modeKey    = this._normaliseMode(mode);

    // Build candidate list: mode + theme match, not in recency buffer
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        this._modeMatches(u, modeKey) &&
        this._themeMatches(u, themes) &&
        !this._recentBuffer.includes(i)
      );

    // If theme filter kills the pool, drop theme constraint
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) =>
          this._modeMatches(u, modeKey) &&
          !this._recentBuffer.includes(i)
        );
    }

    // If recency buffer kills the pool, clear it and retry
    if (candidates.length === 0) {
      this._recentBuffer = [];
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => this._modeMatches(u, modeKey));
    }

    // Last resort: everything
    if (candidates.length === 0) {
      candidates = all.map((u, i) => ({ u, i }));
    }

    return this._weightedRandom(candidates);
  }

  _weightedRandom(candidates) {
    const total = candidates.reduce((sum, { u }) => sum + (u.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const { u, i } of candidates) {
      r -= (u.weight ?? 1);
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
   * When all lines are exhausted (or after random delay for single-line), auto-picks a new unit.
   */
  _cycle(unit) {
    const lines    = unit.lines;
    const interval = unit.interval ?? this._defaultInterval;
    let   index    = 0;

    const emit = () => this._onLine(lines[index], this._crossfadeMs);

    const advance = () => {
      index++;

      if (index >= lines.length) {
        if (lines.length === 1) {
          // Single-line unit — wait random time then pick new one
          const randomDelay = this._getRandomInterval();
          this._timer = setTimeout(() => {
            this._pickAndPlay();
          }, randomDelay);
          return;
        }
        // Multi-line unit exhausted — pick a new one
        this._pickAndPlay();
        return;
      }

      emit();
      this._timer = setTimeout(advance, interval);
    };

    emit();

    if (lines.length > 1) {
      this._timer = setTimeout(advance, interval);
    } else {
      // Single-line: schedule random auto-advance
      const randomDelay = this._getRandomInterval();
      this._timer = setTimeout(() => {
        this._pickAndPlay();
      }, randomDelay);
    }
  }

  _getRandomInterval() {
    return Math.random() * (this._randomMaxMs - this._randomMinMs) + this._randomMinMs;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _normaliseMode(mode) {
    return mode.toLowerCase().replace(/\s+\+\s+/g, '+').trim();
  }

  _modeMatches(unit, modeKey) {
    if (!unit.modes) return true;
    return unit.modes.includes('any') || unit.modes.includes(modeKey);
  }

  _themeMatches(unit, themes) {
    if (!themes || themes.length === 0) return true;
    if (!unit.themes) return false;
    return themes.some(t => unit.themes.includes(t));
  }
}


// ─── Convenience wrapper ───────────────────────────────────────────────────
//
// Handles animated text transitions on a DOM element.
//
// Usage:
//   attachFlavourText(flavour, getCurrentMode, document.querySelector('.subtitle'));
//   attachFlavourText(flavour, () => 'event', el, ['chaos', 'boundary']);

export function attachFlavourText(flavourInstance, mode, element, themes = [], onUpdateCallback = null) {
  // Import animation functions dynamically
  let animateTextIn, animateTextOut;
  
  import('./textAnimation.js').then(module => {
    animateTextIn = module.animateTextIn;
    animateTextOut = module.animateTextOut;
  });
  
  flavourInstance.start(mode, (line, crossfadeMs) => {
    // If animations not loaded yet, fallback to simple text update
    if (!animateTextOut || !animateTextIn) {
      element.textContent = line;
      if (onUpdateCallback) {
        setTimeout(() => onUpdateCallback(), 50);
      }
      return;
    }
    
    // Animate out current text
    animateTextOut(element, () => {
      // Set text temporarily (invisible) to get proper sizing
      element.style.visibility = 'hidden';
      element.textContent = line;
      
      // Call fitTitle to apply final sizing and letter-spacing
      if (onUpdateCallback) {
        onUpdateCallback();
      }
      
      // Wait for fitTitle to complete all measurements and adjustments
      setTimeout(() => {
        // Force layout recalculation
        void element.offsetHeight;
        
        // Measure the ACTUAL element width after all fitTitle adjustments
        const finalTextWidth = element.getBoundingClientRect().width;
        
        // Now animate in with the properly sized text
        element.style.visibility = 'visible';
        animateTextIn(element, line, finalTextWidth, () => {
          // Animation complete - don't call fitTitle again, it would recalculate and shrink
          // The sizing is already correct from the initial fitTitle call
        });
      }, 50);
    });
  }, themes);
}
