import { state, AXIS_NAMES, QUALITY_PRESETS } from '../../state.js';
import { $ } from '../utils.js';
import type { UITreeStore } from '../semantic-tree/store.js';

// ─── Slider enhancement utility ──────────────────────────────────────────────

interface EnhancedSlider {
  updateTrackFill: () => void;
  rangeWrap: HTMLDivElement;
}

export function enhanceSlider(input: HTMLInputElement): EnhancedSlider | undefined {
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
  const formatNum = (n: number): string => decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));

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
  const updateTrackFill = (): void => {
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
  (input as any)._updateTrackFill = updateTrackFill;
  
  // Initial update
  updateTrackFill();

  return { updateTrackFill, rangeWrap };
}

export function enhanceAllSliders(): void {
  document.querySelectorAll('.sl-track-row input[type="range"]').forEach(input => {
    enhanceSlider(input as HTMLInputElement);
  });
}

// ─── Z0 sliders builder ──────────────────────────────────────────────────────

export function buildZ0Sliders(
  scheduleRender: (reason: string) => void,
  writeHash: () => void,
  updateStateBox: () => void,
  drawOverlayHUD: () => void,
  uiTree: UITreeStore | null = null
): void {
  const wrap = $("z0Sliders");
  if (!wrap) return;
  
  wrap.innerHTML = "";
  
  const sliderNodes: any[] = [];
  
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
    const updateTrackFill = (): void => {
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
      const idx = +input.dataset.idx!;
      state.z0[idx] = +input.value;
      const ni = $(`z0v_${idx}`) as HTMLInputElement | null;
      if (ni && document.activeElement !== ni) ni.value = state.z0[idx].toFixed(2);
      updateTrackFill();
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });
    numInput.addEventListener("change", () => {
      const idx = +input.dataset.idx!;
      const clamped = Math.max(+input.min, Math.min(+input.max, +numInput.value));
      state.z0[idx] = clamped;
      input.value = String(clamped);
      numInput.value = clamped.toFixed(2);
      updateTrackFill();
      scheduleRender("z0"); writeHash(); updateStateBox(); drawOverlayHUD();
    });

    // Store update function on input element so it can be called externally
    (input as any)._updateTrackFill = updateTrackFill;
    
    updateTrackFill();
    wrap.appendChild(row);
    
    // Register with semantic tree (Phase 2)
    if (uiTree) {
      const sliderId = `slider-z${i}`;
      const analogId = `${sliderId}:analog`;
      const valueId = `${sliderId}:value`;
      
      sliderNodes.push(
        {
          id: sliderId,
          kind: 'grid',
          role: 'slider',
          parentId: 'sec-z0-body',
          children: [analogId, valueId],
          rows: 1,
          cols: 2,
          cells: [
            { id: analogId, rowSpan: 1, colSpan: 1 },
            { id: valueId, rowSpan: 1, colSpan: 1 }
          ],
          focusMode: 'entry-node',
          wrapRows: false,
          wrapCols: false,
          entryPolicy: 'primary',
          meta: {
            label: AXIS_NAMES[i],
            min: -2.0,
            max: 2.0,
            step: 0.01,
            value: 0.0
          },
          element: row
        },
        {
          id: analogId,
          kind: 'analog-control',
          parentId: sliderId,
          children: [],
          focusMode: 'leaf',
          role: 'analog-control',
          primary: true,
          ariaLabel: `${AXIS_NAMES[i]} slider`,
          element: input
        },
        {
          id: valueId,
          kind: 'value-editor',
          parentId: sliderId,
          children: [],
          focusMode: 'leaf',
          role: 'value-editor',
          primary: false,
          ariaLabel: `${AXIS_NAMES[i]} value`,
          element: numInput
        }
      );
    }
  }
  
  // Add all slider nodes to tree and update parent grid
  if (uiTree && sliderNodes.length > 0) {
    console.log('[buildZ0Sliders] Adding', sliderNodes.length / 3, 'sliders to tree');
    uiTree.addNodes(sliderNodes);
    
    // NOW attach elements after nodes exist
    sliderNodes.forEach(node => {
      if (node.element) {
        uiTree.attachElement(node.id, node.element);
      }
    });
    
    // Update sec-z0-body grid to include z0 slider cells
    const secZ0Body = uiTree.getNode('sec-z0-body');
    if (secZ0Body) {
      // Build flat cells array
      const cells = [
        { id: 'z0Zero', rowSpan: 1, colSpan: 1 },
        { id: 'z0SmallRand', rowSpan: 1, colSpan: 1 },
        { id: 'slider-z0Range', rowSpan: 1, colSpan: 2 }
      ];
      
      // Add z0-z9 sliders (each spans 2 columns)
      for (let i = 0; i < 10; i++) {
        cells.push({ id: `slider-z${i}`, rowSpan: 1, colSpan: 2 });
      }
      
      console.log('[buildZ0Sliders] Rebuilding sec-z0-body with', cells.length, 'cells:', cells.map(c => c.id));
      
      uiTree.updateNode('sec-z0-body', {
        cells: cells,
        rows: 2 + 10,
        cols: 2
      });
      
      const updated = uiTree.getNode('sec-z0-body');
      console.log('[buildZ0Sliders] Updated sec-z0-body - cells:', updated.cells.length, 'rows:', updated.rows);
    } else {
      console.warn('[buildZ0Sliders] sec-z0-body node not found in tree!');
    }
  }
}

export function setZ0Range(r: number): void {
  const wrap = $("z0Sliders");
  if (!wrap) return;
  
  wrap.querySelectorAll('input[type="range"]').forEach(inp => {
    const input = inp as HTMLInputElement;
    input.min = (-r).toFixed(2);
    input.max = r.toFixed(2);
    
    // Determine decimal places from step
    const step = parseFloat(input.step) || 1;
    const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
    const formatNum = (n: number): string => decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    
    // Update marker labels
    const trackContainer = input.closest('.sl-track-container');
    if (trackContainer) {
      const markers = trackContainer.querySelector('.sl-markers');
      if (markers) {
        const minLabel = markers.querySelector('.min .sl-marker-label') as HTMLElement | null;
        const maxLabel = markers.querySelector('.max .sl-marker-label') as HTMLElement | null;
        if (minLabel) minLabel.textContent = formatNum(-r);
        if (maxLabel) maxLabel.textContent = formatNum(r);
      }
      
      // Update track fill
      const trackFill = trackContainer.querySelector('.sl-track-fill') as HTMLElement | null;
      if (trackFill) {
        const value = parseFloat(input.value);
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
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
    }
  });
  const ni = $("z0RangeVal") as HTMLInputElement | null;
  if (ni && document.activeElement !== ni) ni.value = r.toFixed(1);
}

export function zeroZ0(
  scheduleRender: (reason: string) => void,
  writeHash: () => void,
  updateStateBox: () => void,
  drawOverlayHUD: () => void
): void {
  state.z0.fill(0.0);
  const wrap = $("z0Sliders");
  if (!wrap) return;
  
  wrap.querySelectorAll('input[type="range"]').forEach(inp => {
    const input = inp as HTMLInputElement;
    input.value = "0.0";
    const valueInput = $(`z0v_${input.dataset.idx}`) as HTMLInputElement | null;
    if (valueInput) valueInput.value = "0.00";
    // Update track fill
    if ((input as any)._updateTrackFill) {
      (input as any)._updateTrackFill();
    }
  });
  scheduleRender("z0-zero"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function smallRandomZ0(
  scheduleRender: (reason: string) => void,
  writeHash: () => void,
  updateStateBox: () => void,
  drawOverlayHUD: () => void
): void {
  for (let i = 0; i < 10; i++) state.z0[i] = (Math.random() * 2 - 1) * 0.15;
  const wrap = $("z0Sliders");
  if (!wrap) return;
  
  wrap.querySelectorAll('input[type="range"]').forEach(inp => {
    const input = inp as HTMLInputElement;
    const idx = +input.dataset.idx!;
    input.value = String(state.z0[idx]);
    const valueInput = $(`z0v_${idx}`) as HTMLInputElement | null;
    if (valueInput) valueInput.value = state.z0[idx].toFixed(2);
    // Update track fill
    if ((input as any)._updateTrackFill) {
      (input as any)._updateTrackFill();
    }
  });
  scheduleRender("z0-rand"); writeHash(); updateStateBox(); drawOverlayHUD();
}

export function applyQualityPreset(
  name: keyof typeof QUALITY_PRESETS,
  scheduleRender: (reason: string) => void,
  writeHash: () => void,
  updateStateBox: () => void,
  drawOverlayHUD: () => void
): void {
  const q = QUALITY_PRESETS[name] || QUALITY_PRESETS.balanced;
  state.dtMacro = q.dtMacro;
  state.maxSteps = q.maxSteps;
  const dtMacroInput = $("dtMacro") as HTMLInputElement | null;
  const dtMacroVal = $("dtMacroVal") as HTMLInputElement | null;
  const maxStepsInput = $("maxSteps") as HTMLInputElement | null;
  const maxStepsVal = $("maxStepsVal") as HTMLInputElement | null;
  if (dtMacroInput) dtMacroInput.value = String(state.dtMacro);
  if (dtMacroVal) dtMacroVal.value = state.dtMacro.toFixed(4);
  if (maxStepsInput) maxStepsInput.value = String(state.maxSteps);
  if (maxStepsVal) maxStepsVal.value = String(state.maxSteps);
  scheduleRender("quality"); writeHash(); updateStateBox(); drawOverlayHUD();
}
