/**
 * @fileoverview Preset Button Factory
 * Unified button component for preset grid items
 */

/**
 * Preset button configuration
 */
export interface PresetButtonConfig {
  /** Button ID (optional) */
  id?: string;
  /** Button label text */
  label: string;
  /** Whether this preset is currently active */
  active?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Whether this button should span 2 columns (e.g., 'custom' preset) */
  spanColumns?: boolean;
}

/**
 * Creates a preset button for the preset grid
 * Extends base .btn styling with grid-specific overrides
 */
export function createPresetButton({
  id,
  label,
  active = false,
  onClick,
  spanColumns = false
}: PresetButtonConfig): HTMLButtonElement {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.className = 'btn preset' + (active ? ' active' : '');
  btn.textContent = label;
  
  if (spanColumns) {
    btn.style.gridColumn = 'span 2';
  }
  
  if (onClick) {
    btn.addEventListener('click', onClick);
  }
  
  return btn;
}
