import { state } from '../../state.js';
import { $ } from '../utils.js';
import { showLargeResWarning } from '../dialogs/resolution-warning.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Resolution picker overlay ───────────────────────────────────────────────

let _resPickerCallback: ((res: number) => void) | null = null;

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
    if (overlay) overlay.classList.remove("open");
    _resPickerCallback = null;
    
    // Unregister from keyboard navigation
    const uiTree = (window as any).uiTree;
    if (uiTree) {
      unregisterPickerOverlay(uiTree, 'resPickerOverlay');
    }
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
