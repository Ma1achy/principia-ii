import { createThreeBodyRenderer } from './renderer.js';
import { state, encodeStateHash, decodeStateHash, applyPackedHash, MODE_INFO, canonicalState } from './state.js';
import { GlTooltip } from './ui/components/tooltip.js';
import {
  buildResolutions, buildPresets, buildAxisSelects, buildZ0Sliders,
  setZ0Range, applyCustomBasis, updateStateBox, getStateBoxValue,
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
import { initAllScrollbars } from './ui/components/scrollbar/init.js';
import { initAllPickers } from './ui/pickers/init.js';
import { initAllPanels } from './ui/panels/init.js';
import { createCanvasControls } from './ui/components/canvas-controls/init.js';
import { createControlSection } from './ui/sidebar/initControlSection.js';
import { initSidebarSections } from './ui/sidebar/initSections.js';
import { initSidebarScrollbar } from './ui/sidebar/initScrollbar.js';

// ─── Semantic UI Tree (Phase 1) ──────────────────────────────────────────────
import { uiTree } from './ui/semantic-tree/index.js';
import { buildPrincipiaUITree } from './ui/semantic-tree/principia-tree.js';
import { attachPrincipiaElements, syncCollapseState, initTabindexes } from './ui/semantic-tree/attach.js';

const glCanvas  = document.getElementById('glCanvas') as HTMLCanvasElement;
const outCanvas = document.getElementById('outCanvas') as HTMLCanvasElement;
const uiCanvas  = document.getElementById('uiCanvas') as HTMLCanvasElement;
const ui2d      = uiCanvas.getContext('2d');

// ─── Mode mapping and interaction state ──────────────────────────────────────

const MODE_MAP: Record<string, string> = {
  'Event classification': 'event',
  'Diffusion':            'diffusion',
  'Phase + Diffusion':    'phase+diffusion',
  'Shape sphere phase':   'phase',
  'Shape sphere RGB':     'phase',
};

interface InteractionState {
  isZooming: boolean;
  isDragging: boolean;
  isRendering: boolean;
  isLongRender: boolean;
  lastActionTime: number;
  idleThresholdMs: number;
  pageLoadTime: number;
  graceGracePeriodMs: number;
  probeActive: boolean;
  hasCollision: boolean;
  hasEscape: boolean;
  stabilityValue: number;
}

const interactionState: InteractionState = {
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

function getCurrentMode(): string {
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

function trackActivity(): void {
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
let buttonTracker: ButtonTracker | null = null;
let sliderTracker: SliderTracker | null = null;
let selectTracker: SelectTracker | null = null;
let patternDetector: PatternDetector | null = null;

// Update layout on resize/changes
let layoutUpdateRafId: number | null = null;
function updateChazyLayout(): void {
  if (layoutUpdateRafId != null) {
    cancelAnimationFrame(layoutUpdateRafId);
    layoutUpdateRafId = null;
  }
  layoutUpdateRafId = requestAnimationFrame(() => {
    const bbox = computeTitleBoundingBox();
    console.log('[Main] Layout calculated:', bbox);
    chazy.updateLayout(bbox);
    layoutUpdateRafId = null;
  });
}

// Watch for collision/ejection events and try to interrupt
let lastObservedMode: string | null = null;
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
let lastUserActivity: number = Date.now();
let wasIdle: boolean = false;
const IDLE_THRESHOLD: number = 30000; // 30 seconds

// Update last activity timestamp
function trackUserActivity(): void {
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

function resizeUiCanvasToMatch(): void {
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

function drawHUD(): void {
  drawOverlayHUD(renderer, glCanvas, outCanvas, uiCanvas, ui2d, resizeUiCanvasToMatch);
}

// ─── Canvas visibility ────────────────────────────────────────────────────────

function showGL_(): void { showGL(glCanvas, outCanvas, resizeUiCanvasToMatch); }
function showOut_(): void { showOut(glCanvas, outCanvas, resizeUiCanvasToMatch); }

// ─── Render scheduling ────────────────────────────────────────────────────────

let finalTimer: ReturnType<typeof setTimeout> | null = null;
let previewPending: boolean = false;

function scheduleRender(reason: string = ''): void {
  const autoRender = document.getElementById('autoRender') as HTMLInputElement;
  const previewWhileDrag = document.getElementById('previewWhileDrag') as HTMLInputElement;
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

async function doRender(res: number): Promise<void> {
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

function writeHash(): void {
  history.replaceState(null, '', '#' + encodeStateHash(state));
}

// ─── Probe ───────────────────────────────────────────────────────────────────

function showProbe(e: PointerEvent): void {
  showProbeAtEvent(e, probeTooltip, glCanvas, outCanvas, renderer, interactionState);
}

// ─── Interrupt Prediction Setup ─────────────────────────────────────────────

/**
 * Setup interrupt prediction system
 * - Tracks mouse position and velocity
 * - Predicts button clicks based on trajectory
 * - Pre-warms interrupt system by slowing typing
 */
function setupInterruptPrediction(): void {
  if (!(chazy as any)?.view?.textStateMachine?.interruptPredictor) {
    console.warn('[InterruptPrediction] Predictor not available');
    return;
  }
  
  const predictor = (chazy as any).view.textStateMachine.interruptPredictor;
  
  console.log('[InterruptPrediction] Setting up mouse tracking');
  
  // Update button bounds for all tracked buttons
  function updateButtonBounds(): void {
    const buttons: Record<string, HTMLElement | null> = {
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
  let lastProcessTime: number = 0;
  const PROCESS_INTERVAL: number = 50;  // 20 samples per second
  
  document.addEventListener('mousemove', (e: MouseEvent) => {
    const now = performance.now();
    if (now - lastProcessTime >= PROCESS_INTERVAL) {
      predictor.trackMousePosition(e.clientX, e.clientY);
      lastProcessTime = now;
    }
  });
  
  console.log('[InterruptPrediction] Setup complete');
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  console.log('[Boot] Starting boot sequence...');
  
  // FIRST: Wait for fonts to load
  console.log('[Boot] Waiting for fonts...');
  await document.fonts.ready;
  console.log('[Boot] ✓ Fonts loaded');
  
  // SECOND: Initialize Chazy (title + subtitle system) but DON'T start it yet
  console.log('[Boot] Initializing Chazy...');
  await chazy.init(document.body, getCurrentMode);
  console.log('[Boot] ✓ Chazy initialized (idle, not started)');
  
  // CRITICAL: Create UI elements BEFORE loading settings (settings need the DOM elements to exist)
  console.log('[Boot] Building UI structure...');
  
  // Create canvas controls (Info & Settings buttons)
  console.log('[Boot] Creating canvas controls...');
  createCanvasControls();
  console.log('[Boot] ✓ Canvas controls created');
  
  // Create sidebar control section (Render, URL, JSON, PNG, Reset buttons)
  console.log('[Boot] Creating control section...');
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    const controlSection = createControlSection();
    sidebar.insertBefore(controlSection, sidebar.firstChild);
  }
  console.log('[Boot] ✓ Control section created');
  
  // Create sidebar sections (Display, Slice Basis, etc.)
  console.log('[Boot] Creating sidebar sections...');
  initSidebarSections();
  console.log('[Boot] ✓ Sidebar sections created');
  
  // Create sidebar scrollbar
  console.log('[Boot] Creating sidebar scrollbar...');
  initSidebarScrollbar();
  console.log('[Boot] ✓ Sidebar scrollbar created');
  
  // Build semantic UI tree (Phase 1)
  console.log('[Boot] Building semantic UI tree...');
  uiTree.addNodes(buildPrincipiaUITree());
  console.log('[Boot] ✓ Semantic tree built:', uiTree.toJSON().nodes.length, 'nodes');
  (window as any).uiTree = uiTree; // Debug access
  
  // Create pickers and panels (must be before applySavedSettings)
  console.log('[Boot] Creating picker overlays...');
  initAllPickers();
  console.log('[Boot] ✓ Pickers created');
  
  console.log('[Boot] Creating panel overlays...');
  initAllPanels();
  console.log('[Boot] ✓ Panels created');
  
  // NOW apply saved settings (after DOM elements exist)
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
  
  // ─── Navigation System (Early Init) ────────────────────────────────────────
  console.log('[Boot] Initializing keyboard navigation...');
  const { KeyboardNavigationManager } = await import('./navigation/KeyboardNavigationManager.ts');
  const { BehaviorRegistry } = await import('./navigation/BehaviorRegistry.ts');
  const { DOMFocusEffects } = await import('./navigation/FocusEffects.ts');
  const { FocusVisualizer } = await import('./navigation/FocusVisualizer.ts');
  const behaviors = await import('./navigation/behaviors.ts');
  const { createCanvasActionDispatcher } = await import('./canvas-actions.ts');
  
  // Setup editor registry
  const { EditorRegistry } = await import('./ui/editors/EditorRegistry.ts');
  const { createJSONEditor } = await import('./ui/editors/JSONEditor.ts');
  const { createWGSLEditor } = await import('./ui/editors/WGSLEditor.ts');
  
  const editorRegistry = new EditorRegistry();
  editorRegistry.register('json', createJSONEditor);
  editorRegistry.register('wgsl', createWGSLEditor);
  console.log('[Boot] ✓ Editor registry initialized');
  
  // Editor instance map (shared across behaviors)
  const editors = new Map();
  
  // Setup behavior registry
  const behaviorRegistry = new BehaviorRegistry();
  
  // Import behavior composer for capability-based behaviors
  const { BehaviorComposer } = await import('./navigation/BehaviorComposer.ts');
  const behaviorComposer = new BehaviorComposer({ uiTree, behaviorDeps: {} });
  const composerFactory = behaviorComposer.createFactory();
  
  // Import BEHAVIOR_RESULT for custom handlers
  const { BEHAVIOR_RESULT } = await import('./navigation/behaviors.ts');
  
  // Simple behaviors use capability-based composer
  behaviorRegistry.register('section-header', composerFactory);
  behaviorRegistry.register('button', composerFactory);
  behaviorRegistry.register('native-select', composerFactory);
  behaviorRegistry.register('param-trigger', composerFactory);
  
  // Interactive behaviors with complex logic - keep original implementations
  // value-editor works perfectly with capabilities, analog-control has different toggle semantics
  behaviorRegistry.register('value-editor', (n: any, el: HTMLElement | null, deps: any) => {
    const enhancedNode = {
      ...n,
      meta: {
        ...n.meta,
        capabilities: {
          interactive: true,
          escapePolicy: 'auto',
          arrowPolicy: 'custom',
          onArrowKey: (node: any, element: HTMLElement | null, direction: string, isInteracting: boolean, allDeps: any) => {
            if (isInteracting) {
              console.log('[valueEditorBehavior] Arrow key ignored while editing:', direction);
              return BEHAVIOR_RESULT.IGNORED;
            }
            
            const parentNode = allDeps.uiTree?.getNode(node.parentId);
            const hasParamTrigger = parentNode?.children?.some((childId: string) => {
              const child = allDeps.uiTree?.getNode(childId);
              return child?.kind === 'param-trigger';
            });
            
            if (hasParamTrigger) {
              if (direction === 'ArrowDown' || direction === 'ArrowRight') {
                return BEHAVIOR_RESULT.ESCAPE_SCOPE;
              }
            } else {
              if (direction === 'ArrowUp' || direction === 'ArrowDown' || direction === 'ArrowRight') {
                return BEHAVIOR_RESULT.ESCAPE_SCOPE;
              }
            }
            
            return BEHAVIOR_RESULT.IGNORED;
          }
        }
      }
    };
    return composerFactory(enhancedNode, el, deps);
  });
  
  // Analog-control has different toggle semantics - keep original implementation
  behaviorRegistry.register('analog-control', behaviors.analogControlBehavior);
  
  // Keep other specialized behaviors that need custom dependencies
  behaviorRegistry.register('checkbox', behaviors.checkboxBehavior);
  behaviorRegistry.register('canvas', behaviors.canvasBehavior);
  behaviorRegistry.register('textarea', behaviors.textareaBehavior);
  behaviorRegistry.register('code-editor', behaviors.codeEditorBehavior);
  
  // Setup focus effects and visualizer
  const effects = new DOMFocusEffects();
  const visualizer = new FocusVisualizer(document.body);
  
  // Setup canvas action dispatcher (needed before navManager)
  const dispatchCanvasAction = createCanvasActionDispatcher({
    glCanvas,
    outCanvas,
    scheduleRender,
    writeHash,
    updateStateBox,
    drawHUD
  });
  
  // Setup behavior dependencies
  const behaviorDeps = {
    uiTree,
    dispatchCanvasAction,
    editorRegistry,
    editors,
    PAN_STEP: 20,
    ZOOM_STEP: 0.1
  };
  
  const navManager = new KeyboardNavigationManager({ effects, visualizer, uiTree, behaviorRegistry, behaviorDeps });
  console.log('[Boot] ✓ Keyboard navigation initialized');
  
  buildResolutions(renderer);
  await buildPresets(scheduleRender, writeHash, updateStateBox, drawHUD, uiTree, navManager);
  buildAxisSelects();
  buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawHUD, uiTree);
  setZ0Range(+(document.getElementById('z0Range') as HTMLInputElement).value);

  if (location.hash && location.hash.length > 2) {
    applyPackedHash(decodeStateHash(location.hash.slice(1)), applyCustomBasis);
  }

  const resOptions = [...(document.getElementById('resolution') as HTMLSelectElement).options].map(o => +o.value);
  if (!resOptions.includes(state.res)) state.res = resOptions[0];

  syncUIFromState(renderer, scheduleRender, writeHash, drawHUD, uiTree);

  bindUI(renderer, glCanvas, outCanvas, uiCanvas, ui2d, probeTooltip, doRender, scheduleRender, writeHash, resizeUiCanvasToMatch, uiTree);
  
  // ─── Element Binding (Phase 2) ─────────────────────────────────────────────
  console.log('[Boot] Binding elements to semantic tree...');
  attachPrincipiaElements(uiTree);
  await syncCollapseState(uiTree);
  initTabindexes(uiTree);
  console.log('[Boot] ✓ Elements bound to semantic tree');
  
  console.log('[Boot] Initializing code editors...');
  const editorContainer = document.getElementById('stateJsonEditor');
  console.log('[Boot] stateJsonEditor container:', editorContainer);
  
  if (editorContainer) {
    console.log('[Boot] Creating JSON editor...');
    const jsonEditor = editorRegistry.create('json', {
      theme: 'light',  // Use 'light' for Atom One Light
      lineNumbers: true,
      linting: true,
      autoFormat: true,
      autocompletion: true
    });
    
    console.log('[Boot] Editor created:', jsonEditor);
    
    if (jsonEditor) {
      console.log('[Boot] Mounting editor...');
      jsonEditor.mount(editorContainer);
      console.log('[Boot] Editor mounted');
      
      // Set initial state value
      const initialValue = JSON.stringify(canonicalState(state), null, 2);
      console.log('[Boot] Setting initial value, length:', initialValue.length);
      jsonEditor.setValue(initialValue);
      console.log('[Boot] Value set');
      
      // Debug: Check if syntax highlighting was applied
      setTimeout(() => {
        const content = editorContainer.querySelector('.cm-content');
        if (content) {
          const lines = content.querySelectorAll('.cm-line');
          console.log('[Boot] Total lines in editor:', lines.length);
          
          if (lines.length > 0) {
            const firstLine = lines[0];
            console.log('[Boot] First line HTML:', firstLine.innerHTML);
            
            const spans = firstLine.querySelectorAll('span[class]');
            console.log('[Boot] Spans with classes in first line:', spans.length);
            spans.forEach((span, i) => {
              const style = window.getComputedStyle(span);
              console.log(`[Boot]   Span ${i}: class="${span.className}" text="${span.textContent}" color="${style.color}"`);
            });
          }
        }
      }, 500);
      
      // Register editor instance
      const { initStateBoxEditor } = await import('./ui/editors/stateBoxEditor.ts');
      initStateBoxEditor(jsonEditor);
      editors.set('stateBox', jsonEditor);
      
      // Initialize tooltip z-index fixer for CodeMirror tooltips
      const { initTooltipZIndexFixer } = await import('./ui/editors/tooltip-z-index-fixer.ts');
      initTooltipZIndexFixer();
      
      console.log('[Boot] ✓ State JSON editor initialized');
    } else {
      console.error('[Boot] Failed to create JSON editor');
    }
  } else {
    console.error('[Boot] stateJsonEditor container not found!');
  }
  
  // Register param-trigger with capability-based behavior (just needs click)
  behaviorRegistry.register('param-trigger', composerFactory);
  
  // Register picker-close-button and menu-item behaviors with navManager dependency
  // These still need custom activation logic to call navManager.closeOverlay
  const triggerDeps = { uiTree, navManager };
  behaviorRegistry.register('picker-close-button', (n: any, el: HTMLElement, deps: any) =>
    behaviors.pickerCloseButtonBehavior(n, el, { ...deps, navManager }));
  
  behaviorRegistry.register('menu-item', (n: any, el: HTMLElement, deps: any) =>
    behaviors.menuItemBehavior(n, el, { ...deps, navManager, uiTree }));
  
  // Initialize navigation manager (will setup UITree event listeners)
  navManager.init('root');
  
  // Debug access
  (window as any).navManager = navManager;
  console.log('[Boot] ✓ Keyboard navigation ready');
  
  // NOW track buttons (after UI is built)
  console.log('[Boot] Setting up button tracking...');
  buttonTracker!.trackButton(document.getElementById('renderBtn'), 'render');
  buttonTracker!.trackButton(document.getElementById('copyLinkBtn'), 'share');
  buttonTracker!.trackButton(document.getElementById('savePngBtn'), 'savePng');
  buttonTracker!.trackButton(document.getElementById('copyJsonBtn'), 'copyJson');
  buttonTracker!.trackButton(document.getElementById('resetAllBtn'), 'reset');
  buttonTracker!.trackButton(document.getElementById('z0Zero'), 'zero_z0');
  buttonTracker!.trackButton(document.getElementById('z0SmallRand'), 'randomize_z0');

  // Track render controls (Phase 2)
  console.log('[Boot] Setting up select tracking...');
  selectTracker!.trackSelect(document.getElementById('mode') as HTMLSelectElement, 'render_mode');
  selectTracker!.trackSelect(document.getElementById('resolution') as HTMLSelectElement, 'resolution');
  selectTracker!.trackSelect(document.getElementById('tiltDim1') as HTMLSelectElement, 'tilt_dim1');
  selectTracker!.trackSelect(document.getElementById('tiltDim2') as HTMLSelectElement, 'tilt_dim2');
  
  // Track Z0 sliders (Phase 4)
  console.log('[Boot] Setting up slider tracking...');
  const z0Container = document.getElementById('z0Sliders')!;
  const z0Sliders = z0Container.querySelectorAll('input[type="range"]');
  z0Sliders.forEach((slider, idx) => {
    sliderTracker!.trackSlider(slider as HTMLInputElement, `z${idx}`);
  });
  console.log(`[Boot] Tracked ${z0Sliders.length} z-coordinate sliders`);
  
  // Track orientation sliders (Phase 5)
  sliderTracker!.trackSlider(document.getElementById('gamma') as HTMLInputElement, 'tilt');
  sliderTracker!.trackSlider(document.getElementById('tiltAmt1') as HTMLInputElement, 'tilt_q1');
  sliderTracker!.trackSlider(document.getElementById('tiltAmt2') as HTMLInputElement, 'tilt_q2');
  
  // Track simulation sliders (Phase 5)
  sliderTracker!.trackSlider(document.getElementById('horizon') as HTMLInputElement, 'horizon');
  sliderTracker!.trackSlider(document.getElementById('maxSteps') as HTMLInputElement, 'max_steps');
  sliderTracker!.trackSlider(document.getElementById('dtMacro') as HTMLInputElement, 'dt_macro');
  sliderTracker!.trackSlider(document.getElementById('rColl') as HTMLInputElement, 'r_coll');
  sliderTracker!.trackSlider(document.getElementById('rEsc') as HTMLInputElement, 'r_esc');
  
  // Track orientation/import buttons (Phase 5 & 6)
  buttonTracker!.trackButton(document.getElementById('rotReset'), 'reset_tilts');
  buttonTracker!.trackButton(document.getElementById('pasteJsonBtn'), 'apply_json');
  buttonTracker!.trackButton(document.getElementById('downloadJsonBtn'), 'download_json');

  // NEW: Setup interrupt prediction system
  setupInterruptPrediction();

  attachGestures(glCanvas,  glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe, interactionState);
  attachGestures(outCanvas, glCanvas, outCanvas, probeTooltip, scheduleRender, writeHash, updateStateBox, drawHUD, showProbe, interactionState);
  attachProbe(glCanvas,  probeTooltip, showProbe, interactionState);
  attachProbe(outCanvas, probeTooltip, showProbe, interactionState);
  attachHintTooltips(hintTooltip);
  
  // Initialize custom scrollbars
  initAllScrollbars();

  // Set up layout observers
  new ResizeObserver(updateChazyLayout).observe(document.getElementById('main')!);
  window.addEventListener('resize', updateChazyLayout);

  writeHash();
  updateStateBox();
  updateChazyLayout();
  
  // Expose global event emitter for Mind autonomy
  (window as any).chazyEvent = (eventType: string, data: any) => chazy.route(eventType, data);
  
  // Expose chazy instance for debugging (timing tests, etc.)
  (window as any).chazy = chazy;
  
  requestAnimationFrame(() => resizeUiCanvasToMatch());
  
  console.log('[Boot] ✓ UI built, everything ready');
  
  // Prevent buttons from retaining focus after click/keyboard interaction
  // This ensures box-shadows are not affected by browser focus styling
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'BUTTON' || target.classList.contains('btn'))) {
      // Only blur if not in interaction mode (inputs should keep focus when editing)
      const isInputElement = target.tagName === 'INPUT' || 
                            target.tagName === 'TEXTAREA' || 
                            target.tagName === 'SELECT' ||
                            target.classList.contains('cm-content');
      
      if (!isInputElement) {
        // Use setTimeout to ensure click event completes first
        setTimeout(() => {
          (target as HTMLButtonElement).blur();
        }, 0);
      }
    }
  }, true); // Use capture phase to catch all focus events
  
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
