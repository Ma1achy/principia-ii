/**
 * Unified Slider Update System
 * 
 * Centralized utility for updating slider values programmatically.
 * Automatically handles track fill updates and paired number inputs.
 * 
 * Usage:
 *   import { updateSliderValue } from './ui/utils/sliderUpdater.js';
 *   updateSliderValue("mySlider", 50, { numberInputId: "mySliderVal", decimals: 2 });
 */

import { $ } from '../utils.js';

/**
 * Options for updating a slider
 */
export interface SliderUpdateOptions {
  /** ID of paired number input (e.g., "sliderVal") */
  numberInputId?: string;
  /** Number of decimal places for number input formatting */
  decimals?: number;
}

/**
 * Single slider update configuration
 */
export interface SliderUpdate {
  sliderId: string;
  value: number | string;
  numberInputId?: string;
  decimals?: number;
}

/**
 * Update a single slider with automatic track fill update
 * 
 * @param sliderId - ID of the range input element
 * @param value - New value to set
 * @param options - Optional configuration for number input and formatting
 * @returns true if update was successful, false otherwise
 */
export function updateSliderValue(
  sliderId: string,
  value: number | string,
  options: SliderUpdateOptions = {}
): boolean {
  const input = $(sliderId) as HTMLInputElement | null;
  
  if (!input) {
    console.warn(`[sliderUpdater] Slider not found: ${sliderId}`);
    return false;
  }
  
  // Update the range input value
  input.value = String(value);
  
  // Update paired number input if specified
  if (options.numberInputId) {
    const numberInput = $(options.numberInputId) as HTMLInputElement | null;
    if (numberInput) {
      const numValue = typeof value === 'number' ? value : parseFloat(String(value));
      if (!isNaN(numValue) && options.decimals !== undefined) {
        numberInput.value = numValue.toFixed(options.decimals);
      } else {
        numberInput.value = String(value);
      }
    }
  }
  
  // Call _updateTrackFill if available
  const updateFn = (input as any)._updateTrackFill;
  if (typeof updateFn === 'function') {
    updateFn();
  }
  
  return true;
}

/**
 * Batch update multiple sliders
 * 
 * @param updates - Array of slider update configurations
 */
export function updateSliders(updates: SliderUpdate[]): void {
  for (const update of updates) {
    updateSliderValue(update.sliderId, update.value, {
      numberInputId: update.numberInputId,
      decimals: update.decimals
    });
  }
}

/**
 * Update all slider track fills globally
 * Useful after bulk DOM operations or state synchronization
 */
export function updateAllSliderTrackFills(): void {
  document.querySelectorAll('input[type="range"]').forEach((inp) => {
    const input = inp as HTMLInputElement & { _updateTrackFill?: () => void };
    if (input._updateTrackFill) {
      input._updateTrackFill();
    }
  });
}
