import { state } from '../../state.js';
import { $ } from '../utils.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Mode picker overlay ─────────────────────────────────────────────────────

let _modePickerCallback: ((mode: number) => void) | null = null;

export function bindModePicker(onPick: (mode: number) => void): void {
  const overlay  = $("modePickerOverlay");
  const list     = $("modePickerList");
  const closeBtn = $("modePickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[mode] Required elements not found');
    return;
  }

  function buildList(activeMode: number): void {
    if (!list) return;
    
    list.innerHTML = "";
    const sel = $("mode") as HTMLSelectElement | null;
    if (!sel) return;
    
    for (const opt of sel.options) {
      const m = +opt.value;
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (m === activeMode ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_modePickerCallback) _modePickerCallback(m);
        closeModePicker();
      });
      list.appendChild(btn);
    }
  }

  function closeModePicker(): void {
    if (overlay) overlay.classList.remove("open");
    _modePickerCallback = null;
    
    // Unregister from keyboard navigation
    const uiTree = (window as any).uiTree;
    if (uiTree) {
      unregisterPickerOverlay(uiTree, 'modePickerOverlay');
    }
  }

  overlay.addEventListener("click", (e) => { 
    if (e.target === overlay) {
      // Close via KNM to ensure proper state management
      const navManager = (window as any).navManager;
      if (navManager) {
        navManager.closeOverlay('modePickerOverlay');
      } else {
        closeModePicker();
      }
    }
  });
  closeBtn.addEventListener("click", () => {
    // Close button click already handled by pickerCloseButtonBehavior
    // But keep this as fallback if KNM is not active
    const navManager = (window as any).navManager;
    if (navManager) {
      navManager.closeOverlay('modePickerOverlay');
    } else {
      closeModePicker();
    }
  });

  const modeLabel = $("modeLabel");
  if (modeLabel) {
    modeLabel.addEventListener("click", () => {
      buildList(state.mode);
      _modePickerCallback = onPick;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      const sel = $("mode") as HTMLSelectElement | null;
      const itemCount = sel ? sel.options.length : 0;
      
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'modePickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount,
          triggerId: 'mode-picker:trigger',
          onClose: closeModePicker
        });
      }
    });
  }
}
