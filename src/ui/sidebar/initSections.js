/**
 * @fileoverview Sidebar Sections Initialization
 * Dynamically generates all sidebar sections and their content
 */

import { createSection } from '../components/section/SectionFactory.js';
import { createSlider } from '../components/slider/SliderFactory.js';
import { createScrollbar } from '../components/scrollbar/ScrollbarFactory.js';

/**
 * Creates all sidebar sections and inserts them into the sidebar-scroll container
 */
export function initSidebarSections() {
  const container = document.getElementById('sidebar-scroll');
  if (!container) {
    console.error('[SidebarSections] Container #sidebar-scroll not found');
    return;
  }
  
  // Clear existing content (if any)
  container.innerHTML = '';
  
  // Build each section
  container.appendChild(createDisplaySection());
  container.appendChild(createSliceBasisSection());
  container.appendChild(createSliceOffsetSection());
  container.appendChild(createOrientationSection());
  container.appendChild(createSimulationSection());
  container.appendChild(createExportImportSection());
}

/**
 * Display Section (render mode + resolution)
 */
function createDisplaySection() {
  const content = `
    <div class="dim-pair-row">
      <div class="dim-pair-cell">
        <label>Render mode</label>
        <span class="sl-dim-label" id="modeLabel"><span class="sl-dim-text" id="modeName">Event classification</span><span class="sl-dim-arrow">&#9662;</span></span>
        <select id="mode" style="display:none;" data-tip="Render mode: event classification, phase + diffusion, shape sphere phase, diffusion, or shape sphere RGB.">
          <option value="0">Event classification</option>
          <option value="1">Phase + Diffusion</option>
          <option value="2">Shape sphere phase</option>
          <option value="3">Diffusion</option>
          <option value="4">Shape sphere RGB</option>
        </select>
      </div>
      <div class="dim-pair-cell">
        <label>Resolution</label>
        <span class="sl-dim-label" id="resLabel"><span class="sl-dim-text" id="resName">1024 × 1024</span><span class="sl-dim-arrow">&#9662;</span></span>
        <select id="resolution" style="display:none;"></select>
      </div>
    </div>
  `;
  
  return createSection({
    id: 'sec-mode',
    title: 'Display',
    open: true,
    content
  });
}

/**
 * Slice Basis Section (preset grid + custom dim selectors + customMag slider)
 */
function createSliceBasisSection() {
  const content = document.createElement('div');
  
  // Preset grid (populated by buildPresets)
  const presetGrid = document.createElement('div');
  presetGrid.className = 'presetGrid';
  presetGrid.id = 'presetGrid';
  content.appendChild(presetGrid);
  
  // Custom basis panel (hidden by default)
  const customPanel = document.createElement('div');
  customPanel.id = 'customBasisPanel';
  customPanel.style.cssText = 'display:none; margin-top:10px; border-top:1px solid var(--border-strong); padding-top:10px;';
  
  customPanel.innerHTML = `
    <div class="dim-pair-row">
      <div class="dim-pair-cell">
        <label>H-axis (&rarr;)</label>
        <span class="sl-dim-label" id="customDimHLabel"><span class="sl-dim-text" id="customDimHName">z&#x2080;</span><span class="sl-dim-arrow">&#9662;</span></span>
        <select id="customDimH" style="display:none;"></select>
      </div>
      <div class="dim-pair-cell">
        <label>V-axis (&uarr;)</label>
        <span class="sl-dim-label" id="customDimVLabel"><span class="sl-dim-text" id="customDimVName">z&#x2081;</span><span class="sl-dim-arrow">&#9662;</span></span>
        <select id="customDimV" style="display:none;"></select>
      </div>
    </div>
  `;
  
  // Add customMag slider
  const customMagSlider = createSlider({
    id: 'customMag',
    label: '&#xb1;mag',
    min: 0.1,
    max: 4.0,
    step: 0.05,
    value: 1.0,
    tip: 'Half-range magnitude for the custom basis vectors.',
    numberTitle: 'Half-range magnitude',
    marginTop: '8px'
  });
  customPanel.appendChild(customMagSlider);
  
  content.appendChild(customPanel);
  
  return createSection({
    id: 'sec-presets',
    title: 'Slice Basis',
    open: true,
    content
  });
}

/**
 * Slice Offset Section (z0 buttons + z0Range slider + z0Sliders container)
 */
function createSliceOffsetSection() {
  const content = document.createElement('div');
  
  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = 'row';
  buttonRow.innerHTML = `
    <button id="z0Zero" data-tip="Set all z0 offset dimensions to zero." class="btn" style="font-size:10px; padding:5px 8px;">Zero</button>
    <button id="z0SmallRand" data-tip="Apply a small random perturbation to z0." class="btn" style="font-size:10px; padding:5px 8px;">Small random</button>
  `;
  content.appendChild(buttonRow);
  
  // z0Range slider
  const z0RangeSlider = createSlider({
    id: 'z0Range',
    label: '&#xb1;range',
    min: 0.25,
    max: 8.0,
    step: 0.25,
    value: 2.0,
    tip: 'Range of the z0 offset sliders (+-value).',
    numberTitle: 'z&#x2080; Range',
    marginTop: '8px'
  });
  content.appendChild(z0RangeSlider);
  
  // z0Sliders container (populated by buildZ0Sliders)
  const z0Sliders = document.createElement('div');
  z0Sliders.id = 'z0Sliders';
  content.appendChild(z0Sliders);
  
  return createSection({
    id: 'sec-z0',
    title: 'Slice Offset z&#8320; (10D)',
    open: true,
    content
  });
}

/**
 * Orientation Section (gamma slider + tilt sliders + checkbox + reset button)
 */
function createOrientationSection() {
  const content = document.createElement('div');
  
  // Gamma slider
  const gammaSlider = createSlider({
    id: 'gamma',
    label: '&gamma; &mdash; rotate within plane',
    min: 0,
    max: 360,
    step: 0.25,
    value: 0,
    tip: 'Rotate the slice plane within the q1-q2 basis by gamma degrees.',
    numberTitle: '&#x3b3; rotation (&#xb0;)'
  });
  content.appendChild(gammaSlider);
  
  // Tilt 1 slider (with picker label)
  const tilt1Row = document.createElement('div');
  tilt1Row.className = 'sl-row';
  tilt1Row.style.marginTop = '10px';
  tilt1Row.innerHTML = `
    <span class="sl-dim-label" id="tiltDim1Label"><span class="sl-dim-text">q&#8321; tilt into <span id="tiltDim1Name">z&#8328;</span></span><span class="sl-dim-arrow">&#9662;</span></span>
    <div class="sl-track-row">
      <input id="tiltAmt1" data-tip="Tilt q1 into the selected extra dimension." type="range" min="-2.0" max="2.0" step="0.01" value="0" />
      <div class="sl-val-wrap">
        <input type="number" class="slider-num" id="tiltAmt1Val" value="0.00" step="0.01" min="-2.0" max="2.0" data-title="Tilt q&#x2081; amount" data-tip="Tilt q1 into the selected extra dimension." />
      </div>
    </div>
  `;
  content.appendChild(tilt1Row);
  
  // Tilt 2 slider (with picker label)
  const tilt2Row = document.createElement('div');
  tilt2Row.className = 'sl-row';
  tilt2Row.style.marginTop = '8px';
  tilt2Row.innerHTML = `
    <span class="sl-dim-label" id="tiltDim2Label"><span class="sl-dim-text">q&#8322; tilt into <span id="tiltDim2Name">z&#8329;</span></span><span class="sl-dim-arrow">&#9662;</span></span>
    <div class="sl-track-row">
      <input id="tiltAmt2" data-tip="Tilt q2 into the selected extra dimension." type="range" min="-2.0" max="2.0" step="0.01" value="0" />
      <div class="sl-val-wrap">
        <input type="number" class="slider-num" id="tiltAmt2Val" value="0.00" step="0.01" min="-2.0" max="2.0" data-title="Tilt q&#x2082; amount" data-tip="Tilt q2 into the selected extra dimension." />
      </div>
    </div>
  `;
  content.appendChild(tilt2Row);
  
  // Hidden selects for tilt dimensions
  const hiddenSelects = document.createElement('div');
  hiddenSelects.innerHTML = `
    <select id="tiltDim1" style="display:none;"></select>
    <select id="tiltDim2" style="display:none;"></select>
  `;
  content.appendChild(hiddenSelects);
  
  // Ortho checkbox
  const checkbox = document.createElement('div');
  checkbox.className = 'check';
  checkbox.innerHTML = `
    <input id="doOrtho" data-tip="Orthonormalise q1 and q2 so the slice axes are perpendicular." type="checkbox" checked />
    <label for="doOrtho">Orthonormalise q&#8321;, q&#8322;</label>
  `;
  content.appendChild(checkbox);
  
  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.id = 'rotReset';
  resetBtn.className = 'btn';
  resetBtn.style.cssText = 'margin-top:10px; font-size:10px; padding:5px 8px;';
  resetBtn.setAttribute('data-tip', 'Reset gamma rotation and all tilt amounts to zero.');
  resetBtn.textContent = 'Reset tilts + γ';
  content.appendChild(resetBtn);
  
  return createSection({
    id: 'sec-orient',
    title: 'Orientation (&gamma; + tilts)',
    open: true,
    content
  });
}

/**
 * Simulation Section (5 simulation parameter sliders)
 */
function createSimulationSection() {
  const sliders = [
    createSlider({
      id: 'horizon',
      label: 'Horizon',
      min: 10,
      max: 200,
      step: 10,
      value: 50,
      tip: 'Integration time horizon. Larger = longer trajectories before classification.'
    }),
    createSlider({
      id: 'maxSteps',
      label: 'Max steps',
      min: 1000,
      max: 40000,
      step: 1000,
      value: 20000,
      tip: 'Maximum integrator steps per pixel before forced termination.',
      marginTop: '8px'
    }),
    createSlider({
      id: 'dtMacro',
      label: 'dt macro',
      min: 0.0005,
      max: 0.01,
      step: 0.0005,
      value: 0.002,
      tip: 'Macro timestep for the leapfrog integrator. Smaller = more accurate.',
      marginTop: '8px'
    }),
    createSlider({
      id: 'rColl',
      label: 'r_coll',
      min: 0.005,
      max: 0.06,
      step: 0.001,
      value: 0.02,
      tip: 'Collision detection radius.',
      marginTop: '8px'
    }),
    createSlider({
      id: 'rEsc',
      label: 'r_esc',
      min: 1.0,
      max: 12.0,
      step: 0.25,
      value: 5.0,
      tip: 'Escape detection radius.',
      marginTop: '8px'
    })
  ];
  
  return createSection({
    id: 'sec-sim',
    title: 'Simulation',
    open: false,
    content: sliders
  });
}

/**
 * Export/Import Section (buttons + stateBox with scrollbar)
 */
function createExportImportSection() {
  const content = document.createElement('div');
  
  // Button row
  const buttonRow = document.createElement('div');
  buttonRow.className = 'row';
  buttonRow.innerHTML = `
    <button id="pasteJsonBtn" data-tip="Apply the JSON in the text box to restore a saved state." class="btn" style="font-size:10px; padding:5px 8px;">Apply JSON</button>
    <button id="downloadJsonBtn" data-tip="Download the current state as a JSON file." class="btn" style="font-size:10px; padding:5px 8px;">Download JSON</button>
  `;
  content.appendChild(buttonRow);
  
  // Label
  const label = document.createElement('label');
  label.style.marginTop = '10px';
  label.textContent = 'State JSON';
  content.appendChild(label);
  
  // StateBox wrap (textarea + scrollbar)
  const wrap = document.createElement('div');
  wrap.id = 'stateBox-wrap';
  
  const textarea = document.createElement('textarea');
  textarea.id = 'stateBox';
  textarea.setAttribute('spellcheck', 'false');
  
  const scrollbar = createScrollbar('stateBox-sb');
  
  wrap.appendChild(textarea);
  wrap.appendChild(scrollbar);
  content.appendChild(wrap);
  
  return createSection({
    id: 'sec-state',
    title: 'Export / Import',
    open: false,
    content
  });
}
