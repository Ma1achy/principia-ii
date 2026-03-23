import { state } from '../../state.js';
import { $ } from '../utils.js';
import { showLargeResWarning } from '../dialogs/resolution-warning.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Resolution picker overlay ───────────────────────────────────────────────

let _resPickerCallback: ((res: number) => void) | null = null;
let _resPickerIsClosing = false; // Guard to prevent recursive closes

export function bindResPicker(onPick: (res: number) => void): void {
  const overlay  = $("resPickerOverlay");
  const list     = $("resPickerList");
  const closeBtn = $("resPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[resolution] Required elements not found');
    return;
  }

  function buildList(activeRes: number): void {
    if (!list) return;
    
    list.innerHTML = "";
    const sel = $("resolution") as HTMLSelectElement | null;
    if (!sel) return;
    
    for (const opt of sel.options) {
      const r = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (r === activeRes ? " active" : "");
      btn.textContent = opt.textContent + (r >= 8192 ? " ⚠" : "");
      btn.addEventListener("click", () => {
        console.log(`[ResPicker] Resolution ${r} clicked`);
        closeResPicker();
        if (r >= 4096) {
          console.log(`[ResPicker] Large resolution (${r}), showing warning dialog`);
          showLargeResWarning(r, (confirmedRes) => {
            console.log(`[ResPicker] Warning dialog confirmed with resolution ${confirmedRes}`);
            onPick(confirmedRes);
            console.log(`[ResPicker] onPick called with ${confirmedRes}`);
          });
        } else {
          console.log(`[ResPicker] Normal resolution (${r}), calling onPick directly`);
          onPick(r);
        }
      });
      list.appendChild(btn);
    }
  }

  function closeResPicker(): void {
    // Guard against recursive closes
    if (_resPickerIsClosing) {
      console.log('[ResPicker] Already closing, skipping');
      return;
    }
    _resPickerIsClosing = true;
    
    console.log('[ResPicker] closeResPicker called');
    if (overlay) overlay.classList.remove("open");
    _resPickerCallback = null;
    
    // Close overlay in navigation manager first (if it's open)
    const navManager = (window as any).navManager;
    const uiTree = (window as any).uiTree;
    
    if (navManager && uiTree) {
      // Check if the overlay is actually in the stack before closing
      const node = uiTree.getNode('resPickerOverlay');
      if (node) {
        console.log('[ResPicker] Closing overlay via navManager');
        // Close the overlay in the navigation stack
        // This will emit overlay:before-close which triggers the cleanup
        navManager.closeOverlay('resPickerOverlay');
      } else {
        console.log('[ResPicker] Overlay node not found in tree');
      }
    } else if (uiTree) {
      // Fallback: just remove nodes if navManager isn't available
      console.log('[ResPicker] navManager not available, unregistering directly');
      unregisterPickerOverlay(uiTree, 'resPickerOverlay');
    }
    
    // Reset the guard after a short delay to allow for the next open/close cycle
    setTimeout(() => {
      _resPickerIsClosing = false;
    }, 100);
  }

  overlay.addEventListener("click", (e) => { 
    if (e.target === overlay) {
      // Close via KNM to ensure proper state management
      const navManager = (window as any).navManager;
      if (navManager) {
        navManager.closeOverlay('resPickerOverlay');
      } else {
        closeResPicker();
      }
    }
  });
  closeBtn.addEventListener("click", () => {
    // Close button click already handled by pickerCloseButtonBehavior
    // But keep this as fallback if KNM is not active
    const navManager = (window as any).navManager;
    if (navManager) {
      navManager.closeOverlay('resPickerOverlay');
    } else {
      closeResPicker();
    }
  });

  const resLabel = $("resLabel");
  if (resLabel) {
    resLabel.addEventListener("click", () => {
      buildList(state.res);
      _resPickerCallback = onPick;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      const sel = $("resolution") as HTMLSelectElement | null;
      const itemCount = sel ? sel.options.length : 0;
      
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'resPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount,
          triggerId: 'resolution-picker:trigger',
          onClose: closeResPicker
        });
      }
    });
  }
}
