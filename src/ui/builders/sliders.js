import { state, AXIS_NAMES, QUALITY_PRESETS } from '../../state.js';
import { $ } from '../utils.js';

// ─── Slider enhancement utility ──────────────────────────────────────────────

export function enhanceSlider(input) {
  // Skip if already enhanced
  if (input.closest('.sl-range-wrap')) return;

  const trackRow = input.parentElement;
  if (!trackRow || !trackRow.classList.contains('sl-track-row')) return;

  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const hasZero = min < 0 && max > 0;
  
  // Determine decimal places from step
  const step = parseFloat(input.step) || 1;
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  
  // Format number with consistent decimals
  const formatNum = (n) => decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));

  // Create wrapper
  const rangeWrap = document.createElement("div");
  rangeWrap.className = "sl-range-wrap";

  // Track container
  const trackContainer = document.createElement("div");
  trackContainer.className = "sl-track-container";

  // Background track
  const trackBg = document.createElement("div");
  trackBg.className = "sl-track-bg";
  trackContainer.appendChild(trackBg);

  // Filled track
  const trackFill = document.createElement("div");
  trackFill.className = "sl-track-fill";
  trackContainer.appendChild(trackFill);

  // Markers container (inside track container for proper positioning)
  const markers = document.createElement("div");
  markers.className = "sl-markers";

  // Min marker
  const minMarker = document.createElement("div");
  minMarker.className = "sl-marker min";
  minMarker.style.left = "0%";
  minMarker.innerHTML = `<div class="sl-marker-line"></div><div class="sl-marker-label">${formatNum(min)}</div>`;
  markers.appendChild(minMarker);

  // Zero marker (only if range includes zero)
  if (hasZero) {
    const range = max - min;
    const zeroPos = (0 - min) / range * 100;
    const zeroMarker = document.createElement("div");
    zeroMarker.className = "sl-marker zero";
    zeroMarker.style.left = `${zeroPos}%`;
    zeroMarker.innerHTML = `<div class="sl-marker-line"></div><div class="sl-marker-label">${formatNum(0)}</div>`;
    markers.appendChild(zeroMarker);
  }

  // Max marker
  const maxMarker = document.createElement("div");
  maxMarker.className = "sl-marker max";
  maxMarker.style.right = "0";
  maxMarker.style.left = "auto";
  maxMarker.style.transform = "translateX(50%)";
  maxMarker.innerHTML = `<div class="sl-marker-line"></div><div class="sl-marker-label">${formatNum(max)}</div>`;
  markers.appendChild(maxMarker);

  trackContainer.appendChild(markers);

  // Move input into track container
  trackRow.insertBefore(rangeWrap, input);
  trackContainer.appendChild(input);
  rangeWrap.appendChild(trackContainer);

  // Update track fill position
  const updateTrackFill = () => {
    const value = parseFloat(input.value);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const range = max - min;
    
    if (min < 0 && max > 0) {
      // Range includes zero - fill from zero
      const zeroPos = (0 - min) / range * 100;
      const valuePos = (value - min) / range * 100;

      if (value >= 0) {
        trackFill.style.left = `${zeroPos}%`;
        trackFill.style.width = `${Math.max(0, valuePos - zeroPos)}%`;
      } else {
        trackFill.style.left = `${valuePos}%`;
        trackFill.style.width = `${Math.max(0, zeroPos - valuePos)}%`;
      }
    } else {
      // Range doesn't include zero - fill from min
      const valuePos = (value - min) / range * 100;
      trackFill.style.left = `0%`;
      trackFill.style.width = `${Math.max(0, valuePos)}%`;
    }
  };

  // Update on input change
  input.addEventListener("input", updateTrackFill);
  
  // Store update function on input element so it can be called externally
  input._updateTrackFill = updateTrackFill;
  
  // Initial update
  updateTrackFill();

  return { updateTrackFill, rangeWrap };
}

export function enhanceAllSliders() {
  document.querySelectorAll('.sl-track-row input[type="range"]').forEach(input => {
    enhanceSlider(input);
  });
}

// ─── Z0 sliders builder ──────────────────────────────────────────────────────

export function buildZ0Sliders(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const wrap = $("z0Sliders");
  wrap.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const row = document.createElement("div");
    row.className = "sl-row";

    const lab = document.createElement("label");
    lab.textContent = AXIS_NAMES[i];
    row.appendChild(lab);

    const trackRow = document.createElement("div");
    trackRow.className = "sl-track-row";

    // Create the enhanced slider wrapper
    const rangeWrap = document.createElement("div");
    rangeWrap.className = "sl-range-wrap";

    // Track container
    const trackContainer = document.createElement("div");
    trackContainer.className = "sl-track-container";

    // Background track
    const trackBg = document.createElement("div");
    trackBg.className = "sl-track-bg";
    trackContainer.appendChild(trackBg);

    // Filled track
    const trackFill = document.createElement("div");
    trackFill.className = "sl-track-fill";
    trackContainer.appendChild(trackFill);

    // Markers container
    const markers = document.createElement("div");
    markers.className = "sl-markers";

    // Min marker
    const minMarker = document.createElement("div");
    minMarker.className = "sl-marker min";
    minMarker.style.left = "0%";
    minMarker.innerHTML = '<div class="sl-marker-line"></div><div class="sl-marker-label">-2.00</div>';
    markers.appendChild(minMarker);

    // Zero marker
    const zeroMarker = document.createElement("div");
    zeroMarker.className = "sl-marker zero";
    zeroMarker.style.left = "50%";
    zeroMarker.innerHTML = '<div class="sl-marker-line"></div><div class="sl-marker-label">0.00</div>';
    markers.appendChild(zeroMarker);

    // Max marker
    const maxMarker = document.createElement("div");
    maxMarker.className = "sl-marker max";
    maxMarker.style.right = "0";
    maxMarker.style.left = "auto";
    maxMarker.style.transform = "translateX(50%)";
    maxMarker.innerHTML = '<div class="sl-marker-line"></div><div class="sl-marker-label">2.00</div>';
    markers.appendChild(maxMarker);

    trackContainer.appendChild(markers);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "-2.0"; input.max = "2.0"; input.step = "0.01"; input.value = "0.0";
    input.dataset.idx = String(i);
    trackContainer.appendChild(input);

    rangeWrap.appendChild(trackContainer);
    trackRow.appendChild(rangeWrap);

    const valWrap = document.createElement("div");
    valWrap.className = "sl-val-wrap";

    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.id = `z0v_${i}`;
    numInput.className = "slider-num";
    numInput.value = "0.00";
    numInput.step = "0.01";
    numInput.min = input.min;
    numInput.max = input.max;
    numInput.dataset.title = AXIS_NAMES[i];
    numInput.dataset.tip = `z${i} offset component.`;
    valWrap.appendChild(numInput);
    trackRow.appendChild(valWrap);
    row.appendChild(trackRow);

    // Update track fill position
    const updateTrackFill = () => {
      const value = parseFloat(input.value);
      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      const range = max - min;
      const zeroPos = (0 - min) / range * 100;
      const valuePos = (value - min) / range * 100;

      if (value >= 0) {
        trackFill.style.left = `${zeroPos}%`;
        trackFill.style.width = `${Math.max(0, valuePos - zeroPos)}%`;
      } else {
        trackFill.style.left = `${valuePos}%`;
        trackFill.style.width = `${Math.max(0, zeroPos - valuePos)}%`;
      }
    };

    input.addEventListener("input", () => {
      const idx = +input.dataset.idx;
      state.z0[idx] = +input.value;
      const ni = $(`z0v_${idx}`);
      if (document.activeElement !== ni) ni.value = state.z0[idx].toFixed(2);
      updateTrackFill();
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });
    numInput.addEventListener("change", () => {
      const idx = +input.dataset.idx;
      const clamped = Math.max(+input.min, Math.min(+input.max, +numInput.value));
      state.z0[idx] = clamped;
      input.value = clamped;
      numInput.value = clamped.toFixed(2);
      updateTrackFill();
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });

    // Store update function on input element so it can be called externally
    input._updateTrackFill = updateTrackFill;
    
    updateTrackFill();
    wrap.appendChild(row);
  }
}

export function setZ0Range(r) {
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    inp.min = (-r).toFixed(2);
    inp.max = r.toFixed(2);
    
    // Determine decimal places from step
    const step = parseFloat(inp.step) || 1;
    const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
    const formatNum = (n) => decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    
    // Update marker labels
    const trackContainer = inp.closest('.sl-track-container');
    if (trackContainer) {
      const markers = trackContainer.querySelector('.sl-markers');
      const minLabel = markers.querySelector('.min .sl-marker-label');
      const maxLabel = markers.querySelector('.max .sl-marker-label');
      if (minLabel) minLabel.textContent = formatNum(-r);
      if (maxLabel) maxLabel.textContent = formatNum(r);
      
      // Update track fill
      const rangeWrap = inp.closest('.sl-range-wrap');
      const trackFill = trackContainer.querySelector('.sl-track-fill');
      const value = parseFloat(inp.value);
      const min = parseFloat(inp.min);
      const max = parseFloat(inp.max);
      const range = max - min;
      const zeroPos = (0 - min) / range * 100;
      const valuePos = (value - min) / range * 100;

      if (value >= 0) {
        trackFill.style.left = `${zeroPos}%`;
        trackFill.style.width = `${valuePos - zeroPos}%`;
      } else {
        trackFill.style.left = `${valuePos}%`;
        trackFill.style.width = `${zeroPos - valuePos}%`;
      }
    }
  });
  const ni = $("z0RangeVal");
  if (document.activeElement !== ni) ni.value = r.toFixed(1);
}

export function zeroZ0(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  state.z0.fill(0.0);
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    inp.value = "0.0";
    $(`z0v_${inp.dataset.idx}`).value = "0.00";
    // Update track fill
    if (inp._updateTrackFill) {
      inp._updateTrackFill();
    }
  });
  scheduleRender("z0-zero"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function smallRandomZ0(scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  for (let i = 0; i < 10; i++) state.z0[i] = (Math.random() * 2 - 1) * 0.15;
  $("z0Sliders").querySelectorAll('input[type="range"]').forEach(inp => {
    const idx = +inp.dataset.idx;
    inp.value = String(state.z0[idx]);
    $(`z0v_${idx}`).value = state.z0[idx].toFixed(2);
    // Update track fill
    if (inp._updateTrackFill) {
      inp._updateTrackFill();
    }
  });
  scheduleRender("z0-rand"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function applyQualityPreset(name, scheduleRender, writeHash, updateStateBox, drawOverlayHUD) {
  const q = QUALITY_PRESETS[name] || QUALITY_PRESETS.balanced;
  state.dtMacro = q.dtMacro;
  state.maxSteps = q.maxSteps;
  $("dtMacro").value = String(state.dtMacro);
  $("dtMacroVal").value = state.dtMacro.toFixed(4);
  $("maxSteps").value = String(state.maxSteps);
  $("maxStepsVal").value = String(state.maxSteps);
  scheduleRender("quality"); writeHash(); updateStateBox(); drawOverlayHUD();
}
