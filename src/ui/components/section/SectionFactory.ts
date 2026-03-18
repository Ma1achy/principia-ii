/**
 * @fileoverview Section Factory
 * Dynamically generates collapsible section structures
 */

/**
 * Section configuration options
 */
export interface SectionConfig {
  /** Section body ID (e.g., 'sec-mode') */
  id: string;
  /** Section title (e.g., 'Display') */
  title: string;
  /** Whether section starts open */
  open?: boolean;
  /** Section content */
  content: HTMLElement | HTMLElement[] | string;
}

/**
 * Creates a collapsible section
 */
export function createSection({ id, title, open = false, content }: SectionConfig): HTMLElement {
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
