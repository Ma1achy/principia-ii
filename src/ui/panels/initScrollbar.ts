/**
 * @fileoverview Settings Panel Scrollbar Initialization
 * Creates the custom scrollbar for the settings panel
 */

import { createScrollbar } from '../components/scrollbar/ScrollbarFactory.js';
import { initScrollbar } from '../components/scrollbar/scrollbar.js';

/**
 * Creates and inserts the settings panel scrollbar
 */
export function initSettingsPanelScrollbar(): HTMLElement | null {
  const scrollWrap = document.getElementById('settingsPanelScrollWrap');
  if (!scrollWrap) {
    console.error('[SettingsPanelScrollbar] Container #settingsPanelScrollWrap not found');
    return null;
  }
  
  // Create scrollbar with settings-sb ID
  const scrollbar = createScrollbar('settings-sb');
  
  // Insert after #settingsPanelContent (as a sibling inside scroll-wrap)
  const panelContent = document.getElementById('settingsPanelContent');
  if (panelContent && panelContent.nextSibling) {
    scrollWrap.insertBefore(scrollbar, panelContent.nextSibling);
  } else {
    scrollWrap.appendChild(scrollbar);
  }
  
  // Wire up scrollbar behavior
  const track = scrollbar.querySelector('#settings-sb-track') as HTMLElement;
  const thumb = scrollbar.querySelector('#settings-sb-thumb') as HTMLElement;
  const btnUp = scrollbar.querySelector('#settings-sb-up') as HTMLElement;
  const btnDown = scrollbar.querySelector('#settings-sb-down') as HTMLElement;
  
  if (track && thumb && btnUp && btnDown) {
    initScrollbar(panelContent, scrollbar, track, thumb, btnUp, btnDown, 60);
  } else {
    console.error('[SettingsPanelScrollbar] Failed to find scrollbar child elements');
  }
  
  return scrollbar;
}
