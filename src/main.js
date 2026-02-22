import { createThreeBodyRenderer } from './renderer.js';
import { state, encodeStateHash, decodeStateHash, applyPackedHash, MODE_INFO } from './state.js';
import { GlTooltip } from './ui/components/tooltip.js';
import {
  buildResolutions, buildPresets, buildAxisSelects, buildZ0Sliders,
  setZ0Range, applyCustomBasis, updateStateBox,
  syncUIFromState, drawOverlayHUD, showProbeAtEvent, setOverlay, setStatus,
  showGL, showOut, bindUI, setRenderingState,
} from './ui.js';
import { attachGestures, attachProbe } from './interaction/gestures.js';
import { attachHintTooltips } from './interaction/hints.js';
import { ButtonTracker } from './interaction/buttonTracking.js';
import { PatternDetector } from './interaction/patternDetector.js';
import { Chazy } from './Chazy/index.js';
import { computeTitleBoundingBox } from './ui/core/layout.js';

const glCanvas  = document.getElementById('glCanvas');
const outCanvas = document.getElementById('outCanvas');
const uiCanvas  = document.getElementById('uiCanvas');
const ui2d      = uiCanvas.getContext('2d');

// ─── Mode mapping and interaction state ──────────────────────────────────────

const MODE_MAP = {
  'Event classification': 'event',
  'Diffusion':            'diffusion',
  'Phase + Diffusion':    'phase+diffusion',
  'Shape sphere phase':   'phase',
  'Shape sphere RGB':     'phase',
};

const interactionState = {
  isZooming: false,
  isDragging: false,
  isRendering: false,
  isLongRender: false,
  lastActionTime: Date.now(),
  idleThresholdMs: 30000,
  pageLoadTime: Date.now(),
  graceGracePeriodMs: 5000,
  probeActive: false,
  hasCollision: false,
  hasEscape: false,
  stabilityValue: 0,
};

function getCurrentMode() {
  if (interactionState.isZooming) return 'zoom';
  if (interactionState.isDragging) return 'drag';
  if (interactionState.isLongRender) return 'render';
  
  if (interactionState.probeActive) {
    if (interactionState.hasCollision) return 'collision';
    if (interactionState.stabilityValue < 0.15) return 'stable';
    if (interactionState.hasEscape) return 'ejection';
  }
  
  const timeSincePageLoad = Date.now() - interactionState.pageLoadTime;
  const idleTime = Date.now() - interactionState.lastActionTime;
  if (timeSincePageLoad > interactionState.graceGracePeriodMs && 
      idleTime > interactionState.idleThresholdMs) {
    return 'idle';
  }
  
  const modeName = MODE_INFO[state.mode]?.name || 'Event classification';
  return MODE_MAP[modeName] ?? 'event';
}

function trackActivity() {
  interactionState.lastActionTime = Date.now();
}

export { interactionState, patternDetector };

// ─── Chazy (subtitle system) ─────────────────────────────────────────────────

const chazy = new Chazy({
  textPath: 'src/Chazy/flavour.json',
  displayMinMs: 2000,
  displayMaxMs: 10000,
  selector: {
    bufferSize: 32,
    multiLineMultiplier: 2.5
  }
});

// Initialize interaction trackers (after chazy)
let buttonTracker = null;
let patternDetector = null;

// Update layout on resize/changes
let layoutUpdateTimeout = null;
function updateChazyLayout() {
  // Always clear any pending timeout to ensure fresh calculation
  if (layoutUpdateTimeout) {
    clearTimeout(layoutUpdateTimeout);
    layoutUpdateTimeout = null;
  }
  
  // Use requestAnimationFrame to batch with browser layout
  layoutUpdateTimeout = requestAnimationFrame(() => {
    const bbox = computeTitleBoundingBox();
    console.log('[Main] Layout calculated:', bbox);
    chazy.updateLayout(bbox);
    layoutUpdateTimeout = null;
  });
}

// Watch for collision/ejection events and try to interrupt
let lastObservedMode = null;
setInterval(() => {
  const mode = getCurrentMode();
  
  if (mode !== lastObservedMode) {
    if (mode === 'collision' || mode === 'ejection' || mode === 'stable' || 
        mode === 'zoom' || mode === 'drag' || mode === 'idle' || mode === 'render') {
      
      const eventData = {
        stability: interactionState.stabilityValue,
        hasCollision: interactionState.hasCollision,
        hasEscape: interactionState.hasEscape,
      };
      
      chazy.observe(mode, eventData);
      
      if (chazy.mind.shouldInterrupt(mode)) {
        chazy.interrupt();
      }
    }
    
    lastObservedMode = mode;
  }
  
  if (mode === 'collision' || mode === 'ejection') {
    chazy.interrupt();
  }
}, 1000);

// Track activity on any user interaction
document.addEventListener('mousemove', trackActivity, { passive: true });
document.addEventListener('mousedown', trackActivity, { passive: true });
document.addEventListener('keydown', trackActivity, { passive: true });
document.addEventListener('wheel', trackActivity, { passive: true });
document.addEventListener('touchstart', trackActivity, { passive: true });

// ─── Page Lifecycle Events ──────────────────────────────────────────────────

// Track page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    chazy.route('page_hidden', {});
  } else {
    chazy.route('page_visible', {});
  }
});

// Track user idle/returned states
let lastUserActivity = Date.now();
let wasIdle = false;
const IDLE_THRESHOLD = 30000; // 30 seconds

// Update last activity timestamp
function trackUserActivity() {
  lastUserActivity = Date.now();
  
  // Check if was idle and now returned
  if (wasIdle) {
    wasIdle = false;
    chazy.route('user_returned', {});
  }
  
  trackActivity(); // Also update interaction state
}

// Replace existing activity listeners with enhanced version
document.removeEventListener('mousemove', trackActivity);
document.removeEventListener('mousedown', trackActivity);
document.removeEventListener('keydown', trackActivity);
document.removeEventListener('wheel', trackActivity);
document.removeEventListener('touchstart', trackActivity);

document.addEventListener('mousemove', trackUserActivity, { passive: true });
document.addEventListener('mousedown', trackUserActivity, { passive: true });
document.addEventListener('keydown', trackUserActivity, { passive: true });
document.addEventListener('wheel', trackUserActivity, { passive: true });
document.addEventListener('touchstart', trackUserActivity, { passive: true });

// Check for idle state periodically
setInterval(() => {
  const idleTime = Date.now() - lastUserActivity;
  
  if (!wasIdle && idleTime > IDLE_THRESHOLD) {
    wasIdle = true;
    chazy.route('user_idle', { duration: idleTime });
  }
}, 5000); // Check every 5 seconds

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

async function boot() {
  // FIRST: Wait for fonts to load before doing anything
  await document.fonts.ready;
  console.log('[Boot] Fonts loaded');
  
  // SECOND: Initialize Chazy (title + subtitle system)
  await chazy.init(document.body, getCurrentMode);
  
  // Initialize interaction trackers (but don't track buttons yet)
  buttonTracker = new ButtonTracker(chazy.router);
  patternDetector = new PatternDetector(chazy.router);
  
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
  
  // NOW track buttons (after UI is built)
  console.log('[Boot] Setting up button tracking...');
  buttonTracker.trackButton(document.getElementById('renderBtn'), 'render');
  buttonTracker.trackButton(document.getElementById('copyLinkBtn'), 'share');
  buttonTracker.trackButton(document.getElementById('savePngBtn'), 'savePng');
  buttonTracker.trackButton(document.getElementById('copyJsonBtn'), 'copyJson');
  buttonTracker.trackButton(document.getElementById('resetAllBtn'), 'reset');
  buttonTracker.trackButton(document.getElementById('z0Zero'), 'zero_z0');
  buttonTracker.trackButton(document.getElementById('z0SmallRand'), 'randomize_z0');

  attachGestures(glCanvas,  glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe, interactionState);
  attachGestures(outCanvas, glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe, interactionState);
  attachProbe(glCanvas,  probeTooltip, showProbe, interactionState);
  attachProbe(outCanvas, probeTooltip, showProbe, interactionState);
  attachHintTooltips(hintTooltip);

  // Set up layout observers
  new ResizeObserver(updateChazyLayout).observe(document.getElementById('main'));
  window.addEventListener('resize', updateChazyLayout);

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

  // Update layout and start Chazy
  updateChazyLayout();
  
  // Emit page_loaded event, then start
  chazy.route('page_loaded', {});
  
  // Expose global event emitter for Mind autonomy
  window.chazyEvent = (eventType, data) => chazy.route(eventType, data);
  
  // Expose chazy instance for debugging (timing tests, etc.)
  window.chazy = chazy;
  
  // Defer start if page loaded hidden
  if (document.hidden) {
    console.log('[Boot] Page loaded hidden, deferring start');
    const startOnVisible = () => {
      document.removeEventListener('visibilitychange', startOnVisible);
      console.log('[Boot] Page visible, starting Chazy');
      chazy.start();
    };
    document.addEventListener('visibilitychange', startOnVisible);
  } else {
    chazy.start();
  }

  requestAnimationFrame(() => resizeUiCanvasToMatch());
}

boot();
