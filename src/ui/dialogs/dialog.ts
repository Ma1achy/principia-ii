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
 * 
 * Styling contract:
 * - src/ui/dialogs/dialog.css defines all visual appearance (colors, sizes, spacing)
 * - CSS font-size values are maximums - this JS reduces them dynamically if needed
 * - fitTextToWidth() adjusts letter-spacing (0.00-0.50em) and font-size as needed
 * - CSS must be loaded via <link> tag in index.html
 */

import { attachDynamicBehaviorBatch } from '../components/button/DynamicButton.js';

// ═══════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

type DialogState = 'IDLE' | 'OPEN' | 'CLOSING_GUARD' | 'CLEANUP';

interface DialogParagraph {
  text: string;
  style?: string;
  strong?: boolean;
}

interface DialogField {
  id: string;
  type: 'number' | 'text';
  label?: string;
  value?: string | number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  selectOnFocus?: boolean;
}

interface DialogCheckbox {
  id: string;
  label: string;
  defaultChecked?: boolean;
  helpText?: string;
  persistKey?: string;
}

interface DialogButton {
  id: string;
  label?: string;
  labelPoolId?: string;
  role: 'primary' | 'secondary' | 'danger';
  intent?: 'confirm' | 'cancel' | 'dismiss' | 'other';
  closes?: boolean;
  autoFocus?: boolean;
  hotkey?: 'Enter' | 'Escape';
  returns?: any;
  disabled?: boolean;
  pairedKey?: string;
}

export interface DialogOptions {
  id: string;
  title: string;
  content?: {
    paragraphs?: DialogParagraph[];
    text?: string;
  };
  fields?: DialogField[];
  checkboxes?: DialogCheckbox[];
  buttons: DialogButton[];
  confirmActionIds?: string[];
  variant?: 'info' | 'warning' | 'danger';
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  restoreFocus?: boolean;
  onOpenLoadState?: () => { checks?: Record<string, boolean>; values?: Record<string, string> };
  onConfirmPersist?: (result: DialogResult) => void;
  beforeClose?: (attempt: CloseAttempt) => boolean | Promise<boolean>;
  eventBridge?: { emit: (event: string, data: any) => void };
  chazy?: { emitOpenEvent?: string; emitCloseEvent?: string };
  contentPool?: any;
  pairPoolId?: string;
}

export interface DialogResult {
  dialogId: string;
  confirmed: boolean;
  action: string | null;
  dismissedBy: 'button' | 'escape' | 'backdrop' | 'programmatic';
  checks: Record<string, boolean>;
  values: Record<string, string>;
  buttonReturn?: any;
  timestamp: number;
}

interface NormalizedOptions {
  id: string;
  title: string;
  buttons: Array<Omit<DialogButton, 'labelPoolId' | 'pairedKey'>>;
  paragraphs: DialogParagraph[];
  fields: DialogField[];
  checkboxes: DialogCheckbox[];
  variant: 'info' | 'warning' | 'danger';
  closeOnEscape: boolean;
  closeOnBackdrop: boolean;
  restoreFocus: boolean;
  confirmActionIds: string[];
  onOpenLoadState: (() => { checks?: Record<string, boolean>; values?: Record<string, string> }) | null;
  onConfirmPersist: ((result: DialogResult) => void) | null;
  beforeClose: ((attempt: CloseAttempt) => boolean | Promise<boolean>) | null;
  eventBridge: { emit: (event: string, data: any) => void } | null;
  chazy: { emitOpenEvent?: string; emitCloseEvent?: string } | null;
  contentPool: any;
}

interface CloseAttempt {
  action: string | null;
  dismissedBy: 'button' | 'escape' | 'backdrop' | 'programmatic';
  checks: Record<string, boolean>;
  values: Record<string, string>;
  buttonReturn?: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// DialogManager - Singleton State Machine
// ═══════════════════════════════════════════════════════════════════════════

class DialogManagerClass {
  state: DialogState = 'IDLE';
  currentDialogId: string | null = null;
  isBusy: boolean = false;
  rootElement: HTMLElement | null = null;
  restoreFocusTarget: Element | null = null;
  currentOptions: NormalizedOptions | null = null;
  handlers: Array<() => void> = [];
  resolvePromise: ((value: DialogResult) => void) | null = null;
  rejectPromise: ((reason?: any) => void) | null = null;
  buttonWrap: HTMLElement | null = null;
  overlayRegistered: boolean = false;
  dialogNodeId: string | null = null;
  
  isOpen(): boolean {
    return this.state !== 'IDLE';
  }
  
  getCurrentId(): string | null {
    return this.currentDialogId;
  }
}

// Singleton instance
const DialogManager = new DialogManagerClass();

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard Mode Detection
// ═══════════════════════════════════════════════════════════════════════════

let keyboardModeActive = false;

function enableKeyboardMode(): void {
  if (!keyboardModeActive) {
    keyboardModeActive = true;
    document.documentElement.classList.add('keyboard-mode');
  }
}

function disableKeyboardMode(): void {
  if (keyboardModeActive) {
    keyboardModeActive = false;
    document.documentElement.classList.remove('keyboard-mode');
  }
}

// Listen for keyboard events to enable keyboard mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
    enableKeyboardMode();
  }
});

// Listen for mouse events to disable keyboard mode
document.addEventListener('mousedown', () => {
  disableKeyboardMode();
});

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

export async function showDialog(options: DialogOptions): Promise<DialogResult> {
  // ─────────────────────────────────────────────────────────────────────
  // Phase 1: Pre-Open (Validation)
  // ─────────────────────────────────────────────────────────────────────
  
  // 1.1 Concurrency check
  if (DialogManager.isOpen()) {
    const err: any = new Error('Dialog already open');
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
  
  // 2.6.5 Register escape event listener
  if ((window as any).uiTree?._events && normalized.closeOnEscape !== false) {
    const dialogId = `dialog-${normalized.id}`;
    console.log('[Dialog] Setting up overlay:before-close listener for:', dialogId, 'closeOnEscape:', normalized.closeOnEscape);
    
    const beforeCloseHandler = (event: any) => {
      console.log('[Dialog] overlay:before-close event received:', event);
      if (event.id === dialogId) {
        console.log('[Dialog] Overlay close requested by navigation system (Escape)');
        handleCloseAttempt({
          action: 'escape',
          dismissedBy: 'escape',
          checks: {},
          values: {},
          buttonReturn: null
        });
      } else {
        console.log('[Dialog] Event was for different overlay:', event.id, 'expected:', dialogId);
      }
    };
    
    (window as any).uiTree._events.on('overlay:before-close', beforeCloseHandler);
    console.log('[Dialog] Event listener registered successfully');
    
    DialogManager.handlers.push(() => {
      console.log('[Dialog] Cleaning up overlay:before-close listener');
      (window as any).uiTree._events.off('overlay:before-close', beforeCloseHandler);
    });
  } else {
    console.log('[Dialog] NOT setting up listener - uiTree._events:', !!(window as any).uiTree?._events, 'closeOnEscape:', normalized.closeOnEscape);
  }
  
  // 2.7 Focus initial element
  focusInitialElement(DialogManager.rootElement, normalized);
  
  // 2.8 Emit open event
  emitEvent(normalized, 'open');
  
  // ─────────────────────────────────────────────────────────────────────
  // Phase 3: Interactive (Waiting)
  // ─────────────────────────────────────────────────────────────────────
  
  return new Promise((resolve, reject) => {
    DialogManager.resolvePromise = resolve;
    DialogManager.rejectPromise = reject;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Option Normalization
// ═══════════════════════════════════════════════════════════════════════════

function normalizeOptions(options: DialogOptions): NormalizedOptions {
  let pairedLabels: Record<string, string> | null = null;
  if ((options as any).pairPoolId && options.contentPool) {
    const usePair = Math.random() < 0.5;
    if (usePair) {
      try {
        pairedLabels = options.contentPool.selectPair((options as any).pairPoolId, {
          fallback: { cancel: 'CANCEL', confirm: 'OK' }
        });
        console.log('[Dialog] Using paired labels:', pairedLabels);
      } catch (err) {
        console.error(`[Dialog] Pair selection failed:`, err);
      }
    }
  }
  
  const normalizedButtons = (options.buttons || []).map((btn, index) => {
    let label = btn.label;
    
    if (pairedLabels && (btn as any).pairedKey && pairedLabels[(btn as any).pairedKey]) {
      label = pairedLabels[(btn as any).pairedKey];
    }
    else if (btn.labelPoolId && options.contentPool) {
      try {
        label = options.contentPool.select(btn.labelPoolId, {
          fallback: btn.label || 'OK',
          session: false
        });
      } catch (err) {
        console.error(`[Dialog] Label pool selection failed for button ${btn.id}:`, err);
        label = btn.label || 'OK';
      }
    }
    
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
    id: options.id,
    title: options.title,
    buttons: normalizedButtons,
    paragraphs: normalizeParagraphs(options.content),
    fields: options.fields || [],
    checkboxes: options.checkboxes || [],
    variant: options.variant || 'info',
    closeOnEscape: options.closeOnEscape !== false,
    closeOnBackdrop: options.closeOnBackdrop || false,
    restoreFocus: options.restoreFocus !== false,
    confirmActionIds: options.confirmActionIds || [],
    onOpenLoadState: options.onOpenLoadState || null,
    onConfirmPersist: options.onConfirmPersist || null,
    beforeClose: options.beforeClose || null,
    eventBridge: options.eventBridge || null,
    chazy: options.chazy || null,
    contentPool: options.contentPool || null
  };
}

function normalizeParagraphs(content?: { paragraphs?: DialogParagraph[]; text?: string }): DialogParagraph[] {
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

async function loadInitialState(normalized: NormalizedOptions): Promise<{ checks: Record<string, boolean>; values: Record<string, string> }> {
  const initialState = {
    checks: {} as Record<string, boolean>,
    values: {} as Record<string, string>
  };
  
  normalized.checkboxes.forEach(chk => {
    if (chk.defaultChecked) {
      initialState.checks[chk.id] = true;
    }
  });
  
  normalized.fields.forEach(field => {
    if (field.value !== undefined) {
      initialState.values[field.id] = String(field.value);
    }
  });
  
  if (normalized.onOpenLoadState) {
    try {
      const loaded = normalized.onOpenLoadState();
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

function createDialogRoot(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  
  const box = document.createElement('div');
  box.className = 'dialog-box';
  
  overlay.appendChild(box);
  return overlay;
}

function renderDialog(rootElement: HTMLElement, options: NormalizedOptions, initialState: { checks: Record<string, boolean>; values: Record<string, string> }): void {
  const box = rootElement.querySelector('.dialog-box');
  if (!box) return;
  
  box.innerHTML = '';
  
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
    btn.className = 'btn dynamic-btn';
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
  
  DialogManager.buttonWrap = buttonWrap;
  
  rootElement.classList.add('open');
  
  // Register overlay with keyboard navigation
  if ((window as any).uiTree && (window as any).navManager) {
    const dialogId = `dialog-${options.id}`;
    const triggerId = DialogManager.restoreFocusTarget?.id || null;
    
    const buttonElements = buttonWrap.querySelectorAll('[data-button-id]');
    const fieldElements = rootElement.querySelectorAll('[data-field-id]');
    const checkElements = rootElement.querySelectorAll('[data-check-id]');
    
    const buttonGridId = `${dialogId}:button-grid`;
    const buttonIds = Array.from(buttonElements).map(b => `${dialogId}:btn-${(b as HTMLElement).dataset.buttonId}`);
    
    const contentIds = [
      ...Array.from(fieldElements).map(f => `${dialogId}:field-${(f as HTMLElement).dataset.fieldId}`),
      ...Array.from(checkElements).map(c => `${dialogId}:check-${(c as HTMLElement).dataset.checkId}`)
    ];
    
    const buttonNodes = Array.from(buttonElements).map((b: Element) => {
      const btn = b as HTMLElement;
      const buttonId = btn.dataset.buttonId!;
      const buttonDef = options.buttons.find(btn => btn.id === buttonId);
      
      return {
        id: `${dialogId}:btn-${buttonId}`,
        kind: 'button',
        parentId: buttonGridId,
        children: [],
        focusMode: 'leaf',
        role: 'button',
        ariaRole: 'button',
        ariaLabel: btn.textContent?.trim() || '',
        primary: buttonDef?.role === 'primary',
        element: btn,
        meta: {
          buttonRole: buttonDef?.role,
          intent: buttonDef?.intent,
          hotkey: buttonDef?.hotkey
        }
      };
    });
    
    const buttonGridNode = {
      id: buttonGridId,
      kind: 'grid',
      parentId: dialogId,
      rows: 1,
      cols: buttonIds.length,
      cells: buttonIds.map((id, col) => ({ id, row: 0, col, rowSpan: 1, colSpan: 1 })),
      children: buttonIds,
      wrapRows: false,
      wrapCols: true,
      entryPolicy: 'remembered',
      escapeUp: contentIds.length > 0 ? contentIds[contentIds.length - 1] : null,
      role: 'button-group',
      ariaLabel: 'Dialog buttons',
      meta: {
        isButtonRow: true
      }
    };
    
    const contentNodes = [
      ...Array.from(fieldElements).map((f: Element) => {
        const field = f as HTMLInputElement;
        return {
          id: `${dialogId}:field-${field.dataset.fieldId}`,
          kind: 'value-editor',
          parentId: dialogId,
          children: [],
          focusMode: 'leaf',
          role: 'value-editor',
          ariaLabel: field.placeholder || field.dataset.fieldId,
          element: field
        };
      }),
      ...Array.from(checkElements).map((c: Element) => {
        const check = c as HTMLInputElement;
        return {
          id: `${dialogId}:check-${check.dataset.checkId}`,
          kind: 'checkbox',
          parentId: dialogId,
          children: [],
          focusMode: 'leaf',
          role: 'checkbox',
          ariaLabel: check.dataset.checkId,
          element: check
        };
      })
    ];
    
    const dialogChildIds = [...contentIds, buttonGridId];
    
    const dialogNode = {
      id: dialogId,
      kind: 'grid',
      parentId: null,
      rows: dialogChildIds.length,
      cols: 1,
      cells: dialogChildIds.map((id, row) => ({ id, row, col: 0, rowSpan: 1, colSpan: 1 })),
      children: dialogChildIds,
      wrapRows: true,
      wrapCols: false,
      entryPolicy: 'first',
      focusMode: 'entry-node',
      overlay: true,
      modal: true,
      transient: true,
      isOverlay: true,
      closeOnEscape: options.closeOnEscape !== false,
      ariaRole: 'dialog',
      ariaLabel: options.title,
      meta: {
        title: options.title,
        triggerId,
        closeOnEscape: options.closeOnEscape !== false,
        gridLayout: true
      }
    };
    
    const childNodes = [...contentNodes, buttonGridNode, ...buttonNodes];
    
    try {
      console.log('[Dialog] Registering overlay with', childNodes.length, 'children');
      (window as any).uiTree.addNodes([dialogNode, ...childNodes]);
      
      childNodes.forEach((node: any) => {
        if (node.element) {
          (window as any).uiTree.attachElement(node.id, node.element);
        }
      });
      
      (window as any).uiTree._events.emit('overlay:registered', { id: dialogId, triggerId });
      
      DialogManager.overlayRegistered = true;
      DialogManager.dialogNodeId = dialogId;
      console.log('[Dialog] Registered overlay:', dialogId);
    } catch (err) {
      console.warn('[Dialog] Failed to register overlay:', err);
      DialogManager.overlayRegistered = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

function bindHandlers(options: NormalizedOptions, rootElement: HTMLElement): void {
  DialogManager.handlers.forEach(cleanup => cleanup());
  DialogManager.handlers = [];
  
  const buttons = rootElement.querySelectorAll('[data-button-id]');
  buttons.forEach(btn => {
    const handler = () => handleButtonClick(btn as HTMLButtonElement);
    btn.addEventListener('click', handler);
    DialogManager.handlers.push(() => btn.removeEventListener('click', handler));
  });
  
  if (options.closeOnBackdrop) {
    const backdropHandler = (e: MouseEvent) => {
      if (e.target === rootElement) {
        handleCloseAttempt({ action: null, dismissedBy: 'backdrop', checks: {}, values: {} });
      }
    };
    rootElement.addEventListener('click', backdropHandler);
    DialogManager.handlers.push(() => rootElement.removeEventListener('click', backdropHandler));
  }
  
  const fields = rootElement.querySelectorAll('input[data-select-on-focus]');
  fields.forEach(field => {
    const handler = () => (field as HTMLInputElement).select();
    field.addEventListener('focus', handler);
    DialogManager.handlers.push(() => field.removeEventListener('focus', handler));
  });
  
  const buttonWrap = DialogManager.buttonWrap;
  if (buttonWrap) {
    const buttonElements = Array.from(buttonWrap.querySelectorAll('.btn')) as HTMLButtonElement[];
    
    const dynamicControls = attachDynamicBehaviorBatch(buttonElements, {
      targetWidth: 'auto',
      internalMargin: 16
    });
    
    dynamicControls.forEach(control => {
      DialogManager.handlers.push(control.cleanup);
    });
  }
}

function handleButtonClick(btn: HTMLButtonElement): void {
  if (DialogManager.isBusy) return;
  
  const buttonId = btn.dataset.buttonId;
  const options = DialogManager.currentOptions;
  if (!options || !buttonId) return;
  
  const button = options.buttons.find(b => b.id === buttonId);
  if (!button) return;
  
  handleCloseAttempt({
    action: buttonId,
    dismissedBy: 'button',
    checks: {},
    values: {},
    buttonReturn: button.returns
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Focus Management
// ═══════════════════════════════════════════════════════════════════════════

function focusInitialElement(rootElement: HTMLElement, options: NormalizedOptions): void {
  console.log('[Dialog] Skipping native focus - navigation system will handle');
}

// ═══════════════════════════════════════════════════════════════════════════
// Close Path
// ═══════════════════════════════════════════════════════════════════════════

async function handleCloseAttempt(trigger: Partial<CloseAttempt>): Promise<void> {
  const attempt = collectAttemptState(trigger);
  
  const allowed = await runBeforeClose(attempt);
  if (!allowed) return;
  
  const result = buildDialogResult(attempt);
  
  await finalizeClose(result);
  
  if (DialogManager.resolvePromise) {
    DialogManager.resolvePromise(result);
  }
  
  DialogManager.resolvePromise = null;
  DialogManager.rejectPromise = null;
}

function collectAttemptState(trigger: Partial<CloseAttempt>): CloseAttempt {
  const rootElement = DialogManager.rootElement;
  if (!rootElement) {
    return {
      action: trigger.action || null,
      dismissedBy: trigger.dismissedBy || 'programmatic',
      checks: trigger.checks || {},
      values: trigger.values || {},
      buttonReturn: trigger.buttonReturn
    };
  }
  
  return {
    action: trigger.action || null,
    dismissedBy: trigger.dismissedBy || 'programmatic',
    checks: getCurrentChecks(rootElement),
    values: getCurrentValues(rootElement),
    buttonReturn: trigger.buttonReturn
  };
}

function getCurrentChecks(rootElement: HTMLElement): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  const checkboxes = rootElement.querySelectorAll('[data-check-id]');
  
  checkboxes.forEach(chk => {
    const checkbox = chk as HTMLInputElement;
    if (checkbox.dataset.checkId) {
      checks[checkbox.dataset.checkId] = checkbox.checked;
    }
  });
  
  return checks;
}

function getCurrentValues(rootElement: HTMLElement): Record<string, string> {
  const values: Record<string, string> = {};
  const fields = rootElement.querySelectorAll('[data-field-id]');
  
  fields.forEach(field => {
    const input = field as HTMLInputElement;
    if (input.dataset.fieldId) {
      values[input.dataset.fieldId] = input.value;
    }
  });
  
  return values;
}

async function runBeforeClose(attempt: CloseAttempt): Promise<boolean> {
  const options = DialogManager.currentOptions;
  if (!options) return true;
  
  if (!options.beforeClose) {
    return true;
  }
  
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
    emitEvent(options, 'validation_error', { error: err });
  }
  
  DialogManager.isBusy = false;
  setDialogBusy(false);
  
  if (!allowed) {
    DialogManager.state = 'OPEN';
    return false;
  }
  
  DialogManager.state = 'CLEANUP';
  return true;
}

function setDialogBusy(busy: boolean): void {
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

function buildDialogResult(attempt: CloseAttempt): DialogResult {
  const options = DialogManager.currentOptions;
  if (!options) {
    return {
      dialogId: '',
      confirmed: false,
      action: attempt.action,
      dismissedBy: attempt.dismissedBy,
      checks: attempt.checks,
      values: attempt.values,
      buttonReturn: attempt.buttonReturn,
      timestamp: Date.now()
    };
  }
  
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

function computeConfirmed(attempt: CloseAttempt, options: NormalizedOptions): boolean {
  if (attempt.dismissedBy !== 'button') {
    return false;
  }
  
  const buttonId = attempt.action;
  if (!buttonId) return false;
  
  const button = options.buttons.find(b => b.id === buttonId);
  if (!button) return false;
  
  if (options.confirmActionIds.length > 0) {
    return options.confirmActionIds.includes(buttonId);
  }
  
  if (button.intent === 'confirm') {
    return true;
  }
  
  const firstPrimary = options.buttons.find(b => b.role === 'primary');
  return button === firstPrimary;
}

async function finalizeClose(result: DialogResult): Promise<void> {
  const options = DialogManager.currentOptions;
  const rootElement = DialogManager.rootElement;
  
  console.log('[Dialog] finalizeClose called, result:', result);
  
  if (DialogManager.state === 'CLEANUP') {
    console.log('[Dialog] Already closing, ignoring duplicate finalizeClose');
    return;
  }
  
  DialogManager.state = 'CLEANUP';
  
  if (result.confirmed && options?.onConfirmPersist) {
    try {
      options.onConfirmPersist(result);
    } catch (err) {
      console.error('[Dialog] onConfirmPersist failed:', err);
    }
  }
  
  DialogManager.handlers.forEach(cleanup => cleanup());
  DialogManager.handlers = [];
  
  const dialogId = DialogManager.dialogNodeId;
  if (DialogManager.overlayRegistered && (window as any).navManager && dialogId) {
    const isAlreadyClosing = (window as any).navManager.currentContext._pendingClose;
    
    if (!isAlreadyClosing) {
      console.log('[Dialog] Closing overlay in navigation manager:', dialogId);
      try {
        (window as any).navManager.closeOverlay(dialogId);
      } catch (err) {
        console.warn('[Dialog] Failed to close overlay in nav manager:', err);
      }
    } else {
      console.log('[Dialog] Overlay close already pending from nav manager');
    }
  }
  
  if (DialogManager.overlayRegistered && (window as any).uiTree && dialogId) {
    try {
      console.log('[Dialog] Removing overlay from tree:', dialogId);
      (window as any).uiTree.removeTransientOverlay(dialogId);
    } catch (err) {
      console.warn('[Dialog] Failed to remove overlay:', err);
    }
    DialogManager.overlayRegistered = false;
    DialogManager.dialogNodeId = null;
  }
  
  if (rootElement) {
    rootElement.classList.remove('open');
  }
  
  if ((window as any).navManager && dialogId) {
    console.log('[Dialog] Completing overlay close in navigation manager');
    try {
      (window as any).navManager.completeOverlayClose(dialogId);
    } catch (err) {
      console.warn('[Dialog] Failed to complete overlay close:', err);
    }
  }
  
  if (options) {
    emitEvent(options, 'close', {
      confirmed: result.confirmed,
      action: result.action
    });
  }
  
  DialogManager.state = 'IDLE';
  DialogManager.currentDialogId = null;
  DialogManager.restoreFocusTarget = null;
  DialogManager.currentOptions = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Bridge
// ═══════════════════════════════════════════════════════════════════════════

function emitEvent(options: NormalizedOptions, type: string, data: any = {}): void {
  if (!options.eventBridge?.emit) return;
  
  const eventMap: Record<string, string> = {
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
