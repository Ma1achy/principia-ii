/**
 * @fileoverview Section Factory
 * Dynamically generates collapsible section structures
 */

/**
 * Creates a collapsible section
 * @param {Object} config - Section configuration
 * @param {string} config.id - Section body ID (e.g., 'sec-mode')
 * @param {string} config.title - Section title (e.g., 'Display')
 * @param {boolean} [config.open=false] - Whether section starts open
 * @param {HTMLElement|HTMLElement[]|string} config.content - Section content
 * @returns {HTMLElement} The section container element
 */
export function createSection({ id, title, open = false, content }) {
  const section = document.createElement('div');
  section.className = 'section';
  
  // Section head (clickable header)
  const head = document.createElement('div');
  head.className = open ? 'section-head open' : 'section-head';
  head.setAttribute('data-target', id);
  
  const titleSpan = document.createElement('span');
  titleSpan.innerHTML = title; // Use innerHTML to support HTML entities
  
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.innerHTML = '&#8250;'; // ›
  
  head.appendChild(titleSpan);
  head.appendChild(arrow);
  
  // Section body (collapsible content)
  const body = document.createElement('div');
  body.className = open ? 'section-body open' : 'section-body';
  body.id = id;
  
  // Add content
  if (Array.isArray(content)) {
    content.forEach(el => body.appendChild(el));
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  } else if (typeof content === 'string') {
    body.innerHTML = content;
  }
  
  // Assemble
  section.appendChild(head);
  section.appendChild(body);
  
  return section;
}
