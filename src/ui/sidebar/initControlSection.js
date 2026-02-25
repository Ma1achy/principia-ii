/**
 * @fileoverview Control Section Initialization
 * Creates the primary action buttons in the sidebar control section
 */

// SVG icon constants
const ICON_LINK = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/></svg>';

const ICON_JSON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="1" width="9" height="11" rx="1"/><rect x="2" y="4" width="9" height="11" rx="1"/></svg>';

const ICON_PNG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"/></svg>';

const ICON_RESET = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><line x1="5" y1="5" x2="11" y2="11"/><line x1="11" y1="5" x2="5" y2="11"/></svg>';

/**
 * Creates the control section with primary action buttons
 */
export function createControlSection() {
  const section = document.createElement('div');
  section.id = 'ctrl-section';
  
  // Row 1: Render button (full width)
  const row1 = document.createElement('div');
  row1.className = 'row';
  
  const renderBtn = document.createElement('button');
  renderBtn.id = 'renderBtn';
  renderBtn.className = 'btn primary';
  renderBtn.style.width = '100%';
  renderBtn.setAttribute('data-tip', 'Render at the selected resolution. High resolutions use tiled rendering.');
  renderBtn.textContent = 'Render';
  
  row1.appendChild(renderBtn);
  
  // Row 2: Icon buttons (URL, JSON, PNG, Reset)
  const row2 = document.createElement('div');
  row2.className = 'row';
  row2.style.marginTop = '6px';
  
  // URL button
  const urlBtn = document.createElement('button');
  urlBtn.id = 'copyLinkBtn';
  urlBtn.className = 'btn icon-btn';
  urlBtn.setAttribute('data-tip', 'Copy a shareable URL encoding the current state.');
  urlBtn.innerHTML = ICON_LINK + '<span>URL</span>';
  
  // JSON button
  const jsonBtn = document.createElement('button');
  jsonBtn.id = 'copyJsonBtn';
  jsonBtn.className = 'btn icon-btn';
  jsonBtn.setAttribute('data-tip', 'Copy the full state as JSON to clipboard.');
  jsonBtn.innerHTML = ICON_JSON + '<span>JSON</span>';
  
  // PNG button
  const pngBtn = document.createElement('button');
  pngBtn.id = 'savePngBtn';
  pngBtn.className = 'btn icon-btn';
  pngBtn.setAttribute('data-tip', 'Save the current canvas as a PNG image.');
  pngBtn.innerHTML = ICON_PNG + '<span>PNG</span>';
  
  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.id = 'resetAllBtn';
  resetBtn.className = 'btn icon-btn';
  resetBtn.setAttribute('data-tip', 'Reset all parameters to defaults.');
  resetBtn.innerHTML = ICON_RESET + '<span>Reset</span>';
  
  row2.appendChild(urlBtn);
  row2.appendChild(jsonBtn);
  row2.appendChild(pngBtn);
  row2.appendChild(resetBtn);
  
  // Assemble
  section.appendChild(row1);
  section.appendChild(row2);
  
  return section;
}
