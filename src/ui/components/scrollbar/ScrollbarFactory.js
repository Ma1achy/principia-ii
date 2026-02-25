/**
 * @fileoverview Scrollbar Factory
 * Dynamically generates scrollbar HTML structures
 */

// SVG icon constants
const ICON_ARROW_UP = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,6 4,2 7,6"/></svg>';
const ICON_ARROW_DOWN = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,2 4,6 7,2"/></svg>';

/**
 * Creates a scrollbar structure
 * @param {string} idPrefix - Base ID (e.g., 'custom-sb', 'stateBox-sb', 'picker-sb')
 * @param {string} [className] - Optional class name for the scrollbar container
 * @returns {HTMLElement} The scrollbar container element
 */
export function createScrollbar(idPrefix, className = null) {
  const sb = document.createElement('div');
  
  if (className) {
    sb.className = className;
  }
  
  if (idPrefix) {
    sb.id = idPrefix;
  }
  
  // Up button
  const upBtn = document.createElement('button');
  if (idPrefix) upBtn.id = `${idPrefix}-up`;
  upBtn.setAttribute('aria-label', 'Scroll up');
  upBtn.innerHTML = ICON_ARROW_UP;
  
  // Track with thumb
  const track = document.createElement('div');
  if (idPrefix) track.id = `${idPrefix}-track`;
  
  const thumb = document.createElement('div');
  if (idPrefix) thumb.id = `${idPrefix}-thumb`;
  
  track.appendChild(thumb);
  
  // Down button
  const downBtn = document.createElement('button');
  if (idPrefix) downBtn.id = `${idPrefix}-down`;
  downBtn.setAttribute('aria-label', 'Scroll down');
  downBtn.innerHTML = ICON_ARROW_DOWN;
  
  // Assemble
  sb.appendChild(upBtn);
  sb.appendChild(track);
  sb.appendChild(downBtn);
  
  return sb;
}
