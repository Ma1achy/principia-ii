/**
 * @fileoverview Picker Initialization
 * Creates and initializes all picker overlays
 */

import { createPicker } from './PickerFactory.js';

/**
 * Creates all picker overlays and appends them to the DOM
 * @returns {Object} Map of picker IDs to their elements
 */
export function initAllPickers() {
  const pickers = {
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
