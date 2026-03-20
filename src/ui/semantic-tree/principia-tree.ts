/**
 * Principia UI Tree Definition
 * Describes the complete semantic structure of Principia's interface
 * 
 * GRID-BASED ARCHITECTURE:
 * - All UI elements are organized into grids (even single buttons are 1x1 grids)
 * - Navigation uses coordinates (row, col) instead of tree traversal
 * - Grids can span multiple rows/columns for complex layouts
 */
import {
  section, slider, button, checkbox, picker, panel,
  grid, cell
} from './builders.js';
import type { UINode } from './store.js';

/**
 * Build complete Principia UI tree
 * @returns Array of all tree nodes
 */
export function buildPrincipiaUITree(): UINode[] {
  const nodes: UINode[] = [];

  // ─── WebGL Canvas ──────────────────────────────────────────────────────────
  // Canvas is a 1×1 grid (acts like a leaf) with custom escape routes
  // Enter activates interaction mode (cyan), Escape exits back to nav mode (orange)
  const canvasNode: UINode = {
    id: "canvas",
    kind: "grid",
    parentId: null,
    children: [],
    rows: 1,
    cols: 1,
    cells: [],  // Empty grid - just a focusable container
    wrapRows: false,
    wrapCols: false,
    escapeDown: 'canvas-controls',  // Down/Left both go to settings
    focusMode: "leaf",  // Acts like a leaf (don't try to enter it)
    role: "canvas",
    ariaRole: "application",
    ariaLabel: "Visualization canvas - Press Enter to interact, arrow keys to pan, +/- to zoom, Escape to exit",
    meta: {
      canInteract: true,
      actualKind: "canvas" // Preserve semantic meaning
    }
  };
  nodes.push(canvasNode);

  // ─── Canvas Controls (Floating Buttons) ───────────────────────────────────
  // 2×1 vertical grid: [Info] [Settings]
  // Up/down cycles between them
  // Entry defaults to Settings but remembers last position
  const infoBtnNode = button("infoBtn", { 
    ariaLabel: "Controls and information" 
  });
  const settingsBtnNode = button("settingsBtn", { 
    ariaLabel: "Navigation and rendering settings" 
  });
  
  const canvasControlsGrid = grid("canvas-controls", {
    cells: [
      [cell("infoBtn")],
      [cell("settingsBtn")]
    ],
    wrapCols: false,
    wrapRows: false,  // Don't wrap vertically
    entryPolicy: 'remembered',  // Remember which button you were on
    entryCell: 1,  // Default to Settings button (row 1)
    escapeRight: 'canvas',  // Right goes to canvas
    escapeUp: 'canvas'  // Up from INFO button goes to canvas
  });
  
  nodes.push(canvasControlsGrid, infoBtnNode, settingsBtnNode);

  // ─── Control Section (Render + Icon Buttons) ──────────────────────────────
  // Section body: 2-row grid
  // Row 0: [RENDER] (single button, spans 4 cols)
  // Row 1: [URL] [JSON] [PNG] [RESET] (4 buttons)
  const renderBtn = button("renderBtn", { 
    primary: true, 
    ariaLabel: "Render"
  });
  
  const copyLinkBtn = button("copyLinkBtn", { 
    ariaLabel: "Copy link"
  });
  const copyJsonBtn = button("copyJsonBtn", { 
    ariaLabel: "Copy JSON"
  });
  const savePngBtn = button("savePngBtn", { 
    ariaLabel: "Save PNG"
  });
  const resetAllBtn = button("resetAllBtn", { 
    ariaLabel: "Reset all"
  });
  
  const controlGrid = grid("ctrl-section", {
    cells: [
      [cell("renderBtn", 1, 4)],  // Render button spans all 4 columns
      [cell("copyLinkBtn"), cell("copyJsonBtn"), cell("savePngBtn"), cell("resetAllBtn")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this grid
    escapeLeft: 'canvas',  // Left from any button goes to canvas
    escapeDown: 'sec-mode:header'  // Down from button row goes to Display header
  });
  
  nodes.push(controlGrid, renderBtn, copyLinkBtn, copyJsonBtn, savePngBtn, resetAllBtn);

  // ─── Display Section ───────────────────────────────────────────────────────
  const modePicker = picker("mode-picker", {
    label: "Render mode",
    options: [
      { id: "event", label: "Event classification", value: 0 },
      { id: "phase-diffusion", label: "Phase + Diffusion", value: 1 },
      { id: "phase", label: "Shape sphere phase", value: 2 },
      { id: "diffusion", label: "Diffusion", value: 3 },
      { id: "rgb", label: "Shape sphere RGB", value: 4 }
    ],
    selectedId: "event"
  });

  const resPicker = picker("resolution-picker", {
    label: "Resolution",
    options: [
      { id: "256", label: "256 × 256", value: 256 },
      { id: "512", label: "512 × 512", value: 512 },
      { id: "1024", label: "1024 × 1024", value: 1024 },
      { id: "2048", label: "2048 × 2048", value: 2048 }
    ],
    selectedId: "1024"
  });
  
  // Section body: 1×2 grid [RENDER MODE] [RESOLUTION]
  const displayBodyGrid = grid("sec-mode-body", {
    cells: [
      cell("mode-picker:trigger", 1, 1),
      cell("resolution-picker:trigger", 1, 1)
    ],
    rows: 1,
    cols: 2,
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-mode-body',  // Up exits this scope
    escapeDown: 'sec-mode-body'  // Down exits this scope
  });

  const { header: displayHeader, section: displaySection } = section("sec-mode", "Display", [
    displayBodyGrid
  ]);
  
  nodes.push(
    displayHeader,
    displaySection,
    displayBodyGrid,
    modePicker.trigger,
    ...modePicker.overlayNodes,
    resPicker.trigger,
    ...resPicker.overlayNodes
  );

  // ─── Slice Basis Section ───────────────────────────────────────────────────
  // Section body will contain preset buttons + custom controls in a vertical grid
  // Preset buttons are added dynamically by buildPresets
  // Initial structure: just placeholders for custom controls (hidden)
  
  // Custom basis pickers (hidden until "custom" preset selected)
  const customDimHPicker = picker("customDimH-picker", {
    triggerKind: "param-trigger",
    label: "H-axis",
    options: [], // Populated by buildAxisSelects
    selectedId: "z0",
    hidden: true
  });

  const customDimVPicker = picker("customDimV-picker", {
    triggerKind: "param-trigger",
    label: "V-axis",
    options: [], // Populated by buildAxisSelects
    selectedId: "z1",
    hidden: true
  });

  const customMagSlider = slider("slider-customMag", {
    label: "±mag",
    min: 0.1,
    max: 4.0,
    step: 0.05,
    value: 1.0,
    hasParamTrigger: false,
    hidden: true,
    meta: { tip: "Half-range magnitude for custom basis vectors." }
  });

  // Section body: will be populated dynamically by buildPresets
  // Structure will be: [preset buttons in 2D grid] + [custom controls]
  const sliceBasisBodyGrid = grid("sec-presets-body", {
    cells: [
      // Preset buttons added dynamically by buildPresets
      [cell("customDimH-picker:trigger")],
      [cell("customDimV-picker:trigger")],
      [cell("slider-customMag")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-presets-body',  // Up exits this scope
    escapeDown: 'sec-presets-body',  // Down exits this scope
    meta: { dynamic: true }  // Will be updated by buildPresets
  });

  const { header: sliceBasisHeader, section: sliceBasisSection } = section("sec-presets", "Slice Basis", [
    sliceBasisBodyGrid
  ]);

  nodes.push(
    sliceBasisHeader,
    sliceBasisSection,
    sliceBasisBodyGrid,
    customDimHPicker.trigger,
    ...customDimHPicker.overlayNodes,
    customDimVPicker.trigger,
    ...customDimVPicker.overlayNodes,
    ...customMagSlider
  );

  // ─── Slice Offset Section ──────────────────────────────────────────────────
  const z0ZeroBtn = button("z0Zero", { 
    ariaLabel: "Zero all z0" 
  });
  const z0SmallRandBtn = button("z0SmallRand", { 
    ariaLabel: "Small random z0" 
  });
  
  const z0RangeSlider = slider("slider-z0Range", {
    label: "±range",
    min: 0.25,
    max: 8.0,
    step: 0.25,
    value: 2.0,
    hasParamTrigger: false,
    meta: { tip: "Range of z0 offset sliders." }
  });

  // Grid structure:
  // Row 0: [ZERO] [SMALL RAND] (2 buttons)
  // Row 1: [±range slider]
  // Rows 2-11: [z0-z9 sliders] (added dynamically by buildZ0Sliders)
  const z0Grid = grid("sec-z0-body", {
    cells: [
      [cell("z0Zero"), cell("z0SmallRand")],
      [cell("slider-z0Range", 1, 2)]  // Range slider spans both columns
      // z0-z9 sliders added dynamically
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-z0-body',  // Up exits this scope
    escapeDown: 'sec-z0-body',  // Down exits this scope
    meta: { dynamic: true }  // Sliders added dynamically
  });

  const { header: sliceOffsetHeader, section: sliceOffsetSection } = section("sec-z0", "Slice Offset z₀ (10D)", [
    z0Grid
  ]);

  nodes.push(
    sliceOffsetHeader,
    sliceOffsetSection,
    z0Grid,
    z0ZeroBtn,
    z0SmallRandBtn,
    ...z0RangeSlider
  );

  // ─── Orientation Section ───────────────────────────────────────────────────
  const gammaSlider = slider("slider-gamma", {
    label: "γ — rotate within plane",
    min: 0,
    max: 360,
    step: 0.25,
    value: 0,
    hasParamTrigger: false,
    meta: { tip: "Rotate slice plane by gamma degrees." }
  });

  const tiltDim1Picker = picker("tiltDim1-picker", {
    triggerKind: "param-trigger",
    label: "q₁ tilt into",
    options: [
      { id: "z8", label: "z₈", value: 8 },
      { id: "z9", label: "z₉", value: 9 }
    ],
    selectedId: "z8"
  });

  const tiltAmt1Slider = slider("slider-tiltAmt1", {
    label: "Tilt amount",
    min: -2.0,
    max: 2.0,
    step: 0.01,
    value: 0,
    hasParamTrigger: false,  // We'll manually add the picker trigger as a child
    fastActions: { "Shift+Enter": "jump-and-begin-value-edit" }
  });

  const tiltDim2Picker = picker("tiltDim2-picker", {
    triggerKind: "param-trigger",
    label: "q₂ tilt into",
    options: [
      { id: "z8", label: "z₈", value: 8 },
      { id: "z9", label: "z₉", value: 9 }
    ],
    selectedId: "z9"
  });

  const tiltAmt2Slider = slider("slider-tiltAmt2", {
    label: "Tilt amount",
    min: -2.0,
    max: 2.0,
    step: 0.01,
    value: 0,
    hasParamTrigger: false  // We'll manually add the picker trigger as a child
  });

  // Restructure: Make picker triggers children of their respective sliders
  // This matches the spec's requirement that the param-trigger is inside the slider scope
  const [tiltAmt1SliderNode, , ] = tiltAmt1Slider;  // [scope, analog, value]
  const [tiltAmt2SliderNode, , ] = tiltAmt2Slider;
  
  // Update picker trigger parentId and insert as first child
  tiltDim1Picker.trigger.parentId = tiltAmt1SliderNode.id;
  tiltAmt1SliderNode.children.unshift(tiltDim1Picker.trigger.id);
  // Update grid structure: 2 rows × 2 cols
  // Row 0: Param trigger (colSpan=2)
  // Row 1: Analog | Value
  tiltAmt1SliderNode.rows = 2;
  tiltAmt1SliderNode.cols = 2;
  tiltAmt1SliderNode.cells = [
    { id: tiltAmt1SliderNode.children[0], rowSpan: 1, colSpan: 2 },  // Param trigger
    { id: tiltAmt1SliderNode.children[1], rowSpan: 1, colSpan: 1 },  // Analog
    { id: tiltAmt1SliderNode.children[2], rowSpan: 1, colSpan: 1 }   // Value
  ];
  
  tiltDim2Picker.trigger.parentId = tiltAmt2SliderNode.id;
  tiltAmt2SliderNode.children.unshift(tiltDim2Picker.trigger.id);
  // Update grid structure: 2 rows × 2 cols
  tiltAmt2SliderNode.rows = 2;
  tiltAmt2SliderNode.cols = 2;
  tiltAmt2SliderNode.cells = [
    { id: tiltAmt2SliderNode.children[0], rowSpan: 1, colSpan: 2 },  // Param trigger
    { id: tiltAmt2SliderNode.children[1], rowSpan: 1, colSpan: 1 },  // Analog
    { id: tiltAmt2SliderNode.children[2], rowSpan: 1, colSpan: 1 }   // Value
  ];

  const doOrthoCheck = checkbox("doOrtho", { 
    label: "Orthonormalise q₁, q₂" 
  });
  const rotResetBtn = button("rotReset", { 
    ariaLabel: "Reset tilts + γ" 
  });

  // Vertical grid: 5×1 (gamma slider + 2 tilt sliders + checkbox + button)
  const orientationBodyGrid = grid("sec-orient-body", {
    cells: [
      [cell("slider-gamma")],
      [cell("slider-tiltAmt1")],
      [cell("slider-tiltAmt2")],
      [cell("doOrtho")],
      [cell("rotReset")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-orient-body',  // Up exits this scope
    escapeDown: 'sec-orient-body'  // Down exits this scope
  });

  const { header: orientationHeader, section: orientationSection } = section("sec-orient", "Orientation (γ + tilts)", [
    orientationBodyGrid
  ]);

  nodes.push(
    orientationHeader,
    orientationSection,
    orientationBodyGrid,
    ...gammaSlider,
    tiltDim1Picker.trigger,
    ...tiltDim1Picker.overlayNodes,
    ...tiltAmt1Slider,
    tiltDim2Picker.trigger,
    ...tiltDim2Picker.overlayNodes,
    ...tiltAmt2Slider,
    doOrthoCheck,
    rotResetBtn
  );

  // ─── Simulation Section (Collapsed by Default) ────────────────────────────
  const simSliders = [
    slider("slider-horizon", { 
      label: "Horizon", 
      min: 10, 
      max: 200, 
      step: 10, 
      value: 50, 
      hasParamTrigger: false 
    }),
    slider("slider-maxSteps", { 
      label: "Max steps", 
      min: 1000, 
      max: 40000, 
      step: 1000, 
      value: 20000, 
      hasParamTrigger: false 
    }),
    slider("slider-dtMacro", { 
      label: "dt macro", 
      min: 5e-4, 
      max: 0.01, 
      step: 5e-4, 
      value: 0.002, 
      hasParamTrigger: false 
    }),
    slider("slider-rColl", { 
      label: "r_coll", 
      min: 0.005, 
      max: 0.06, 
      step: 0.001, 
      value: 0.02, 
      hasParamTrigger: false 
    }),
    slider("slider-rEsc", { 
      label: "r_esc", 
      min: 1.0, 
      max: 12.0, 
      step: 0.25, 
      value: 5.0, 
      hasParamTrigger: false 
    })
  ];

  // Vertical grid: 5×1 (one slider per row)
  const simBodyGrid = grid("sec-sim-body", {
    cells: [
      [cell("slider-horizon")],
      [cell("slider-maxSteps")],
      [cell("slider-dtMacro")],
      [cell("slider-rColl")],
      [cell("slider-rEsc")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-sim-body',  // Up exits this scope
    escapeDown: 'sec-sim-body'  // Down exits this scope
  });

  const { header: simHeader, section: simSection } = section("sec-sim", "Simulation", [
    simBodyGrid
  ], { collapsed: true });

  nodes.push(simHeader, simSection, simBodyGrid, ...simSliders.flatMap(s => s));

  // ─── Export / Import Section (Collapsed by Default) ───────────────────────
  const pasteJsonBtn = button("pasteJsonBtn", { 
    ariaLabel: "Apply JSON" 
  });
  const downloadJsonBtn = button("downloadJsonBtn", { 
    ariaLabel: "Download JSON" 
  });
  
  // StateBox code editor node
  const stateBoxNode: UINode = {
    id: 'stateBox',
    kind: 'code-editor',
    parentId: 'sec-state-body',
    role: 'code-editor',
    ariaRole: 'textbox',
    ariaLabel: 'State JSON code editor',
    meta: {
      multiline: true,
      escapeOnly: true,  // Only Escape exits, not arrows
      editorLanguage: 'json'
    }
  };
  
  // Section body: buttons in row 0, textarea in row 1
  const exportBodyGrid = grid("sec-state-body", {
    cells: [
      [cell("pasteJsonBtn"), cell("downloadJsonBtn")],
      [cell("stateBox", 1, 2)]  // Textarea spans both columns
    ],
    rows: 2,
    cols: 2,
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember last position in this section
    escapeUp: 'sec-state-body',  // Up exits this scope
    escapeDown: 'sec-state-body'  // Down exits this scope
  });

  const { header: exportHeader, section: exportSection } = section("sec-state", "Export / Import", [
    exportBodyGrid
  ], { collapsed: true });

  nodes.push(exportHeader, exportSection, exportBodyGrid, pasteJsonBtn, downloadJsonBtn, stateBoxNode);

  // ─── Sidebar Scope (Wraps All Sections) ───────────────────────────────────
  // Sidebar: vertical grid (N×1) of controls and sections
  // Each section header + section body pair is a separate row
  const sidebarGrid = grid("sidebar", {
    cells: [
      [cell("ctrl-section")],
      [cell("sec-mode:header")],
      [cell("sec-mode-body")],
      [cell("sec-presets:header")],
      [cell("sec-presets-body")],
      [cell("sec-z0:header")],
      [cell("sec-z0-body")],
      [cell("sec-orient:header")],
      [cell("sec-orient-body")],
      [cell("sec-sim:header")],
      [cell("sec-sim-body")],
      [cell("sec-state:header")],
      [cell("sec-state-body")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',
    escapeLeft: 'canvas'  // Left goes back to canvas
  });
  nodes.push(sidebarGrid);

  // ─── Panel Overlays ────────────────────────────────────────────────────────
  // Info panel: just a close button for now
  const infoPanelGrid = grid("info-panel-body", {
    cells: [[cell("info-panel:close")]],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'first'
  });
  
  const infoPanel = panel("info-panel", "Controls & Info", [infoPanelGrid], { 
    triggerId: "infoBtn" 
  });
  nodes.push(...infoPanel.nodes, infoPanelGrid);

  // Settings panel: 3 vertical groups
  const autoRenderCheck = checkbox("autoRender", { 
    label: "Auto-render" 
  });
  const previewDragCheck = checkbox("previewWhileDrag", { 
    label: "Preview while moving" 
  });
  const showHudCheck = checkbox("showHud", { 
    label: "Show probe" 
  });
  
  // Rendering group: 3×1 grid
  const renderingGroupGrid = grid("settings-panel:rendering", {
    cells: [
      [cell("autoRender")],
      [cell("previewWhileDrag")],
      [cell("showHud")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'first'
  });

  const invertScrollCheck = checkbox("stgInvertScroll", { 
    label: "Invert scroll direction" 
  });
  const zoomSpeedSlider = slider("slider-stgZoomSpeed", { 
    label: "Zoom speed", 
    min: 0.2, 
    max: 4.0, 
    step: 0.1, 
    value: 1.0, 
    hasParamTrigger: false 
  });
  
  // Scroll group: 2×1 grid
  const scrollGroupGrid = grid("settings-panel:scroll", {
    cells: [
      [cell("stgInvertScroll")],
      [cell("slider-stgZoomSpeed")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'first'
  });

  const invertPanXCheck = checkbox("stgInvertPanX", { 
    label: "Invert pan X" 
  });
  const invertPanYCheck = checkbox("stgInvertPanY", { 
    label: "Invert pan Y" 
  });
  const panSpeedSlider = slider("slider-stgPanSpeed", { 
    label: "Pan speed", 
    min: 0.2, 
    max: 4.0, 
    step: 0.1, 
    value: 1.0, 
    hasParamTrigger: false 
  });
  
  // Panning group: 3×1 grid
  const panningGroupGrid = grid("settings-panel:panning", {
    cells: [
      [cell("stgInvertPanX")],
      [cell("stgInvertPanY")],
      [cell("slider-stgPanSpeed")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'first'
  });

  // Settings panel body: vertical grid of close button + 3 groups
  const settingsPanelBodyGrid = grid("settings-panel-body", {
    cells: [
      [cell("settings-panel:close")],
      [cell("settings-panel:rendering")],
      [cell("settings-panel:scroll")],
      [cell("settings-panel:panning")]
    ],
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'first'
  });

  const settingsPanel = panel("settings-panel", "Settings", [
    settingsPanelBodyGrid
  ], { triggerId: "settingsBtn" });

  nodes.push(
    renderingGroupGrid, autoRenderCheck, previewDragCheck, showHudCheck,
    scrollGroupGrid, invertScrollCheck, ...zoomSpeedSlider,
    panningGroupGrid, invertPanXCheck, invertPanYCheck, ...panSpeedSlider,
    settingsPanelBodyGrid,
    ...settingsPanel.nodes
  );

  // ─── Root (Top-Level Regions) ──────────────────────────────────────────────
  // Root is a 2-row grid with canvas-controls spanning 2 rows:
  // Row 0: [canvas-controls (2 rows)] [canvas] [sidebar]
  // Row 1: (canvas-controls spans)    [empty]  [sidebar]
  // This allows: down from canvas → searches row 1, finds canvas-controls at col 0
  //              left from canvas → canvas-controls
  //              right from canvas → sidebar
  // Default entry: canvas (middle position)
  const rootGrid = grid('root', {
    cells: [
      [cell('canvas-controls', 2, 1), cell('canvas'), cell('sidebar', 2, 1)]
    ],
    rows: 2,
    cols: 3,
    wrapCols: false,
    wrapRows: false,
    entryPolicy: 'remembered',  // Remember where you were
    entryCell: 1  // Default to canvas (column 1)
  });
  nodes.push(rootGrid);

  return nodes;
}
