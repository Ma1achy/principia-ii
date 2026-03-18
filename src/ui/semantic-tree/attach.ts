/**
 * Element Binding - Connect DOM elements to semantic tree
 * DOM-first approach: factories create DOM, then we bind to tree
 */

import type { UITreeStore } from './store.js';

/**
 * Attach all Principia elements to the semantic tree
 * Called after factories create DOM
 */
export function attachPrincipiaElements(uiTree: UITreeStore): void {
  console.log('[attach] Starting element attachment...');
  
  // ── Canvas ─────────────────────────────────────────────────────────────────
  uiTree.attachElement('canvas', document.getElementById('glCanvas'));
  
  // ── Canvas Controls ────────────────────────────────────────────────────────
  // Canvas-controls is a transparent navigation grid - no DOM element
  // Navigation goes directly to the buttons
  uiTree.attachElement('infoBtn', document.getElementById('infoBtn'));
  uiTree.attachElement('settingsBtn', document.getElementById('settingsBtn'));
  
  // ── Control Section ────────────────────────────────────────────────────────
  const renderBtn = document.getElementById('renderBtn');
  const ctrlSectionContainer = renderBtn?.parentElement;
  // ctrl-section is a transparent navigation container - no DOM attachment
  
  uiTree.attachElement('renderBtn', renderBtn);
  uiTree.attachElement('copyLinkBtn', document.getElementById('copyLinkBtn'));
  uiTree.attachElement('copyJsonBtn', document.getElementById('copyJsonBtn'));
  uiTree.attachElement('savePngBtn', document.getElementById('savePngBtn'));
  uiTree.attachElement('resetAllBtn', document.getElementById('resetAllBtn'));
  
  // ── Display Section ────────────────────────────────────────────────────────
  const secMode = document.getElementById('sec-mode');
  uiTree.attachElement('sec-mode', secMode); // Section container (legacy)
  uiTree.attachElement('sec-mode-body', secMode); // Section body grid
  uiTree.attachElement('sec-mode:header', secMode?.parentElement?.querySelector('.section-head') as HTMLElement | null); // Section header
  
  // Mode picker
  const modeLabel = document.getElementById('modeLabel');
  const modeSelect = document.getElementById('mode') as HTMLSelectElement | null;
  uiTree.attachElement('mode-picker:trigger', modeLabel);
  if (modeSelect) {
    const modeOptions = [...modeSelect.options];
    modeOptions.forEach((opt, idx) => {
      const menuId = `mode-picker:dropdown:${['event', 'phase-diffusion', 'phase', 'diffusion', 'rgb'][idx]}`;
      uiTree.attachElement(menuId, opt);
    });
  }
  
  // Resolution picker
  const resLabel = document.getElementById('resLabel');
  const resSelect = document.getElementById('resolution') as HTMLSelectElement | null;
  uiTree.attachElement('resolution-picker:trigger', resLabel);
  if (resSelect) {
    const resOptions = [...resSelect.options];
    resOptions.forEach((opt) => {
      const menuId = `resolution-picker:dropdown:${opt.value}`;
      // Only attach if node exists (resolutions are dynamic based on renderer capabilities)
      if (uiTree.getNode(menuId)) {
        uiTree.attachElement(menuId, opt);
      }
    });
  }
  
  // ── Slice Basis Section ────────────────────────────────────────────────────
  const secPresets = document.getElementById('sec-presets');
  uiTree.attachElement('sec-presets', secPresets); // Section container (legacy)
  uiTree.attachElement('sec-presets-body', secPresets); // Section body grid
  uiTree.attachElement('sec-presets:header', secPresets?.parentElement?.querySelector('.section-head') as HTMLElement | null);
  // preset-grid is a transparent navigation container - no DOM element attached
  
  // Custom basis pickers
  const customDimHLabel = document.getElementById('customDimHLabel');
  const customDimVLabel = document.getElementById('customDimVLabel');
  if (customDimHLabel) uiTree.attachElement('customDimH-picker:trigger', customDimHLabel);
  if (customDimVLabel) uiTree.attachElement('customDimV-picker:trigger', customDimVLabel);
  
  // Custom mag slider
  attachSlider(uiTree, 'slider-customMag', 'customMag');
  
  // ── Slice Offset Section ───────────────────────────────────────────────────
  const secZ0 = document.getElementById('sec-z0');
  uiTree.attachElement('sec-z0', secZ0); // Section container (legacy)
  uiTree.attachElement('sec-z0-body', secZ0); // Section body grid
  uiTree.attachElement('sec-z0:header', secZ0?.parentElement?.querySelector('.section-head') as HTMLElement | null);
  
  // Z0 buttons (no longer a separate group, just individual buttons in grid)
  uiTree.attachElement('z0Zero', document.getElementById('z0Zero'));
  uiTree.attachElement('z0SmallRand', document.getElementById('z0SmallRand'));
  
  attachSlider(uiTree, 'slider-z0Range', 'z0Range');
  // Note: z0Range is the input ID, attachSlider will find its parent container
  
  // z0-z9 sliders attached dynamically by buildZ0Sliders
  
  // ── Orientation Section ────────────────────────────────────────────────────
  const secOrient = document.getElementById('sec-orient');
  uiTree.attachElement('sec-orient', secOrient); // Section container (legacy)
  uiTree.attachElement('sec-orient-body', secOrient); // Section body grid
  uiTree.attachElement('sec-orient:header', secOrient?.parentElement?.querySelector('.section-head') as HTMLElement | null);
  attachSlider(uiTree, 'slider-gamma', 'gamma');
  
  // Tilt dim pickers
  // Tilt picker labels (param-triggers for tilt sliders - now children of sliders)
  const tiltDim1Label = document.getElementById('tiltDim1Label');
  const tiltDim2Label = document.getElementById('tiltDim2Label');
  if (tiltDim1Label) uiTree.attachElement('tiltDim1-picker:trigger', tiltDim1Label);
  if (tiltDim2Label) uiTree.attachElement('tiltDim2-picker:trigger', tiltDim2Label);
  
  // Tilt amount sliders (main scope attached to entire .sl-row)
  attachSlider(uiTree, 'slider-tiltAmt1', 'tiltAmt1');
  attachSlider(uiTree, 'slider-tiltAmt2', 'tiltAmt2');
  
  uiTree.attachElement('doOrtho', document.getElementById('doOrtho'));
  uiTree.attachElement('rotReset', document.getElementById('rotReset'));
  
  // ── Simulation Section ─────────────────────────────────────────────────────
  const secSim = document.getElementById('sec-sim');
  uiTree.attachElement('sec-sim', secSim); // Section container (legacy)
  uiTree.attachElement('sec-sim-body', secSim); // Section body grid
  uiTree.attachElement('sec-sim:header', secSim?.parentElement?.querySelector('.section-head') as HTMLElement | null);
  attachSlider(uiTree, 'slider-horizon', 'horizon');
  attachSlider(uiTree, 'slider-maxSteps', 'maxSteps');
  attachSlider(uiTree, 'slider-dtMacro', 'dtMacro');
  attachSlider(uiTree, 'slider-rColl', 'rColl');
  attachSlider(uiTree, 'slider-rEsc', 'rEsc');
  
  // ── Export/Import Section ──────────────────────────────────────────────────
  const secState = document.getElementById('sec-state');
  uiTree.attachElement('sec-state', secState); // Section container (legacy)
  uiTree.attachElement('sec-state-body', secState); // Section body grid
  uiTree.attachElement('sec-state:header', secState?.parentElement?.querySelector('.section-head') as HTMLElement | null);
  uiTree.attachElement('pasteJsonBtn', document.getElementById('pasteJsonBtn'));
  uiTree.attachElement('downloadJsonBtn', document.getElementById('downloadJsonBtn'));
  
  // ── Sidebar ────────────────────────────────────────────────────────────────
  // Sidebar is a transparent navigation container - no DOM element
  // Navigation goes directly to section bodies
  
  // ── Settings Panel ─────────────────────────────────────────────────────────
  uiTree.attachElement('autoRender', document.getElementById('autoRender'));
  uiTree.attachElement('previewWhileDrag', document.getElementById('previewWhileDrag'));
  uiTree.attachElement('showHud', document.getElementById('showHud'));
  uiTree.attachElement('stgInvertScroll', document.getElementById('stgInvertScroll'));
  attachSlider(uiTree, 'slider-stgZoomSpeed', 'stgZoomSpeed');
  uiTree.attachElement('stgInvertPanX', document.getElementById('stgInvertPanX'));
  uiTree.attachElement('stgInvertPanY', document.getElementById('stgInvertPanY'));
  attachSlider(uiTree, 'slider-stgPanSpeed', 'stgPanSpeed');
  
  console.log('[attach] Element attachment complete');
}

/**
 * Helper: Attach slider composite widget parts
 */
function attachSlider(uiTree: UITreeStore, sliderId: string, htmlId: string): void {
  let container = document.getElementById(htmlId) as HTMLElement | null;
  if (!container) {
    console.warn(`[attach] Slider element not found: ${htmlId}`);
    return;
  }
  
  // If htmlId points to an input, find its parent slider container
  if (container.tagName === 'INPUT') {
    container = container.closest('.sl-row');
    if (!container) {
      console.warn(`[attach] Slider container (.sl-row) not found for input: ${htmlId}`);
      return;
    }
  }
  
  // Find slider parts
  const label = container.querySelector('.sl-label') as HTMLElement | null;
  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  const valueInput = container.querySelector('input[type="number"]') as HTMLInputElement | null;
  
  // Attach scope (container itself)
  uiTree.attachElement(sliderId, container);
  
  // Attach param trigger (if exists)
  if (label && label.classList.contains('clickable')) {
    uiTree.attachElement(`${sliderId}:param`, label);
  }
  
  // Attach analog control
  if (rangeInput) {
    uiTree.attachElement(`${sliderId}:analog`, rangeInput);
  }
  
  // Attach value editor
  if (valueInput) {
    uiTree.attachElement(`${sliderId}:value`, valueInput);
  }
}

/**
 * Sync collapse state from tree to DOM
 * Reads tree meta.collapsed and applies CSS classes
 */
export async function syncCollapseState(uiTree: UITreeStore): Promise<void> {
  // Sync initial collapse state for all section bodies
  document.querySelectorAll('.section-head').forEach(head => {
    const htmlHead = head as HTMLElement;
    const target = htmlHead.dataset.target;
    if (!target) return;

    const body = document.getElementById(target);
    
    if (body) {
      const isOpen = body.classList.contains('open');
      const bodyGridId = `${target}-body`;
      const bodyGrid = uiTree.getNode(bodyGridId);
      
      if (bodyGrid && bodyGrid.kind === 'grid') {
        // Set hidden to true if section is collapsed (not open)
        uiTree.updateNode(bodyGridId, {
          hidden: !isOpen
        });
        console.log('[attach] Initial state for', bodyGridId, '- hidden:', !isOpen);
      }
    }
  });
  
  // Rebuild sidebar grid to reflect initial state
  const { rebuildSidebarGrid } = await import('./grid-rebuilder.js');
  rebuildSidebarGrid(uiTree);
}

/**
 * Initialize tabindex for all interactive elements
 * Sets all to tabindex="-1" for keyboard navigation manager control
 */
export function initTabindexes(uiTree: UITreeStore): void {
  const nodes = uiTree.toJSON().nodes.filter(n => 
    n.focusMode === 'leaf' || n.focusMode === 'entry-node'
  );
  
  nodes.forEach(node => {
    const element = uiTree.getElement(node.id);
    if (!element) return;
    
    // Only set tabindex on focusable elements
    if (element.tagName === 'BUTTON' || 
        element.tagName === 'INPUT' || 
        element.tagName === 'SELECT' ||
        element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
    }
  });
  
  console.log('[attach] Tabindex initialized for', nodes.length, 'nodes');
}
