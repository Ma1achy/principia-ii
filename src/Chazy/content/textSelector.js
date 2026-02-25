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
      multiplier = 1.5;        // Was 2.0 (too extreme)
      minRange = 1.2;          // Was 1.5
      maxRange = 2.0;          // Was 3.0 (way too high)
      if (intensity < 0.2) multiplier = 2.2;  // Was 3.5 (extreme - caused 30s+ gaps)
      break;
      
    case 'EXCITED':
      multiplier = 0.5;        // Changed from 0.3
      minRange = 0.3;          // Changed from 0.1
      maxRange = 0.8;          // Changed from 0.5
      if (intensity > 0.8) {
        multiplier = 0.35;     // Changed from 0.15
      }
      break;
      
    case 'SURPRISED':
      multiplier = 0.7;        // Changed from 0.5
      minRange = 0.5;          // Changed from 0.3
      maxRange = 0.9;          // Changed from 0.7
      break;
      
    case 'ANALYTICAL':
      multiplier = 1.2;
      minRange = 0.8;
      maxRange = 1.5;
      break;
      
    case 'CONTEMPLATIVE':
      multiplier = 1.5;        // Was 1.8 (too slow)
      minRange = 1.1;          // Was 1.3
      maxRange = 2.0;          // Was 2.5 (too extreme)
      break;
      
    case 'CONCERNED':
      multiplier = 1.0;        // Changed from 0.9
      minRange = 0.7;          // Changed from 0.6
      maxRange = 1.3;          // Changed from 1.2
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
      multiplier = 0.6;        // Increased from 0.5 (was too brief)
      minRange = 0.4;          // Increased from 0.3
      maxRange = 0.8;          // Increased from 0.7
      break;
      
    case 'SURPRISED':
      multiplier = 0.7;        // Increased from 0.6
      minRange = 0.5;          // Increased from 0.4
      maxRange = 0.9;          // Increased from 0.8
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
  
  const calculated = baseDisplay * multiplier * variation * intensityFactor;
  
  // Apply hard bounds to prevent too-brief or too-long displays
  const DISPLAY_MIN = 1500;  // Never less than 1.5s (too brief to read)
  const DISPLAY_MAX = 15000; // Never more than 15s (feels stuck)
  
  return Math.max(DISPLAY_MIN, Math.min(DISPLAY_MAX, calculated));
}

export class TextSelector {
  constructor(linesPath, options = {}) {
    this.linesPath = linesPath;
    this.data = null;
    this.interactionContent = null;  // NEW: For immediate responses
    this.bufferSize = options.bufferSize || 32;
    this.displayMinMs = options.displayMinMs || 2000;
    this.displayMaxMs = options.displayMaxMs || 10000;
    this.multiLineMultiplier = options.multiLineMultiplier || 2.5;
    this.recentBuffer = [];
    this.isFirstSelection = true;
    
    // Template processing regex for \ref{key} or \ref{key|formatter}
    this.templatePattern = /(?<!\\)\\ref\{([^}]+)\}/g;
  }
  
  /**
   * Calculate display time multiplier based on text length
   * Longer text needs more reading time
   */
  _getDisplayLengthMultiplier(textLength) {
    const charCount = textLength || 50;
    
    // Base: 50 chars = 1.0×
    // Scale: +1% per additional 5 chars, up to 2.0× max
    const baseChars = 50;
    const extraChars = Math.max(0, charCount - baseChars);
    const lengthMult = 1.0 + Math.min(1.0, extraChars / 250);  // Max 2.0× at 300 chars
    
    return lengthMult;
  }
  
  async load() {
    // Define all ambient content files (from core/ - non-event-driven musings)
    const files = [
      'core/boundary.json', 
      'core/mathematical.json', 
      'core/existential.json',
      'core/infohazard.json', 
      'core/dark-humor.json', 
      'core/observational.json'
    ];
    
    // Interaction content files
    const interactionFiles = [
      // GUI: Button click events (ASSERTIVE interrupts)
      'interactions/gui/buttons/render/click.json',
      'interactions/gui/buttons/share/click.json',
      'interactions/gui/buttons/save/click.json',
      'interactions/gui/buttons/copy/click.json',
      'interactions/gui/buttons/reset/click.json',
      'interactions/gui/buttons/zero/click.json',
      'interactions/gui/buttons/randomize/click.json',
      'interactions/gui/buttons/reset-tilts/click.json',
      'interactions/gui/buttons/apply-json/click.json',
      'interactions/gui/buttons/download-json/click.json',
      // GUI: Button hesitation events (POLITE interrupts)
      'interactions/gui/buttons/render/hesitation.json',
      'interactions/gui/buttons/share/hesitation.json',
      'interactions/gui/buttons/save/hesitation.json',
      'interactions/gui/buttons/copy/hesitation.json',
      'interactions/gui/buttons/reset/hesitation.json',
      'interactions/gui/buttons/zero/hesitation.json',
      'interactions/gui/buttons/randomize/hesitation.json',
      'interactions/gui/buttons/reset-tilts/hesitation.json',
      'interactions/gui/buttons/apply-json/hesitation.json',
      'interactions/gui/buttons/download-json/hesitation.json',
      // GUI: Select dropdowns
      'interactions/gui/selects/render-mode/hover.json',
      'interactions/gui/selects/render-mode/changed.json',
      'interactions/gui/selects/resolution/hover.json',
      'interactions/gui/selects/resolution/changed.json',
      // GUI: Sliders - Specific slider files (checked BEFORE generic)
      'interactions/gui/sliders/horizon/changed.json',
      'interactions/gui/sliders/max-steps/changed.json',
      'interactions/gui/sliders/dt-macro/changed.json',
      'interactions/gui/sliders/r-coll/changed.json',
      'interactions/gui/sliders/r-esc/changed.json',
      'interactions/gui/sliders/tilt-gamma/changed.json',
      'interactions/gui/sliders/tilt-q1/changed.json',
      'interactions/gui/sliders/tilt-q2/changed.json',
      // GUI: Sliders - Generic (fallback for all other sliders)
      'interactions/gui/sliders/generic/hover.json',
      'interactions/gui/sliders/generic/changed.json',
      // Lifecycle events
      'interactions/lifecycle/welcome.json',
      'interactions/lifecycle/idle.json',
      // Physics events
      'interactions/physics/collision.json',
      'interactions/physics/ejection.json',
      'interactions/physics/stable.json',
      // Navigation events
      'interactions/navigation/drag.json',
      'interactions/navigation/zoom.json',
      // Rendering events
      'interactions/rendering/render.json',
      // Pattern detection (behavioral patterns)
      'interactions/patterns/slider-exploration.json',
      'interactions/patterns/preset-browsing.json',
      // Fallback for unmatched events
      'interactions/generic-fallback.json',
    ];
    
    // Load all files in parallel
    const basePath = this.linesPath;
    
    // Defensive check on basePath
    if (!basePath || typeof basePath !== 'string') {
      console.error('[TextSelector] Invalid linesPath');
      return;
    }
    
    const promises = files.map(f => 
      fetch(basePath + f, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
        })
        .catch(err => {
          console.warn(`[TextSelector] Failed to load ${f}:`, err);
          return { lines: [] }; // Graceful fallback
        })
    );
    
    // Load interaction content (gracefully fail if not present)
    const interactionPromises = interactionFiles.map(f =>
      fetch(basePath + f, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
        })
        .catch(err => {
          // Silently ignore - these files don't exist until Phase 5
          return null;
        })
    );
    
    const allData = await Promise.all(promises);
    const allInteractionData = await Promise.all(interactionPromises);
    
    // Clear/initialize pools
    this.welcomeEntries = [];
    this.ambientEntries = [];
    this.interactionContent = [];
    
    // Reconstruct original structure for backwards compatibility
    this.data = {
      _schema: "principia-flavour_v2_emotional",
      subtitles: []  // Will be set to ambientEntries at the end
    };
    
    // Helper to normalize wildcard ("*" -> "any")
    const normalizeWildcard = (val) => val === '*' ? 'any' : val;
    
    for (const fileData of allData) {
      // Defensive check on fileData
      if (!fileData || typeof fileData !== 'object') {
        console.warn('[TextSelector] Skipping invalid fileData');
        continue;
      }
      
      const context = fileData._context || {};
      const defaultWhen = (context.when || ['any']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      // Add context back to each entry
      for (const entry of fileData.lines || []) {
        // Defensive check on entry
        if (!entry || typeof entry !== 'object') {
          console.warn('[TextSelector] Skipping invalid entry in fileData');
          continue;
        }
        
        // Get entry's when array (use entry's when if present, otherwise use file context)
        const entryWhen = (entry.when || defaultWhen).map(normalizeWildcard);
        
        // CRITICAL: Skip welcome entries in core files (welcome should only be in welcome.json)
        if (entryWhen.some(w => w === 'welcome')) {
          console.warn('[TextSelector] Skipping welcome entry in core file (should be in welcome.json)');
          continue;
        }
        
        // Add to ambient pool (core files)
        this.ambientEntries.push({
          // Backwards compatible: keep weights field
          weights: entry.weights || {},
          themes: entry.themes || [],
          lines: entry.lines || [],
          // Use entry's when/what if present, otherwise use file context
          when: entryWhen,
          what: (entry.what || defaultWhat).map(normalizeWildcard),
          
          // NEW FIELDS (v3 schema)
          select_bias: entry.select_bias || {},
          reflect_pull: entry.reflect_pull || {},
          tone: entry.tone || 'neutral'
        });
      }
    }
    
    // Separate content into three pools for clean logic
    
    // 1. WELCOME POOL: Only welcome.json entries
    const welcomeFile = allInteractionData.find(f => f?._file === 'welcome');
    if (welcomeFile && welcomeFile.lines) {
      const context = welcomeFile._context || {};
      const defaultWhen = (context.when || ['welcome']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      for (const entry of welcomeFile.lines) {
        this.welcomeEntries.push({
          weights: entry.weights || {},
          themes: entry.themes || [],
          lines: entry.lines || [],
          when: (entry.when || defaultWhen).map(normalizeWildcard),
          what: (entry.what || defaultWhat).map(normalizeWildcard),
          select_bias: entry.select_bias || {},
          reflect_pull: entry.reflect_pull || {},
          tone: entry.tone || 'neutral'
        });
      }
    }
    
    // 2. AMBIENT POOL: Core files + idle.json only (welcome entries already filtered out)
    const idleFile = allInteractionData.find(f => f?._file === 'idle');
    if (idleFile && idleFile.lines) {
      const context = idleFile._context || {};
      const defaultWhen = (context.when || ['any']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      for (const entry of idleFile.lines) {
        // Get entry's when array
        const entryWhen = (entry.when || defaultWhen).map(normalizeWildcard);
        
        // CRITICAL: Skip welcome entries in idle.json (welcome should only be in welcome.json)
        if (entryWhen.some(w => w === 'welcome')) {
          console.warn('[TextSelector] Skipping welcome entry in idle.json (should be in welcome.json)');
          continue;
        }
        
        this.ambientEntries.push({
          weights: entry.weights || {},
          themes: entry.themes || [],
          lines: entry.lines || [],
          when: entryWhen,
          what: (entry.what || defaultWhat).map(normalizeWildcard),
          select_bias: entry.select_bias || {},
          reflect_pull: entry.reflect_pull || {},
          tone: entry.tone || 'neutral'
        });
      }
    }
    
    // 3. INTERACTION POOL: All interaction files for event matching
    this.interactionContent = allInteractionData.filter(data => data !== null);
    
    // Legacy: Point data.subtitles to ambientEntries for backwards compatibility
    this.data.subtitles = this.ambientEntries;
    
    console.log(`[TextSelector] Loaded ${this.welcomeEntries.length} welcome entries`);
    console.log(`[TextSelector] Loaded ${this.ambientEntries.length} ambient entries (${files.length} core + idle)`);
    console.log(`[TextSelector] Loaded ${this.interactionContent.length} interaction files for event matching`);
    return this;
  }
  
  /**
   * Select a text unit based on current context
   * @param {Object} context - { mode, themes, emotion, intensity, excludeWelcome }
   * @returns {Object|null} - { lines, weights, select_bias, reflect_pull, tone, themes, isMultiLine } or null
   */
  select(context) {
    // Defensive null checks
    if (!context || typeof context !== 'object') {
      console.error('[TextSelector] Invalid context in select');
      return null;
    }
    
    const { mode, themes = [], emotion, intensity, excludeWelcome = false, stateRefs = {} } = context;
    
    // Validate required parameters
    if (!mode || typeof mode !== 'string') {
      console.error('[TextSelector] Invalid or missing mode in select');
      return null;
    }
    
    if (!emotion || typeof emotion !== 'string') {
      console.error('[TextSelector] Invalid or missing emotion in select');
      return null;
    }
    
    // Validate data structure
    if (!this.data || !this.data.subtitles || !Array.isArray(this.data.subtitles)) {
      console.error('[TextSelector] Invalid data structure - subtitles not loaded');
      return null;
    }
    
    try {
      // Handle welcome text on first selection (when mode is 'welcome')
      if (this.isFirstSelection && mode === 'welcome') {
        const welcomeIndex = this._pickIndexForWelcome(themes, emotion, intensity);
        if (welcomeIndex !== -1) {
          this.isFirstSelection = false;
          const unit = this.welcomeEntries[welcomeIndex];
          
          // Defensive check on unit
          if (!unit || !unit.lines || !Array.isArray(unit.lines)) {
            console.error('[TextSelector] Invalid welcome unit at index', welcomeIndex);
            return null;
          }
          
          // Process templates in welcome lines
          const processedLines = unit.lines.map(line => this._processTemplate(line, stateRefs));
          
          return {
            lines: processedLines,
            weights: unit.weights || {},           // Backwards compat
            select_bias: unit.select_bias || {},   // NEW
            reflect_pull: unit.reflect_pull || {}, // NEW
            tone: unit.tone || 'neutral',          // NEW
            themes: unit.themes || [],
            isMultiLine: unit.lines.length > 1
          };
        }
        // If no welcome message found, mark as no longer first selection
        this.isFirstSelection = false;
      }
      
      // Normal ambient selection (uses ambientEntries via data.subtitles)
      const index = this._pickIndex(mode, themes, emotion, intensity);
      if (index === -1) {
        console.warn('[TextSelector] No suitable text found for mode:', mode);
        return null;
      }
      
      this._addToBuffer(index);
      const unit = this.data.subtitles[index];
      
      // Defensive check on unit
      if (!unit || !unit.lines || !Array.isArray(unit.lines)) {
        console.error('[TextSelector] Invalid unit at index', index);
        return null;
      }
      
      // Process templates in ambient lines
      const processedLines = unit.lines.map(line => this._processTemplate(line, stateRefs));
      
      return {
        lines: processedLines,
        weights: unit.weights || {},           // Backwards compat
        select_bias: unit.select_bias || {},   // NEW
        reflect_pull: unit.reflect_pull || {}, // NEW
        tone: unit.tone || 'neutral',          // NEW
        themes: unit.themes || [],
        isMultiLine: unit.lines.length > 1
      };
    } catch (error) {
      console.error('[TextSelector] Error in select:', error);
      return null;
    }
  }
  
  /**
   * Calculate display time based on emotion and intensity
   * @param {string} emotion - Current emotion
   * @param {number} intensity - Emotion intensity
   * @param {number} textLength - Length of text to display (for length-aware scaling)
   */
  getDisplayTime(emotion, intensity, textLength) {
    const baseDisplay = getEmotionalDisplayTime(emotion, intensity, this.displayMinMs, this.displayMaxMs);
    
    // If textLength provided, apply length multiplier
    if (textLength) {
      const lengthMult = this._getDisplayLengthMultiplier(textLength);
      return baseDisplay * lengthMult;
    }
    
    return baseDisplay;
  }
  
  /**
   * Calculate idle time based on emotion and intensity
   */
  getIdleTime(emotion, intensity, baseDisplay) {
    return getEmotionalIdleTime(emotion, intensity, baseDisplay);
  }
  
  /**
   * Process template references in text
   * CRITICAL: Must handle BOTH string lines AND object lines with .t property
   * 
   * @param {string|Object} line - Line text OR object with .t property
   * @param {Object} stateRefs - State reference object
   * @returns {string|Object} Processed text (same type as input)
   */
  _processTemplate(line, stateRefs) {
    try {
      // Handle object lines with .t property (from _showLines in Orchestrator)
      if (typeof line === 'object' && line !== null && line.t) {
        return {
          ...line,
          t: this._processTemplateString(line.t, stateRefs)
        };
      }
      
      // Handle plain string lines
      if (typeof line === 'string') {
        return this._processTemplateString(line, stateRefs);
      }
      
      // Passthrough for null/undefined/other types
      return line;
    } catch (error) {
      console.error('[TextSelector] Error in _processTemplate:', error, 'Line:', line);
      // Return original line on error
      return line;
    }
  }
  
  /**
   * Process template string (extracted for DRY)
   * @param {string} text - Text with \ref{key} or \ref{key|formatter} templates
   * @param {Object} stateRefs - State reference object
   * @returns {string} Processed text with refs replaced
   */
  _processTemplateString(text, stateRefs) {
    if (!text || typeof text !== 'string') return text || '';
    if (!stateRefs || typeof stateRefs !== 'object') return text;
    
    try {
      // Replace \ref{key} or \ref{key|formatter} with actual values
      let result = text.replace(this.templatePattern, (match, content) => {
        try {
          const [key, formatter] = content.split('|').map(s => s.trim());
          
          const value = stateRefs[key];
          if (value === undefined || value === null) {
            console.warn(`[TextSelector] Unknown state reference: ${key}`);
            return '?';
          }
          
          // Apply formatter if provided
          if (formatter) {
            return this._formatValue(value, formatter);
          }
          
          return String(value);
        } catch (error) {
          console.error('[TextSelector] Error processing template ref:', error);
          return '?';
        }
      });
      
      // Unescape escaped refs (\\ref{} → \ref{})
      result = result.replace(/\\\\ref\{/g, '\\ref{');
      
      return result;
    } catch (error) {
      console.error('[TextSelector] Error in _processTemplateString:', error);
      return text;
    }
  }
  
  /**
   * Apply formatter to value
   * @param {any} value - Value to format
   * @param {string} formatter - Formatter name (int, fixed2, etc.)
   * @returns {any} Formatted value
   */
  _formatValue(value, formatter) {
    switch (formatter) {
      case 'int':
        return Math.round(Number(value));
      case 'fixed1':
        return Number(value).toFixed(1);
      case 'fixed2':
        return Number(value).toFixed(2);
      case 'fixed3':
        return Number(value).toFixed(3);
      case 'fixed4':
        return Number(value).toFixed(4);
      case 'sci':
        return Number(value).toExponential(2);
      case 'percent':
        return (Number(value) * 100).toFixed(0) + '%';
      case 'upper':
        return String(value).toUpperCase();
      case 'lower':
        return String(value).toLowerCase();
      default:
        console.warn(`[TextSelector] Unknown formatter: ${formatter}`);
        return String(value);
    }
  }
  
  /**
   * Select immediate response text based on event
   * @param {Object} context - { event, emotion, intensity, button?, data? }
   * @returns {Object|null} - { lines, tone, themes } or null
   */
  selectImmediate(context) {
    const { event, emotion, intensity, button, slider, select, data = {}, stateRefs = {} } = context;
    
    if (!this.interactionContent) {
      return null;
    }
    
    // Find matching file by _context
    let matchingFile = this.interactionContent.find(file => {
      if (!file._context) return false;
      
      // Check event match
      if (file._context.event && file._context.event !== '*' && file._context.event !== event) {
        return false;
      }
      
      // Check button match (if applicable) - supports wildcards
      if (button && file._context.button && file._context.button !== '*' && file._context.button !== button) {
        return false;
      }
      
      // Check slider match (if applicable) - supports wildcards
      if (slider && file._context.slider && file._context.slider !== '*' && file._context.slider !== slider) {
        return false;
      }
      
      // Check select match (if applicable) - supports wildcards
      if (select && file._context.select && file._context.select !== '*' && file._context.select !== select) {
        return false;
      }
      
      return true;
    });
    
    // Fallback to generic fallback file
    if (!matchingFile) {
      matchingFile = this.interactionContent.find(file => file._context?.event === '*');
    }
    
    if (!matchingFile || !matchingFile.lines || matchingFile.lines.length === 0) {
      console.error('[TextSelector] No matching file found for event:', event, 'with detail:', detail);
      return null;
    }
    
    console.log(`[TextSelector] Found matching file: ${matchingFile._file} with ${matchingFile.lines.length} entries`);
    
    // Now select from the entries using emotional bias
    const candidates = matchingFile.lines.map(entry => {
      // Defensive null checks
      if (!entry || typeof entry !== 'object') {
        return { entry: null, weight: 0 };
      }
      const bias = entry.select_bias?.[emotion.toLowerCase()] || 1.0;
      return { entry, weight: Math.max(0, bias) }; // Ensure non-negative weight
    }).filter(c => c.entry !== null && c.weight > 0); // Filter out invalid entries
    
    if (candidates.length === 0) {
      console.error('[TextSelector] No valid candidates after filtering');
      return null;
    }
    
    // Weighted random selection
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    
    if (totalWeight <= 0) {
      console.error('[TextSelector] Total weight is zero or negative');
      return null;
    }
    
    let random = Math.random() * totalWeight;
    
    for (const { entry, weight } of candidates) {
      random -= weight;
      if (random <= 0) {
        // Defensive check on entry.lines
        if (!entry.lines || !Array.isArray(entry.lines) || entry.lines.length === 0) {
          console.error('[TextSelector] Selected entry has invalid lines');
          continue; // Try next candidate
        }
        
        console.log(`[TextSelector] Selected entry with ${entry.lines.length} lines (tone: ${entry.tone})`);
        
        // Process templates in selected lines
        try {
          const processedLines = entry.lines.map(line => this._processTemplate(line, stateRefs));
          
          return {
            lines: processedLines,  // Return processed lines
            tone: entry.tone || 'neutral',
            themes: entry.themes || [],
            select_bias: entry.select_bias || {},
            reflect_pull: entry.reflect_pull || {}
          };
        } catch (error) {
          console.error('[TextSelector] Error processing templates:', error);
          continue; // Try next candidate
        }
      }
    }
    
    // Fallback to first candidate
    const firstCandidate = candidates[0];
    if (!firstCandidate || !firstCandidate.entry) {
      console.error('[TextSelector] No valid first candidate');
      return null;
    }
    
    const entry = firstCandidate.entry;
    
    // Defensive check on fallback entry.lines
    if (!entry.lines || !Array.isArray(entry.lines) || entry.lines.length === 0) {
      console.error('[TextSelector] Fallback entry has invalid lines');
      return null;
    }
    
    // Process templates in fallback lines
    try {
      const processedLines = entry.lines.map(line => this._processTemplate(line, stateRefs));
      
      return {
        lines: processedLines,  // Return processed lines
        tone: entry.tone || 'neutral',
        themes: entry.themes || [],
        select_bias: entry.select_bias || {},
        reflect_pull: entry.reflect_pull || {}
      };
    } catch (error) {
      console.error('[TextSelector] Error processing fallback templates:', error);
      return null;
    }
  }
  
  // ─── Internal ──────────────────────────────────────────────────────────────
  
  _pickIndexForWelcome(themes, emotion, intensity) {
    // Select from welcome pool only
    const preferredThemes = this._getPreferredThemesForEmotion(emotion);
    const allThemes = [...themes, ...preferredThemes];
    
    let candidates = this.welcomeEntries
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => this._themeMatches(u, allThemes));
    
    if (candidates.length === 0) {
      // Fallback: any welcome entry
      candidates = this.welcomeEntries.map((u, i) => ({ u, i }));
    }
    
    if (candidates.length === 0) return -1;
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _pickIndex(visualMode, themes, emotion, intensity) {
    // Select from ambient pool only (no welcome, no excludeWelcome needed)
    const all = this.data.subtitles;  // Points to ambientEntries
    const preferredThemes = this._getPreferredThemesForEmotion(emotion);
    const allThemes = [...themes, ...preferredThemes];
    
    let candidates = all
      .map((u, i) => ({ u, i }))
      .filter(({ u, i }) =>
        this._whenMatches(u, visualMode) &&
        this._whatMatches(u, visualMode) &&
        this._themeMatches(u, allThemes) &&
        !this.recentBuffer.includes(i)
      );
    
    if (candidates.length === 0) {
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) =>
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, visualMode) &&
          !this.recentBuffer.includes(i)
        );
    }
    
    if (candidates.length === 0) {
      this.recentBuffer = [];
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => 
          this._whenMatches(u, visualMode) &&
          this._whatMatches(u, visualMode)
        );
    }
    
    if (candidates.length === 0) {
      candidates = all.map((u, i) => ({ u, i }));
    }
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _weightedRandom(candidates, emotion, intensity) {
    // Defensive null checks
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      console.error('[TextSelector] Invalid or empty candidates array in _weightedRandom');
      return -1;
    }
    
    if (!emotion || typeof emotion !== 'string') {
      console.warn('[TextSelector] Invalid emotion in _weightedRandom, defaulting to "neutral"');
      emotion = 'neutral';
    }
    
    // Clamp intensity to valid range
    intensity = Math.max(0, Math.min(1, intensity || 0.5));
    
    try {
      const total = candidates.reduce((sum, { u }) => {
        if (!u || typeof u !== 'object') return sum; // Skip invalid entries
        
        // Use select_bias for selection, fallback to weights for backwards compat
        const selectBias = u.select_bias || u.weights || {};
        const rawWeight = selectBias[emotion] || 1.0;
        const effectiveWeight = Math.max(0, 1.0 + (rawWeight - 1.0) * intensity); // Ensure non-negative
        return sum + effectiveWeight;
      }, 0);
      
      if (total <= 0) {
        console.error('[TextSelector] Total weight is zero or negative in _weightedRandom');
        return candidates[0]?.i ?? -1;
      }
      
      let r = Math.random() * total;
      for (const { u, i } of candidates) {
        if (!u || typeof u !== 'object' || typeof i !== 'number') continue; // Skip invalid entries
        
        // Use select_bias for selection, fallback to weights for backwards compat
        const selectBias = u.select_bias || u.weights || {};
        const rawWeight = selectBias[emotion] || 1.0;
        const effectiveWeight = Math.max(0, 1.0 + (rawWeight - 1.0) * intensity);
        
        r -= effectiveWeight;
        if (r <= 0) return i;
      }
      
      // Fallback to last candidate
      const lastCandidate = candidates[candidates.length - 1];
      return lastCandidate?.i ?? -1;
    } catch (error) {
      console.error('[TextSelector] Error in _weightedRandom:', error);
      return candidates[0]?.i ?? -1;
    }
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
    if (!mode || typeof mode !== 'string') {
      console.warn('[TextSelector] Invalid mode in _normaliseMode:', mode);
      return 'any';
    }
    return mode.toLowerCase().replace(/\s+\+\s+/g, '+').trim();
  }
  
  _whenMatches(unit, visualMode) {
    if (!unit || typeof unit !== 'object') return false;
    if (!unit.when || unit.when.length === 0) return true;
    if (unit.when.includes('any')) return true;
    
    const normalised = this._normaliseMode(visualMode);
    return unit.when.some(w => this._normaliseMode(w) === normalised);
  }
  
  _whatMatches(unit, currentMode) {
    if (!unit || typeof unit !== 'object') return false;
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
    if (!unit || typeof unit !== 'object') return false;
    if (!themes || !Array.isArray(themes) || themes.length === 0) return true;
    if (!unit.themes || !Array.isArray(unit.themes)) return false;
    return themes.some(t => unit.themes.includes(t));
  }
  
  _isWelcomeText(unit) {
    if (!unit || typeof unit !== 'object') return false;
    if (unit.when && Array.isArray(unit.when) && unit.when.includes('welcome')) return true;
    if (unit.modes && Array.isArray(unit.modes) && unit.modes.includes('welcome')) return true;
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
