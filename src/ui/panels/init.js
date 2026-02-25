/**
 * @fileoverview Panel Initialization
 * Creates and initializes Settings and Info side panels
 */

import { createSidePanel } from './PanelFactory.js';

/**
 * Creates Settings panel content
 * @returns {string} HTML string for settings content
 */
function createSettingsContent() {
  return `
    <div class="stg-group">
      <div class="stg-group-title">Rendering</div>
      <div class="stg-row"><span>Auto-render</span><input type="checkbox" id="autoRender" checked /></div>
      <div class="stg-row"><span>Preview while moving</span><input type="checkbox" id="previewWhileDrag" checked /></div>
      <div class="stg-row"><span>Show probe</span><input type="checkbox" id="showHud" checked /></div>
    </div>
    <div class="stg-group">
      <div class="stg-group-title">Scroll / Zoom</div>
      <div class="stg-row"><span>Invert scroll direction</span><input type="checkbox" id="stgInvertScroll" /></div>
      <div class="sl-row">
        <label>Zoom speed</label>
        <div class="sl-track-row">
          <input type="range" id="stgZoomSpeed" min="0.2" max="4.0" step="0.1" value="1.0" />
          <div class="sl-val-wrap">
            <input type="number" class="slider-num" id="stgZoomSpeedVal" value="1.0" step="0.1" min="0.2" max="4.0" />
          </div>
        </div>
      </div>
    </div>
    <div class="stg-group">
      <div class="stg-group-title">Panning</div>
      <div class="stg-row"><span>Invert pan X</span><input type="checkbox" id="stgInvertPanX" /></div>
      <div class="stg-row"><span>Invert pan Y</span><input type="checkbox" id="stgInvertPanY" /></div>
      <div class="sl-row">
        <label>Pan speed</label>
        <div class="sl-track-row">
          <input type="range" id="stgPanSpeed" min="0.2" max="4.0" step="0.1" value="1.0" />
          <div class="sl-val-wrap">
            <input type="number" class="slider-num" id="stgPanSpeedVal" value="1.0" step="0.1" min="0.2" max="4.0" />
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

/**
 * Creates Info panel content
 * @returns {string} HTML string for info content
 */
function createInfoContent() {
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
 * @returns {Object} Map of panel IDs to their elements
 */
export function initAllPanels() {
  const panels = {
    settings: createSidePanel('settingsPanel', 'Settings', createSettingsContent()),
    info: createSidePanel('infoPanel', 'Controls & Info', createInfoContent())
  };
  
  // Append all panel overlays to body
  Object.values(panels).forEach(panel => {
    document.body.appendChild(panel.overlay);
  });
  
  return panels;
}
