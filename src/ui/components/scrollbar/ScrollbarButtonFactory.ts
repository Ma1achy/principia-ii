/**
 * @fileoverview Scrollbar Button Factory
 * Unified button components for custom scrollbar up/down buttons
 */

/**
 * Scrollbar button type
 */
export type ScrollbarButtonType = 'up' | 'down';

/**
 * Scrollbar button configuration
 */
export interface ScrollbarButtonConfig {
  /** Button type: 'up' or 'down' */
  type: ScrollbarButtonType;
  /** Button ID (optional) */
  id?: string;
  /** Click handler */
  onClick?: () => void;
  /** Custom arrow symbol (default: ▲ or ▼) */
  arrowSymbol?: string;
}

/**
 * Creates a scrollbar up/down button
 * Used in picker scrollbars and sidebar scrollbar
 */
export function createScrollbarButton({
  type,
  id,
  onClick,
  arrowSymbol
}: ScrollbarButtonConfig): HTMLButtonElement {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.className = type === 'up' ? 'picker-sb-up' : 'picker-sb-down';
  btn.textContent = arrowSymbol || (type === 'up' ? '▲' : '▼');
  
  if (onClick) {
    btn.addEventListener('click', onClick);
  }
  
  return btn;
}
