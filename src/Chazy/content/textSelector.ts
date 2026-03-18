/**
 * TextSelector - Contextual text selection with emotional weighting
 * 
 * Extracted from flavourText.js to create a pure text selection module.
 * Handles weighted selection, recency buffer, and emotional timing calculations.
 */

import type { StateReferences } from './stateReferences.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface TextEntry {
  weights?: Record<string, number>;
  themes: string[];
  lines: Array<string | { t: string; [key: string]: any }>;
  when: string[];
  what: string[];
  select_bias?: Record<string, number>;
  reflect_pull?: Record<string, number>;
  tone?: string;
}

interface FileData {
  _schema?: string;
  _file?: string;
  _context?: {
    event?: string;
    button?: string;
    slider?: string;
    select?: string;
    when?: string[];
    what?: string[];
  };
  lines?: TextEntry[];
  subtitles?: TextEntry[];
}

interface SelectContext {
  mode: string;
  themes?: string[];
  emotion: string;
  intensity: number;
  excludeWelcome?: boolean;
  stateRefs?: Partial<StateReferences>;
}

interface SelectImmediateContext {
  event: string;
  emotion: string;
  intensity: number;
  button?: string;
  slider?: string;
  select?: string;
  data?: any;
  stateRefs?: Partial<StateReferences>;
}

interface SelectResult {
  lines: Array<string | { t: string; [key: string]: any }>;
  weights: Record<string, number>;
  select_bias: Record<string, number>;
  reflect_pull: Record<string, number>;
  tone: string;
  themes: string[];
  isMultiLine: boolean;
}

interface TextSelectorOptions {
  bufferSize?: number;
  displayMinMs?: number;
  displayMaxMs?: number;
  multiLineMultiplier?: number;
}

// ─── Emotional Timing Functions ────────────────────────────────────────────

function getEmotionalIdleTime(emotion: string, intensity: number, baseDisplayTime: number): number {
  let multiplier = 1.0;
  let minRange = 0.8;
  let maxRange = 1.2;
  
  switch(emotion.toUpperCase()) {
    case 'BORED':
      multiplier = 1.5;
      minRange = 1.2;
      maxRange = 2.0;
      if (intensity < 0.2) multiplier = 2.2;
      break;
      
    case 'EXCITED':
      multiplier = 0.8;
      minRange = 0.6;
      maxRange = 1.0;
      if (intensity > 0.8) {
        multiplier = 0.7;
      }
      break;
      
    case 'SURPRISED':
      multiplier = 0.85;
      minRange = 0.7;
      maxRange = 1.0;
      break;
      
    case 'ANALYTICAL':
      multiplier = 1.2;
      minRange = 0.8;
      maxRange = 1.5;
      break;
      
    case 'CONTEMPLATIVE':
      multiplier = 1.5;
      minRange = 1.1;
      maxRange = 2.0;
      break;
      
    case 'CONCERNED':
      multiplier = 1.0;
      minRange = 0.7;
      maxRange = 1.3;
      break;
      
    case 'AMUSED':
      multiplier = 1.0;
      minRange = 0.7;
      maxRange = 1.3;
      break;
      
    case 'CURIOUS':
      multiplier = 0.95;
      minRange = 0.7;
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

function getEmotionalDisplayTime(emotion: string, intensity: number, baseMin: number, baseMax: number): number {
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
      multiplier = 0.6;
      minRange = 0.4;
      maxRange = 0.8;
      break;
      
    case 'SURPRISED':
      multiplier = 0.7;
      minRange = 0.5;
      maxRange = 0.9;
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
  
  const DISPLAY_MIN = 1500;
  const DISPLAY_MAX = 15000;
  
  return Math.max(DISPLAY_MIN, Math.min(DISPLAY_MAX, calculated));
}

// ─── TextSelector Class ────────────────────────────────────────────────────

export class TextSelector {
  linesPath: string;
  data: FileData | null = null;
  interactionContent: FileData[] | null = null;
  bufferSize: number;
  displayMinMs: number;
  displayMaxMs: number;
  multiLineMultiplier: number;
  recentBuffer: number[] = [];
  isFirstSelection: boolean = true;
  templatePattern: RegExp;
  welcomeEntries: TextEntry[] = [];
  ambientEntries: TextEntry[] = [];
  
  constructor(linesPath: string, options: TextSelectorOptions = {}) {
    this.linesPath = linesPath;
    this.bufferSize = options.bufferSize || 32;
    this.displayMinMs = options.displayMinMs || 2000;
    this.displayMaxMs = options.displayMaxMs || 10000;
    this.multiLineMultiplier = options.multiLineMultiplier || 2.5;
    this.templatePattern = /(?<!\\)\\ref\{([^}]+)\}/g;
  }
  
  _getDisplayLengthMultiplier(textLength: number): number {
    const charCount = textLength || 50;
    const baseChars = 50;
    const extraChars = Math.max(0, charCount - baseChars);
    const lengthMult = 1.0 + Math.min(1.0, extraChars / 250);
    return lengthMult;
  }
  
  async load(): Promise<this> {
    const files = [
      'core/boundary.json', 
      'core/mathematical.json', 
      'core/existential.json',
      'core/infohazard.json', 
      'core/dark-humor.json', 
      'core/observational.json'
    ];
    
    const interactionFiles = [
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
      'interactions/gui/selects/render-mode/hover.json',
      'interactions/gui/selects/render-mode/changed.json',
      'interactions/gui/selects/resolution/hover.json',
      'interactions/gui/selects/resolution/changed.json',
      'interactions/gui/sliders/horizon/changed.json',
      'interactions/gui/sliders/max-steps/changed.json',
      'interactions/gui/sliders/dt-macro/changed.json',
      'interactions/gui/sliders/r-coll/changed.json',
      'interactions/gui/sliders/r-esc/changed.json',
      'interactions/gui/sliders/tilt-gamma/changed.json',
      'interactions/gui/sliders/tilt-q1/changed.json',
      'interactions/gui/sliders/tilt-q2/changed.json',
      'interactions/gui/sliders/generic/hover.json',
      'interactions/gui/sliders/generic/changed.json',
      'interactions/lifecycle/welcome.json',
      'interactions/lifecycle/idle.json',
      'interactions/physics/collision.json',
      'interactions/physics/ejection.json',
      'interactions/physics/stable.json',
      'interactions/navigation/drag.json',
      'interactions/navigation/zoom.json',
      'interactions/rendering/render.json',
      'interactions/patterns/slider-exploration.json',
      'interactions/patterns/preset-browsing.json',
      'interactions/generic-fallback.json',
    ];
    
    const basePath = this.linesPath;
    
    if (!basePath || typeof basePath !== 'string') {
      console.error('[TextSelector] Invalid linesPath');
      return this;
    }
    
    const promises = files.map(f => 
      fetch(basePath + f, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
        })
        .catch(err => {
          console.warn(`[TextSelector] Failed to load ${f}:`, err);
          return { lines: [] };
        })
    );
    
    const interactionPromises = interactionFiles.map(f =>
      fetch(basePath + f, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
        })
        .catch(err => {
          return null;
        })
    );
    
    const allData = await Promise.all(promises);
    const allInteractionData = await Promise.all(interactionPromises);
    
    this.welcomeEntries = [];
    this.ambientEntries = [];
    this.interactionContent = [];
    
    this.data = {
      _schema: "principia-flavour_v2_emotional",
      subtitles: []
    };
    
    const normalizeWildcard = (val: string): string => val === '*' ? 'any' : val;
    
    for (const fileData of allData) {
      if (!fileData || typeof fileData !== 'object') {
        console.warn('[TextSelector] Skipping invalid fileData');
        continue;
      }
      
      const context = fileData._context || {};
      const defaultWhen = (context.when || ['any']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      for (const entry of fileData.lines || []) {
        if (!entry || typeof entry !== 'object') {
          console.warn('[TextSelector] Skipping invalid entry in fileData');
          continue;
        }
        
        const entryWhen = (entry.when || defaultWhen).map(normalizeWildcard);
        
        if (entryWhen.some(w => w === 'welcome')) {
          console.warn('[TextSelector] Skipping welcome entry in core file (should be in welcome.json)');
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
    
    const idleFile = allInteractionData.find(f => f?._file === 'idle');
    if (idleFile && idleFile.lines) {
      const context = idleFile._context || {};
      const defaultWhen = (context.when || ['any']).map(normalizeWildcard);
      const defaultWhat = (context.what || ['any']).map(normalizeWildcard);
      
      for (const entry of idleFile.lines) {
        const entryWhen = (entry.when || defaultWhen).map(normalizeWildcard);
        
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
    
    this.interactionContent = allInteractionData.filter((data): data is FileData => data !== null);
    this.data.subtitles = this.ambientEntries;
    
    console.log(`[TextSelector] Loaded ${this.welcomeEntries.length} welcome entries`);
    console.log(`[TextSelector] Loaded ${this.ambientEntries.length} ambient entries (${files.length} core + idle)`);
    console.log(`[TextSelector] Loaded ${this.interactionContent.length} interaction files for event matching`);
    return this;
  }
  
  select(context: SelectContext): SelectResult | null {
    if (!context || typeof context !== 'object') {
      console.error('[TextSelector] Invalid context in select');
      return null;
    }
    
    const { mode, themes = [], emotion, intensity, excludeWelcome = false, stateRefs = {} } = context;
    
    if (!mode || typeof mode !== 'string') {
      console.error('[TextSelector] Invalid or missing mode in select');
      return null;
    }
    
    if (!emotion || typeof emotion !== 'string') {
      console.error('[TextSelector] Invalid or missing emotion in select');
      return null;
    }
    
    if (!this.data || !this.data.subtitles || !Array.isArray(this.data.subtitles)) {
      console.error('[TextSelector] Invalid data structure - subtitles not loaded');
      return null;
    }
    
    try {
      if (this.isFirstSelection && mode === 'welcome') {
        const welcomeIndex = this._pickIndexForWelcome(themes, emotion, intensity);
        if (welcomeIndex !== -1) {
          this.isFirstSelection = false;
          const unit = this.welcomeEntries[welcomeIndex];
          
          if (!unit || !unit.lines || !Array.isArray(unit.lines)) {
            console.error('[TextSelector] Invalid welcome unit at index', welcomeIndex);
            return null;
          }
          
          const processedLines = unit.lines.map(line => this._processTemplate(line, stateRefs));
          
          return {
            lines: processedLines,
            weights: unit.weights || {},
            select_bias: unit.select_bias || {},
            reflect_pull: unit.reflect_pull || {},
            tone: unit.tone || 'neutral',
            themes: unit.themes || [],
            isMultiLine: unit.lines.length > 1
          };
        }
        this.isFirstSelection = false;
      }
      
      const index = this._pickIndex(mode, themes, emotion, intensity);
      if (index === -1) {
        console.warn('[TextSelector] No suitable text found for mode:', mode);
        return null;
      }
      
      this._addToBuffer(index);
      const unit = this.data.subtitles[index];
      
      if (!unit || !unit.lines || !Array.isArray(unit.lines)) {
        console.error('[TextSelector] Invalid unit at index', index);
        return null;
      }
      
      const processedLines = unit.lines.map(line => this._processTemplate(line, stateRefs));
      
      return {
        lines: processedLines,
        weights: unit.weights || {},
        select_bias: unit.select_bias || {},
        reflect_pull: unit.reflect_pull || {},
        tone: unit.tone || 'neutral',
        themes: unit.themes || [],
        isMultiLine: unit.lines.length > 1
      };
    } catch (error) {
      console.error('[TextSelector] Error in select:', error);
      return null;
    }
  }
  
  getDisplayTime(emotion: string, intensity: number, textLength?: number): number {
    const baseDisplay = getEmotionalDisplayTime(emotion, intensity, this.displayMinMs, this.displayMaxMs);
    
    if (textLength) {
      const lengthMult = this._getDisplayLengthMultiplier(textLength);
      return baseDisplay * lengthMult;
    }
    
    return baseDisplay;
  }
  
  getIdleTime(emotion: string, intensity: number, baseDisplay: number): number {
    return getEmotionalIdleTime(emotion, intensity, baseDisplay);
  }
  
  _processTemplate(line: string | { t: string; [key: string]: any }, stateRefs: Partial<StateReferences>): string | { t: string; [key: string]: any } {
    try {
      if (typeof line === 'object' && line !== null && line.t) {
        return {
          ...line,
          t: this._processTemplateString(line.t, stateRefs)
        };
      }
      
      if (typeof line === 'string') {
        return this._processTemplateString(line, stateRefs);
      }
      
      return line;
    } catch (error) {
      console.error('[TextSelector] Error in _processTemplate:', error, 'Line:', line);
      return line;
    }
  }
  
  _processTemplateString(text: string, stateRefs: Partial<StateReferences>): string {
    if (!text || typeof text !== 'string') return text || '';
    if (!stateRefs || typeof stateRefs !== 'object') return text;
    
    try {
      let result = text.replace(this.templatePattern, (match, content) => {
        try {
          const [key, formatter] = content.split('|').map((s: string) => s.trim());
          
          const value = (stateRefs as any)[key];
          if (value === undefined || value === null) {
            console.warn(`[TextSelector] Unknown state reference: ${key}`);
            return '?';
          }
          
          if (formatter) {
            return this._formatValue(value, formatter);
          }
          
          return String(value);
        } catch (error) {
          console.error('[TextSelector] Error processing template ref:', error);
          return '?';
        }
      });
      
      result = result.replace(/\\\\ref\{/g, '\\ref{');
      
      return result;
    } catch (error) {
      console.error('[TextSelector] Error in _processTemplateString:', error);
      return text;
    }
  }
  
  _formatValue(value: any, formatter: string): string {
    switch (formatter) {
      case 'int':
        return String(Math.round(Number(value)));
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
  
  selectImmediate(context: SelectImmediateContext): Omit<SelectResult, 'weights' | 'isMultiLine'> | null {
    const { event, emotion, intensity, button, slider, select, data = {}, stateRefs = {} } = context;
    
    if (!this.interactionContent) {
      return null;
    }
    
    let matchingFile = this.interactionContent.find(file => {
      if (!file._context) return false;
      
      if (file._context.event && file._context.event !== '*' && file._context.event !== event) {
        return false;
      }
      
      if (button && file._context.button && file._context.button !== '*' && file._context.button !== button) {
        return false;
      }
      
      if (slider && file._context.slider && file._context.slider !== '*' && file._context.slider !== slider) {
        return false;
      }
      
      if (select && file._context.select && file._context.select !== '*' && file._context.select !== select) {
        return false;
      }
      
      return true;
    });
    
    if (!matchingFile) {
      matchingFile = this.interactionContent.find(file => file._context?.event === '*');
    }
    
    if (!matchingFile || !matchingFile.lines || matchingFile.lines.length === 0) {
      console.error('[TextSelector] No matching file found for event:', event);
      return null;
    }
    
    console.log(`[TextSelector] Found matching file: ${matchingFile._file} with ${matchingFile.lines.length} entries`);
    
    const candidates = matchingFile.lines.map(entry => {
      if (!entry || typeof entry !== 'object') {
        return { entry: null, weight: 0 };
      }
      const bias = entry.select_bias?.[emotion.toLowerCase()] || 1.0;
      return { entry, weight: Math.max(0, bias) };
    }).filter(c => c.entry !== null && c.weight > 0);
    
    if (candidates.length === 0) {
      console.error('[TextSelector] No valid candidates after filtering');
      return null;
    }
    
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    
    if (totalWeight <= 0) {
      console.error('[TextSelector] Total weight is zero or negative');
      return null;
    }
    
    let random = Math.random() * totalWeight;
    
    for (const { entry, weight } of candidates) {
      random -= weight;
      if (random <= 0 && entry) {
        if (!entry.lines || !Array.isArray(entry.lines) || entry.lines.length === 0) {
          console.error('[TextSelector] Selected entry has invalid lines');
          continue;
        }
        
        console.log(`[TextSelector] Selected entry with ${entry.lines.length} lines (tone: ${entry.tone})`);
        
        try {
          const processedLines = entry.lines.map(line => this._processTemplate(line, stateRefs));
          
          return {
            lines: processedLines,
            tone: entry.tone || 'neutral',
            themes: entry.themes || [],
            select_bias: entry.select_bias || {},
            reflect_pull: entry.reflect_pull || {}
          };
        } catch (error) {
          console.error('[TextSelector] Error processing templates:', error);
          continue;
        }
      }
    }
    
    const firstCandidate = candidates[0];
    if (!firstCandidate || !firstCandidate.entry) {
      console.error('[TextSelector] No valid first candidate');
      return null;
    }
    
    const entry = firstCandidate.entry;
    
    if (!entry.lines || !Array.isArray(entry.lines) || entry.lines.length === 0) {
      console.error('[TextSelector] Fallback entry has invalid lines');
      return null;
    }
    
    try {
      const processedLines = entry.lines.map(line => this._processTemplate(line, stateRefs));
      
      return {
        lines: processedLines,
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
  
  _pickIndexForWelcome(themes: string[], emotion: string, intensity: number): number {
    const preferredThemes = this._getPreferredThemesForEmotion(emotion);
    const allThemes = [...themes, ...preferredThemes];
    
    let candidates = this.welcomeEntries
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => this._themeMatches(u, allThemes));
    
    if (candidates.length === 0) {
      candidates = this.welcomeEntries.map((u, i) => ({ u, i }));
    }
    
    if (candidates.length === 0) return -1;
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _pickIndex(visualMode: string, themes: string[], emotion: string, intensity: number): number {
    const all = this.data!.subtitles!;
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
      candidates = all
        .map((u, i) => ({ u, i }))
        .filter(({ u, i }) => !this.recentBuffer.includes(i));
    }
    
    if (candidates.length === 0) {
      candidates = all.map((u, i) => ({ u, i }));
      this.recentBuffer = [];
    }
    
    if (candidates.length === 0) return -1;
    
    return this._weightedRandom(candidates, emotion, intensity);
  }
  
  _weightedRandom(candidates: Array<{ u: TextEntry; i: number }>, emotion: string, intensity: number): number {
    const emKey = emotion.toLowerCase();
    const weighted = candidates.map(({ u, i }) => {
      const w = u.weights?.[emKey] || 1;
      return { idx: i, weight: w };
    });
    
    const total = weighted.reduce((acc, { weight }) => acc + weight, 0);
    if (total <= 0) return weighted[0]?.idx ?? -1;
    
    let r = Math.random() * total;
    for (const { idx, weight } of weighted) {
      r -= weight;
      if (r <= 0) return idx;
    }
    
    return weighted[0]?.idx ?? -1;
  }
  
  _addToBuffer(idx: number): void {
    this.recentBuffer.push(idx);
    if (this.recentBuffer.length > this.bufferSize) {
      this.recentBuffer.shift();
    }
  }
  
  _whenMatches(unit: TextEntry, visualMode: string): boolean {
    return unit.when.includes('any') || unit.when.includes(visualMode);
  }
  
  _whatMatches(unit: TextEntry, visualMode: string): boolean {
    return unit.what.includes('any') || unit.what.includes(visualMode);
  }
  
  _themeMatches(unit: TextEntry, requestedThemes: string[]): boolean {
    if (unit.themes.length === 0) return true;
    if (requestedThemes.length === 0) return true;
    return unit.themes.some(t => requestedThemes.includes(t));
  }
  
  _getPreferredThemesForEmotion(emotion: string): string[] {
    switch (emotion.toUpperCase()) {
      case 'BORED':
        return ['meta', 'absurd', 'humor'];
      case 'EXCITED':
        return ['discovery', 'chaos', 'wonder'];
      case 'SURPRISED':
        return ['wonder', 'discovery', 'chaos'];
      case 'ANALYTICAL':
        return ['mathematical', 'deep', 'philosophical'];
      case 'CONTEMPLATIVE':
        return ['philosophical', 'deep', 'existential'];
      case 'CONCERNED':
        return ['warning', 'caution', 'boundary'];
      case 'AMUSED':
        return ['humor', 'absurd', 'playful'];
      case 'CURIOUS':
        return ['discovery', 'mathematical', 'wonder'];
      case 'NEUTRAL':
      default:
        return [];
    }
  }
}
