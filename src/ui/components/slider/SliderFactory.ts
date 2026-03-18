/**
 * @fileoverview Slider Factory
 * Dynamically generates slider row structures
 */

/**
 * Slider configuration options
 */
export interface SliderConfig {
  /** Base ID for the slider (e.g., 'gamma') */
  id: string;
  /** Label text (supports HTML entities) */
  label: string;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step increment */
  step: number;
  /** Initial value */
  value: number;
  /** Tooltip text */
  tip?: string;
  /** Title for number input (defaults to label) */
  numberTitle?: string | null;
  /** CSS margin-top value (e.g., '8px') */
  marginTop?: string | null;
}

/**
 * Creates a slider row (label + range input + number input)
 */
export function createSlider({
  id,
  label,
  min,
  max,
  step,
  value,
  tip = '',
  numberTitle = null,
  marginTop = null
}: SliderConfig): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sl-row';
  if (marginTop) row.style.marginTop = marginTop;
  
  // Label
  const labelEl = document.createElement('label');
  labelEl.innerHTML = label; // Support HTML entities like &gamma;
  
  // Track row (contains range input and number input)
  const trackRow = document.createElement('div');
  trackRow.className = 'sl-track-row';
  
  // Range input
  const rangeInput = document.createElement('input');
  rangeInput.id = id;
  rangeInput.type = 'range';
  rangeInput.min = String(min);
  rangeInput.max = String(max);
  rangeInput.step = String(step);
  rangeInput.value = String(value);
  if (tip) rangeInput.setAttribute('data-tip', tip);
  
  // Number input wrapper
  const valWrap = document.createElement('div');
  valWrap.className = 'sl-val-wrap';
  
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.className = 'slider-num';
  numberInput.id = `${id}Val`;
  numberInput.value = value.toFixed(getDecimalPlaces(step));
  numberInput.step = String(step);
  numberInput.min = String(min);
  numberInput.max = String(max);
  numberInput.setAttribute('data-title', numberTitle || label);
  if (tip) numberInput.setAttribute('data-tip', tip);
  
  valWrap.appendChild(numberInput);
  
  // Assemble track row
  trackRow.appendChild(rangeInput);
  trackRow.appendChild(valWrap);
  
  // Assemble slider row
  row.appendChild(labelEl);
  row.appendChild(trackRow);
  
  return row;
}

/**
 * Helper to determine decimal places from step value
 */
function getDecimalPlaces(step: number): number {
  const str = String(step);
  const decimalIndex = str.indexOf('.');
  return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
}
