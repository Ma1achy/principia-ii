/**
 * @fileoverview Picker Initialization
 * Creates and initializes all picker overlays
 */

import { createPicker, PickerResult } from './PickerFactory.ts';

/**
 * Picker map structure
 */
export interface PickerMap {
  mode: PickerResult;
  customDim: PickerResult;
  res: PickerResult;
  tilt: PickerResult;
}

/**
 * Creates all picker overlays and appends them to the DOM
 */
export function initAllPickers(): PickerMap {
  const pickers: PickerMap = {
    mode: createPicker('modePicker', 'Render mode'),
    customDim: createPicker('customDimPicker', 'H-axis dimension'),
    res: createPicker('resPicker', 'Resolution'),
    tilt: createPicker('tiltPicker', 'Tilt into')
  };
  
  // Append all picker overlays to body
  Object.values(pickers).forEach(picker => {
    document.body.appendChild(picker.overlay);
  });
  
  return pickers;
}
