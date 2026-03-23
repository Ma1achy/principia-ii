/**
 * @fileoverview Close Button Factory
 * Unified close button for pickers, panels, and dialogs
 */

/**
 * Close button configuration
 */
export interface CloseButtonConfig {
  /** Unique ID for the button */
  id: string;
  /** Button text (default: '✕') */
  label?: string;
  /** Aria label for accessibility */
  ariaLabel?: string;
}

/**
 * Creates a close button element
 * Used in pickers, panels, and dialogs
 */
export function createCloseButton({
  id,
  label = '✕',
  ariaLabel = 'Close'
}: CloseButtonConfig): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'close-btn';
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  
  return btn;
}
