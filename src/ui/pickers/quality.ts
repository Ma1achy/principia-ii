import { $ } from '../utils.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Quality picker overlay ──────────────────────────────────────────────────

let _qualityPickerCallback: ((value: string) => void) | null = null;

export function bindQualityPicker(onPick: (value: string) => void): void {
  const overlay  = $("qualityPickerOverlay");
  const list     = $("qualityPickerList");
  const closeBtn = $("qualityPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[quality] Required elements not found');
    return;
  }

  function buildList(activeVal: string): void {
    if (!list) return;
    
    list.innerHTML = "";
    const sel = $("quality") as HTMLSelectElement | null;
    if (!sel) return;
    
    for (const opt of sel.options) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (opt.value === activeVal ? " active" : "");
      btn.textContent = opt.textContent;
      btn.addEventListener("click", () => {
        if (_qualityPickerCallback) _qualityPickerCallback(opt.value);
        closeQualityPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeQualityPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _qualityPickerCallback = null;
    
    // Unregister from keyboard navigation
    const uiTree = (window as any).uiTree;
    if (uiTree) {
      unregisterPickerOverlay(uiTree, 'qualityPickerOverlay');
    }
  }

  overlay.addEventListener("click", (e) => { 
    if (e.target === overlay) {
      // Close via KNM to ensure proper state management
      const navManager = (window as any).navManager;
      if (navManager) {
        navManager.closeOverlay('qualityPickerOverlay');
      } else {
        closeQualityPicker();
      }
    }
  });
  closeBtn.addEventListener("click", () => {
    // Close button click already handled by pickerCloseButtonBehavior
    // But keep this as fallback if KNM is not active
    const navManager = (window as any).navManager;
    if (navManager) {
      navManager.closeOverlay('qualityPickerOverlay');
    } else {
      closeQualityPicker();
    }
  });

  const qualityLabel = $("qualityLabel");
  if (qualityLabel) {
    qualityLabel.addEventListener("click", () => {
      const sel = $("quality") as HTMLSelectElement | null;
      if (sel) buildList(sel.value);
      _qualityPickerCallback = onPick;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      const itemCount = sel ? sel.options.length : 0;
      
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'qualityPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount,
          triggerId: 'quality-picker:trigger',
          onClose: closeQualityPicker
        });
      }
    });
  }
}
