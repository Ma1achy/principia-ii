/**
 * @fileoverview Scrollbar Initialization
 * Sets up all custom DOM scrollbars used in the application
 */

import { initScrollbar, initSidebarScrollbar } from './scrollbar.js';

/**
 * Initialize all scrollbars in the application
 * Called automatically on page load
 */
export function initAllScrollbars(): void {
  // Main sidebar scrollbar (with enhanced rAF-debouncing)
  initSidebarScrollbar();

  // StateBox textarea scrollbar
  const stateBox = document.getElementById('stateBox');
  const stateBoxSb = document.getElementById('stateBox-sb');
  const stateBoxTrack = document.getElementById('stateBox-sb-track');
  const stateBoxThumb = document.getElementById('stateBox-sb-thumb');
  const stateBoxUp = document.getElementById('stateBox-sb-up');
  const stateBoxDown = document.getElementById('stateBox-sb-down');
  
  if (stateBox && stateBoxSb && stateBoxTrack && stateBoxThumb && stateBoxUp && stateBoxDown) {
    initScrollbar(stateBox, stateBoxSb, stateBoxTrack, stateBoxThumb, stateBoxUp, stateBoxDown, 60);
  }

  // Picker scrollbars (all 4 pickers)
  ['modePicker', 'customDimPicker', 'resPicker', 'tiltPicker'].forEach(id => {
    const list = document.getElementById(id + 'List');
    if (!list) return;
    
    const wrap = list.closest('.picker-list-wrap');
    if (!wrap) return;
    
    const sb = wrap.querySelector('.picker-sb');
    const track = wrap.querySelector('.picker-sb-track');
    const thumb = wrap.querySelector('.picker-sb-thumb');
    const up = wrap.querySelector('.picker-sb-up');
    const down = wrap.querySelector('.picker-sb-down');
    
    if (sb && track && thumb && up && down) {
      initScrollbar(list, sb as HTMLElement, track as HTMLElement, thumb as HTMLElement, up as HTMLElement, down as HTMLElement, 60);
    }
  });
}
