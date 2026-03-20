import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Custom dimension picker overlay ─────────────────────────────────────────

let _customDimPickerCallback: ((dim: number) => void) | null = null;

export function bindCustomDimPicker(onPickH: (dim: number) => void, onPickV: (dim: number) => void): void {
  const overlay  = $("customDimPickerOverlay");
  const list     = $("customDimPickerList");
  const closeBtn = $("customDimPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[custom-dim] Required elements not found');
    return;
  }

  function buildList(activeDim: number): void {
    if (!list) return;
    
    list.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const btn = document.createElement("button");
      btn.className = "tilt-pick-btn" + (i === activeDim ? " active" : "");
      btn.textContent = AXIS_NAMES[i];
      btn.addEventListener("click", () => {
        if (_customDimPickerCallback) _customDimPickerCallback(i);
        closeCustomDimPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeCustomDimPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _customDimPickerCallback = null;
    
    // Unregister from keyboard navigation
    const uiTree = (window as any).uiTree;
    if (uiTree) {
      unregisterPickerOverlay(uiTree, 'customDimPickerOverlay');
    }
  }

  overlay.addEventListener("click", (e) => { 
    if (e.target === overlay) {
      // Close via KNM to ensure proper state management
      const navManager = (window as any).navManager;
      if (navManager) {
        navManager.closeOverlay('customDimPickerOverlay');
      } else {
        closeCustomDimPicker();
      }
    }
  });
  closeBtn.addEventListener("click", () => {
    // Close button click already handled by pickerCloseButtonBehavior
    // But keep this as fallback if KNM is not active
    const navManager = (window as any).navManager;
    if (navManager) {
      navManager.closeOverlay('customDimPickerOverlay');
    } else {
      closeCustomDimPicker();
    }
  });

  const customDimHLabel = $("customDimHLabel");
  const customDimVLabel = $("customDimVLabel");
  const customDimPickerTitle = $("customDimPickerTitle");

  if (customDimHLabel) {
    customDimHLabel.addEventListener("click", () => {
      if (customDimPickerTitle) customDimPickerTitle.textContent = "H-axis (→) dimension";
      buildList(state.customDimH);
      _customDimPickerCallback = onPickH;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'customDimPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount: 10,
          triggerId: 'customDimH-picker:trigger',
          onClose: closeCustomDimPicker
        });
      }
    });
  }

  if (customDimVLabel) {
    customDimVLabel.addEventListener("click", () => {
      if (customDimPickerTitle) customDimPickerTitle.textContent = "V-axis (↑) dimension";
      buildList(state.customDimV);
      _customDimPickerCallback = onPickV;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'customDimPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount: 10,
          triggerId: 'customDimV-picker:trigger',
          onClose: closeCustomDimPicker
        });
      }
    });
  }
}
