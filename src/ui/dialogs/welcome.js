import { loadSettings, saveSettings } from '../settings-storage.js';
import { showDialog } from './dialog.js';
import { ContentPool } from '../content/ContentPool.js';
import { preloadButtonPools } from '../content/poolLoader.js';

// Global pool instance (initialized on first use)
let contentPool = null;

/**
 * Initialize content pool (async, called on first use)
 */
async function getContentPool() {
  if (!contentPool) {
    const pools = await preloadButtonPools();
    contentPool = new ContentPool(pools);
  }
  return contentPool;
}

export async function showWelcomeDialog() {
  console.log('[Welcome] showWelcomeDialog() called');
  
  const settings = loadSettings();
  console.log('[Welcome] Settings loaded:', settings);
  
  // Don't show if user has suppressed it
  if (settings.suppressWelcomeDialog) {
    console.log('[Welcome] Dialog suppressed by user preference');
    return;
  }
  
  console.log('[Welcome] Showing welcome dialog via new system...');
  
  // Load pools asynchronously
  const pool = await getContentPool();
  
  const result = await showDialog({
    id: 'welcome',
    title: 'WELCOME TO PRINCIPIA',
    contentPool: pool,  // Provide pool instance
    content: {
      paragraphs: [
        {
          text: 'Principia is an interactive atlas of the starting conditions of three stars, where you can wander the boundary between nearly identical beginnings and radically different endings.*'
        },
        {
          text: 'CAUTION: Best experienced on a desktop or laptop with a capable GPU. Mobile devices and older or low-power graphics hardware may render slowly, fail to render correctly, or perform poorly.',
          style: 'warning'
        },
        {
          text: '*You are exploring a chosen 2D slice of the planar gravitational three-body problem\'s initial-condition manifold — compactified, sampled, and made tolerable for your hardware.',
          style: 'technical'
        }
      ]
    },
    checkboxes: [
      {
        id: 'disableAutoRender',
        label: 'Start in manual render mode',
        defaultChecked: false
      },
      {
        id: 'dontShowAgain',
        label: 'Don\'t show this dialog again',
        defaultChecked: false
      }
    ],
    buttons: [
      {
        id: 'confirm',
        labelPoolId: 'welcome_confirm',  // Declarative randomization!
        label: 'CONTINUE',  // Fallback if pool fails
        role: 'primary',
        intent: 'confirm',
        hotkey: 'Enter'
      }
    ],
    closeOnEscape: true,
    onConfirmPersist: (result) => {
      console.log('[Welcome] onConfirmPersist called with result:', result);
      
      // Handle "disable auto render" checkbox
      if (result.checks.disableAutoRender) {
        console.log('[Welcome] User chose to disable auto-render');
        const autoRenderEl = document.getElementById('autoRender');
        if (autoRenderEl) {
          autoRenderEl.checked = false;
        }
      }
      
      // Handle "don't show again" checkbox
      if (result.checks.dontShowAgain) {
        console.log('[Welcome] User checked "don\'t show again", saving preference');
        settings.suppressWelcomeDialog = true;
        saveSettings(settings);
      }
    }
  });
  
  console.log('[Welcome] Dialog closed with result:', result);
}
