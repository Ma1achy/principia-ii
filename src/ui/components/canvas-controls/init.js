/**
 * @fileoverview Canvas Controls Initialization
 * Creates the Info & Settings buttons overlay
 */

// SVG icon constants
const ICON_INFO = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="8" cy="8" r="6.5"/>
  <line x1="8" y1="7" x2="8" y2="11.5"/>
  <circle cx="8" cy="4.5" r="0.7" fill="currentColor" stroke="none"/>
</svg>`;

const ICON_SETTINGS = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" stroke="none">
  <path fill-rule="evenodd" d="M6.5 1a.5.5 0 0 0-.493.42l-.24 1.47a5.1 5.1 0 0 0-.99.578l-1.394-.557a.5.5 0 0 0-.612.213l-1.5 2.598a.5.5 0 0 0 .12.645l1.187.918a5.17 5.17 0 0 0 0 1.43L1.39 9.213a.5.5 0 0 0-.12.645l1.5 2.598a.5.5 0 0 0 .612.213l1.394-.557c.31.22.641.41.99.578l.24 1.47A.5.5 0 0 0 6.5 14.58h3a.5.5 0 0 0 .493-.42l.24-1.47c.349-.168.68-.358.99-.578l1.394.557a.5.5 0 0 0 .612-.213l1.5-2.598a.5.5 0 0 0-.12-.645l-1.187-.918a5.17 5.17 0 0 0 0-1.43l1.187-.918a.5.5 0 0 0 .12-.645l-1.5-2.598a.5.5 0 0 0-.612-.213l-1.394.557a5.1 5.1 0 0 0-.99-.578l-.24-1.47A.5.5 0 0 0 9.5 1h-3zm1.5 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/>
</svg>`;

/**
 * Creates canvas control buttons (Info & Settings)
 * @returns {HTMLElement} The canvas-controls container
 */
export function createCanvasControls() {
  const container = document.createElement('div');
  container.id = 'canvas-controls';
  
  // Info button
  const infoBtn = document.createElement('button');
  infoBtn.id = 'infoBtn';
  infoBtn.className = 'btn canvas-ctrl-btn';
  infoBtn.setAttribute('data-tip', 'Controls and information.');
  infoBtn.innerHTML = ICON_INFO + '<span>Info</span>';
  
  // Settings button
  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settingsBtn';
  settingsBtn.className = 'btn canvas-ctrl-btn';
  settingsBtn.setAttribute('data-tip', 'Navigation and rendering settings.');
  settingsBtn.innerHTML = ICON_SETTINGS + '<span>Settings</span>';
  
  container.appendChild(infoBtn);
  container.appendChild(settingsBtn);
  
  // Insert at the beginning of body (before main content)
  document.body.insertBefore(container, document.body.firstChild);
  
  return container;
}
