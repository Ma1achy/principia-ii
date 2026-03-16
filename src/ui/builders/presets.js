import { state, PRESETS } from '../../state.js';
import { $ } from '../utils.js';

// ─── Preset builder ──────────────────────────────────────────────────────────

export function applyCustomBasis() {
  const q1 = new Array(10).fill(0); q1[state.customDimH] = state.customMag;
  const q2 = new Array(10).fill(0); q2[state.customDimV] = state.customMag;
  state.dir1Base = q1;
  state.dir2Base = q2;
}

export async function updateCustomPanelVisibility(uiTree = null, navManager = null, triggerButtonId = null) {
  const panel = $("customBasisPanel");
  const isCustom = state.presetId === "custom";
  
  if (panel) {
    panel.style.display = isCustom ? "block" : "none";
  }
  
  // Update semantic tree node visibility and rebuild grid
  if (uiTree) {
    const customControls = [
      'customDimH-picker:trigger',
      'customDimV-picker:trigger', 
      'slider-customMag'
    ];
    
    // Update hidden state for custom controls and their children
    customControls.forEach(nodeId => {
      const node = uiTree.getNode(nodeId);
      if (node) {
        uiTree.updateNode(nodeId, { hidden: !isCustom });
        
        // Also update children (e.g., slider analog and value)
        if (node.children) {
          node.children.forEach(childId => {
            uiTree.updateNode(childId, { hidden: !isCustom });
          });
        }
      }
    });
    
    // Rebuild presets grid to reflect new state
    const { rebuildPresetsGrid } = await import('../semantic-tree/grid-rebuilder.js');
    rebuildPresetsGrid(uiTree, isCustom);
    
    console.log('[updateCustomPanelVisibility] Grid rebuilt, custom:', isCustom);
    
    // Validate current focus after grid rebuild, returning to the trigger button if needed
    if (navManager && navManager.validateCurrentFocus) {
      navManager.validateCurrentFocus(triggerButtonId);
    }
  }
}

export async function buildPresets(scheduleRender, writeHash, updateStateBox, drawOverlayHUD, uiTree = null, navManager = null) {
  console.log('[buildPresets] Starting preset build, uiTree:', !!uiTree);
  const grid = $("presetGrid");
  grid.innerHTML = "";
  
  const presetNodes = [];
  
  console.log('[buildPresets] Building', PRESETS.length, 'preset buttons');
  
  for (const p of PRESETS) {
    console.log('[buildPresets] Creating preset:', p.id, p.name);
    const b = document.createElement("button");
    b.className = "btn preset" + (p.id === state.presetId ? " active" : "");
    if (p.id === "custom") b.style.gridColumn = "span 2";
    b.textContent = p.name;
    b.addEventListener("click", () => {
      state.presetId = p.id;
      if (p.id === "custom") {
        applyCustomBasis();
      } else {
        state.dir1Base = p.q1.slice();
        state.dir2Base = p.q2.slice();
      }
      [...grid.children].forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      
      // Pass the button ID so focus returns to the clicked button
      const btnId = `preset-${p.id}`;
      updateCustomPanelVisibility(uiTree, navManager, btnId);
      
      scheduleRender("preset");
      writeHash(); updateStateBox(); drawOverlayHUD();
    });
    grid.appendChild(b);
    
    // Register with semantic tree (Phase 2)
    if (uiTree) {
      const btnId = `preset-${p.id}`;
      console.log('[buildPresets] Queueing preset node:', btnId);
      presetNodes.push({
        id: btnId,
        kind: 'button',
        parentId: 'preset-grid',
        children: [],
        focusMode: 'leaf',
        role: 'button',
        ariaRole: 'button',
        ariaLabel: p.name,
        primary: p.id === state.presetId,
        meta: { label: p.name, presetId: p.id },
        element: b // Store reference for later attachment
      });
    }
  }
  
  // Add all preset nodes to tree with proper 2D grid structure
  if (uiTree && presetNodes.length > 0) {
    console.log('[buildPresets] Adding', presetNodes.length, 'preset buttons directly to sec-presets-body');
    
    // Add preset buttons to tree first
    uiTree.addNodes(presetNodes);
    
    // Attach elements after nodes exist
    presetNodes.forEach(node => {
      console.log('[buildPresets] Attaching element for:', node.id);
      uiTree.attachElement(node.id, node.element);
    });
    
    // Rebuild presets grid based on current state
    const { rebuildPresetsGrid } = await import('../semantic-tree/grid-rebuilder.js');
    const isCustomActive = state.presetId === 'custom';
    rebuildPresetsGrid(uiTree, isCustomActive);
  }
  
  console.log('[buildPresets] Complete');
}
