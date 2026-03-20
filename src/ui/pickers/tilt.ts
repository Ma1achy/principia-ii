import { state, AXIS_NAMES } from '../../state.js';
import { $ } from '../utils.js';
import { registerPickerOverlay, unregisterPickerOverlay } from './keyboard-nav-integration.js';

// ─── Tilt dimension picker overlay ───────────────────────────────────────────

let _tiltPickerCallback: ((dim: number) => void) | null = null;

export function bindTiltPicker(onPick1: (dim: number) => void, onPick2: (dim: number) => void): void {
  const overlay = $("tiltPickerOverlay");
  const list    = $("tiltPickerList");
  const closeBtn = $("tiltPickerClose");

  if (!overlay || !list || !closeBtn) {
    console.warn('[tilt] Required elements not found');
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
        if (_tiltPickerCallback) _tiltPickerCallback(i);
        closeTiltPicker();
      });
      list.appendChild(btn);
    }
  }

  function closeTiltPicker(): void {
    if (overlay) overlay.classList.remove("open");
    _tiltPickerCallback = null;
    
    // Unregister from keyboard navigation
    const uiTree = (window as any).uiTree;
    if (uiTree) {
      unregisterPickerOverlay(uiTree, 'tiltPickerOverlay');
    }
  }

  overlay.addEventListener("click", (e) => { 
    if (e.target === overlay) {
      // Close via KNM to ensure proper state management
      const navManager = (window as any).navManager;
      if (navManager) {
        navManager.closeOverlay('tiltPickerOverlay');
      } else {
        closeTiltPicker();
      }
    }
  });
  closeBtn.addEventListener("click", () => {
    // Close button click already handled by pickerCloseButtonBehavior
    // But keep this as fallback if KNM is not active
    const navManager = (window as any).navManager;
    if (navManager) {
      navManager.closeOverlay('tiltPickerOverlay');
    } else {
      closeTiltPicker();
    }
  });

  const tiltDim1Label = $("tiltDim1Label");
  const tiltDim2Label = $("tiltDim2Label");
  const tiltPickerTitle = $("tiltPickerTitle");

  if (tiltDim1Label) {
    tiltDim1Label.addEventListener("click", () => {
      if (tiltPickerTitle) tiltPickerTitle.textContent = "Tilt q₁ into";
      buildList(state.tiltDim1);
      _tiltPickerCallback = onPick1;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'tiltPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount: 10,
          triggerId: 'tiltDim1-picker:trigger',
          onClose: closeTiltPicker
        });
      }
    });
  }

  if (tiltDim2Label) {
    tiltDim2Label.addEventListener("click", () => {
      if (tiltPickerTitle) tiltPickerTitle.textContent = "Tilt q₂ into";
      buildList(state.tiltDim2);
      _tiltPickerCallback = onPick2;
      if (overlay) overlay.classList.add("open");
      
      // Register with keyboard navigation
      const uiTree = (window as any).uiTree;
      if (uiTree && list && closeBtn) {
        registerPickerOverlay({
          uiTree,
          pickerId: 'tiltPickerOverlay',
          overlayElement: overlay,
          listElement: list,
          closeButtonElement: closeBtn,
          itemCount: 10,
          triggerId: 'tiltDim2-picker:trigger',
          onClose: closeTiltPicker
        });
      }
    });
  }
}

export function syncTiltDimLabels(): void {
  const n1 = $("tiltDim1Name");
  const n2 = $("tiltDim2Name");
  if (n1) n1.textContent = AXIS_NAMES[state.tiltDim1] || `z${state.tiltDim1}`;
  if (n2) n2.textContent = AXIS_NAMES[state.tiltDim2] || `z${state.tiltDim2}`;
}
