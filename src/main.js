import { createThreeBodyRenderer } from './renderer.js';
import { state, encodeStateHash, decodeStateHash, applyPackedHash, MODE_INFO } from './state.js';
import { GlTooltip } from './tooltip.js';
import {
  buildResolutions, buildPresets, buildAxisSelects, buildZ0Sliders,
  setZ0Range, applyCustomBasis, updateStateBox,
  syncUIFromState, drawOverlayHUD, showProbeAtEvent, setOverlay, setStatus,
  showGL, showOut, bindUI, setRenderingState, fitTitle,
} from './ui.js';
import { attachGestures, attachProbe, attachHintTooltips } from './nav.js';
import { FlavourText, attachFlavourText } from './flavourText.js';

const glCanvas  = document.getElementById('glCanvas');
const outCanvas = document.getElementById('outCanvas');
const uiCanvas  = document.getElementById('uiCanvas');
const ui2d      = uiCanvas.getContext('2d');

// ─── Flavour text ─────────────────────────────────────────────────────────────

const MODE_MAP = {
  'Event classification': 'event',
  'Diffusion':            'diffusion',
  'Phase + Diffusion':    'phase+diffusion',
  'Shape sphere phase':   'phase',
  'Shape sphere RGB':     'phase',  // Use 'phase' for shape sphere modes
};

// Interaction state tracker for reactive mode switching
const interactionState = {
  isZooming: false,
  isDragging: false,
  isRendering: false,
  isLongRender: false, // Only true for tiled/slow renders
  lastActionTime: Date.now(),
  idleThresholdMs: 30000, // 30 seconds of no input = idle
  pageLoadTime: Date.now(), // Track when page loaded
  graceGracePeriodMs: 5000, // 5 second grace period after page load before considering "idle"
  
  // Probe state - updated when hovering over rendered output
  probeActive: false,
  hasCollision: false,
  hasEscape: false,
  stabilityValue: 0,
};

function getCurrentMode() {
  // Active interaction states (highest priority)
  if (interactionState.isZooming) return 'zoom';
  if (interactionState.isDragging) return 'drag';
  
  // Long render mode (only for tiled/slow renders, not quick previews)
  if (interactionState.isLongRender) return 'render';
  
  // Contextual modes when hovering (only when actively probing)
  if (interactionState.probeActive) {
    if (interactionState.hasCollision) return 'collision';
    if (interactionState.stabilityValue < 0.15) return 'stable';
    if (interactionState.hasEscape) return 'ejection';
  }
  
  // Check for idle (no input for a while) - but not during grace period after page load
  const timeSincePageLoad = Date.now() - interactionState.pageLoadTime;
  const idleTime = Date.now() - interactionState.lastActionTime;
  if (timeSincePageLoad > interactionState.graceGracePeriodMs && 
      idleTime > interactionState.idleThresholdMs) {
    return 'idle';
  }
  
  // Default: use the simulation mode
  const modeName = MODE_INFO[state.mode]?.name || 'Event classification';
  return MODE_MAP[modeName] ?? 'event';
}

// Track user activity for idle detection
function trackActivity() {
  interactionState.lastActionTime = Date.now();
}

const subtitleEl = document.getElementById('canvas-title-sub');
const flavour = new FlavourText('src/resources/flavour.json', {
  defaultInterval: 4000,
  crossfadeMs:      600,
  bufferSize:        32,
  displayMinMs:     2000,
  displayMaxMs:    10000,
  multiLineMultiplier: 2.5,
});

await flavour.load();
attachFlavourText(flavour, getCurrentMode, subtitleEl, [], fitTitle);

// Watch for collision/ejection events and try to interrupt
let lastObservedMode = null;
setInterval(() => {
  // Only try to interrupt if we're in a reactive mode
  const mode = getCurrentMode();
  
  // Feed new events to Chazy
  if (mode !== lastObservedMode) {
    // Mode changed, observe the event
    if (mode === 'collision' || mode === 'ejection' || mode === 'stable' || 
        mode === 'zoom' || mode === 'drag' || mode === 'idle' || mode === 'render') {
      
      // Prepare event data
      const eventData = {
        stability: interactionState.stabilityValue,
        hasCollision: interactionState.hasCollision,
        hasEscape: interactionState.hasEscape,
      };
      
      flavour.chazy.observe(mode, eventData);
      
      // Try to interrupt if Chazy thinks this event is emotionally significant
      if (flavour.chazy.shouldInterrupt(mode)) {
        flavour.interrupt();
      }
    }
    
    lastObservedMode = mode;
  }
  
  // Also try to interrupt for collision/ejection even without mode change
  if (mode === 'collision' || mode === 'ejection') {
    flavour.interrupt();
  }
}, 1000); // Check every second

// Add click-to-reroll
subtitleEl.style.cursor = 'pointer';
subtitleEl.addEventListener('click', () => {
  trackActivity();
  attachFlavourText(flavour, getCurrentMode, subtitleEl, [], fitTitle);
});

// Track activity on any user interaction
document.addEventListener('mousemove', trackActivity, { passive: true });
document.addEventListener('mousedown', trackActivity, { passive: true });
document.addEventListener('keydown', trackActivity, { passive: true });
document.addEventListener('wheel', trackActivity, { passive: true });
document.addEventListener('touchstart', trackActivity, { passive: true });

// Export interaction state for other modules to update
export { interactionState };

const renderer     = await createThreeBodyRenderer(glCanvas, outCanvas);
const probeTooltip = new GlTooltip();
const hintTooltip  = new GlTooltip();

// ─── Resize UI canvas ────────────────────────────────────────────────────────

function resizeUiCanvasToMatch() {
  const activeCanvas = outCanvas.style.display !== 'none' ? outCanvas : glCanvas;
  const rect = activeCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  uiCanvas.width  = Math.max(1, Math.round(rect.width  * dpr));
  uiCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  uiCanvas.style.width  = rect.width  + 'px';
  uiCanvas.style.height = rect.height + 'px';
  drawHUD();
}

window.addEventListener('resize', () => resizeUiCanvasToMatch());

function drawHUD() {
  drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch);
}

// ─── Canvas visibility ────────────────────────────────────────────────────────

function showGL_() { showGL(glCanvas, outCanvas, resizeUiCanvasToMatch); }
function showOut_() { showOut(glCanvas, outCanvas, resizeUiCanvasToMatch); }

// ─── Render scheduling ────────────────────────────────────────────────────────

let finalTimer = null, previewPending = false;

function scheduleRender(reason = '') {
  const autoRender = document.getElementById('autoRender');
  const previewWhileDrag = document.getElementById('previewWhileDrag');
  if (!autoRender.checked) return;
  if (previewWhileDrag.checked) {
    if (!previewPending) {
      previewPending = true;
      requestAnimationFrame(() => {
        previewPending = false;
        const previewRes = Math.min(512, renderer.getMaxDrawableSize());
        try {
          showGL_();
          renderer.renderNormal(state, previewRes);
          setStatus(`Preview ${previewRes}x${previewRes}${reason ? ' · ' + reason : ''}`);
          drawHUD();
        } catch(e) { console.error(e); }
      });
    }
  }
  clearTimeout(finalTimer);
  finalTimer = setTimeout(() => {
    doRender(state.res).catch(err => {
      setOverlay(false);
      setRenderingState(false);
      setStatus(String(err?.message || err));
      console.error(err);
      drawHUD();
    });
  }, 220);
}

async function doRender(res) {
  const maxGpu = renderer.getMaxDrawableSize();
  interactionState.isRendering = true;
  
  // Only set long render mode for large/tiled renders
  const isLongRender = res >= 8192 || res > maxGpu;
  if (isLongRender) {
    interactionState.isLongRender = true;
  }
  
  setRenderingState(true);
  renderer.setAbort(false);
  if (isLongRender) {
    const preview = Math.min(1024, maxGpu);
    showGL_();
    renderer.renderNormal(state, preview);
    drawHUD();
    showOut_();
    setOverlay(true, 'Tiling...', 0);
    setStatus(`Tiled render ${res}x${res}`);
    const result = await renderer.renderTiled(state, res, ({ done, total, w, h }) => {
      setOverlay(true, `${done}/${total} tiles (${w}x${h})`, (done / total) * 100);
    });
    setOverlay(false);
    interactionState.isRendering = false;
    interactionState.isLongRender = false;
    setRenderingState(false);
    if (result.aborted) { setStatus('Stopped.'); drawHUD(); return; }
    setStatus(`Done: ${res}x${res} (tiled)`);
    drawHUD();
    return;
  }
  showGL_();
  setOverlay(true, `Rendering ${res}x${res}...`, 40);
  renderer.renderNormal(state, res);
  setOverlay(false);
  interactionState.isRendering = false;
  setRenderingState(false);
  setStatus(`Done: ${res}x${res}`);
  drawHUD();
}

// ─── URL hash ────────────────────────────────────────────────────────────────

function writeHash() {
  history.replaceState(null, '', '#' + encodeStateHash(state));
}

// ─── Probe ───────────────────────────────────────────────────────────────────

function showProbe(e) {
  showProbeAtEvent(e, probeTooltip, glCanvas, outCanvas, renderer, interactionState);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

function boot() {
  buildResolutions(renderer);
  buildPresets(scheduleRender, writeHash, updateStateBox, drawHUD);
  buildAxisSelects();
  buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawHUD);
  setZ0Range(+document.getElementById('z0Range').value);

  if (location.hash && location.hash.length > 2) {
    applyPackedHash(decodeStateHash(location.hash.slice(1)), applyCustomBasis);
  }

  const resOptions = [...document.getElementById('resolution').options].map(o => +o.value);
  if (!resOptions.includes(state.res)) state.res = resOptions[0];

  buildPresets(scheduleRender, writeHash, updateStateBox, drawHUD);
  syncUIFromState(renderer, scheduleRender, writeHash, drawHUD);

  bindUI(renderer, glCanvas, outCanvas, uiCanvas, ui2d, probeTooltip, doRender, scheduleRender, writeHash, resizeUiCanvasToMatch);

  attachGestures(glCanvas,  glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe);
  attachGestures(outCanvas, glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe);
  attachProbe(glCanvas,  probeTooltip, showProbe, interactionState);
  attachProbe(outCanvas, probeTooltip, showProbe, interactionState);
  attachHintTooltips(hintTooltip);

  fitTitle();
  new ResizeObserver(fitTitle).observe(document.getElementById('main'));
  window.addEventListener('resize', fitTitle);

  writeHash();
  updateStateBox();

  doRender(state.res).catch(err => {
    setOverlay(false);
    setRenderingState(false);
    setStatus(String(err?.message || err));
    console.error(err);
    drawHUD();
  }).finally(() => {
    document.body.classList.add('loaded');
  });

  requestAnimationFrame(() => resizeUiCanvasToMatch());
}

boot();
