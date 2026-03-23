/**
 * @fileoverview Checkbox Component Entry Point
 * Re-exports checkbox factory for easy importing
 * 
 * Styling contract:
 * - checkbox.css defines all visual appearance
 * - CheckboxFactory.ts handles DOM generation
 * - CSS must be loaded via <link> tag in index.html
 */

export { createCheckbox, type CheckboxConfig } from './CheckboxFactory.js';
