/**
 * Canonical bind-group layouts (G3). Every pipeline in Principia must use
 * these layout OBJECTS — WebGPU bind-group compatibility is identity-based,
 * not structural, so two equivalent ad-hoc layouts are NOT interchangeable
 * and produce `bind group at index N is not compatible` the first time a
 * SimResult buffer is bound for both compute and render.
 *
 * Group structure (the architectural contract — resist adding groups):
 *   group(0) frame:     b0 SimUniforms, b1 TileRequest,
 *                       b2 DebugUniform (G17), b3 ChartUniforms (G4),
 *                       b4 LinearisedRef (G6, compute-only),
 *                       b5 EnsembleOffsets (G7, compute-only),
 *                       b6 SliceUniforms (compute-only),
 *                       b7 UploadedIC[] (compute-only, read-only storage).
 *   group(1) perTile:   b0 SimResult[], b1 ICDescriptor[]  (storage).
 *   group(2) reduction: b0 TileReduction                   (storage).
 *   group(3) render:    b0 RenderParams, b1 TileWindow (G8) (uniform).
 *
 * Visibility flags are the union of every stage that statically uses the
 * binding across ALL pipelines; WebGPU is fine with overspecification, and
 * the union is what lets one layout object back compute-only and
 * fragment-also pipelines.
 *
 * Storage access is `storage` (read-write) everywhere in group(1): WebGPU
 * requires a shader's declared access mode to MATCH the layout's buffer
 * type, so every shader binding group(1) declares `var<storage, read_write>`
 * even if it only reads (render_layer0.wgsl has done this since G17;
 * render_graph.wgsl and reduce.wgsl were flipped by G3).
 */

/**
 * GPUShaderStage bit values per the WebGPU spec. Defined locally because
 * the `GPUShaderStage` global only exists in a WebGPU environment — this
 * module (and its descriptor constants) must be importable in plain Node.
 */
export const STAGE = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;

const COMPUTE_AND_FRAGMENT = STAGE.COMPUTE | STAGE.FRAGMENT;

export const FRAME_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.frame',
  entries: [
    { binding: 0, visibility: COMPUTE_AND_FRAGMENT,
      buffer: { type: 'uniform' } },                     // SimUniforms
    { binding: 1, visibility: COMPUTE_AND_FRAGMENT,
      buffer: { type: 'uniform' } },                     // TileRequest
    { binding: 2, visibility: STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // DebugUniform (G17)
    { binding: 3, visibility: COMPUTE_AND_FRAGMENT,
      buffer: { type: 'uniform' } },                     // ChartUniforms (G4)
    { binding: 4, visibility: STAGE.COMPUTE,
      buffer: { type: 'uniform' } },                     // LinearisedRef (G6)
    { binding: 5, visibility: STAGE.COMPUTE,
      buffer: { type: 'uniform' } },                     // EnsembleOffsets (G7)
    { binding: 6, visibility: STAGE.COMPUTE,
      buffer: { type: 'uniform' } },                     // SliceUniforms
    { binding: 7, visibility: STAGE.COMPUTE,
      buffer: { type: 'read-only-storage' } },           // UploadedIC[]
  ],
};

export const PER_TILE_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.perTile',
  entries: [
    { binding: 0, visibility: COMPUTE_AND_FRAGMENT,
      buffer: { type: 'storage' } },                     // SimResult[]
    { binding: 1, visibility: COMPUTE_AND_FRAGMENT,
      buffer: { type: 'storage' } },                     // ICDescriptor[]
  ],
};

export const REDUCTION_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.reduction',
  entries: [
    { binding: 0, visibility: STAGE.COMPUTE,
      buffer: { type: 'storage' } },                     // TileReduction
  ],
};

export const RENDER_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.render',
  entries: [
    { binding: 0, visibility: STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // RenderParams
    { binding: 1, visibility: STAGE.VERTEX | STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // TileWindow (G8)
  ],
};

/** TileWindow uniform size (G8): vec4 screen rect + vec4 tile-UV window. */
export const TILE_WINDOW_SIZE = 32;

export interface PipelineLayouts {
  /** group 0 */ frame: GPUBindGroupLayout;
  /** group 1 */ perTile: GPUBindGroupLayout;
  /** group 2 */ reduction: GPUBindGroupLayout;
  /** group 3 */ render: GPUBindGroupLayout;
  /** Composite layouts for each pipeline. */
  pipelineSimulate: GPUPipelineLayout;
  pipelineReduce: GPUPipelineLayout;
  pipelineRender: GPUPipelineLayout;
  pipelineInspectorPreview: GPUPipelineLayout;
}

// Layout identity is per-device: every builder that calls buildLayouts for
// the same device MUST receive the same objects, or bind groups stop being
// shareable across pipelines — which is the whole point of G3. Memoised
// here so call sites keep their (ctx, bufs, code) signatures.
const cache = new WeakMap<GPUDevice, PipelineLayouts>();

export function buildLayouts(device: GPUDevice): PipelineLayouts {
  const hit = cache.get(device);
  if (hit) return hit;

  const frame = device.createBindGroupLayout(FRAME_LAYOUT_DESC);
  const perTile = device.createBindGroupLayout(PER_TILE_LAYOUT_DESC);
  const reduction = device.createBindGroupLayout(REDUCTION_LAYOUT_DESC);
  const render = device.createBindGroupLayout(RENDER_LAYOUT_DESC);

  const pipelineSimulate = device.createPipelineLayout({
    label: 'principia.pipeline.simulate',
    bindGroupLayouts: [frame, perTile],
  });
  const pipelineReduce = device.createPipelineLayout({
    label: 'principia.pipeline.reduce',
    bindGroupLayouts: [frame, perTile, reduction],
  });
  const pipelineRender = device.createPipelineLayout({
    label: 'principia.pipeline.render',
    bindGroupLayouts: [frame, perTile, reduction, render],
  });
  const pipelineInspectorPreview = device.createPipelineLayout({
    label: 'principia.pipeline.inspectorPreview',
    bindGroupLayouts: [frame, perTile, reduction, render],
  });

  const layouts: PipelineLayouts = {
    frame, perTile, reduction, render,
    pipelineSimulate, pipelineReduce,
    pipelineRender, pipelineInspectorPreview,
  };
  cache.set(device, layouts);
  return layouts;
}

/**
 * Size of the zero-filled ChartUniforms placeholder buffer (G4 will pack
 * real per-chart knobs into it; 64 bytes per the G4 contract).
 */
export const CHART_UNIFORMS_SIZE = 64;
