/**
 * @fileoverview Picker Factory
 * Dynamic HTML generation for picker overlays
 */

// SVG icon constants
const ICON_ARROW_UP = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,6 4,2 7,6"/></svg>';
const ICON_ARROW_DOWN = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,2 4,6 7,2"/></svg>';
const ICON_CLOSE = '&#x2715;';

/**
 * Creates a complete picker overlay structure
 * @param {string} id - Base ID (e.g., 'modePicker')
 * @param {string} title - Display title (e.g., 'Render mode')
 * @returns {Object} Object containing overlay element and key child references
 */
export function createPicker(id, title) {
  // Main overlay
  const overlay = document.createElement('div');
  overlay.id = `${id}Overlay`;
  
  // Panel
  const panel = document.createElement('div');
  panel.id = `${id}Panel`;
  
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
  
  // List wrapper
  const listWrap = document.createElement('div');
  listWrap.className = 'picker-list-wrap';
  
  // List element (populated by picker logic)
  const list = document.createElement('div');
  list.id = `${id}List`;
  
  // Scrollbar
  const sb = document.createElement('div');
  sb.className = 'picker-sb';
  
  const upBtn = document.createElement('button');
  upBtn.className = 'picker-sb-up';
  upBtn.innerHTML = ICON_ARROW_UP;
  
  const track = document.createElement('div');
  track.className = 'picker-sb-track';
  
  const thumb = document.createElement('div');
  thumb.className = 'picker-sb-thumb';
  track.appendChild(thumb);
  
  const downBtn = document.createElement('button');
  downBtn.className = 'picker-sb-down';
  downBtn.innerHTML = ICON_ARROW_DOWN;
  
  sb.appendChild(upBtn);
  sb.appendChild(track);
  sb.appendChild(downBtn);
  
  // Assemble list wrapper
  listWrap.appendChild(list);
  listWrap.appendChild(sb);
  
  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(listWrap);
  
  // Assemble overlay
  overlay.appendChild(panel);
  
  // Return overlay and references for event binding
  return {
    overlay,
    panel,
    header,
    title: titleSpan,
    closeBtn,
    list,
    scrollbar: {
      container: sb,
      track,
      thumb,
      upBtn,
      downBtn
    }
  };
}
