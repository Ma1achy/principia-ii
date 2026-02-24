/**
 * @fileoverview Core dialog system for Principia
 * Implements a reusable, accessible dialog component with:
 * - State machine (IDLE → OPEN → CLOSING_GUARD → CLEANUP → IDLE)
 * - Concurrency control (single active dialog)
 * - Focus management (trap + restoration)
 * - Validation hooks (beforeClose)
 * - Persistence hooks (onOpenLoadState, onConfirmPersist)
 * - Keyboard navigation (Enter, Escape, Tab trap)
 * - Accessibility (ARIA attributes, focus management)
 */

import { fitTextToWidth } from '../../utils/textFit.js';

// ═══════════════════════════════════════════════════════════════════════════
// DialogManager - Singleton State Machine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {'IDLE' | 'OPEN' | 'CLOSING_GUARD' | 'CLEANUP'} DialogState
 */

class DialogManagerClass {
  constructor() {
    /** @type {DialogState} */
    this.state = 'IDLE';
    
    /** @type {string|null} */
    this.currentDialogId = null;
    
    /** @type {boolean} - Separate from isOpen for re-entrant guard */
    this.isBusy = false;
    
    /** @type {HTMLElement|null} - Reusable container */
    this.rootElement = null;
    
    /** @type {Element|null} - For focus restoration */
    this.restoreFocusTarget = null;
    
    /** @type {Object} - Current normalized options */
    this.currentOptions = null;
    
    /** @type {Function[]} - Event handler cleanup functions */
    this.handlers = [];
    
    /** @type {Function|null} - Promise resolve callback */
    this.resolvePromise = null;
    
    /** @type {Function|null} - Promise reject callback */
    this.rejectPromise = null;
  }
  
  isOpen() {
    return this.state !== 'IDLE';
  }
  
  getCurrentId() {
    return this.currentDialogId;
  }
}

// Singleton instance
const DialogManager = new DialogManagerClass();

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard Mode Detection
// ═══════════════════════════════════════════════════════════════════════════

let keyboardModeActive = false;

function enableKeyboardMode() {
  if (!keyboardModeActive) {
    keyboardModeActive = true;
    document.documentElement.classList.add('keyboard-mode');
  }
}

function disableKeyboardMode() {
  if (keyboardModeActive) {
    keyboardModeActive = false;
    document.documentElement.classList.remove('keyboard-mode');
  }
}

// Listen for keyboard events to enable keyboard mode
document.addEventListener('keydown', (e) => {
  // Enable keyboard mode on Tab or arrow keys
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
    enableKeyboardMode();
  }
});

// Listen for mouse events to disable keyboard mode
document.addEventListener('mousedown', () => {
  disableKeyboardMode();
});

// ═══════════════════════════════════════════════════════════════════════════
// Type Definitions (JSDoc)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} DialogOptions
 * @property {string} id - Unique dialog identifier
 * @property {string} title - Dialog title
 * @property {Object} [content] - Content configuration
 * @property {Array<{text: string, style?: string, strong?: boolean}>} [content.paragraphs] - Paragraph array
 * @property {string} [content.text] - Simple text (split on \n)
 * @property {Array<{id: string, type: 'number'|'text', label?: string, value?: string|number, min?: number, max?: number, step?: number, placeholder?: string, selectOnFocus?: boolean}>} [fields] - Input fields
 * @property {Array<{id: string, label: string, defaultChecked?: boolean, helpText?: string, persistKey?: string}>} [checkboxes] - Checkbox array
 * @property {Array<{id: string, label?: string, labelPoolId?: string, role: 'primary'|'secondary'|'danger', intent?: 'confirm'|'cancel'|'dismiss'|'other', closes?: boolean, autoFocus?: boolean, hotkey?: 'Enter'|'Escape', returns?: any, disabled?: boolean}>} buttons - Button array (required)
 * @property {string[]} [confirmActionIds] - Button IDs that count as "confirmed"
 * @property {'info'|'warning'|'danger'} [variant] - Visual variant
 * @property {boolean} [closeOnEscape] - Allow Escape to close (default true)
 * @property {boolean} [closeOnBackdrop] - Allow backdrop click to close (default false)
 * @property {boolean} [restoreFocus] - Restore focus on close (default true)
 * @property {Function} [onOpenLoadState] - Load initial state hook
 * @property {Function} [onConfirmPersist] - Persist state hook (confirmed only)
 * @property {Function} [beforeClose] - Validation hook, return false to prevent close
 * @property {Object} [eventBridge] - Event emission
 * @property {Object} [chazy] - Chazy integration
 * @property {Object} [contentPool] - ContentPool instance for label randomization
 */

/**
 * @typedef {Object} DialogResult
 * @property {string} dialogId - Dialog ID
 * @property {boolean} confirmed - True if confirmed (computed from confirmActionIds/intent)
 * @property {string|null} action - Button ID clicked (or null)
 * @property {'button'|'escape'|'backdrop'|'programmatic'} dismissedBy - How dialog was closed
 * @property {Record<string, boolean>} checks - Checkbox states
 * @property {Record<string, string>} values - Field values (raw strings)
 * @property {any} [buttonReturn] - Button's return value
 * @property {number} timestamp - Close timestamp
 */

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show a modal dialog
 * @param {DialogOptions} options - Dialog configuration
 * @returns {Promise<DialogResult>} Resolves when dialog closes
 */
export async function showDialog(options) {
  // ─────────────────────────────────────────────────────────────────────
  // Phase 1: Pre-Open (Validation)
  // ─────────────────────────────────────────────────────────────────────
  
  // 1.1 Concurrency check
  if (DialogManager.isOpen()) {
    const err = new Error('Dialog already open');
    err.code = 'DIALOG_ALREADY_OPEN';
    err.dialogId = options.id;
    err.currentDialogId = DialogManager.getCurrentId();
    console.warn('[Dialog] Rejected:', options.id, '(already open:', err.currentDialogId + ')');
    return Promise.reject(err);
  }
  
  // 1.2 Normalize options
  const normalized = normalizeOptions(options);
  
  // 1.3 Validate required fields
  if (!normalized.id || !normalized.title || !normalized.buttons.length) {
    throw new Error('Invalid dialog options: missing required fields');
  }
  
  // Store for use in handlers
  DialogManager.currentOptions = normalized;
  
  // ─────────────────────────────────────────────────────────────────────
  // Phase 2: Initialization
  // ─────────────────────────────────────────────────────────────────────
  
  // 2.1 Claim dialog slot
  DialogManager.state = 'OPEN';
  DialogManager.currentDialogId = normalized.id;
  
  // 2.2 Create or reuse root container
  if (!DialogManager.rootElement) {
    DialogManager.rootElement = createDialogRoot();
    document.body.appendChild(DialogManager.rootElement);
  }
  
  // 2.3 Hydrate initial state (defaults + hook)
  const initialState = await loadInitialState(normalized);
  
  // 2.4 Render dialog DOM
  renderDialog(DialogManager.rootElement, normalized, initialState);
  
  // 2.5 Store current focus for restoration
  DialogManager.restoreFocusTarget = document.activeElement;
  
  // 2.6 Bind event handlers
  bindHandlers(normalized, DialogManager.rootElement);
  
  // 2.7 Focus initial element
  focusInitialElement(DialogManager.rootElement, normalized);
  
  // 2.8 Emit open event
  emitEvent(normalized, 'open');
  
  // ─────────────────────────────────────────────────────────────────────
  // Phase 3: Interactive (Waiting)
  // ─────────────────────────────────────────────────────────────────────
  
  // Dialog is now open, waiting for user interaction
  // Resolution happens via event handlers calling handleCloseAttempt()
  
  // Return promise that will be resolved by close handlers
  return new Promise((resolve, reject) => {
    DialogManager.resolvePromise = resolve;
    DialogManager.rejectPromise = reject;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Option Normalization
// ═══════════════════════════════════════════════════════════════════════════

function normalizeOptions(options) {
  // Check if paired selection should be used (25% chance if pairPoolId specified)
  let pairedLabels = null;
  if (options.pairPoolId && options.contentPool) {
    const usePair = Math.random() < 0.5; // 25% chance
    if (usePair) {
      try {
        pairedLabels = options.contentPool.selectPair(options.pairPoolId, {
          fallback: { cancel: 'CANCEL', confirm: 'OK' }
        });
        console.log('[Dialog] Using paired labels:', pairedLabels);
      } catch (err) {
        console.error(`[Dialog] Pair selection failed:`, err);
      }
    }
  }
  
  // Normalize buttons with validation, fallbacks, and label randomization
  const normalizedButtons = (options.buttons || []).map((btn, index) => {
    // Resolve label: paired → labelPoolId → ContentPool → label → fallback
    let label = btn.label;
    
    // If paired labels available and button has pairedKey, use paired label
    if (pairedLabels && btn.pairedKey && pairedLabels[btn.pairedKey]) {
      label = pairedLabels[btn.pairedKey];
    }
    // Otherwise, if labelPoolId specified, use ContentPool to select label
    else if (btn.labelPoolId && options.contentPool) {
      try {
        label = options.contentPool.select(btn.labelPoolId, {
          fallback: btn.label || 'OK',
          session: false  // Randomize on every dialog appearance
        });
      } catch (err) {
        console.error(`[Dialog] Label pool selection failed for button ${btn.id}:`, err);
        label = btn.label || 'OK';
      }
    }
    
    // Final fallback
    if (!label) {
      label = 'OK';
    }
    
    return {
      id: btn.id || `button_${index}`,
      label: label,
      role: btn.role || 'secondary',
      intent: btn.intent,
      closes: btn.closes !== false,
      autoFocus: btn.autoFocus || false,
      hotkey: btn.hotkey,
      returns: btn.returns,
      disabled: btn.disabled || false
    };
  });
  
  return {
    // Required
    id: options.id,
    title: options.title,
    buttons: normalizedButtons,
    
    // Content (normalized to paragraphs)
    paragraphs: normalizeParagraphs(options.content),
    
    // Optional arrays
    fields: options.fields || [],
    checkboxes: options.checkboxes || [],
    
    // Behavior
    variant: options.variant || 'info',
    closeOnEscape: options.closeOnEscape !== false,
    closeOnBackdrop: options.closeOnBackdrop || false,
    restoreFocus: options.restoreFocus !== false,
    
    // Computation
    confirmActionIds: options.confirmActionIds || [],
    
    // Hooks
    onOpenLoadState: options.onOpenLoadState || null,
    onConfirmPersist: options.onConfirmPersist || null,
    beforeClose: options.beforeClose || null,
    
    // Integration
    eventBridge: options.eventBridge || null,
    chazy: options.chazy || null,
    contentPool: options.contentPool || null
  };
}

function normalizeParagraphs(content) {
  if (!content) return [];
  
  if (content.paragraphs) {
    return content.paragraphs;
  }
  
  if (content.text) {
    return content.text.split('\n').map(text => ({ text: text.trim() })).filter(p => p.text);
  }
  
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// State Loading
// ═══════════════════════════════════════════════════════════════════════════

async function loadInitialState(normalized) {
  // Start with defaults from options
  const initialState = {
    checks: {},
    values: {}
  };
  
  // Apply defaults from checkboxes
  normalized.checkboxes.forEach(chk => {
    if (chk.defaultChecked) {
      initialState.checks[chk.id] = true;
    }
  });
  
  // Apply defaults from fields
  normalized.fields.forEach(field => {
    if (field.value !== undefined) {
      initialState.values[field.id] = String(field.value);
    }
  });
  
  // Hook overrides defaults (if present)
  if (normalized.onOpenLoadState) {
    try {
      const loaded = normalized.onOpenLoadState();
      // Merge: hook values override defaults
      if (loaded.checks) {
        Object.assign(initialState.checks, loaded.checks);
      }
      if (loaded.values) {
        Object.assign(initialState.values, loaded.values);
      }
    } catch (err) {
      console.error('[Dialog] onOpenLoadState failed:', err);
    }
  }
  
  return initialState;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM Creation & Rendering
// ═══════════════════════════════════════════════════════════════════════════

function createDialogRoot() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  
  const box = document.createElement('div');
  box.className = 'dialog-box';
  
  overlay.appendChild(box);
  return overlay;
}

function renderDialog(rootElement, options, initialState) {
  const box = rootElement.querySelector('.dialog-box');
  box.innerHTML = '';
  
  // Set ARIA label
  rootElement.setAttribute('aria-labelledby', 'dialog-title-' + options.id);
  
  // Title
  const title = document.createElement('div');
  title.className = 'dialog-title';
  title.id = 'dialog-title-' + options.id;
  title.textContent = options.title;
  box.appendChild(title);
  
  // Content
  if (options.paragraphs.length > 0) {
    const content = document.createElement('div');
    content.className = 'dialog-content';
    content.id = 'dialog-content-' + options.id;
    
    options.paragraphs.forEach(para => {
      const p = document.createElement('p');
      p.textContent = para.text;
      
      if (para.style) {
        p.className = 'dialog-para-' + para.style;
      }
      if (para.strong) {
        p.style.fontWeight = 'bold';
      }
      
      content.appendChild(p);
    });
    
    box.appendChild(content);
    rootElement.setAttribute('aria-describedby', content.id);
  }
  
  // Fields
  if (options.fields.length > 0) {
    options.fields.forEach(field => {
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'dialog-field';
      
      if (field.label) {
        const label = document.createElement('label');
        label.textContent = field.label;
        label.setAttribute('for', 'dialog-field-' + field.id);
        fieldWrap.appendChild(label);
      }
      
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.id = 'dialog-field-' + field.id;
      input.className = 'dialog-input';
      input.dataset.fieldId = field.id;
      
      if (field.type === 'number') {
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        if (field.step !== undefined) input.step = String(field.step);
      }
      
      if (field.placeholder) {
        input.placeholder = field.placeholder;
      }
      
      input.value = initialState.values[field.id] || '';
      
      if (field.selectOnFocus) {
        input.dataset.selectOnFocus = 'true';
      }
      
      fieldWrap.appendChild(input);
      box.appendChild(fieldWrap);
    });
  }
  
  // Checkboxes
  if (options.checkboxes.length > 0) {
    options.checkboxes.forEach(checkbox => {
      const checkWrap = document.createElement('div');
      checkWrap.className = 'dialog-checkbox check';
      
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'dialog-check-' + checkbox.id;
      input.dataset.checkId = checkbox.id;
      input.checked = !!initialState.checks[checkbox.id];
      
      const label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = checkbox.label;
      
      checkWrap.appendChild(input);
      checkWrap.appendChild(label);
      
      if (checkbox.helpText) {
        const help = document.createElement('div');
        help.className = 'dialog-checkbox-help';
        help.textContent = checkbox.helpText;
        checkWrap.appendChild(help);
      }
      
      box.appendChild(checkWrap);
    });
  }
  
  // Buttons
  const buttonWrap = document.createElement('div');
  buttonWrap.className = 'dialog-buttons val-edit-btns';
  
  options.buttons.forEach(button => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.dataset.buttonId = button.id;
    btn.textContent = button.label;
    
    if (button.role === 'primary') btn.classList.add('primary');
    if (button.role === 'danger') btn.classList.add('danger');
    if (button.disabled) btn.disabled = true;
    if (button.autoFocus) btn.dataset.autoFocus = 'true';
    if (button.hotkey) btn.dataset.hotkey = button.hotkey;
    if (button.intent) btn.dataset.intent = button.intent;
    
    buttonWrap.appendChild(btn);
  });
  
  box.appendChild(buttonWrap);
  
  // Store reference to buttonWrap for later fitting
  DialogManager.buttonWrap = buttonWrap;
  
  // Show dialog
  rootElement.classList.add('open');
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

function bindHandlers(options, rootElement) {
  // Clear previous handlers
  DialogManager.handlers.forEach(cleanup => cleanup());
  DialogManager.handlers = [];
  
  // Button clicks
  const buttons = rootElement.querySelectorAll('[data-button-id]');
  buttons.forEach(btn => {
    const handler = () => handleButtonClick(btn);
    btn.addEventListener('click', handler);
    DialogManager.handlers.push(() => btn.removeEventListener('click', handler));
  });
  
  // Keyboard events
  const keyHandler = (e) => handleKeyboard(e, options, rootElement);
  document.addEventListener('keydown', keyHandler);
  DialogManager.handlers.push(() => document.removeEventListener('keydown', keyHandler));
  
  // Backdrop click
  if (options.closeOnBackdrop) {
    const backdropHandler = (e) => {
      if (e.target === rootElement) {
        handleCloseAttempt({ action: null, dismissedBy: 'backdrop' });
      }
    };
    rootElement.addEventListener('click', backdropHandler);
    DialogManager.handlers.push(() => rootElement.removeEventListener('click', backdropHandler));
  }
  
  // Field select-on-focus
  const fields = rootElement.querySelectorAll('input[data-select-on-focus]');
  fields.forEach(field => {
    const handler = () => field.select();
    field.addEventListener('focus', handler);
    DialogManager.handlers.push(() => field.removeEventListener('focus', handler));
  });
  
  // Button text fitting on resize
  const buttonWrap = DialogManager.buttonWrap;
  if (buttonWrap) {
    const fitAllButtonText = () => {
      console.log('[Dialog] fitAllButtonText called');
      
      // First, reset all buttons to base styles
      options.buttons.forEach((button, index) => {
        const btn = buttonWrap.children[index];
        if (!btn) return;
        btn.style.fontSize = '25px';
        btn.style.letterSpacing = '0.06em';
      });
      
      // Wait for next frame to ensure layout is complete
      requestAnimationFrame(() => {
        options.buttons.forEach((button, index) => {
          const btn = buttonWrap.children[index];
          if (!btn) return;
          
          // Get button's available width AFTER layout completes
          const btnRect = btn.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(btn);
          const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
          const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
          
          // Fixed internal margin for breathing room
          const internalMargin = 16;

          const availableWidth = btnRect.width - paddingLeft - paddingRight - (internalMargin * 2);
          
          console.log('[Dialog] Button resize:', {
            buttonId: button.id,
            buttonWidth: btnRect.width,
            padding: paddingLeft + paddingRight,
            availableWidth: availableWidth,
            textLength: btn.textContent.length
          });
          
          if (availableWidth > 0) {
            fitTextToWidth(btn, availableWidth);
          }
        });
      });
    };
    
    // Fit button text initially
    fitAllButtonText();
    
    // Re-fit button text on window resize
    const resizeHandler = () => {
      console.log('[Dialog] Resize event fired');
      fitAllButtonText();
    };
    
    window.addEventListener('resize', resizeHandler);
    console.log('[Dialog] Resize handler attached');
    DialogManager.handlers.push(() => {
      console.log('[Dialog] Cleaning up resize handler');
      window.removeEventListener('resize', resizeHandler);
    });
  }
}

function handleButtonClick(btn) {
  if (DialogManager.isBusy) return;
  
  const buttonId = btn.dataset.buttonId;
  const options = DialogManager.currentOptions;
  const button = options.buttons.find(b => b.id === buttonId);
  
  if (!button) return;
  
  handleCloseAttempt({
    action: buttonId,
    dismissedBy: 'button',
    buttonReturn: button.returns
  });
}

function handleKeyboard(e, options, rootElement) {
  // Ignore if busy
  if (DialogManager.isBusy) return;
  
  // Escape key
  if (e.key === 'Escape') {
    if (options.closeOnEscape) {
      // Check if button has Escape hotkey
      const escapeButton = options.buttons.find(b => b.hotkey === 'Escape');
      if (escapeButton) {
        handleCloseAttempt({ action: escapeButton.id, dismissedBy: 'button' });
      } else {
        handleCloseAttempt({ action: null, dismissedBy: 'escape' });
      }
      e.preventDefault();
    }
    return;
  }
  
  // Enter key
  if (e.key === 'Enter') {
    // Check if focused element is a button
    if (document.activeElement?.tagName === 'BUTTON') {
      // Let button's click handler deal with it
      return;
    }
    
    // Check if focused element is textarea (future-proofing)
    if (document.activeElement?.tagName === 'TEXTAREA') {
      return; // Let native newline behavior happen
    }
    
    // Check for button with Enter hotkey
    const enterButton = options.buttons.find(b => b.hotkey === 'Enter');
    if (enterButton && !enterButton.disabled) {
      handleCloseAttempt({ action: enterButton.id, dismissedBy: 'button' });
      e.preventDefault();
      return;
    }
    
    // Default to first primary button
    const primaryButton = options.buttons.find(b => b.role === 'primary' && !b.disabled);
    if (primaryButton) {
      handleCloseAttempt({ action: primaryButton.id, dismissedBy: 'button' });
      e.preventDefault();
      return;
    }
  }
  
  // Tab key - focus trap
  if (e.key === 'Tab') {
    trapFocus(e, rootElement);
  }
}

function trapFocus(e, rootElement) {
  const focusableElements = rootElement.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  
  const focusable = Array.from(focusableElements).filter(el => {
    return el.offsetParent !== null; // Visible check
  });
  
  if (focusable.length === 0) return;
  
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  
  if (e.shiftKey) {
    // Shift+Tab
    if (document.activeElement === first) {
      last.focus();
      e.preventDefault();
    }
  } else {
    // Tab
    if (document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Focus Management
// ═══════════════════════════════════════════════════════════════════════════

function focusInitialElement(rootElement, options) {
  // Priority order:
  // 1. Element with autoFocus
  // 2. First field
  // 3. First primary button
  // 4. Dialog container
  
  const autoFocusBtn = rootElement.querySelector('[data-auto-focus]');
  if (autoFocusBtn) {
    autoFocusBtn.focus();
    return;
  }
  
  const firstField = rootElement.querySelector('.dialog-input');
  if (firstField) {
    firstField.focus();
    if (firstField.dataset.selectOnFocus) {
      firstField.select();
    }
    return;
  }
  
  const primaryBtn = rootElement.querySelector('.btn.primary');
  if (primaryBtn) {
    primaryBtn.focus();
    return;
  }
  
  rootElement.focus();
}

function restoreFocus() {
  const target = DialogManager.restoreFocusTarget;
  
  try {
    if (target && target.isConnected && typeof target.focus === 'function') {
      target.focus();
    } else {
      // Fallback to body
      document.body.focus();
    }
  } catch (err) {
    console.warn('[Dialog] Focus restoration failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Close Path (Phase 4-5)
// ═══════════════════════════════════════════════════════════════════════════

async function handleCloseAttempt(trigger) {
  // 1. Collect current state
  const attempt = collectAttemptState(trigger);
  
  // 2. Run validation guard
  const allowed = await runBeforeClose(attempt);
  if (!allowed) return;
  
  // 3. Compute result
  const result = buildDialogResult(attempt);
  
  // 4. Execute cleanup
  await finalizeClose(result);
  
  // 5. Resolve promise
  if (DialogManager.resolvePromise) {
    DialogManager.resolvePromise(result);
  }
  
  // 6. Clear promise callbacks after resolution
  DialogManager.resolvePromise = null;
  DialogManager.rejectPromise = null;
}

function collectAttemptState(trigger) {
  const options = DialogManager.currentOptions;
  const rootElement = DialogManager.rootElement;
  
  return {
    action: trigger.action || null,
    dismissedBy: trigger.dismissedBy,
    checks: getCurrentChecks(rootElement),
    values: getCurrentValues(rootElement),
    buttonReturn: trigger.buttonReturn
  };
}

function getCurrentChecks(rootElement) {
  const checks = {};
  const checkboxes = rootElement.querySelectorAll('[data-check-id]');
  
  checkboxes.forEach(chk => {
    checks[chk.dataset.checkId] = chk.checked;
  });
  
  return checks;
}

function getCurrentValues(rootElement) {
  const values = {};
  const fields = rootElement.querySelectorAll('[data-field-id]');
  
  fields.forEach(field => {
    values[field.dataset.fieldId] = field.value;
  });
  
  return values;
}

async function runBeforeClose(attempt) {
  const options = DialogManager.currentOptions;
  
  if (!options.beforeClose) {
    return true;
  }
  
  // Enter busy state
  DialogManager.isBusy = true;
  DialogManager.state = 'CLOSING_GUARD';
  setDialogBusy(true);
  
  let allowed = false;
  
  try {
    const result = options.beforeClose(attempt);
    allowed = await Promise.resolve(result);
  } catch (err) {
    console.error('[Dialog] beforeClose error:', err);
    allowed = false;
    
    // Optional: emit error event
    emitEvent(options, 'validation_error', { error: err });
  }
  
  // Exit busy state
  DialogManager.isBusy = false;
  setDialogBusy(false);
  
  if (!allowed) {
    // Rejected - return to OPEN
    DialogManager.state = 'OPEN';
    return false;
  }
  
  // Allowed - proceed to cleanup
  DialogManager.state = 'CLEANUP';
  return true;
}

function setDialogBusy(busy) {
  const rootElement = DialogManager.rootElement;
  if (!rootElement) return;
  
  const buttons = rootElement.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.disabled = busy;
  });
  
  if (busy) {
    rootElement.classList.add('is-busy');
  } else {
    rootElement.classList.remove('is-busy');
  }
}

function buildDialogResult(attempt) {
  const options = DialogManager.currentOptions;
  
  return {
    dialogId: options.id,
    confirmed: computeConfirmed(attempt, options),
    action: attempt.action,
    dismissedBy: attempt.dismissedBy,
    checks: attempt.checks,
    values: attempt.values,
    buttonReturn: attempt.buttonReturn,
    timestamp: Date.now()
  };
}

function computeConfirmed(attempt, options) {
  // Non-button dismissal = not confirmed
  if (attempt.dismissedBy !== 'button') {
    return false;
  }
  
  const buttonId = attempt.action;
  const button = options.buttons.find(b => b.id === buttonId);
  
  if (!button) return false;
  
  // 1. Check confirmActionIds
  if (options.confirmActionIds.length > 0) {
    return options.confirmActionIds.includes(buttonId);
  }
  
  // 2. Check button intent
  if (button.intent === 'confirm') {
    return true;
  }
  
  // 3. Fallback: first primary button
  const firstPrimary = options.buttons.find(b => b.role === 'primary');
  return button === firstPrimary;
}

async function finalizeClose(result) {
  const options = DialogManager.currentOptions;
  const rootElement = DialogManager.rootElement;
  
  // Run persistence hook (only if confirmed)
  if (result.confirmed && options.onConfirmPersist) {
    try {
      options.onConfirmPersist(result);
    } catch (err) {
      console.error('[Dialog] onConfirmPersist failed:', err);
    }
  }
  
  // Unbind handlers
  DialogManager.handlers.forEach(cleanup => cleanup());
  DialogManager.handlers = [];
  
  // Hide dialog
  if (rootElement) {
    rootElement.classList.remove('open');
  }
  
  // Restore focus
  if (options.restoreFocus) {
    restoreFocus();
  }
  
  // Emit close event
  emitEvent(options, 'close', {
    confirmed: result.confirmed,
    action: result.action
  });
  
  // Release dialog slot (but NOT promise callbacks - those are cleared after resolution)
  DialogManager.state = 'IDLE';
  DialogManager.currentDialogId = null;
  DialogManager.restoreFocusTarget = null;
  DialogManager.currentOptions = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Emergency Cleanup
// ═══════════════════════════════════════════════════════════════════════════

function emergencyCleanup() {
  // Remove all event listeners
  DialogManager.handlers.forEach(cleanup => cleanup());
  DialogManager.handlers = [];
  
  // Reset busy state
  DialogManager.isBusy = false;
  
  // Attempt focus restoration
  try {
    if (DialogManager.restoreFocusTarget?.isConnected) {
      DialogManager.restoreFocusTarget.focus();
    }
  } catch (err) {
    console.warn('[Dialog] Emergency focus restoration failed:', err);
  }
  
  // Release dialog slot
  DialogManager.state = 'IDLE';
  DialogManager.currentDialogId = null;
  DialogManager.restoreFocusTarget = null;
  DialogManager.currentOptions = null;
  DialogManager.resolvePromise = null;
  DialogManager.rejectPromise = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Bridge
// ═══════════════════════════════════════════════════════════════════════════

function emitEvent(options, type, data = {}) {
  if (!options.eventBridge?.emit) return;
  
  const eventMap = {
    open: options.chazy?.emitOpenEvent || 'dialog_opened',
    close: options.chazy?.emitCloseEvent || 'dialog_closed',
    validation_error: 'dialog_validation_error'
  };
  
  const eventName = eventMap[type] || type;
  
  options.eventBridge.emit(eventName, {
    dialogId: options.id,
    ...data
  });
}
