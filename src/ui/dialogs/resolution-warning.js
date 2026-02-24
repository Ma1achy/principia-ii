import { showDialog } from './dialog.js';
import { ContentPool } from '../content/ContentPool.js';
import { preloadButtonPools } from '../content/poolLoader.js';

// ─── Large resolution warning dialog ─────────────────────────────────────────

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

const _suppressedRes = new Set(JSON.parse(localStorage.getItem("principia_suppressedRes") || "[]"));

function saveSuppressed() {
  localStorage.setItem("principia_suppressedRes", JSON.stringify([..._suppressedRes]));
}

export async function showLargeResWarning(resolution, onConfirm) {
  console.log(`[ResWarning] showLargeResWarning called with resolution=${resolution}`);
  
  if (_suppressedRes.has(resolution)) {
    console.log(`[ResWarning] Resolution ${resolution} is suppressed, calling onConfirm immediately`);
    onConfirm(resolution);
    return;
  }

  // Load pools asynchronously
  const pool = await getContentPool();

  const tiled = resolution >= 8192;
  const message = `${resolution} × ${resolution} is a ${tiled ? "tiled" : "large"} render (${tiled ? "≥8192 uses multi-pass tiling" : "high memory usage"}). This can be very slow, especially with auto-render enabled.`;
  
  console.log(`[ResWarning] Showing warning dialog...`);
  
  const result = await showDialog({
    id: 'large-res-warning',
    title: 'LARGE TEXTURE',
    contentPool: pool,  // Provide pool instance
    pairPoolId: 'large_texture_pairs',  // 25% chance to use paired labels
    content: {
      text: message
    },
    checkboxes: [
      {
        id: 'disableAutoRender',
        label: 'Disable auto-render',
        defaultChecked: true
      },
      {
        id: 'suppressResolution',
        label: `Don't warn me about this resolution again`,
        defaultChecked: false
      }
    ],
    buttons: [
      {
        id: 'cancel',
        pairedKey: 'cancel',  // Maps to paired label
        labelPoolId: 'large_texture_cancel',  // Fallback to unpaired pool
        label: 'CANCEL',  // Final fallback
        role: 'secondary',
        intent: 'cancel',
        hotkey: 'Escape'
      },
      {
        id: 'confirm',
        pairedKey: 'confirm',  // Maps to paired label
        labelPoolId: 'large_texture_confirm',  // Fallback to unpaired pool
        label: 'RENDER ANYWAY',  // Final fallback
        role: 'primary',
        intent: 'confirm',
        hotkey: 'Enter'
      }
    ],
    closeOnEscape: true,
    closeOnBackdrop: true,  // Allow dismissal by clicking outside dialog
    onConfirmPersist: (result) => {
      console.log(`[ResWarning] onConfirmPersist called`);
      console.log(`[ResWarning] Auto-render checkbox: ${result.checks.disableAutoRender}`);
      console.log(`[ResWarning] Suppress checkbox: ${result.checks.suppressResolution}`);
      
      // Handle "disable auto-render" checkbox
      if (result.checks.disableAutoRender) {
        console.log(`[ResWarning] Disabling auto-render`);
        const autoRenderEl = document.getElementById('autoRender');
        if (autoRenderEl) {
          autoRenderEl.checked = false;
        }
      }
      
      // Handle "suppress this resolution" checkbox
      if (result.checks.suppressResolution) {
        console.log(`[ResWarning] Adding ${resolution} to suppressed list`);
        _suppressedRes.add(resolution);
        saveSuppressed();
      }
    }
  });
  
  console.log(`[ResWarning] Dialog closed with result:`, result);
  
  // Only call onConfirm if user confirmed
  if (result.confirmed) {
    console.log(`[ResWarning] Calling onConfirm(${resolution})`);
    onConfirm(resolution);
  } else {
    console.log(`[ResWarning] User cancelled, not calling onConfirm`);
  }
}
