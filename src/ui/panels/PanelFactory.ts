/**
 * @fileoverview Panel Factory
 * Dynamic HTML generation for side panel overlays (Settings & Info)
 */

const ICON_CLOSE = '&#x2715;';

/**
 * Side panel result structure
 */
export interface SidePanelResult {
  overlay: HTMLElement;
  panel: HTMLElement;
  header: HTMLElement;
  title: HTMLElement;
  closeBtn: HTMLButtonElement;
  contentDiv: HTMLElement;
}

/**
 * Creates a side panel overlay structure
 * @param id - Base ID (e.g., 'settingsPanel')
 * @param title - Display title (e.g., 'Settings')
 * @param content - Content to place inside panel (element or HTML string)
 * @returns Object containing overlay element and key child references
 */
export function createSidePanel(
  id: string,
  title: string,
  content: HTMLElement | string
): SidePanelResult {
  // Main overlay
  const overlay = document.createElement('div');
  overlay.id = `${id}Overlay`;
  
  // Panel
  const panel = document.createElement('div');
  panel.id = id;
  
  // Header
  const header = document.createElement('div');
  header.id = `${id}Header`;
  
  const titleSpan = document.createElement('span');
  titleSpan.id = `${id}Title`;
  titleSpan.textContent = title;
  
  const closeBtn = document.createElement('button');
  closeBtn.id = `${id}Close`;
  closeBtn.innerHTML = ICON_CLOSE;
  
  header.appendChild(titleSpan);
  header.appendChild(closeBtn);
  
  // Content container
  const contentDiv = document.createElement('div');
  contentDiv.id = `${id}Content`;
  
  // Add content (either element or HTML string)
  if (content instanceof HTMLElement) {
    contentDiv.appendChild(content);
  } else if (typeof content === 'string') {
    contentDiv.innerHTML = content;
  }
  
  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(contentDiv);
  
  // Assemble overlay
  overlay.appendChild(panel);
  
  // Return overlay and references
  return {
    overlay,
    panel,
    header,
    title: titleSpan,
    closeBtn,
    contentDiv
  };
}
