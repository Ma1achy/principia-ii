/**
 * TextSelector - Contextual text selection with emotional weighting
 * 
 * Extracted from flavourText.js to create a pure text selection module.
 * Handles weighted selection, recency buffer, and emotional timing calculations.
 */

/**
 * Calculate idle time based on emotion and intensity
 */
function getEmotionalIdleTime(emotion, intensity, baseDisplayTime) {
  let multiplier = 1.0;
  let minRange = 0.8;
  let maxRange = 1.2;
  
  switch(emotion.toUpperCase()) {
    case 'BORED':
      multiplier = 2.0;
      minRange = 1.5;
      maxRange = 3.0;
      if (intensity < 0.2) multiplier = 3.5;
      break;
      
    case 'EXCITED':
      multiplier = 0.3;
      minRange = 0.1;
      maxRange = 0.5;
      if (intensity > 0.8) multiplier = 0.15;
      break;
      
    case 'SURPRISED':
      multiplier = 0.5;
      minRange = 0.3;
      maxRange = 0.7;
      break;
      
    case 'ANALYTICAL':
      multiplier = 1.2;
      minRange = 0.8;
      maxRange = 1.5;
      break;
      
    case 'CONTEMPLATIVE':
      multiplier = 1.8;
      minRange = 1.3;
      maxRange = 2.5;
      break;
      
    case 'CONCERNED':
      multiplier = 0.9;
      minRange = 0.6;
      maxRange = 1.2;
      break;
      
    case 'AMUSED':
      multiplier = 1.0;
      minRange = 0.7;
      maxRange = 1.3;
      break;
      
    case 'CURIOUS':
      multiplier = 0.9;
      minRange = 0.6;
      maxRange = 1.2;
      break;
      
    case 'NEUTRAL':
    default:
      multiplier = 1.1;
      minRange = 0.9;
      maxRange = 1.4;
      break;
  }
  
  const intensityFactor = 0.7 + (intensity * 0.6);
  const variation = minRange + Math.random() * (maxRange - minRange);
  return baseDisplayTime * multiplier * variation * intensityFactor;
}

/**
 * Calculate display time based on emotion and intensity
 */
function getEmotionalDisplayTime(emotion, intensity, baseMin, baseMax) {
  let multiplier = 1.0;
  let minRange = 0.8;
  let maxRange = 1.2;
  
  switch(emotion.toUpperCase()) {
    case 'BORED':
      multiplier = 0.6;
      minRange = 0.4;
      maxRange = 0.8;
      break;
      
    case 'EXCITED':
      multiplier = 0.5;
      minRange = 0.3;
      maxRange = 0.7;
      break;
      
    case 'SURPRISED':
      multiplier = 0.6;
      minRange = 0.4;
      maxRange = 0.8;
      break;
      
    case 'ANALYTICAL':
      multiplier = 1.3;
      minRange = 1.0;
      maxRange = 1.6;
      break;
      
    case 'CONTEMPLATIVE':
      multiplier = 1.5;
      minRange = 1.2;
      maxRange = 1.8;
      break;
      
    case 'CONCERNED':
      multiplier = 1.0;
      minRange = 0.8;
      maxRange = 1.2;
      break;
      
    case 'AMUSED':
      multiplier = 1.0;
      minRange = 0.6;
      maxRange = 1.4;
      break;
      
    case 'CURIOUS':
      multiplier = 1.0;
      minRange = 0.8;
      maxRange = 1.2;
      break;
      
    case 'NEUTRAL':
    default:
      multiplier = 1.0;
      minRange = 0.9;
      maxRange = 1.1;
      break;
  }
  
  const intensityFactor = 0.7 + (intensity * 0.6);
  const baseDisplay = baseMin + Math.random() * (baseMax - baseMin);
  const variation = minRange + Math.random() * (maxRange - minRange);
  
  return baseDisplay * multiplier * variation * intensityFactor;
}

export class TextSelector {
  constructor(jsonPath, options = {}) {
    this.jsonPath = jsonPath;
    this.data = null;
    this.bufferSize = options.bufferSize || 32;
    this.displayMinMs = options.displayMinMs || 2000;
    this.displayMaxMs = options.displayMaxMs || 10000;
    this.multiLineMultiplier = options.multiLineMultiplier || 2.5;
    this.recentBuffer = [];
    this.isFirstSelection = true;
  }
  
  async load() {
    // Define all split files
    const files = [
      'welcome.json',
      'collision.json', 'ejection.json', 'stable.json', 'idle.json',
      'zoom.json', 'drag.json', 'render.json',
      'core/boundary.json', 'core/mathematical.json', 'core/existential.json',
      'core/infohazard.json', 'core/dark-humor.json', 'core/observational.json'
    ];
    
    // Load all files in parallel
    const basePath = this.jsonPath.replace('flavour.json', 'lines/');
    const promises = files.map(f => 
      fetch(basePath + f)
        .then(r => r.json())
        .catch(err => {
          console.warn(`[TextSelector] Failed to load ${f}:`, err);
          return { lines: [] }; // Graceful fallback
        })
    );
    
    const allData = await Promise.all(promises);
    
    // Reconstruct original structure for backwards compatibility
    this.data = {
      _schema: "principia-flavour_v2_emotional",
      subtitles: []
    };
    
    // Helper to normalize wildcard ("*" -> "any")
    const normalizeWildcard = (val) => val === '*' ? 'any' : val;
    
    for (const fileData of allData) {
      const context = fileData._context || {};
      const defaultWhen = (context.when || ['any']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      // Add context back to each entry
      for (const entry of fileData.lines || []) {
        this.data.subtitles.push({
          // Backwards compatible: keep weights field
          weights: entry.weights || {},
          themes: entry.themes || [],
          lines: entry.lines || [],
          // Use entry's when/what if present, otherwise use file context
          when: (entry.when || defaultWhen).map(normalizeWildcard),
          what: (entry.what || defaultWhat).map(normalizeWildcard),
          
          // NEW FIELDS (v3 schema)
          select_bias: entry.select_bias || {},
          reflect_pull: entry.reflect_pull || {},
          tone: entry.tone
        });
      }
    }
    
    console.log(`[TextSelector] Loaded ${this.data.subtitles.length} entries from ${files.length} files`);
    return this;
  }
  
  /**
   * Select a text unit based on current context
   * @param {Object} context - { mode, themes, emotion, intensity, excludeWelcome }
   * @returns {Object|null} - { lines, weights, select_bias, reflect_pull, tone, themes, isMultiLine } or null
   */
  select(context) {
    const { mode, themes = [], emotion, intensity, excludeWelcome = false } = context;
    
    // Handle welcome text on first selection (when mode is 'welcome')
    if (this.isFirstSelection && mode === 'welcome') {
      const welcomeIndex = this._pickIndexForWelcome(themes, emotion, intensity);
      if (welcomeIndex !== -1) {
        this.isFirstSelection = false;
        this._addToBuffer(welcomeIndex);
        const unit = this.data.subtitles[welcomeIndex];
        return {
          lines: unit.lines,
          weights: unit.weights || {},           // Backwards compat
          select_bias: unit.select_bias || {},   // NEW
          reflect_pull: unit.reflect_pull || {}, // NEW
          tone: unit.tone,                       // NEW
          themes: unit.themes || [],
          isMultiLine: unit.lines.length > 1
        };
      }
      // If no welcome message found, mark as no longer first selection
      this.isFirstSelection = false;
    }
    
    // Normal selection
    const index = this._pickIndex(mode, themes, emotion, intensity, excludeWelcome);
    if (index === -1) return null;
    
    this._addToBuffer(index);
    const unit = this.data.subtitles[index];
    return {
      lines: unit.lines,
      weights: unit.weights || {},           // Backwards compat
      select_bias: unit.select_bias || {},   // NEW
      reflect_pull: unit.reflect_pull || {}, // NEW
      tone: unit.tone,                       // NEW
      themes: unit.themes || [],
      isMultiLine: unit.lines.length > 1
    };
  }
  
  /**
   * Calculate display time based on emotion and intensity
   */
  getDisplayTime(emotion, intensity) {
    return getEmotionalDisplayTime(emotion, intensity, this.displayMinMs, this.displayMaxMs);
  }
  
  /**
   * Calculate idle time based on emotion and intensity
   */
  getIdleTime(emotion, intensity, baseDisplay) {
    return getEmotionalIdleTime(emotion, intensity, baseDisplay);
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _pickIndexForWelcome(themes, emotion, intensity) {
    const all = this.data.subtitles;
    
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        u.when && u.when.includes('welcome') &&
        !this.recentBuffer.includes(i)
      );
    
    if (candidates.length === 0) return -1;
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _pickIndex(visualMode, themes, emotion, intensity, excludeWelcome) {
    const all = this.data.subtitles;
    const preferredThemes = this._getPreferredThemesForEmotion(emotion);
    const allThemes = [...themes, ...preferredThemes];
    
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        this._whenMatches(u, visualMode) &&
        this._whatMatches(u, visualMode) &&
        this._themeMatches(u, allThemes) &&
        !this.recentBuffer.includes(i) &&
        (!excludeWelcome || !this._isWelcomeText(u))
      );
    
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) =>
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, visualMode) &&
          !this.recentBuffer.includes(i) &&
          (!excludeWelcome || !this._isWelcomeText(u))
        );
    }
    
    if (candidates.length === 0) {
      this.recentBuffer = [];
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => 
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, visualMode) &&
          (!excludeWelcome || !this._isWelcomeText(u))
        );
    }
    
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => !excludeWelcome || !this._isWelcomeText(u));
    }
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _weightedRandom(candidates, emotion, intensity) {
    const total = candidates.reduce((sum, { u }) => {
      // Use select_bias for selection, fallback to weights for backwards compat
      const selectBias = u.select_bias || u.weights || {};
      const rawWeight = selectBias[emotion] || 1.0;
      const effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity;
      return sum + effectiveWeight;
    }, 0);
    
    let r = Math.random() * total;
    for (const { u, i } of candidates) {
      // Use select_bias for selection, fallback to weights for backwards compat
      const selectBias = u.select_bias || u.weights || {};
      const rawWeight = selectBias[emotion] || 1.0;
      const effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity;
      
      r -= effectiveWeight;
      if (r <= 0) return i;
    }
    return candidates[candidates.length - 1].i;
  }
  
  _addToBuffer(index) {
    this.recentBuffer.push(index);
    const effectiveMax = Math.min(
      this.bufferSize,
      Math.floor(this.data.subtitles.length / 2)
    );
    while (this.recentBuffer.length > effectiveMax) {
      this.recentBuffer.shift();
    }
  }
  
  _normaliseMode(mode) {
    return mode.toLowerCase().replace(/\s+\+\s+/g, '+').trim();
  }
  
  _whenMatches(unit, visualMode) {
    if (!unit.when || unit.when.length === 0) return true;
    if (unit.when.includes('any')) return true;
    
    const normalised = this._normaliseMode(visualMode);
    return unit.when.some(w => this._normaliseMode(w) === normalised);
  }
  
  _whatMatches(unit, currentMode) {
    if (!unit.what || unit.what.length === 0) return true;
    if (unit.what.includes('any')) return true;
    
    const normalised = this._normaliseMode(currentMode);
    
    if (normalised === 'welcome') {
      return unit.what.includes('welcome');
    }
    
    const interactiveModes = ['collision', 'ejection', 'stable', 'zoom', 'drag', 'render', 'idle'];
    if (interactiveModes.includes(normalised)) {
      return unit.what.includes(normalised);
    }
    
    return unit.what.some(w => this._normaliseMode(w) === normalised);
  }
  
  _themeMatches(unit, themes) {
    if (!themes || themes.length === 0) return true;
    if (!unit.themes) return false;
    return themes.some(t => unit.themes.includes(t));
  }
  
  _isWelcomeText(unit) {
    if (unit.when && unit.when.includes('welcome')) return true;
    if (unit.modes && unit.modes.includes('welcome')) return true;
    return false;
  }
  
  _getPreferredThemesForEmotion(emotion) {
    const themeMap = {
      'curious': ['mystery', 'discovery'],
      'analytical': ['precision', 'mathematics'],
      'contemplative': ['philosophy', 'meaning'],
      'excited': ['chaos', 'energy'],
      'amused': ['humor', 'irony'],
      'concerned': ['stability', 'boundary'],
      'surprised': ['unexpected', 'paradox'],
      'bored': ['monotony', 'waiting'],
      'neutral': []
    };
    return themeMap[emotion] || [];
  }
}
