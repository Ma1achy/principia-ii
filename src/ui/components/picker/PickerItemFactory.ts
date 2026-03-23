/**
 * @fileoverview Picker Item Button Factory
 * Unified button component for picker list items (mode, resolution, tilt, custom-dim, quality)
 */

/**
 * Picker item button configuration
 */
export interface PickerItemConfig {
  /** Button ID (optional) */
  id?: string;
  /** Button label text */
  label: string;
  /** Whether this item is currently active/selected */
  active?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Optional index/number to display (e.g., dimension index) */
  index?: number | string;
  /** Optional warning indicator (e.g., '⚠' for high-res warnings) */
  warning?: string;
}

/**
 * Creates a picker item button
 * Used in all picker lists for selectable items
 */
export function createPickerItem({
  id,
  label,
  active = false,
  onClick,
  index,
  warning
}: PickerItemConfig): HTMLButtonElement {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.className = 'picker-item' + (active ? ' active' : '');
  
  // Optional index indicator
  if (index !== undefined) {
    const idx = document.createElement('span');
    idx.className = 'picker-item-idx';
    idx.textContent = String(index);
    btn.appendChild(idx);
  }
  
  // Label text
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);
  
  // Optional warning indicator
  if (warning) {
    const warnSpan = document.createElement('span');
    warnSpan.textContent = ' ' + warning;
    btn.appendChild(warnSpan);
  }
  
  // Click handler
  if (onClick) {
    btn.addEventListener('click', onClick);
  }
  
  return btn;
}
