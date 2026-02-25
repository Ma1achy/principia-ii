/**
 * @fileoverview Sidebar Scrollbar Initialization
 * Creates the custom scrollbar for the sidebar
 */

import { createScrollbar } from '../components/scrollbar/ScrollbarFactory.js';

/**
 * Creates and inserts the sidebar scrollbar
 */
export function initSidebarScrollbar() {
  const scrollWrap = document.getElementById('scroll-wrap');
  if (!scrollWrap) {
    console.error('[SidebarScrollbar] Container #scroll-wrap not found');
    return;
  }
  
  // Create scrollbar with custom-sb ID
  const scrollbar = createScrollbar('custom-sb');
  
  // Insert after #sidebar-scroll (as a sibling inside #scroll-wrap)
  const sidebarScroll = document.getElementById('sidebar-scroll');
  if (sidebarScroll && sidebarScroll.nextSibling) {
    scrollWrap.insertBefore(scrollbar, sidebarScroll.nextSibling);
  } else {
    scrollWrap.appendChild(scrollbar);
  }
  
  return scrollbar;
}
