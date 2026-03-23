/**
 * @fileoverview Checkbox Factory
 * Dynamically generates checkbox structures for dialogs, panels, and sidebar
 */

/**
 * Checkbox configuration options
 */
export interface CheckboxConfig {
  /** Unique ID for the checkbox input */
  id: string;
  /** Label text (supports HTML entities) */
  label: string;
  /** Initial checked state */
  checked?: boolean;
  /** Tooltip text */
  tip?: string;
  /** Help text displayed below the checkbox */
  helpText?: string;
}

/**
 * Creates a checkbox element (input + label + optional help text)
 * Returns a container div with class 'check'
 */
export function createCheckbox({
  id,
  label,
  checked = false,
  tip = '',
  helpText = ''
}: CheckboxConfig): HTMLElement {
  const container = document.createElement('div');
  container.className = 'check';
  
  // Input element
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  if (tip) input.setAttribute('data-tip', tip);
  
  // Label element
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.innerHTML = label; // Support HTML entities like &#8321;
  
  // Assemble checkbox
  container.appendChild(input);
  container.appendChild(labelEl);
  
  // Optional help text
  if (helpText) {
    const help = document.createElement('div');
    help.className = 'checkbox-help';
    help.textContent = helpText;
    container.appendChild(help);
  }
  
  return container;
}
