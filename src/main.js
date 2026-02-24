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
import { SliderTracker } from './interaction/sliderTracking.js';
import { SelectTracker } from './interaction/selectTracking.js';
import { PatternDetector } from './interaction/patternDetector.js';
import { Chazy } from './Chazy/index.js';
import { computeTitleBoundingBox } from './ui/core/layout.js';
import { showWelcomeDialog } from './ui/dialogs/welcome.js';
import { applySavedSettings, saveCurrentSettings } from './ui/settings-storage.js';

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
  textPath: 'src/Chazy/lines/',
  displayMinMs: 2000,
  displayMaxMs: 10000,
  selector: {
    bufferSize: 32,
    multiLineMultiplier: 2.5
  }
});

// Initialize interaction trackers (after chazy)
let buttonTracker = null;
let sliderTracker = null;
let selectTracker = null;
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

// ─── Interrupt Prediction Setup ─────────────────────────────────────────────

/**
 * Setup interrupt prediction system
 * - Tracks mouse position and velocity
 * - Predicts button clicks based on trajectory
 * - Pre-warms interrupt system by slowing typing
 */
function setupInterruptPrediction() {
  if (!chazy?.view?.textStateMachine?.interruptPredictor) {
    console.warn('[InterruptPrediction] Predictor not available');
    return;
  }
  
  const predictor = chazy.view.textStateMachine.interruptPredictor;
  
  console.log('[InterruptPrediction] Setting up mouse tracking');
  
  // Update button bounds for all tracked buttons
  function updateButtonBounds() {
    const buttons = {
      'renderBtn': document.getElementById('renderBtn'),
      'shareBtn': document.getElementById('copyLinkBtn'),
      'resetBtn': document.getElementById('resetAllBtn'),
      'copyJson': document.getElementById('copyJsonBtn'),
      'saveJson': document.getElementById('savePngBtn')
    };
    
    let count = 0;
    for (const [id, element] of Object.entries(buttons)) {
      if (element) {
        predictor.updateButtonBounds(id, element);
        count++;
      }
    }
    
    console.log(`[InterruptPrediction] Updated ${count} button bounds`);
  }
  
  // Initial bounds update
  updateButtonBounds();
  
  // Update on resize
  window.addEventListener('resize', updateButtonBounds);
  
  // Track mouse (throttled to 50ms)
  let lastProcessTime = 0;
  const PROCESS_INTERVAL = 50;  // 20 samples per second
  
  document.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastProcessTime >= PROCESS_INTERVAL) {
      predictor.trackMousePosition(e.clientX, e.clientY);
      lastProcessTime = now;
    }
  });
  
  console.log('[InterruptPrediction] Setup complete');
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  console.log('[Boot] Starting boot sequence...');
  
  // FIRST: Wait for fonts to load
  console.log('[Boot] Waiting for fonts...');
  await document.fonts.ready;
  console.log('[Boot] ✓ Fonts loaded');
  
  // SECOND: Initialize Chazy (title + subtitle system) but DON'T start it yet
  console.log('[Boot] Initializing Chazy...');
  await chazy.init(document.body, getCurrentMode);
  console.log('[Boot] ✓ Chazy initialized (idle, not started)');
  
  // THIRD: Apply saved settings from localStorage
  console.log('[Boot] Loading saved settings...');
  applySavedSettings();
  console.log('[Boot] ✓ Settings loaded');
  
  // Setup settings change listeners to auto-save
  const settingsInputs = [
    'autoRender', 'previewWhileDrag', 'showHud', 
    'stgInvertScroll', 'stgZoomSpeed', 
    'stgInvertPanX', 'stgInvertPanY', 'stgPanSpeed'
  ];
  
  settingsInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', saveCurrentSettings);
    }
  });
  
  console.log('[Boot] Building UI...');
  // Initialize interaction trackers (but don't track buttons yet)
  buttonTracker = new ButtonTracker(chazy.router);
  sliderTracker = new SliderTracker(chazy.router);
  selectTracker = new SelectTracker(chazy.router);
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

  // Track render controls (Phase 2)
  console.log('[Boot] Setting up select tracking...');
  selectTracker.trackSelect(document.getElementById('mode'), 'render_mode');
  selectTracker.trackSelect(document.getElementById('resolution'), 'resolution');
  selectTracker.trackSelect(document.getElementById('tiltDim1'), 'tilt_dim1');
  selectTracker.trackSelect(document.getElementById('tiltDim2'), 'tilt_dim2');
  
  // Track Z0 sliders (Phase 4)
  console.log('[Boot] Setting up slider tracking...');
  const z0Container = document.getElementById('z0Sliders');
  const z0Sliders = z0Container.querySelectorAll('input[type="range"]');
  z0Sliders.forEach((slider, idx) => {
    sliderTracker.trackSlider(slider, `z${idx}`);
  });
  console.log(`[Boot] Tracked ${z0Sliders.length} z-coordinate sliders`);
  
  // Track orientation sliders (Phase 5)
  sliderTracker.trackSlider(document.getElementById('gamma'), 'tilt');
  sliderTracker.trackSlider(document.getElementById('tiltAmt1'), 'tilt_q1');
  sliderTracker.trackSlider(document.getElementById('tiltAmt2'), 'tilt_q2');
  
  // Track simulation sliders (Phase 5)
  sliderTracker.trackSlider(document.getElementById('horizon'), 'horizon');
  sliderTracker.trackSlider(document.getElementById('maxSteps'), 'max_steps');
  sliderTracker.trackSlider(document.getElementById('dtMacro'), 'dt_macro');
  sliderTracker.trackSlider(document.getElementById('rColl'), 'r_coll');
  sliderTracker.trackSlider(document.getElementById('rEsc'), 'r_esc');
  
  // Track orientation/import buttons (Phase 5 & 6)
  buttonTracker.trackButton(document.getElementById('rotReset'), 'reset_tilts');
  buttonTracker.trackButton(document.getElementById('pasteJsonBtn'), 'apply_json');
  buttonTracker.trackButton(document.getElementById('downloadJsonBtn'), 'download_json');

  // NEW: Setup interrupt prediction system
  setupInterruptPrediction();

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
  updateChazyLayout();
  
  // Expose global event emitter for Mind autonomy
  window.chazyEvent = (eventType, data) => chazy.route(eventType, data);
  
  // Expose chazy instance for debugging (timing tests, etc.)
  window.chazy = chazy;
  
  requestAnimationFrame(() => resizeUiCanvasToMatch());
  
  console.log('[Boot] ✓ UI built, everything ready');
  
  // Make page visible immediately (HTML/CSS rendering)
  document.body.classList.add('loaded');
  console.log('[Boot] ✓ Page visible (canvas showing background color, no sim render yet)');
  
  // Show welcome dialog first (async, non-blocking)
  console.log('[Boot] Showing welcome dialog (if not suppressed)...');
  showWelcomeDialog()
    .then(() => {
      console.log('[Boot] Welcome dialog dismissed, starting Chazy and simulation render...');
      
      // Update layout and start Chazy
      updateChazyLayout();
      
      // Emit page_loaded event
      chazy.route('page_loaded', {});
      
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
        console.log('[Boot] Starting Chazy now...');
        chazy.start();
      }
      
      // NOW do the WebGL simulation render (after dialog dismissed)
      console.log('[Boot] Starting WebGL simulation render...');
      doRender(state.res).catch(err => {
        setOverlay(false);
        setRenderingState(false);
        setStatus(String(err?.message || err));
        console.error('[Boot] Simulation render error:', err);
        drawHUD();
      }).then(() => {
        console.log('[Boot] ✓ Simulation render complete');
      });
      
      console.log('[Boot] ✓ Boot complete');
    })
    .catch(err => {
      console.error('[Boot] Welcome dialog error:', err);
      console.log('[Boot] Starting Chazy and render anyway due to error...');
      chazy.start();
      doRender(state.res);
    });
  
  console.log('[Boot] Boot function finished, page visible, waiting for welcome dialog...');
}

boot();
