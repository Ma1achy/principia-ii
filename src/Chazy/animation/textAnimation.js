// Character pools for scramble animation - hybrid approach
const LETTER_POOL_BASIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LETTER_POOL_ROMANCE = 'áàâäãåæçéèêëíìîïñóòôöõøœúùûüýÿßÁÀÂÄÃÅÆÇÉÈÊËÍÌÎÏÑÓÒÔÖÕØŒÚÙÛÜÝÿ';
const LETTER_POOL_GERMANIC = 'ÄÖÜäöüẞß';
const LETTER_POOL_NORDIC = 'ÅØÆåøæ';
const LETTER_POOL_EASTERN = 'šžčřěńśćźłđŠŽČŘĚŃŚĆŹŁĐ';
const LETTER_POOL_OTHER = 'þðÞÐ';
const NUMBER_POOL = '0123456789';
const PUNCTUATION_POOL = '!@#$%^&*()[]{},.;:\'"-_+=<>?/\\|`~';
// Chaotic pool for basic ASCII letters - maximum variety!
const CHAOTIC_POOL = LETTER_POOL_BASIC + NUMBER_POOL + PUNCTUATION_POOL;
const CHAR_POOL = LETTER_POOL_BASIC + LETTER_POOL_ROMANCE + LETTER_POOL_GERMANIC + 
                  LETTER_POOL_NORDIC + LETTER_POOL_EASTERN + LETTER_POOL_OTHER + 
                  NUMBER_POOL + PUNCTUATION_POOL;  // Legacy combined pool
// Superscript characters (Unicode)
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ';

// Subscript characters (Unicode)
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ';

// Mathematical and Greek symbols pool
const MATH_GREEK_POOL = 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔';

// Extended math pool including subscripts, superscripts, digits, operators
const MATH_EXTENDED_POOL = MATH_GREEK_POOL + SUPERSCRIPTS + SUBSCRIPTS + '0123456789+-=*/()[]{}<>^|·∙•ℏπℯ∅φϕ∏∐℮';

// Debug flags for tuning (set to true to enable logging)
const DEBUG_TYPING = false;
const DEBUG_DELETION = false;

// Timing bounds to prevent unreadable extremes
const SPEED_BOUNDS = {
  min: 40,    // Raised from 30ms - prevents machine-gun typing
  max: 200    // Never slower than 200ms/char (feels broken/frozen)
};

const IDLE_BOUNDS = {
  min: 3000,   // Never faster than 3s between complete messages (gives breathing room)
  max: 30000   // Never longer than 30s (prevents feeling abandoned)
};

const PAUSE_BOUNDS = {
  min: 80,     // Never shorter than 80ms (feels glitchy)
  max: 800     // Never longer than 800ms (feels frozen)
};

const DISPLAY_BOUNDS = {
  min: 1500,   // Never less than 1.5s visible (too brief to read)
  max: 15000   // Never more than 15s visible (feels stuck)
};

// NEW: Global animation run tracking (prevents stale completions)
let globalAnimationRunId = 0;
let currentActiveRunId = 0;

// QWERTY keyboard adjacency map for realistic typos
const QWERTY_NEIGHBORS = {
  // Letters
  'a': ['q', 'w', 's', 'z'],
  'b': ['v', 'g', 'h', 'n'],
  'c': ['x', 'd', 'f', 'v'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'e': ['w', 's', 'd', 'r', '3', '4'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'i': ['u', 'j', 'k', 'o', '8', '9'],
  'j': ['h', 'u', 'i', 'k', 'n', 'm'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p', ';'],
  'm': ['n', 'j', 'k', ','],
  'n': ['b', 'h', 'j', 'm'],
  'o': ['i', 'k', 'l', 'p', '9', '0'],
  'p': ['o', 'l', '[', ';', '0'],
  'q': ['w', 'a', 's', '1', '2'],
  'r': ['e', 'd', 'f', 't', '4', '5'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  't': ['r', 'f', 'g', 'y', '5', '6'],
  'u': ['y', 'h', 'j', 'i', '7', '8'],
  'v': ['c', 'f', 'g', 'b'],
  'w': ['q', 'a', 's', 'e', '2', '3'],
  'x': ['z', 's', 'd', 'c'],
  'y': ['t', 'g', 'h', 'u', '6', '7'],
  'z': ['a', 's', 'x'],
  
  // Numbers
  '1': ['q', 'w', '2', '`'],
  '2': ['1', '3', 'q', 'w', 'e'],
  '3': ['2', '4', 'w', 'e', 'r'],
  '4': ['3', '5', 'e', 'r', 't'],
  '5': ['4', '6', 'r', 't', 'y'],
  '6': ['5', '7', 't', 'y', 'u'],
  '7': ['6', '8', 'y', 'u', 'i'],
  '8': ['7', '9', 'u', 'i', 'o'],
  '9': ['8', '0', 'i', 'o', 'p'],
  '0': ['9', '-', 'o', 'p', '['],
  
  // Punctuation (right side)
  '-': ['0', '=', 'p', '['],
  '=': ['-', '[', ']'],
  '[': ['p', '0', '-', ']', ';', 'l'],
  ']': ['[', '=', '\'', ';'],
  ';': ['l', 'p', '[', '\'', '/'],
  '\'': [';', '[', ']', '/'],
  
  // Punctuation (bottom row)
  ',': ['m', 'k', 'l', '.'],
  '.': [',', 'l', ';', '/'],
  '/': ['.', ';', '\''],
  
  // Special
  '`': ['1', 'q'],
  '\\': [']', '='],
};

// Math symbol confusion map for realistic equation typos
const MATH_TYPO_NEIGHBORS = {
  // Greek lowercase
  'α': ['a', 'λ'],
  'β': ['b', 'δ'],
  'γ': ['y', 'ν'],
  'δ': ['∂', 'Δ', 'd'],
  'ε': ['e', '∈'],
  'η': ['n', 'π'],
  'θ': ['φ', '∅', 'o'],
  'ι': ['i', 'l'],
  'κ': ['k', 'x'],
  'λ': ['Λ', 'α'],
  'μ': ['u', 'm'],
  'ν': ['v', 'γ'],
  'ξ': ['ζ', 'x'],
  'π': ['n', 'Π', 'η'],
  'ρ': ['p', 'φ'],
  'σ': ['ς', 'o'],
  'τ': ['t', '+'],
  'φ': ['θ', 'ϕ', '∅'],
  'χ': ['x', '×'],
  'ψ': ['Ψ', 'y'],
  'ω': ['Ω', 'w'],
  'ϕ': ['φ', 'θ'],

  // Greek uppercase
  'Γ': ['γ', 'Π'],
  'Δ': ['δ', '∇', 'Λ'],
  'Θ': ['θ', 'Φ', 'O'],
  'Λ': ['λ', 'Δ', 'A'],
  'Ξ': ['ξ', 'Σ'],
  'Π': ['π', 'Π', '∏'],
  'Σ': ['σ', '∑', 'E'],
  'Φ': ['φ', 'Θ', '∅'],
  'Ψ': ['ψ', 'Y'],
  'Ω': ['ω', 'O'],

  // Superscript digits (can confuse with normal digits or each other)
  '⁰': ['0', 'º', '°'],
  '¹': ['1', 'i', 'l'],
  '²': ['2', '^2'],
  '³': ['3', '^3'],
  '⁴': ['4', '^4'],
  '⁵': ['5', '^5'],
  '⁶': ['6', '^6'],
  '⁷': ['7', '^7'],
  '⁸': ['8', '^8'],
  '⁹': ['9', '^9'],
  '⁺': ['+', '^+'],
  '⁻': ['-', '^-'],
  '⁼': ['=', '^='],
  '⁽': ['(', '^('],
  '⁾': [')', '^)'],
  'ⁿ': ['n', '^n'],
  'ⁱ': ['i', '^i'],

  // Subscript digits (can confuse with normal digits or each other)
  '₀': ['0', '_0'],
  '₁': ['1', '_1'],
  '₂': ['2', '_2'],
  '₃': ['3', '_3'],
  '₄': ['4', '_4'],
  '₅': ['5', '_5'],
  '₆': ['6', '_6'],
  '₇': ['7', '_7'],
  '₈': ['8', '_8'],
  '₉': ['9', '_9'],
  '₊': ['+', '_+'],
  '₋': ['-', '_-'],
  '₌': ['=', '_='],
  '₍': ['(', '_('],
  '₎': [')', '_)'],
  'ₐ': ['a', '_a'],
  'ₑ': ['e', '_e'],
  'ₒ': ['o', '_o'],
  'ₓ': ['x', '_x'],
  'ₔ': ['e', 'ₑ'],
  'ₕ': ['h', '_h'],
  'ₖ': ['k', '_k'],
  'ₗ': ['l', '_l'],
  'ₘ': ['m', '_m'],
  'ₙ': ['n', '_n'],
  'ₚ': ['p', '_p'],
  'ₛ': ['s', '_s'],
  'ₜ': ['t', '_t'],

  // Relations / operators
  '=': ['≈', '≠', '≡', '-'],
  '≈': ['=', '≃'],
  '≠': ['=', '≤', '≥'],
  '<': ['≤', '≪'],
  '>': ['≥', '≫'],
  '≤': ['<', '≥', '='],
  '≥': ['>', '≤', '='],
  '+': ['-', '±', 't'],
  '-': ['+', '=', '–'],
  '±': ['+', '-'],
  '×': ['x', '·', '*'],
  '÷': ['/', '-'],
  '*': ['×', '·', '∙'],
  '·': ['.', '×', '*', '∙'],
  '∙': ['·', '•', '*'],
  '•': ['∙', '·', 'o'],
  '/': ['÷', '|'],
  '∝': ['∞', 'α'],
  '∞': ['8', '∝'],
  '∂': ['δ', 'd'],
  '∇': ['Δ', 'V'],
  '√': ['∛', 'v'],
  '∛': ['√', '∜'],
  '∜': ['∛', '√'],

  // Special math constants
  'ℏ': ['h', 'ħ'],
  'ℯ': ['e', 'ε'],
  '∅': ['φ', 'ϕ', 'Φ', '0'],
  '∏': ['Π', 'π'],
  '∐': ['∏', '∑', 'Π'],

  // Set / logic symbols
  '∈': ['ε', '∉'],
  '∉': ['∈'],
  '⊂': ['⊃', '<'],
  '⊃': ['⊂', '>'],
  '∪': ['U', '∩'],
  '∩': ['n', '∪'],
  '∧': ['^', '∨'],
  '∨': ['v', '∧'],
  '¬': ['-', '~'],
  '∀': ['A', '∃'],
  '∃': ['E', '∀'],
  '∄': ['∃', '¬'],

  // Arrows
  '←': ['→', '↔'],
  '→': ['←', '↔', '⇒'],
  '↔': ['←', '→', '⇔'],
  '⇐': ['⇒', '⇔', '←'],
  '⇒': ['⇐', '⇔', '→'],
  '⇔': ['↔', '⇐', '⇒'],

  // Delimiters
  '(': [')', '[', '{'],
  ')': ['(', ']', '}'],
  '[': [']', '(', '{'],
  ']': ['[', ')', '}'],
  '{': ['}', '(', '['],
  '}': ['{', ')', ']'],
  '|': ['/', '1', '∣'],

  // Common superscript-ish ASCII slips
  '^': ['*', '∧'],
  
  // Bidirectional Latin/Greek for prose-math switching
  'a': ['α'],
  'b': ['β'],
  'd': ['δ'],
  'e': ['ε'],
  'n': ['η', 'ν'],
  'o': ['ο', 'θ', 'σ'],
  'p': ['ρ'],
  'v': ['ν'],
  'x': ['χ', '×'],
  'y': ['γ'],
};

// Helper: pick random element from array
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Detect if we're in a mathematical context
function isMathContext(index, chars) {
  const char = chars[index];
  const prev = index > 0 ? chars[index - 1] : '';
  const next = index < chars.length - 1 ? chars[index + 1] : '';

  // Current char itself is mathy
  if (isMathOrGreekSymbol(char)) return true;

  // Math operators / delimiters (not just digits!)
  if (/[=+\-*/^()[\]{}<>|]/.test(char)) return true;

  // Digits are only "math" if near operators/delimiters (not dates/versions)
  if (/[0-9]/.test(char)) {
    const neighborhood = `${prev}${char}${next}`;
    if (/[=+\-*/^()[\]{}<>|]/.test(neighborhood)) return true;
  }

  // Nearby math symbols/operators suggest we're in an equation fragment
  const neighborhood = `${prev}${char}${next}`;
  if (/[=+\-*/^()[\]{}<>|∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔α-ωΑ-Ω₀-₉ₐ-ₜ⁰-⁹ⁱⁿ·∙•ℏℯ∅φϕ∏∐]/.test(neighborhood)) {
    return true;
  }

  return false;
}

// Strong math context: operators nearby, not just numbers
function isStrongMathContext(index, chars) {
  const char = chars[index];
  const prev = index > 0 ? chars[index - 1] : '';
  const next = index < chars.length - 1 ? chars[index + 1] : '';

  // Current char is Greek/math symbol
  if (isMathOrGreekSymbol(char)) return true;

  // Math operators nearby
  if (/[=+\-*/^]/.test(prev) || /[=+\-*/^]/.test(next)) return true;

  // Inside function-like patterns: f(, x=, etc.
  if (/[a-zA-Z]/.test(prev) && /[(=]/.test(char)) return true;
  if (/[=(]/.test(prev) && /[a-zA-Z]/.test(char)) return true;

  return false;
}

// Get math-aware typo (symbol confusion)
function getMathTypo(char) {
  const neighbors = MATH_TYPO_NEIGHBORS[char];
  if (!neighbors || neighbors.length === 0) return null;
  return pickRandom(neighbors);
}

// Get QWERTY keyboard typo (physical neighbor)
function getQwertyTypo(char) {
  // Check direct neighbors (numbers, punctuation)
  if (QWERTY_NEIGHBORS[char]) {
    return pickRandom(QWERTY_NEIGHBORS[char]);
  }

  // For letters, check lowercase version
  const lower = char.toLowerCase();
  const neighbors = QWERTY_NEIGHBORS[lower];
  if (!neighbors || neighbors.length === 0) return null;

  const typo = pickRandom(neighbors);
  const isLetter = /[a-zA-Z]/.test(char);
  return isLetter && char === char.toUpperCase() ? typo.toUpperCase() : typo;
}

// Helper: check if character is a subscript
function isSubscript(char) {
  return /[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]/.test(char);
}

// Helper: check if character is a superscript
function isSuperscript(char) {
  return /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]/.test(char);
}

// Context-aware typo: prefers math confusions in math context, QWERTY otherwise
function getTypoForIndex(index, chars) {
  const char = chars[index];

  // Prefer math-aware confusions in math context
  if (isMathContext(index, chars)) {
    const mathTypo = getMathTypo(char);
    
    // Gate Latin→Greek substitutions to strong math context only
    if (mathTypo && mathTypo !== char) {
      // Check if this is a Latin→Greek substitution
      const isLatinToGreek = /[a-zA-Z]/.test(char) && /[α-ωΑ-Ω]/.test(mathTypo);
      
      if (isLatinToGreek) {
        // Only allow in strong math context (operators nearby)
        if (isStrongMathContext(index, chars)) {
          return mathTypo;
        }
      } else {
        // Other math confusions (symbol→symbol) are fine in weak context
        return mathTypo;
      }
    }

    // For ASCII characters inside math context, still allow QWERTY slips sometimes
    const qTypo = getQwertyTypo(char);
    if (qTypo && qTypo !== char) return qTypo;
    return char;
  }

  // Non-math context: normal keyboard typos
  return getQwertyTypo(char) || char;
}

/**
 * Smooths speed changes over time to prevent jarring transitions
 */
class AnimationMomentum {
  constructor() {
    this.currentSpeedMultiplier = 1.0;
    this.targetSpeedMultiplier = 1.0;
    this.lastUpdate = Date.now();
  }
  
  /**
   * Update momentum toward target
   * @param {number} targetMult - Target speed multiplier from emotion
   * @returns {number} - Smoothed current multiplier
   */
  update(targetMult) {
    const now = Date.now();
    const dt = Math.min(1000, now - this.lastUpdate); // Cap at 1s
    this.lastUpdate = now;
    
    this.targetSpeedMultiplier = targetMult;
    
    // Exponential smoothing (15% move toward target per 100ms)
    const smoothingFactor = 0.15 * (dt / 100);
    this.currentSpeedMultiplier += 
      (this.targetSpeedMultiplier - this.currentSpeedMultiplier) * 
      Math.min(1.0, smoothingFactor);
    
    return this.currentSpeedMultiplier;
  }
  
  /**
   * Reset to specific value (for hard state changes)
   */
  reset(value = 1.0) {
    this.currentSpeedMultiplier = value;
    this.targetSpeedMultiplier = value;
  }
}

// Global momentum instance
const animationMomentum = new AnimationMomentum();

function getTypingParams(emotion, intensity) {
  const params = {
    baseSpeed: 70,              // Slower default (was 50)
    speedVariation: 0.15,       // Much lower jitter (was 0.3)
    typoChance: 0.03,
    pauseChance: 0.08,          // Slightly lower (was 0.1)
    pauseDuration: 200,
    emphasisMultiplier: 1.0     // NEW: for intentional slowdowns on punctuation
  };

  switch (emotion) {
    case 'BORED':
      params.baseSpeed = 120 + (1.0 - intensity) * 80;
      params.speedVariation = 0.2;        // Reduced (was 0.25)
      params.typoChance = 0.015 + intensity * 0.01;
      params.pauseChance = 0.25;          // Reduced (was 0.3)
      params.pauseDuration = 400 + (1.0 - intensity) * 300;
      params.emphasisMultiplier = 1.5;    // NEW: Strong emphasis
      break;

    case 'EXCITED':
      {
        const damped = dampedIntensity(intensity, 2.0);
        params.baseSpeed = 60 - damped * 10;  // Range: 50-60ms (was 35-50ms)
        params.speedVariation = 0.2;          // ±20% (was 0.4)
        params.typoChance = 0.025 + intensity * 0.025;
        params.pauseChance = 0.05;
        params.pauseDuration = 100;
        params.emphasisMultiplier = 0.95;     // NEW: Slightly quicker emphasis
      }
      break;

    case 'CONCERNED':
      params.baseSpeed = 95 + (1.0 - intensity) * 35;
      params.speedVariation = 0.25;           // Reduced (was 0.3)
      params.typoChance = 0.02 + intensity * 0.015;
      params.pauseChance = 0.2;
      params.pauseDuration = 300 + intensity * 200;
      params.emphasisMultiplier = 1.2;        // NEW: Moderate emphasis
      break;

    case 'SURPRISED':
      {
        const damped = dampedIntensity(intensity, 2.0);
        params.baseSpeed = 65 - damped * 10;  // Range: 55-65ms (was 40-55ms)
        params.speedVariation = 0.25;         // ±25% (was 0.5!)
        params.typoChance = 0.035 + intensity * 0.03;
        params.pauseChance = 0.12;            // Reduced (was 0.15)
        params.pauseDuration = 200;
        params.emphasisMultiplier = 1.2;      // NEW: Moderate emphasis
      }
      break;

    case 'AMUSED':
      params.baseSpeed = 60;                  // Slightly slower (was 55)
      params.speedVariation = 0.25;           // Reduced (was 0.35)
      params.typoChance = 0.025;
      params.pauseChance = 0.12;
      params.pauseDuration = 250;
      params.emphasisMultiplier = 1.1;        // NEW: Slight emphasis
      break;

    case 'ANALYTICAL':
      params.baseSpeed = 65;                  // Slightly slower (was 60)
      params.speedVariation = 0.18;           // Slightly reduced (was 0.2)
      params.typoChance = 0.015;
      params.pauseChance = 0.15;
      params.pauseDuration = 300;
      params.emphasisMultiplier = 1.3;        // NEW: Strong emphasis
      break;

    case 'CONTEMPLATIVE':
      params.baseSpeed = 90 + (1.0 - intensity) * 60;
      params.speedVariation = 0.3;            // Reduced (was 0.4)
      params.typoChance = 0.02;
      params.pauseChance = 0.2;               // Reduced (was 0.25)
      params.pauseDuration = 350 + (1.0 - intensity) * 250;
      params.emphasisMultiplier = 1.4;        // NEW: Very strong emphasis
      break;

    case 'CURIOUS':
      params.baseSpeed = 55;                  // Slightly slower (was 50)
      params.speedVariation = 0.25;           // Reduced (was 0.35)
      params.typoChance = 0.02;
      params.pauseChance = 0.12;
      params.pauseDuration = 220;
      params.emphasisMultiplier = 1.0;        // NEW: Neutral emphasis
      break;

    default:  // NEUTRAL
      params.baseSpeed = 70;                  // Slower (was 50)
      params.speedVariation = 0.2;            // Reduced (was 0.3)
      params.emphasisMultiplier = 1.0;        // NEW: Neutral emphasis
      break;
  }

  // Apply pause duration bounds
  params.pauseDuration = Math.max(
    PAUSE_BOUNDS.min,
    Math.min(PAUSE_BOUNDS.max, params.pauseDuration)
  );

  return params;
}

/**
 * Apply tone-based modifiers to typing parameters
 * Tone is a delivery style layer on top of emotion
 * 
 * @param {Object} params - Base typing params from getTypingParams()
 * @param {string} tone - Tone modifier (whisper, clinical, wry, etc.)
 * @param {string} emotion - Current emotion (for context-aware modulation)
 * @returns {Object} Modified typing params
 */
function applyToneModifiers(params, tone, emotion) {
  if (!tone || tone === 'neutral') return params;
  
  // Tone speed adjustments (additive, not multiplicative)
  const TONE_SPEED_ADJUSTMENTS = {
    neutral: { min: 0, max: 0 },
    whisper: { min: 15, max: 30 },         // +15 to +30ms (slower, deliberate)
    ominous: { min: 10, max: 25 },         // +10 to +25ms (measured, foreboding)
    wry: { min: -8, max: 0 },              // -8 to 0ms (slightly quicker, dry)
    deadpan: { min: -12, max: -5 },        // -12 to -5ms (crisp, flat)
    clinical: { min: -8, max: 0 },         // -8 to 0ms (efficient, precise)
    warm: { min: 3, max: 12 },             // +3 to +12ms (gentle, unhurried)
    concerned: { min: -5, max: 8 },        // -5 to +8ms (variable anxiety/caution)
    surprised: { min: -10, max: -3 }       // -10 to -3ms (reactive, quick)
  };
  
  // Other tone properties with variance ranges
  const TONE_OTHER_MODIFIERS = {
    neutral: {
      typoMult: { min: 1.0, max: 1.0 },
      pauseMult: { min: 1.0, max: 1.0 },
      variationMult: { min: 1.0, max: 1.0 }
    },
    whisper: {
      typoMult: { min: 0.4, max: 0.6 },
      pauseMult: { min: 1.3, max: 1.5 },
      variationMult: { min: 0.8, max: 1.0 }
    },
    ominous: {
      typoMult: { min: 0.6, max: 0.8 },
      pauseMult: { min: 1.4, max: 1.7 },
      variationMult: { min: 0.7, max: 0.9 }
    },
    wry: {
      typoMult: { min: 0.7, max: 0.9 },
      pauseMult: { min: 0.8, max: 1.0 },
      variationMult: { min: 1.1, max: 1.3 },
      chuckleBoost: { min: 0.05, max: 0.08 }
    },
    deadpan: {
      typoMult: { min: 0.3, max: 0.5 },
      pauseMult: { min: 0.6, max: 0.8 },
      variationMult: { min: 0.4, max: 0.6 }
    },
    clinical: {
      typoMult: { min: 0.4, max: 0.6 },
      pauseMult: { min: 0.8, max: 1.0 },
      variationMult: { min: 0.5, max: 0.7 }
    },
    warm: {
      typoMult: { min: 0.8, max: 1.0 },
      pauseMult: { min: 1.1, max: 1.3 },
      variationMult: { min: 1.0, max: 1.2 }
    },
    concerned: {
      typoMult: { min: 1.3, max: 1.5 },
      pauseMult: { min: 0.6, max: 0.8 },
      variationMult: { min: 1.2, max: 1.4 }
    },
    surprised: {
      typoMult: { min: 1.1, max: 1.3 },
      pauseMult: { min: 1.3, max: 1.5 },
      variationMult: { min: 1.3, max: 1.5 }
    }
  };
  
  const speedAdj = TONE_SPEED_ADJUSTMENTS[tone] || TONE_SPEED_ADJUSTMENTS.neutral;
  const otherMods = TONE_OTHER_MODIFIERS[tone] || TONE_OTHER_MODIFIERS.neutral;
  
  if (!speedAdj) {
    console.warn(`[Chazy] Unknown tone: "${tone}", using neutral`);
    return params;
  }
  
  // Speed: additive adjustment with variance
  const speedDelta = sampleRange(speedAdj);
  
  // Other properties: multiplicative with variance
  const typoMult = sampleRange(otherMods.typoMult);
  const pauseMult = sampleRange(otherMods.pauseMult);
  const variationMult = sampleRange(otherMods.variationMult);
  const chuckleBoost = otherMods.chuckleBoost ? sampleRange(otherMods.chuckleBoost) : 0;
  
  return {
    baseSpeed: params.baseSpeed + speedDelta,
    speedVariation: params.speedVariation * variationMult,
    typoChance: params.typoChance * typoMult,
    pauseChance: params.pauseChance + chuckleBoost,
    pauseDuration: params.pauseDuration * pauseMult
  };
}

// Character classification helpers for typing psychology
function isWhitespace(char) {
  return /\s/.test(char);
}

function isWordBoundaryChar(char) {
  // All whitespace characters are word boundaries
  return /\s/.test(char);
}

function isSentencePunctuation(char) {
  return /[.!?]/.test(char);
}

function isClausePunctuation(char) {
  return /[,;:]/.test(char);
}

function isPunctuation(char) {
  return /[.,;:!?]/.test(char);
}

function isShiftLikelyChar(char) {
  // Uppercase letters and common shifted symbols
  return /[A-Z!@#$%^&*()_+{}|:"<>?]/.test(char);
}

function isRareSymbolChar(char) {
  return /[\[\]{}<>\\|`~]/.test(char);
}

function isUnicodeOrAccented(char) {
  // crude but useful: non-ascii
  return /[^\x00-\x7F]/.test(char);
}

function isMathOrGreekSymbol(char) {
  // Greek letters (lowercase and uppercase)
  if (/[α-ωΑ-Ω]/.test(char)) return true;
  // Common math symbols
  if (/[∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔]/.test(char)) return true;
  // Subscripts
  if (/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]/.test(char)) return true;
  // Superscripts
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]/.test(char)) return true;
  // Additional math symbols
  if (/[·∙•ℏπℯ∅φϕ∏∐]/.test(char)) return true;
  return false;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Apply non-linear damping to intensity
 * Uses ease-out curve: rapid effect at low intensity, plateaus at high
 */
function dampedIntensity(intensity, curve = 2.0) {
  return 1.0 - Math.pow(1.0 - intensity, curve);
}

/**
 * Get perceptual complexity weight for a character
 * More complex characters should display longer for readability
 */
function getCharacterComplexity(char) {
  // Greek letters (harder to parse for most readers)
  if (/[\u0370-\u03FF]/.test(char)) return 1.3;
  
  // Superscripts
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]/.test(char)) return 1.2;
  
  // Subscripts
  if (/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]/.test(char)) return 1.2;
  
  // Complex math operators and symbols
  if (/[∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔∏∐]/.test(char)) return 1.4;
  
  // Capital letters (slightly more visual weight)
  if (/[A-Z]/.test(char)) return 1.1;
  
  // Punctuation (needs slight pause for cognitive processing)
  if (/[.,;:!?]/.test(char)) return 1.15;
  
  // Regular ASCII
  return 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAUSE SYSTEM: Mid-line typing pauses for dramatic effect
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate and clamp pause duration to reasonable range
 * @param {string|number} duration - Duration from pause marker
 * @returns {number} Clamped duration in ms
 */
function validateAndClampDuration(duration) {
  const MIN_PAUSE = 50;
  const MAX_PAUSE = 5000;
  
  const parsed = parseInt(duration, 10);
  
  if (isNaN(parsed)) {
    console.warn(`[Animation] Invalid pause duration: ${duration}, using ${MIN_PAUSE}ms`);
    return MIN_PAUSE;
  }
  
  if (parsed < MIN_PAUSE) {
    console.warn(`[Animation] Pause ${parsed}ms too short, clamping to ${MIN_PAUSE}ms`);
    return MIN_PAUSE;
  }
  
  if (parsed > MAX_PAUSE) {
    console.warn(`[Animation] Pause ${parsed}ms too long, clamping to ${MAX_PAUSE}ms`);
    return MAX_PAUSE;
  }
  
  return parsed;
}

/**
 * Detect and merge consecutive pause segments
 * @param {Array} segments - Segments from extractPauseMarkers()
 * @returns {Array} Segments with consecutive pauses merged
 */
function validateAndMergePauses(segments) {
  const merged = [];
  let i = 0;
  
  while (i < segments.length) {
    const segment = segments[i];
    
    if (segment.type === 'pause') {
      let totalDuration = segment.duration;
      let consecutiveCount = 1;
      
      // Look ahead for consecutive pauses
      while (i + 1 < segments.length && segments[i + 1].type === 'pause') {
        totalDuration += segments[i + 1].duration;
        consecutiveCount++;
        i++;
      }
      
      if (consecutiveCount > 1) {
        console.warn(
          `[Animation] Merged ${consecutiveCount} consecutive pauses ` +
          `into single ${totalDuration}ms pause`
        );
      }
      
      merged.push({ type: 'pause', duration: totalDuration });
    } else {
      merged.push(segment);
    }
    
    i++;
  }
  
  return merged;
}

/**
 * Extract pause markers from text, returning segments
 * @param {string} text - Text with \pause{ms} markers
 * @returns {Array<{type: 'text'|'pause', content?: string, duration?: number}>}
 */
function extractPauseMarkers(text) {
  const segments = [];
  const pausePattern = /(?<!\\)\\pause\{(\d+)\}/g;
  let lastIndex = 0;
  let match;
  
  while ((match = pausePattern.exec(text)) !== null) {
    // Text segment before this pause
    if (lastIndex < match.index) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }
    
    // Pause segment
    segments.push({
      type: 'pause',
      duration: validateAndClampDuration(match[1])
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Remaining text after last pause
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }
  
  // Return text-only segment if no pauses found
  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

/**
 * Remove pause markers from text for display
 * @param {string} text - Text with \pause{ms} markers
 * @returns {string} Clean text without markers
 */
function cleanPauseMarkers(text) {
  // Remove unescaped pause markers
  let cleaned = text.replace(/(?<!\\)\\pause\{\d+\}/g, '');
  
  // Unescape escaped pauses (\\pause{} → \pause{})
  cleaned = cleaned.replace(/\\\\pause\{/g, '\\pause{');
  
  return cleaned;
}

/**
 * Build map of character index → pause duration
 * @param {Array} segments - Segments from extractPauseMarkers()
 * @returns {Map<number, number>} Map of index to duration in ms
 */
function buildPauseMap(segments) {
  // Validate and merge consecutive pauses first
  const merged = validateAndMergePauses(segments);
  
  const pauseMap = new Map();
  let cleanCharIndex = 0;
  
  for (const segment of merged) {
    if (segment.type === 'text') {
      cleanCharIndex += segment.content.length;
    } else if (segment.type === 'pause') {
      // Pause occurs BEFORE the next character (at current index)
      pauseMap.set(cleanCharIndex, segment.duration);
    }
  }
  
  return pauseMap;
}


/**
 * Sample a random value from a min-max range
 */
function sampleRange(range) {
  if (!range || range.min === range.max) return range?.min || 0;
  return range.min + Math.random() * (range.max - range.min);
}

// Ultimate grapheme-safe splitting (handles emoji, combining marks, ZWJ sequences)
function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(text), s => s.segment);
  }
  return Array.from(text);
}

export function animateTextInTyping(element, targetText, onComplete, options = {}) {
  // Defensive null checks
  if (!element || !(element instanceof HTMLElement)) {
    console.error('[Animation] Invalid element in animateTextInTyping');
    if (onComplete) onComplete();
    return () => {};
  }
  
  if (!targetText || typeof targetText !== 'string') {
    console.error('[Animation] Invalid targetText in animateTextInTyping');
    if (onComplete) onComplete();
    return () => {};
  }
  
  // NEW: Generate unique run ID for this animation instance
  const animationRunId = ++globalAnimationRunId;
  currentActiveRunId = animationRunId;
  
  console.log(`[Animation] Starting typing run ${animationRunId}`);
  
  const {
    emotion = 'NEUTRAL',
    intensity = 0.5,
    tone = 'neutral',  // NEW
  } = options || {};

  // Clamp intensity to valid range
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  
  let typingParams = getTypingParams(emotion, clampedIntensity);
  
  // Apply tone modifiers
  typingParams = applyToneModifiers(typingParams, tone, emotion);
  
  // Apply hard speed bounds (safety clamps)
  typingParams.baseSpeed = Math.max(
    SPEED_BOUNDS.min,
    Math.min(SPEED_BOUNDS.max, typingParams.baseSpeed)
  );
  
  const cascadeDelay = typingParams.baseSpeed;
  const cycleSpeed = 30;

  let cancelled = false;
  const animationFrames = [];
  const timeouts = [];

  // ---- DOM reset ----
  element.querySelectorAll('.text-cursor').forEach(c => c.remove());
  element.textContent = '';
  element.style.visibility = 'visible';

  const cursor = document.createElement('span');
  cursor.className = 'text-cursor';
  cursor.textContent = '█';
  element.appendChild(cursor);

  // Extract pause markers and clean text
  const segments = extractPauseMarkers(targetText);
  const cleanText = cleanPauseMarkers(targetText);
  const pauseMap = buildPauseMap(segments);
  
  if (DEBUG_TYPING && pauseMap.size > 0) {
    console.log('[Animation] Pause map:', Array.from(pauseMap.entries()));
  }

  // Use grapheme-aware splitting for proper emoji/combining mark handling
  // IMPORTANT: Use cleanText (without pause markers) for character array
  const chars = splitGraphemes(cleanText);
  const charSpans = [];

  // Prevent double onComplete() calls in edge cases (interrupts, errors)
  let finished = false;
  function finishOnce() {
    // NEW: Guard by run ID (prevents stale completions)
    if (animationRunId !== currentActiveRunId) {
      console.log(`[Animation] Stale completion ignored (run ${animationRunId} vs current ${currentActiveRunId})`);
      return;
    }
    
    if (finished) return;
    finished = true;
    
    console.log(`[Animation] Typing completed (run ${animationRunId})`);
    
    if (onComplete) onComplete();
  }

  // Context-aware typo probability (uses emotion, intensity, and character context)
  function getContextualTypoChance(index) {
    const char = chars[index];
    const prevChar = index > 0 ? chars[index - 1] : '';
    const nextChar = index < chars.length - 1 ? chars[index + 1] : '';

    if (isWhitespace(char)) return 0;

    let chance = typingParams.typoChance;

    // Fast/excited typing => more typos
    const emotionUpper = String(emotion).toUpperCase();
    const isFastEmotion = emotionUpper === 'EXCITED' || emotionUpper === 'SURPRISED';
    if (isFastEmotion) {
      chance *= (1.05 + 0.25 * intensity); // up to ~1.3x (was 1.6x)
    }

    // Analytical / contemplative => fewer typos
    if (emotionUpper === 'ANALYTICAL' || emotionUpper === 'CONTEMPLATIVE') {
      chance *= (0.85 - 0.3 * intensity); // down to ~0.55x (more reduction)
    }

    // Immediately after punctuation: "smarter" / more deliberate
    if (isPunctuation(prevChar)) {
      chance *= 0.25; // was 0.35
    }

    // First letter after a space (word start) slightly more deliberate
    if (isWordBoundaryChar(prevChar)) {
      chance *= 0.65; // was 0.8
    }

    // Repeated letters / awkward transitions can be a little typo-prone
    // Only check for simple alphabetic characters to avoid grapheme issues
    if (char && nextChar && /^[a-zA-Z]$/.test(char) && /^[a-zA-Z]$/.test(nextChar)) {
      if (char.toLowerCase() === nextChar.toLowerCase()) {
        chance *= 1.05; // was 1.1
      }
    }

    // Shift-heavy chars are a bit more error-prone
    if (isShiftLikelyChar(char)) {
      chance *= 1.08; // was 1.15
    }

    // Math context modulation
    const mathCtx = isMathContext(index, chars);
    if (mathCtx) {
      // Default: more deliberate when typing equations
      chance *= 0.75;

      // But operators / delimiters are easy to slip on
      if (/[=+\-*/^()[\]{}<>|]/.test(char) || isMathOrGreekSymbol(char)) {
        chance *= 1.15;
      }

      // Very low typo chance for π, e, i (super common, well-practiced)
      if (['π', 'e', 'i'].includes(char)) {
        chance *= 0.3;
      }

      // Immediately after '=' or operator can be more careful
      if (/[=+\-*/^]/.test(prevChar)) {
        chance *= 0.8;
      }
    } else {
    // Non-math context: reduce typo chance for isolated math symbols
    if (isMathOrGreekSymbol(char)) {
      chance *= 0.15;
    }
    
    // Subscripts and superscripts are typed deliberately (special input)
    if (isSubscript(char) || isSuperscript(char)) {
      chance *= 0.3;
    }
  }

    // Keep sane bounds
    return clamp01(chance);
  }

  // Pre-calculate typos with context-aware probabilities
  const typoMap = new Map();
  const typoPositions = [];
  chars.forEach((char, index) => {
    const typoChance = getContextualTypoChance(index);
    if (!isWhitespace(char) && Math.random() < typoChance) {
      const typoChar = getTypoForIndex(index, chars);
      // Only add if typo is different from original (avoid no-op typos)
      if (typoChar !== char) {
        typoMap.set(index, {
          typoChar,
          correctChar: char,
        });
        typoPositions.push(index);
      }
    }
  });

  // Create spans
  chars.forEach(() => {
    const span = document.createElement('span');
    span.textContent = '';
    span.style.opacity = '0';
    element.insertBefore(span, cursor);
    charSpans.push(span);
  });

  // ----------------------------
  // Cursor source-of-truth state
  // boundary 0 = before char 0
  // boundary N = after char N-1
  // ----------------------------
  let cursorBoundary = 0;

  function placeCursorAtBoundary(boundary) {
    // Bail early if animation was cancelled
    if (cancelled) return;
    
    // Verify cursor is still part of the document (not removed by interrupt)
    if (!cursor || !cursor.parentNode) return;
    
    // Defensive check on element
    if (!element || !element.parentNode) return;
    
    if (boundary <= 0) {
      // Check if target span still exists in DOM
      const firstSpan = charSpans[0];
      if (firstSpan && firstSpan.parentNode === element) {
        try {
          element.insertBefore(cursor, firstSpan);
        } catch (error) {
          console.error('[Animation] Error placing cursor:', error);
        }
      }
      return;
    }
    if (boundary >= charSpans.length) {
      try {
        element.appendChild(cursor);
      } catch (error) {
        console.error('[Animation] Error appending cursor:', error);
      }
      return;
    }
    // Check if target span still exists in DOM
    const targetSpan = charSpans[boundary];
    if (targetSpan && targetSpan.parentNode === element) {
      try {
        element.insertBefore(cursor, targetSpan);
      } catch (error) {
        console.error('[Animation] Error inserting cursor:', error);
      }
    }
  }

  function setCursorBoundary(boundary) {
    // Bail early if animation was cancelled or cursor removed
    if (cancelled || !cursor.parentNode) return;
    cursorBoundary = Math.max(0, Math.min(boundary, chars.length));
    placeCursorAtBoundary(cursorBoundary);
  }

  // Timer/RAF helpers that respect cancellation
  function safeTimeout(ms) {
    return new Promise((resolve) => {
      if (cancelled) return resolve(false);
      const t = setTimeout(() => resolve(!cancelled), ms);
      timeouts.push(t);
    });
  }

  function nextFrame() {
    return new Promise((resolve) => {
      if (cancelled) return resolve(false);
      const raf = requestAnimationFrame(() => resolve(!cancelled));
      animationFrames.push(raf);
    });
  }

  // Helper: Determine appropriate scramble pool for a character
  function getScramblePoolForChar(char) {
    // Math symbols (Greek, operators, special math chars) - keep mathematical coherence
    if (isMathOrGreekSymbol(char)) {
      return MATH_EXTENDED_POOL;
    }
    
    // Regional accented letters - keep cultural coherence
    if (LETTER_POOL_ROMANCE.includes(char)) {
      return LETTER_POOL_ROMANCE;
    }
    if (LETTER_POOL_GERMANIC.includes(char)) {
      return LETTER_POOL_GERMANIC;
    }
    if (LETTER_POOL_NORDIC.includes(char)) {
      return LETTER_POOL_NORDIC;
    }
    if (LETTER_POOL_EASTERN.includes(char)) {
      return LETTER_POOL_EASTERN;
    }
    if (LETTER_POOL_OTHER.includes(char)) {
      return LETTER_POOL_OTHER;
    }
    
    // Basic ASCII letters - CHAOTIC! Mix with numbers and punctuation
    if (/[a-zA-Z]/.test(char)) {
      return CHAOTIC_POOL;
    }
    
    // Numbers - keep some order
    if (/[0-9]/.test(char)) {
      return NUMBER_POOL;
    }
    
    // Punctuation - keep some order
    if (PUNCTUATION_POOL.includes(char)) {
      return PUNCTUATION_POOL;
    }
    
    // Fallback: check if it's a math operator/bracket
    if (/[=+\-*/^()[\]{}<>|]/.test(char)) {
      return MATH_EXTENDED_POOL;
    }
    
    // Default to full char pool for anything else
    return CHAR_POOL;
  }

  // Scramble a character span for durationMs, then caller decides what to lock in
  async function scrambleSpan(span, durationMs, targetChar = '') {
    const start = performance.now();
    
    // Choose scramble pool based on target character type
    const pool = getScramblePoolForChar(targetChar);

    while (!cancelled && performance.now() - start < durationMs) {
      span.style.opacity = '1';
      span.textContent = pool[Math.floor(Math.random() * pool.length)];

      const ok = await safeTimeout(cycleSpeed);
      if (!ok) return false;
      const ok2 = await nextFrame();
      if (!ok2) return false;
    }

    return !cancelled;
  }

  // Emotion-aware typo correction timings
  function getTypoCorrectionTimings(index) {
    const emotionUpper = String(emotion).toUpperCase();

    // Base timings (original values)
    let realizePause = 800;
    let hesitationPause = 400;
    let retypeDuration = 500;
    let postFixPause = 300;

    if (emotionUpper === 'EXCITED' || emotionUpper === 'SURPRISED') {
      realizePause = 450 + Math.random() * 180;
      hesitationPause = 180 + Math.random() * 120;
      retypeDuration = 260 + Math.random() * 140;
      postFixPause = 120 + Math.random() * 100;
    } else if (emotionUpper === 'ANALYTICAL') {
      realizePause = 700 + Math.random() * 180;
      hesitationPause = 350 + Math.random() * 160;
      retypeDuration = 420 + Math.random() * 150;
      postFixPause = 260 + Math.random() * 120;
    } else if (emotionUpper === 'CONTEMPLATIVE') {
      realizePause = 900 + Math.random() * 260;
      hesitationPause = 420 + Math.random() * 220;
      retypeDuration = 500 + Math.random() * 220;
      postFixPause = 320 + Math.random() * 160;
    }

    // Math context: pause longer to notice, retype more carefully
    if (isMathContext(index, chars)) {
      realizePause *= 1.2;
      retypeDuration *= 0.9;  // Slightly more controlled retype
    }

    return { realizePause, hesitationPause, retypeDuration, postFixPause };
  }

  async function animateTypoCorrection(index, span, typoInfo) {
    const { realizePause, hesitationPause, retypeDuration, postFixPause } = getTypoCorrectionTimings(index);

    // 1) Wrong char appears
    span.textContent = typoInfo.typoChar;
    span.style.opacity = '1';

    // Cursor after mistyped char
    setCursorBoundary(index + 1);

    // 2) Realize mistake pause
    if (!(await safeTimeout(realizePause))) return false;

    // 3) Move cursor back + delete simultaneously
    setCursorBoundary(index);
    span.style.opacity = '0';

    // 4) Hesitation
    if (!(await safeTimeout(hesitationPause))) return false;

    // 5) Retype correct char with cascade
    // CRITICAL FIX: Move cursor AFTER char BEFORE retype scramble (match normal typing)
    setCursorBoundary(index + 1);
    
    const ok = await scrambleSpan(span, retypeDuration, typoInfo.correctChar);
    if (!ok) return false;

    span.textContent = typoInfo.correctChar;
    span.style.opacity = '1';

    // 6) Short pause before cascade resumes
    if (!(await safeTimeout(postFixPause))) return false;

    return true;
  }

  // Character-type-aware scramble duration
  function getScrambleDurationForChar(index, targetChar) {
    // Base duration
    let duration = (120 + Math.random() * 90) * (0.85 + Math.random() * 0.3);

    const prevChar = index > 0 ? chars[index - 1] : '';

    // Spaces don't scramble (handled separately)
    if (isWordBoundaryChar(targetChar)) return 0;

    // Shift-heavy chars take longer (uppercase / symbols)
    if (isShiftLikelyChar(targetChar)) {
      duration += 40 + Math.random() * 90;
    }

    // Rare symbols take longer
    if (isRareSymbolChar(targetChar)) {
      duration += 50 + Math.random() * 110;
    }

    // Unicode/accented chars can take a little longer
    if (isUnicodeOrAccented(targetChar)) {
      duration += 40 + Math.random() * 100;
    }
    
    // Subscripts and superscripts require special input (longer)
    if (isSubscript(targetChar) || isSuperscript(targetChar)) {
      duration += 60 + Math.random() * 120;
    }

    // Punctuation often "snaps" in a bit faster visually, but pause is handled in cadence
    if (isPunctuation(targetChar)) {
      duration *= 0.8 + Math.random() * 0.15;
    }

    // First char of a word can feel more deliberate
    if (isWordBoundaryChar(prevChar)) {
      duration += 10 + Math.random() * 35;
    }

    return Math.max(40, duration);
  }

  async function animateNormalChar(index, span, targetChar) {
    // Move cursor to after this character BEFORE it starts cascading
    setCursorBoundary(index + 1);
    
    // Space appears immediately (or near-immediately in scheduler)
    if (isWordBoundaryChar(targetChar)) {
      span.textContent = ' ';
      span.style.opacity = '1';
      return true;
    }

    // Context-aware scramble duration
    const randomizedDuration = getScrambleDurationForChar(index, targetChar);

    const ok = await scrambleSpan(span, randomizedDuration, targetChar);
    if (!ok) return false;

    span.textContent = targetChar;
    span.style.opacity = '1';
    return true;
  }

  async function animateChar(index) {
    if (cancelled) return false;

    const span = charSpans[index];
    const targetChar = chars[index];
    const typoInfo = typoMap.get(index);

    if (typoInfo) {
      return animateTypoCorrection(index, span, typoInfo);
    }
    return animateNormalChar(index, span, targetChar);
  }

  // Helper to flush all pending normal character animations
  async function flushPendingNormals(pendingNormalAnimations) {
    if (pendingNormalAnimations.length === 0) return true;
    const results = await Promise.all(pendingNormalAnimations);
    pendingNormalAnimations.length = 0;
    return !results.some(r => !r);
  }

  // Humanized per-character start delay (punctuation pauses, word boundaries, hesitations)
  function getHumanizedStepDelay(index, baseSpeed, emphasisMultiplier) {
    const char = chars[index];
    const prevChar = index > 0 ? chars[index - 1] : '';

    // Start with base speed (not varied speed)
    let delay = baseSpeed;
    
    // Apply small base variation (not compounding)
    const baseVariation = 0.9 + Math.random() * 0.2;  // ±10% only (was much larger)
    delay *= baseVariation;
    
    // Apply character complexity weight
    delay *= getCharacterComplexity(char);

    // Micro-pause at word boundaries (slightly reduced)
    if (isWordBoundaryChar(char)) {
      delay += 12 + Math.random() * 35;  // Reduced (was 15-60)
    }

    // Slight pause for first char after a space
    if (isWordBoundaryChar(prevChar)) {
      delay += 8 + Math.random() * 25;  // Reduced (was 10-45)
    }

    // Apply emphasis multiplier to punctuation (intentional, not random)
    if (isClausePunctuation(char)) {
      delay *= emphasisMultiplier;
      delay += 40 + Math.random() * 80;  // Reduced (was 60-180)
    }

    if (isSentencePunctuation(char)) {
      delay *= emphasisMultiplier * 1.5;
      delay += 100 + Math.random() * 200;  // Reduced (was 140-400)
    }

    // Remove old random hesitation system (was too chaotic)
    // Punctuation emphasis above replaces this

    if (DEBUG_TYPING) {
      console.log('[TypingDelay]', { index, char, prevChar, delay: Math.round(delay) });
    }

    return delay;
  }

  async function run() {
    try {
      setCursorBoundary(0);

      const pendingNormalAnimations = [];

      // Check for pause at start of text
      if (pauseMap.has(0)) {
        const startPause = pauseMap.get(0);
        if (DEBUG_TYPING) {
          console.log('[Pause] Start-of-text pause:', startPause);
        }
        const okStartPause = await safeTimeout(startPause);
        if (!okStartPause) return;
      }

      for (let index = 0; index < chars.length; index++) {
        if (cancelled) return;

        // Defensive bounds check
        if (index < 0 || index >= chars.length || index >= charSpans.length) {
          console.error('[Animation] Index out of bounds:', index);
          break;
        }

        // Humanized staggered delay between character starts
        if (index > 0) {
          const rawDelay = getHumanizedStepDelay(
            index, 
            typingParams.baseSpeed,
            typingParams.emphasisMultiplier  // NEW: pass emphasis multiplier
          );
          
          // NEW: Apply momentum smoothing to final delay
          const smoothedDelay = animationMomentum.update(rawDelay);
          
          const okDelay = await safeTimeout(smoothedDelay);
          if (!okDelay) return;
        }

        const span = charSpans[index];
        const targetChar = chars[index];
        
        // Defensive null check on span
        if (!span) {
          console.error('[Animation] Missing span at index:', index);
          continue;
        }
        
        const typoInfo = typoMap.get(index);

        if (typoInfo) {
          // HARD BARRIER: wait for all currently cascading normal chars to finish
          const okFlush = await flushPendingNormals(pendingNormalAnimations);
          if (!okFlush) return;

          // Typo correction blocks everything
          const okTypo = await animateTypoCorrection(index, span, typoInfo);
          if (!okTypo) return;
        } else {
          // Fire-and-forget normal char (still tracked so typos can sync)
          pendingNormalAnimations.push(animateNormalChar(index, span, targetChar));
        }

        // Check for pause AFTER this character (before next character)
        if (pauseMap.has(index + 1)) {
          // Flush all pending animations before pause
          const okFlush = await flushPendingNormals(pendingNormalAnimations);
          if (!okFlush) return;

          const pauseDuration = pauseMap.get(index + 1);

          if (DEBUG_TYPING) {
            console.log('[Pause]', {
              afterCharIndex: index,
              duration: pauseDuration,
              textSoFar: chars.slice(0, index + 1).join('')
            });
          }

          const okPause = await safeTimeout(pauseDuration);
          if (!okPause) return;  // Interrupt during pause
        }
      }

      // Final barrier: wait for any trailing normal chars to finish
      const okFinal = await flushPendingNormals(pendingNormalAnimations);
      if (!okFinal) return;

      // Check for pause at end of text
      if (pauseMap.has(chars.length)) {
        const endPause = pauseMap.get(chars.length);
        if (DEBUG_TYPING) {
          console.log('[Pause] End-of-text pause:', endPause);
        }
        const okEndPause = await safeTimeout(endPause);
        if (!okEndPause) return;
      }

      if (!cancelled && cursor) {
        cursor.classList.add('blinking');
        finishOnce();
      }
    } catch (err) {
      console.error('[Typing Animation] Error:', err);
      if (!cancelled && element) {
        // Fail safe: show final text
        try {
          element.textContent = cleanText;
          const fallbackCursor = document.createElement('span');
          fallbackCursor.className = 'text-cursor blinking';
          fallbackCursor.textContent = '█';
          element.appendChild(fallbackCursor);
        } catch (domError) {
          console.error('[Animation] DOM manipulation failed:', domError);
        }
        finishOnce();
      }
    }
  }

  // Start
  setCursorBoundary(0);
  run();

  // Return object with cancel methods
  const cancelObj = {
    cancel(mode = 'clear') {
      if (cancelled) return; // Already cancelled
      
      console.log(`[Animation] Cancelling run ${animationRunId} with mode: ${mode}`);
      
      cancelled = true;
      
      // NEW: Invalidate this and all prior runs
      if (animationRunId === currentActiveRunId) {
        currentActiveRunId++;
      }
      
      // Cancel all pending operations
      animationFrames.forEach(raf => cancelAnimationFrame(raf));
      timeouts.forEach(t => clearTimeout(t));
      animationFrames.length = 0;
      timeouts.length = 0;
      
      // Apply cancel mode
      switch (mode) {
        case 'clear':
          // Abort and clear (interrupt)
          element.textContent = '';
          break;
          
        case 'complete':
          // Skip animation but show final text (instant complete)
          element.textContent = cleanPauseMarkers(targetText);
          break;
          
        case 'freeze':
          // Leave partial text as-is
          // Do nothing - text stays at current state
          break;
          
        default:
          console.warn(`[Animation] Unknown cancel mode: ${mode}, defaulting to clear`);
          element.textContent = '';
      }
      
      // Add cursor in all cases
      const finalCursor = document.createElement('span');
      finalCursor.className = 'text-cursor blinking';
      finalCursor.textContent = '█';
      element.appendChild(finalCursor);
      
      // Only call finishOnce if NOT already completed
      if (!finished) {
        finishOnce();
      }
    }
  };
  
  // Make cancelObj callable as function (backwards compatibility)
  const cancelFn = cancelObj.cancel.bind(cancelObj, 'clear');
  cancelFn.cancel = cancelObj.cancel;
  
  return cancelFn;
}

// Copy deletion animation from textAnimation.js (preserving full implementation)
function getDeletionParams(emotion, intensity) {
  // Base parameters
  let dasDelay = 400;
  let dasCharCount = 1;
  let arrRate = 50;
  let initialDeleteDelay = 300;
  let chucklePause = false;
  let wordDeleteChance = 0;
  let sentenceDeleteChance = 0;

  switch (emotion) {
    case 'BORED':
      dasDelay = 600 + (1.0 - intensity) * 400;
      arrRate = 80 + (1.0 - intensity) * 60;
      initialDeleteDelay = 500 + (1.0 - intensity) * 300;
      wordDeleteChance = 0.2 + intensity * 0.2;
      sentenceDeleteChance = intensity * 0.1;
      break;

    case 'EXCITED':
      dasDelay = 150 - intensity * 50;
      arrRate = 25 - intensity * 10;
      initialDeleteDelay = 100 - intensity * 30;
      sentenceDeleteChance = intensity * 0.3;
      break;

    case 'CONCERNED':
      dasDelay = 500 + (1.0 - intensity) * 200;
      arrRate = 70 + (1.0 - intensity) * 40;
      initialDeleteDelay = 400 + (1.0 - intensity) * 200;
      wordDeleteChance = 0.1 + intensity * 0.15;
      break;

    case 'SURPRISED':
      dasDelay = 200 - intensity * 50;
      arrRate = 35 - intensity * 10;
      initialDeleteDelay = 150 - intensity * 50;
      sentenceDeleteChance = intensity * 0.2;
      break;

    case 'AMUSED':
      dasDelay = 300;
      arrRate = 40;
      initialDeleteDelay = 200;
      chucklePause = intensity > 0.5;
      wordDeleteChance = intensity * 0.25;
      break;

    case 'ANALYTICAL':
      dasDelay = 400;
      arrRate = 50;
      initialDeleteDelay = 300;
      wordDeleteChance = 0.2 + intensity * 0.2;
      sentenceDeleteChance = intensity * 0.15;
      break;

    case 'CONTEMPLATIVE':
      dasDelay = 500 + (1.0 - intensity) * 300;
      arrRate = 65 + (1.0 - intensity) * 35;
      initialDeleteDelay = 400 + (1.0 - intensity) * 300;
      wordDeleteChance = 0.15 + intensity * 0.2;
      break;

    case 'CURIOUS':
      dasDelay = 350;
      arrRate = 45;
      initialDeleteDelay = 250;
      wordDeleteChance = intensity * 0.2;
      break;

    default:
      break;
  }

  return {
    dasDelay,
    dasCharCount,
    arrRate,
    initialDeleteDelay,
    chucklePause,
    wordDeleteChance,
    sentenceDeleteChance,
  };
}

export function animateTextOut(element, onComplete, options = {}) {
  // Defensive null checks
  if (!element || !(element instanceof HTMLElement)) {
    console.error('[Animation] Invalid element in animateTextOut');
    if (onComplete) onComplete();
    return () => {};
  }
  
  // NEW: Generate unique run ID
  const animationRunId = ++globalAnimationRunId;
  currentActiveRunId = animationRunId;
  
  console.log(`[Animation] Starting deletion run ${animationRunId}`);
  
  const {
    emotion = 'NEUTRAL',
    intensity = 0.5,
    themes = [],
  } = options || {};

  // Clamp intensity to valid range
  const clampedIntensity = Math.max(0, Math.min(1, intensity));

  const deletionParams = getDeletionParams(emotion, clampedIntensity);
  const { dasDelay, dasCharCount, arrRate, initialDeleteDelay, chucklePause, wordDeleteChance, sentenceDeleteChance } = deletionParams;

  const hasHumorTheme = themes.some(t =>
    ['joke', 'humor', 'humour', 'pun', 'witty', 'sarcastic', 'playful'].includes(t.toLowerCase())
  );
  const shouldChuckle = chucklePause && hasHumorTheme;

  const rand = Math.random();
  let deletionStrategy = 'character';

  if (rand < sentenceDeleteChance) {
    deletionStrategy = 'select_all';  // Full line wipe
    if (DEBUG_DELETION) {
      console.log(`[Delete] SELECT_ALL delete - ${emotion}, intensity ${intensity.toFixed(2)}`);
    }
  } else if (rand < sentenceDeleteChance + wordDeleteChance) {
    deletionStrategy = 'word';
    if (DEBUG_DELETION) {
      console.log(`[Delete] WORD delete - ${emotion}, intensity ${intensity.toFixed(2)}`);
    }
  } else {
    if (DEBUG_DELETION) {
      console.log(`[Delete] CHARACTER delete - ${emotion}, intensity ${intensity.toFixed(2)}`);
    }
  }

  let cancelled = false;
  const timeouts = [];

  // Prevent double onComplete() calls
  let finished = false;
  function finishOnce() {
    // NEW: Guard by run ID
    if (animationRunId !== currentActiveRunId) {
      console.log(`[Animation] Stale deletion completion ignored (run ${animationRunId})`);
      return;
    }
    
    if (finished) return;
    finished = true;
    if (onComplete) onComplete();
  }

  let charSpans = [];

  try {
    element.querySelectorAll('.text-cursor').forEach(c => c.remove());
  } catch (error) {
    console.error('[Animation] Error removing cursors:', error);
  }

  // Robust span detection
  try {
    Array.from(element.childNodes).forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && !node.classList.contains('text-cursor')) {
        charSpans.push(node);
      }
    });
  } catch (error) {
    console.error('[Animation] Error detecting spans:', error);
    if (onComplete) onComplete();
    return () => {};
  }

  if (charSpans.length === 0) {
    const textContent = element.textContent || '';
    if (textContent.length === 0) {
      element.style.minWidth = '';
      element.style.maxWidth = '';
      finishOnce();
      return () => {};
    }

    // Use grapheme-aware splitting
    try {
      element.textContent = '';
      const chars = splitGraphemes(textContent);
      charSpans = chars.map(char => {
        const span = document.createElement('span');
        span.textContent = char;
        element.appendChild(span);
        return span;
      });
    } catch (error) {
      console.error('[Animation] Error creating spans:', error);
      if (onComplete) onComplete();
      return () => {};
    }
  }

  const cursor = document.createElement('span');
  cursor.className = 'text-cursor';
  cursor.textContent = '█';
  
  try {
    element.appendChild(cursor);
  } catch (error) {
    console.error('[Animation] Error appending cursor:', error);
  }
  
  if (deletionStrategy === 'select_all') {
    // Visual "selection" effect - apply background to parent container
    element.classList.add('has-selection');
    
    // Hide cursor during selection
    cursor.style.opacity = '0';
    
    // Ensure all spans are visible for selection effect
    charSpans.forEach(span => {
      span.style.opacity = '1';
    });

    const selectionPause = 800 + Math.random() * 600;

    const timeout = setTimeout(() => {
      if (cancelled) return;

      // Remove selection styling
      element.classList.remove('has-selection');
      
      // Show cursor again
      cursor.style.opacity = '1';
      
      // Fade out characters
      charSpans.forEach(span => span.style.opacity = '0');

      const deleteTimeout = setTimeout(() => {
        if (cancelled) return;

        charSpans.forEach(span => span.remove());
        cursor.className = 'text-cursor blinking';
        element.style.minWidth = '';
        element.style.maxWidth = '';
        finishOnce();
      }, 100);
      timeouts.push(deleteTimeout);
    }, selectionPause);
    timeouts.push(timeout);

    return () => {
      cancelled = true;
      timeouts.forEach(t => clearTimeout(t));
      if (cursor) cursor.remove();
      element.textContent = '';
      element.style.minWidth = '';
      element.style.maxWidth = '';
      finishOnce();
    };
  }

  if (deletionStrategy === 'word') {
    const words = [];
    let currentWord = [];

    // Group words with their trailing spaces for more natural deletion
    charSpans.forEach((span, i) => {
      if (isWordBoundaryChar(span.textContent)) {
        // Add space to current word (trailing space)
        if (currentWord.length > 0) {
          currentWord.push(span);
          words.push([...currentWord]);
          currentWord = [];
        } else {
          // Standalone space (multiple spaces)
          words.push([span]);
        }
      } else {
        currentWord.push(span);
      }
    });
    if (currentWord.length > 0) {
      words.push(currentWord);
    }

    let wordIndex = words.length - 1;

    function deleteNextWord() {
      if (cancelled) return;

      if (wordIndex < 0) {
        // Show cursor again when done
        cursor.style.opacity = '1';
        cursor.className = 'text-cursor blinking';
        element.style.minWidth = '';
        element.style.maxWidth = '';
        finishOnce();
        return;
      }

      const word = words[wordIndex];

      // Hide cursor during selection
      cursor.style.opacity = '0';

      // Wrap word spans in a selection wrapper for proper background
      const wrapper = document.createElement('span');
      wrapper.className = 'word-selection-wrapper';
      
      // Ensure all word spans are visible
      word.forEach(span => {
        span.style.opacity = '1';
      });
      
      // Insert wrapper before first span in word
      const firstSpan = word[0];
      firstSpan.parentNode.insertBefore(wrapper, firstSpan);
      
      // Move all word spans into wrapper
      word.forEach(span => {
        wrapper.appendChild(span);
      });

      const selectionPause = 200 + Math.random() * 300;

      const timeout = setTimeout(() => {
        if (cancelled) return;

        // Remove the entire wrapper (with all word spans)
        wrapper.remove();
        wordIndex--;

        // Show cursor briefly between words
        if (wordIndex >= 0) {
          cursor.style.opacity = '1';
        }

        const nextTimeout = setTimeout(deleteNextWord, 100 + Math.random() * 150);
        timeouts.push(nextTimeout);
      }, selectionPause);
      timeouts.push(timeout);
    }

    const initialTimeout = setTimeout(deleteNextWord, 120 + Math.random() * 80);
    timeouts.push(initialTimeout);

    return () => {
      cancelled = true;
      timeouts.forEach(t => clearTimeout(t));
      if (cursor) cursor.remove();
      element.textContent = '';
      element.style.minWidth = '';
      element.style.maxWidth = '';
      finishOnce();
    };
  }

  // CHARACTER DELETE
  let currentIndex = charSpans.length - 1;
  let deleteCount = 0;
  let isRepeating = false;

  function deleteNext() {
    if (cancelled) return;

    if (currentIndex < 0) {
      cursor.className = 'text-cursor blinking';
      element.style.minWidth = '';
      element.style.maxWidth = '';
      finishOnce();
      return;
    }

    const span = charSpans[currentIndex];
    const char = span.textContent;
    
    if (DEBUG_DELETION) {
      console.log('[DeleteChar]', { index: currentIndex, char });
    }
    
    span.remove();
    currentIndex--;
    deleteCount++;

    if (!isRepeating && deleteCount >= dasCharCount) {
      isRepeating = true;
    }

    let nextDelay = isRepeating ? arrRate : dasDelay;

    // Punctuation hesitation - pause slightly before deleting punctuation
    if (/[.,;:!?]/.test(char) && Math.random() < 0.5) {
      nextDelay += 80 + Math.random() * 180;
    }

    if (shouldChuckle && Math.random() < 0.15) {
      nextDelay = 600 + Math.random() * 400;
    }

    const timeout = setTimeout(deleteNext, nextDelay);
    timeouts.push(timeout);
  }

  const initialTimeout = setTimeout(deleteNext, initialDeleteDelay);
  timeouts.push(initialTimeout);

  return () => {
    if (cancelled) return;
    cancelled = true;
    
    // NEW: Invalidate this and all prior runs
    if (animationRunId === currentActiveRunId) {
      currentActiveRunId++;
    }
    
    timeouts.forEach(t => clearTimeout(t));
    if (cursor) cursor.remove();
    element.textContent = '';
    element.style.minWidth = '';
    element.style.maxWidth = '';
    finishOnce();
  };
}

// ============================================================================
// DEBUG & TUNING UTILITIES
// ============================================================================

/**
 * Trace speed calculation through all layers
 */
function traceSpeedCalculation(emotion, intensity, tone) {
  const trace = [];
  
  // Layer 1: Emotion base
  let params = getTypingParams(emotion, intensity);
  trace.push({ layer: 'emotion_base', speed: params.baseSpeed });
  
  // Layer 2: Tone adjustment
  const toneParams = applyToneModifiers(params, tone, emotion);
  trace.push({ 
    layer: 'tone_applied', 
    speed: toneParams.baseSpeed,
    delta: toneParams.baseSpeed - params.baseSpeed
  });
  
  // Layer 3: Bounds
  const clamped = Math.max(SPEED_BOUNDS.min, Math.min(SPEED_BOUNDS.max, toneParams.baseSpeed));
  trace.push({ 
    layer: 'clamped', 
    speed: clamped,
    wasLimited: clamped !== toneParams.baseSpeed
  });
  
  return { finalSpeed: clamped, trace, params: toneParams };
}

/**
 * Add debug tools to window
 */
if (typeof window !== 'undefined') {
  window.chazyDebug = window.chazyDebug || {};
  
  window.chazyDebug.testSpeed = function(config) {
    const { emotion, intensity, tone, text } = config;
    const result = traceSpeedCalculation(emotion, intensity, tone);
    
    console.group('🔬 Speed Calculation Trace');
    console.log('Input:', { emotion, intensity, tone });
    console.log('Trace:', result.trace);
    console.log('Final Speed:', result.finalSpeed, 'ms/char');
    console.log('Full Params:', result.params);
    
    if (text) {
      const estimatedDuration = text.length * result.finalSpeed;
      console.log('Estimated Duration:', estimatedDuration, 'ms for', text.length, 'chars');
    }
    
    console.groupEnd();
    
    return result;
  };
  
  window.chazyDebug.speedBounds = SPEED_BOUNDS;
  window.chazyDebug.idleBounds = IDLE_BOUNDS;
  window.chazyDebug.pauseBounds = PAUSE_BOUNDS;
  window.chazyDebug.displayBounds = DISPLAY_BOUNDS;
  
  window.chazyDebug.resetMomentum = function() {
    animationMomentum.reset();
    console.log('✅ Animation momentum reset to 1.0');
  };
}

