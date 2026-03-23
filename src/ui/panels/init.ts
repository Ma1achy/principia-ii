/**
 * @fileoverview Panel Initialization
 * Creates and initializes Settings and Info side panels
 */

import { createSidePanel, SidePanelResult } from './PanelFactory.js';

/**
 * Panel map structure
 */
export interface PanelMap {
  settings: SidePanelResult;
  info: SidePanelResult;
}

/**
 * Creates Settings panel content
 */
function createSettingsContent(): HTMLElement {
  const container = document.createElement('div');
  
  // HANDLING section (first)
  const handlingSection = document.createElement('div');
  handlingSection.className = 'section';
  
  const handlingHead = document.createElement('div');
  handlingHead.className = 'section-head open';
  handlingHead.setAttribute('data-target', 'settings-panel-handling');
  
  const handlingTitle = document.createElement('span');
  handlingTitle.textContent = 'Handling';
  
  const handlingArrow = document.createElement('span');
  handlingArrow.className = 'arrow';
  handlingArrow.innerHTML = '&#8250;'; // ›
  
  handlingHead.appendChild(handlingTitle);
  handlingHead.appendChild(handlingArrow);
  
  const handlingBody = document.createElement('div');
  handlingBody.className = 'section-body open';
  handlingBody.id = 'settings-panel-handling';
  handlingBody.innerHTML = `
    <div class="stg-group-subtitle">Mouse</div>
    <div class="stg-row"><span>Invert scroll direction</span><input type="checkbox" id="stgInvertScroll" /></div>
    <div class="stg-row"><span>Invert pan X</span><input type="checkbox" id="stgInvertPanX" /></div>
    <div class="stg-row"><span>Invert pan Y</span><input type="checkbox" id="stgInvertPanY" /></div>
    <div class="sl-row">
      <label>Zoom speed</label>
      <div class="sl-track-row">
        <input type="range" id="stgZoomSpeed" min="20" max="400" step="10" value="100" />
        <div class="sl-val-wrap">
          <input type="number" class="slider-num" id="stgZoomSpeedVal" value="100" step="10" min="20" max="400" data-unit="%" />
          <span class="slider-unit">%</span>
        </div>
      </div>
    </div>
    <div class="stg-row">
      <button id="stgResetMouse" class="btn secondary">RESET</button>
    </div>
    <div class="stg-group-subtitle">Keyboard</div>
    <div class="sl-row">
      <label>Key delay (DAS)</label>
      <div class="sl-track-row">
        <input type="range" id="stgNavDAS" min="50" max="500" step="10" value="200" />
        <div class="sl-val-wrap">
          <input type="number" class="slider-num" id="stgNavDASVal" value="200" step="10" min="50" max="500" data-unit="MS" />
          <span class="slider-unit">MS</span>
        </div>
      </div>
    </div>
    <div class="sl-row">
      <label>Key repeat (ARR)</label>
      <div class="sl-track-row">
        <input type="range" id="stgNavARR" min="20" max="200" step="10" value="50" />
        <div class="sl-val-wrap">
          <input type="number" class="slider-num" id="stgNavARRVal" value="50" step="10" min="20" max="200" data-unit="MS" />
          <span class="slider-unit">MS</span>
        </div>
      </div>
    </div>
    <div class="stg-row">
      <button id="stgResetHandling" class="btn secondary">RESET</button>
    </div>
  `;
  
  handlingSection.appendChild(handlingHead);
  handlingSection.appendChild(handlingBody);
  container.appendChild(handlingSection);
  
  // RENDERING section (second)
  const renderingSection = document.createElement('div');
  renderingSection.className = 'section';
  
  const renderingHead = document.createElement('div');
  renderingHead.className = 'section-head open';
  renderingHead.setAttribute('data-target', 'settings-panel-rendering');
  
  const renderingTitle = document.createElement('span');
  renderingTitle.textContent = 'Rendering';
  
  const renderingArrow = document.createElement('span');
  renderingArrow.className = 'arrow';
  renderingArrow.innerHTML = '&#8250;'; // ›
  
  renderingHead.appendChild(renderingTitle);
  renderingHead.appendChild(renderingArrow);
  
  const renderingBody = document.createElement('div');
  renderingBody.className = 'section-body open';
  renderingBody.id = 'settings-panel-rendering';
  renderingBody.innerHTML = `
    <div class="stg-row"><span>Auto-render</span><input type="checkbox" id="autoRender" checked /></div>
    <div class="stg-row"><span>Preview while moving</span><input type="checkbox" id="previewWhileDrag" checked /></div>
    <div class="stg-row"><span>Show probe</span><input type="checkbox" id="showHud" checked /></div>
  `;
  
  renderingSection.appendChild(renderingHead);
  renderingSection.appendChild(renderingBody);
  container.appendChild(renderingSection);
  
  return container;
}

/**
 * Creates Info panel content
 */
function createInfoContent(): string {
  return `
    <div class="info-group">
      <div class="info-group-title">Navigation</div>
      <div class="info-row"><span class="info-key">Pan</span><span class="info-val">Drag</span></div>
      <div class="info-row"><span class="info-key">Zoom</span><span class="info-val">Scroll wheel</span></div>
      <div class="info-row"><span class="info-key">Reset view</span><span class="info-val">Double-click</span></div>
    </div>
    <div class="info-group">
      <div class="info-group-title">Slice orientation</div>
      <div class="info-row"><span class="info-key">Rotate &gamma;</span><span class="info-val">&#x21E7; + drag</span></div>
      <div class="info-row"><span class="info-key">Tilt q&#8321;/q&#8322;</span><span class="info-val">&#x2325; + drag</span></div>
    </div>
    <div class="info-group">
      <div class="info-group-title">About</div>
      <div class="info-row"><span class="info-key">Pipeline</span><span class="info-val">10D slice &rarr; IC decode &rarr; integrate &rarr; classify</span></div>
      <div class="info-row"><span class="info-key">Integrator</span><span class="info-val">KDK leapfrog + adaptive substeps</span></div>
    </div>
    <div class="info-group">
      <div class="info-group-title">Render modes</div>
      <div class="info-row"><span class="info-key">Event</span><span class="info-val">Collision / escape / bounded</span></div>
      <div class="info-row"><span class="info-key">Phase + Diffusion</span><span class="info-val">Hue = &theta;, brightness = chaos</span></div>
      <div class="info-row"><span class="info-key">Shape sphere phase</span><span class="info-val">Hue = shape phase &theta;</span></div>
      <div class="info-row"><span class="info-key">Diffusion</span><span class="info-val">Greyscale chaos proxy</span></div>
      <div class="info-row"><span class="info-key">Shape sphere RGB</span><span class="info-val">RGB &larr; surface normal</span></div>
    </div>
  `.trim();
}

/**
 * Creates all panel overlays and appends them to the DOM
 */
export function initAllPanels(): PanelMap {
  const panels: PanelMap = {
    settings: createSidePanel('settingsPanel', 'Settings', createSettingsContent(), { withScrollbar: true }),
    info: createSidePanel('infoPanel', 'Controls & Info', createInfoContent())
  };
  
  // Append all panel overlays to body
  Object.values(panels).forEach(panel => {
    document.body.appendChild(panel.overlay);
  });
  
  return panels;
}
