// Character pool for scramble animations
const CHAR_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';

// Mathematical and Greek symbols pool
const MATH_GREEK_POOL = 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔';

// Extended math pool including ASCII operators and digits for equation scrambling
const MATH_EXTENDED_POOL = MATH_GREEK_POOL + '0123456789+-=*/()[]{}<>^|';

// Debug flags for tuning (set to true to enable logging)
const DEBUG_TYPING = false;
const DEBUG_DELETION = false;

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
  '*': ['×', '·'],
  '·': ['.', '×', '*'],
  '/': ['÷', '|'],
  '∝': ['∞', 'α'],
  '∞': ['8', '∝'],
  '∂': ['δ', 'd'],
  '∇': ['Δ', 'V'],
  '√': ['∛', 'v'],
  '∛': ['√', '∜'],
  '∜': ['∛', '√'],

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
  if (/[=+\-*/^()[\]{}<>|∑∫∂∇∞≈≠≤≥±×÷√∛∜∝∈∉⊂⊃∪∩∧∨¬∀∃∄←→↔⇐⇒⇔α-ωΑ-Ω]/.test(neighborhood)) {
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

function getTypingParams(emotion, intensity) {
  const params = {
    baseSpeed: 50,
    speedVariation: 0.3,
    typoChance: 0.03,
    pauseChance: 0.1,
    pauseDuration: 200,
  };

  switch (emotion) {
    case 'BORED':
      params.baseSpeed = 120 + (1.0 - intensity) * 80;
      params.speedVariation = 0.6;
      params.typoChance = 0.008;
      params.pauseChance = 0.3;
      params.pauseDuration = 400 + (1.0 - intensity) * 300;
      break;

    case 'EXCITED':
      params.baseSpeed = 30 - intensity * 10;
      params.speedVariation = 0.4;
      params.typoChance = 0.025 + intensity * 0.025;
      params.pauseChance = 0.05;
      params.pauseDuration = 100;
      break;

    case 'CONCERNED':
      params.baseSpeed = 80 + (1.0 - intensity) * 40;
      params.speedVariation = 0.3;
      params.typoChance = 0.02 + intensity * 0.015;
      params.pauseChance = 0.2;
      params.pauseDuration = 300 + intensity * 200;
      break;

    case 'SURPRISED':
      params.baseSpeed = 35 - intensity * 10;
      params.speedVariation = 0.5;
      params.typoChance = 0.035 + intensity * 0.03;
      params.pauseChance = 0.15;
      params.pauseDuration = 200;
      break;

    case 'AMUSED':
      params.baseSpeed = 55;
      params.speedVariation = 0.35;
      params.typoChance = 0.018;
      params.pauseChance = 0.12;
      params.pauseDuration = 250;
      break;

    case 'ANALYTICAL':
      params.baseSpeed = 60;
      params.speedVariation = 0.2;
      params.typoChance = 0.012;
      params.pauseChance = 0.15;
      params.pauseDuration = 300;
      break;

    case 'CONTEMPLATIVE':
      params.baseSpeed = 90 + (1.0 - intensity) * 60;
      params.speedVariation = 0.4;
      params.typoChance = 0.01;
      params.pauseChance = 0.25;
      params.pauseDuration = 350 + (1.0 - intensity) * 250;
      break;

    case 'CURIOUS':
      params.baseSpeed = 50;
      params.speedVariation = 0.35;
      params.typoChance = 0.02;
      params.pauseChance = 0.12;
      params.pauseDuration = 220;
      break;

    default:
      break;
  }

  return params;
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
  return false;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
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
  const {
    emotion = 'NEUTRAL',
    intensity = 0.5,
  } = options;

  const typingParams = getTypingParams(emotion, intensity);
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

  // Use grapheme-aware splitting for proper emoji/combining mark handling
  const chars = splitGraphemes(targetText);
  const charSpans = [];

  // Prevent double onComplete() calls in edge cases (interrupts, errors)
  let finished = false;
  function finishOnce() {
    if (finished) return;
    finished = true;
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
    if (!cursor.parentNode) return;
    
    if (boundary <= 0) {
      // Check if target span still exists in DOM
      const firstSpan = charSpans[0];
      if (firstSpan && firstSpan.parentNode === element) {
        element.insertBefore(cursor, firstSpan);
      }
      return;
    }
    if (boundary >= charSpans.length) {
      element.appendChild(cursor);
      return;
    }
    // Check if target span still exists in DOM
    const targetSpan = charSpans[boundary];
    if (targetSpan && targetSpan.parentNode === element) {
      element.insertBefore(cursor, targetSpan);
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

  // Scramble a character span for durationMs, then caller decides what to lock in
  async function scrambleSpan(span, durationMs, targetChar = '') {
    const start = performance.now();
    
    // Choose scramble pool based on target character type
    const useMathPool = isMathOrGreekSymbol(targetChar) || /[=+\-*/^()[\]{}<>|0-9]/.test(targetChar);
    const pool = useMathPool ? MATH_EXTENDED_POOL : CHAR_POOL;

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
  function getHumanizedStepDelay(index) {
    const char = chars[index];
    const prevChar = index > 0 ? chars[index - 1] : '';

    // Base cadence randomness
    const delayVariation = 1.0 + ((Math.random() - 0.5) * 2 * typingParams.speedVariation);
    let delay = Math.max(0, cascadeDelay * delayVariation);

    // Micro-pause at word boundaries (space after a word)
    if (isWordBoundaryChar(char)) {
      delay += 15 + Math.random() * 45;
    }

    // Slight pause for first char after a space (starting next word)
    if (isWordBoundaryChar(prevChar)) {
      delay += 10 + Math.random() * 35;
    }

    // Clause punctuation gets a pause
    if (isClausePunctuation(char)) {
      delay += 60 + Math.random() * 120;
    }

    // Sentence punctuation gets a bigger pause
    if (isSentencePunctuation(char)) {
      delay += 140 + Math.random() * 260;
    }

    // Optional random hesitation (uses existing pauseChance/pauseDuration params!)
    // Bias toward occurring at boundaries / punctuation rather than random mid-word
    const hesitationBias =
      (isWordBoundaryChar(char) ? 1.5 : 1.0) *
      (isPunctuation(char) ? 1.8 : 1.0) *
      (isWordBoundaryChar(prevChar) ? 1.2 : 1.0);

    const effectivePauseChance = clamp01(typingParams.pauseChance * hesitationBias * 0.6);

    if (Math.random() < effectivePauseChance) {
      const jitter = 0.6 + Math.random() * 0.8; // 0.6x to 1.4x
      delay += typingParams.pauseDuration * jitter;
    }

    if (DEBUG_TYPING) {
      console.log('[TypingDelay]', { index, char, prevChar, delay: Math.round(delay) });
    }

    return delay;
  }

  async function run() {
    try {
      setCursorBoundary(0);

      const pendingNormalAnimations = [];

      for (let index = 0; index < chars.length; index++) {
        if (cancelled) return;

        // Humanized staggered delay between character starts
        if (index > 0) {
          const stepDelay = getHumanizedStepDelay(index);
          const okDelay = await safeTimeout(stepDelay);
          if (!okDelay) return;
        }

        const span = charSpans[index];
        const targetChar = chars[index];
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
      }

      // Final barrier: wait for any trailing normal chars to finish
      const okFinal = await flushPendingNormals(pendingNormalAnimations);
      if (!okFinal) return;

      if (!cancelled) {
        cursor.classList.add('blinking');
        finishOnce();
      }
    } catch (err) {
      console.error('[Typing Animation] Error:', err);
      if (!cancelled) {
        // Fail safe: show final text
        element.textContent = targetText;
        const fallbackCursor = document.createElement('span');
        fallbackCursor.className = 'text-cursor blinking';
        fallbackCursor.textContent = '█';
        element.appendChild(fallbackCursor);
        finishOnce();
      }
    }
  }

  // Start
  setCursorBoundary(0);
  run();

  return () => {
    cancelled = true;
    animationFrames.forEach(raf => cancelAnimationFrame(raf));
    timeouts.forEach(t => clearTimeout(t));

    element.textContent = targetText;
    const finalCursor = document.createElement('span');
    finalCursor.className = 'text-cursor blinking';
    finalCursor.textContent = '█';
    element.appendChild(finalCursor);

    finishOnce();
  };
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
  const {
    emotion = 'NEUTRAL',
    intensity = 0.5,
    themes = [],
  } = options;

  const deletionParams = getDeletionParams(emotion, intensity);
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
    if (finished) return;
    finished = true;
    if (onComplete) onComplete();
  }

  let charSpans = [];

  element.querySelectorAll('.text-cursor').forEach(c => c.remove());

  // Robust span detection
  Array.from(element.childNodes).forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && !node.classList.contains('text-cursor')) {
      charSpans.push(node);
    }
  });

  if (charSpans.length === 0) {
    const textContent = element.textContent || '';
    if (textContent.length === 0) {
      element.style.minWidth = '';
      element.style.maxWidth = '';
      finishOnce();
      return () => {};
    }

    // Use grapheme-aware splitting
    element.textContent = '';
    const chars = splitGraphemes(textContent);
    charSpans = chars.map(char => {
      const span = document.createElement('span');
      span.textContent = char;
      element.appendChild(span);
      return span;
    });
  }

  const cursor = document.createElement('span');
  cursor.className = 'text-cursor';
  cursor.textContent = '█';
  element.appendChild(cursor);

  if (deletionStrategy === 'select_all') {
    // Visual "selection" effect - invert colors (like real selection)
    charSpans.forEach(span => {
      span.classList.add('selected');
      span.style.opacity = '1';  // Ensure visible for selection effect
    });

    const selectionPause = 800 + Math.random() * 600;

    const timeout = setTimeout(() => {
      if (cancelled) return;

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
        cursor.className = 'text-cursor blinking';
        element.style.minWidth = '';
        element.style.maxWidth = '';
        finishOnce();
        return;
      }

      const word = words[wordIndex];

      // "Select" the word (invert colors like real selection)
      word.forEach(span => {
        span.classList.add('selected');
        span.style.opacity = '1';  // Ensure visible for selection effect
      });

      const selectionPause = 200 + Math.random() * 300;

      const timeout = setTimeout(() => {
        if (cancelled) return;

        word.forEach(span => span.remove());
        wordIndex--;

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
    cancelled = true;
    timeouts.forEach(t => clearTimeout(t));
    if (cursor) cursor.remove();
    element.textContent = '';
    element.style.minWidth = '';
    element.style.maxWidth = '';
    finishOnce();
  };
}
