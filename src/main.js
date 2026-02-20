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

function getCurrentMode() {
  const modeName = MODE_INFO[state.mode]?.name || 'Event classification';
  return MODE_MAP[modeName] ?? 'any';
}

const subtitleEl = document.getElementById('canvas-title-sub');
const flavour = new FlavourText('src/resources/flavour.json', {
  defaultInterval: 4000,
  crossfadeMs:      600,
  bufferSize:        32,
  randomMinMs:      8000,   // 8 seconds minimum
  randomMaxMs:     15000,   // 15 seconds maximum
});

await flavour.load();
attachFlavourText(flavour, getCurrentMode, subtitleEl, [], fitTitle);

// Add click-to-reroll
subtitleEl.style.cursor = 'pointer';
subtitleEl.addEventListener('click', () => {
  attachFlavourText(flavour, getCurrentMode, subtitleEl, [], fitTitle);
});

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
  setRenderingState(true);
  renderer.setAbort(false);
  if (res >= 8192 || res > maxGpu) {
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
  showProbeAtEvent(e, probeTooltip, glCanvas, outCanvas, renderer);
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
  attachProbe(glCanvas,  probeTooltip, showProbe);
  attachProbe(outCanvas, probeTooltip, showProbe);
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
