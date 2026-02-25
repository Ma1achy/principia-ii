/**
 * @fileoverview Scrollbar Initialization
 * Sets up all custom DOM scrollbars used in the application
 */

import { initScrollbar, initSidebarScrollbar } from './scrollbar.js';

/**
 * Initialize all scrollbars in the application
 * Called automatically on page load
 */
export function initAllScrollbars() {
  // Main sidebar scrollbar (with enhanced rAF-debouncing)
  initSidebarScrollbar();

  // StateBox textarea scrollbar
  initScrollbar(
    document.getElementById('stateBox'),
    document.getElementById('stateBox-sb'),
    document.getElementById('stateBox-sb-track'),
    document.getElementById('stateBox-sb-thumb'),
    document.getElementById('stateBox-sb-up'),
    document.getElementById('stateBox-sb-down'),
    60
  );

  // Picker scrollbars (all 4 pickers)
  ['modePicker', 'customDimPicker', 'resPicker', 'tiltPicker'].forEach(id => {
    const list = document.getElementById(id + 'List');
    const wrap = list.closest('.picker-list-wrap');
    const sb = wrap.querySelector('.picker-sb');
    const track = wrap.querySelector('.picker-sb-track');
    const thumb = wrap.querySelector('.picker-sb-thumb');
    const up = wrap.querySelector('.picker-sb-up');
    const down = wrap.querySelector('.picker-sb-down');
    initScrollbar(list, sb, track, thumb, up, down, 60);
  });
}
