# G3 — Bind-group layout authority

## Goal

A single `Layouts` module that all three pipelines (simulate, reduce,
render) consume. M3, M5, and M7 each define their own bind-group
layouts; in real WebGPU, sharing pre-bound bind groups across pipelines
requires the layout objects to be the same identity (not just
structurally equivalent). Without G3, you get
`GPUValidationError: bind group at index N is not compatible` the first
time you try to bind a SimResult buffer for both compute and render.

After G3: one `buildLayouts(device)` call (memoised per device — layout
*identity* is the whole point, so every caller must receive the same
objects) returns the canonical `PipelineLayouts` object; all three
pipelines use it; bind groups allocated for one pipeline bind cleanly
into the others. Bind groups are canonical too:
`createTileBindGroups(ctx, layouts, bufs)` is memoised per `TileBuffers`,
so simulate/reduce/render literally share the same `GPUBindGroup` objects.

**This milestone is a refactor, not a prerequisite (A1 ruling).** M3, M5,
and M7 are built first with their own *provisional per-pipeline bind-group
layouts*; G3 later replaces those ad-hoc layouts with the single `Layouts`
authority described here. The per-pipeline bind groups ship before G3
exists by design — G3 centralises them into one source of truth once all
three pipelines exist to share layout identity.

**Exit criterion.**

```bash
npm test -- --run test/integration/layout_compat
```

The same canonical bind-group set dispatches in the simulate pipeline,
the reduce pipeline, and the render-graph pipeline without validation
errors (asserted inside a `pushErrorScope('validation')` around real
dispatches of the real linked shaders; self-skips without WebGPU). On a
real device the same contract is proven by the dev harness checks —
`dev/render_graph.ts` computes with the M3 pipelines and draws with the
M7 graph using the same bind groups in one page.

**Deliverable:** one `buildLayouts(device)` authority (+ canonical
`createTileBindGroups`) consumed by `buildPipelines`,
`buildReducePipeline`, and `buildRenderGraph`; the same bind-group set
binds cleanly across simulate/reduce/render, checked by
`test/integration/layout_compat` and the real-GPU page checks.

## File tree

```
principia/
  src/
    gpu/
      layouts.ts                # the single source of truth (+ STAGE consts,
                                #   *_LAYOUT_DESC exports, CHART_UNIFORMS_SIZE)
      pipelines.ts              # M3 builder, refactored to consume Layouts
      reduce_pipeline.ts        # M5 builder, refactored likewise
      buffers.ts                # + chart & reduction buffers; canonical
                                #   createTileBindGroups / createRenderParamsBindGroup
    render/
      pipeline.ts               # M7 builder, refactored likewise
  test/
    unit/gpu/
      layouts.test.ts
    integration/
      layout_compat.test.ts
```

(The originally drafted `src/gpu/pipelines/{simulate,reduce,render,
inspector_preview}.ts` split was not adopted: the landed builders were
refactored in place with their signatures and result shapes intact, so no
call site churns. `inspector_preview` does not exist as a pipeline — M9's
inspector is CPU-f64 — but its pipeline *layout* is reserved in
`PipelineLayouts` as an alias of the render layout list.)

## The canonical group table

This is an architectural contract — resist adding groups.

| Group | Name | Bindings | Type | Visibility |
|-------|------|----------|------|------------|
| 0 | `frame` | 0 `SimUniforms`, 1 `TileRequest`, 2 `DebugUniform` (G17), 3 `ChartUniforms` (G4 slot) | uniform | b2 FRAGMENT; others COMPUTE\|FRAGMENT |
| 1 | `perTile` | 0 `SimResult[]`, 1 `ICDescriptor[]` | **storage** (read-write) | COMPUTE\|FRAGMENT |
| 2 | `reduction` | 0 `TileReduction` | storage | COMPUTE |
| 3 | `render` | 0 `RenderParams` | uniform | FRAGMENT |

Two bindings need their history spelled out:

- **binding(2) of group(0) is G17's DebugUniform**, not ChartUniforms as
  this doc originally had it — `render_layer0.wgsl` statically reads
  `dbg` at `@group(0) @binding(2)` (D17.1) and that shipped first.
  **ChartUniforms therefore lives at binding(3)**; G4's doc was
  retargeted accordingly. Until G4 packs it, `bufs.chart` is a 64-byte
  zero-filled placeholder (`CHART_UNIFORMS_SIZE`), exactly the D17.1
  zero-filled-uniform pattern.
- **group(1) is `storage` (read-write) everywhere.** WebGPU requires a
  shader's declared access mode to MATCH the layout's buffer type — a
  shader `var<storage, read>` against a `'storage'` layout entry is a
  validation **error**, not a permitted narrowing. (An earlier draft of
  this doc claimed the opposite; M7's own landed `render_layer0.wgsl`
  comment states the real rule.) Consequently `reduce.wgsl` and
  `render_graph.wgsl` declare their group(1) inputs `read_write` even
  though they only read, matching `render_layer0.wgsl` since G17.

Pipeline layouts: simulate = `[frame, perTile]` (shared by the M3 compute
pipeline *and* the layer-0 render pipeline), reduce =
`[frame, perTile, reduction]`, render = `[frame, perTile, reduction,
render]` (the M7 empty-group(2) hack is gone — the render pass binds the
real canonical reduction group; the shader ignores it until tile-debug
overlays read it), inspectorPreview = alias of render.

## `src/gpu/layouts.ts` (essentials)

```ts
/** GPUShaderStage bit values per the WebGPU spec. Defined locally because
 *  the `GPUShaderStage` global only exists in a WebGPU environment — this
 *  module (and its descriptor constants) must be importable in plain Node. */
export const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 } as const;

export const FRAME_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.frame',
  entries: [
    { binding: 0, visibility: STAGE.COMPUTE | STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // SimUniforms
    { binding: 1, visibility: STAGE.COMPUTE | STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // TileRequest
    { binding: 2, visibility: STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // DebugUniform (G17)
    { binding: 3, visibility: STAGE.COMPUTE | STAGE.FRAGMENT,
      buffer: { type: 'uniform' } },                     // ChartUniforms (G4)
  ],
};
// PER_TILE_LAYOUT_DESC (2 × storage, COMPUTE|FRAGMENT),
// REDUCTION_LAYOUT_DESC (1 × storage, COMPUTE),
// RENDER_LAYOUT_DESC (1 × uniform, FRAGMENT) follow the table above.

export interface PipelineLayouts {
  frame: GPUBindGroupLayout;      perTile: GPUBindGroupLayout;
  reduction: GPUBindGroupLayout;  render: GPUBindGroupLayout;
  pipelineSimulate: GPUPipelineLayout;
  pipelineReduce: GPUPipelineLayout;
  pipelineRender: GPUPipelineLayout;
  pipelineInspectorPreview: GPUPipelineLayout;
}

// Layout identity is per-device: every builder that calls buildLayouts for
// the same device MUST receive the same objects, or bind groups stop being
// shareable across pipelines — which is the whole point of G3. Memoised so
// call sites keep their (ctx, bufs, code) signatures.
const cache = new WeakMap<GPUDevice, PipelineLayouts>();
export function buildLayouts(device: GPUDevice): PipelineLayouts { /* … */ }

export const CHART_UNIFORMS_SIZE = 64;
```

## How M3 / M5 / M7 changed

All three builders keep their signatures and result shapes; only their
internals changed to consume the authority:

- `buildPipelines(ctx, bufs, shaders)` (M3): both pipelines take
  `layouts.pipelineSimulate`; `bindGroupCommon`/`bindGroupSim` are now the
  canonical `frame`/`perTile` groups.
- `buildReducePipeline(ctx, bufs, code)` (M5): takes
  `layouts.pipelineReduce`; `bgCommon`/`bgInput`/`bgOutput` are the
  canonical groups; **`outputBuf` is now `bufs.reduction`** — the
  TileReduction buffer moved into `TileBuffers` so it has one home that
  the render pipeline can also bind.
- `buildRenderGraph(ctx, bufs, code)` (M7): takes
  `layouts.pipelineRender`; `bgEmpty` became **`bgReduction`** (the only
  call-site change — `dev/render_graph.ts` sets it at index 2).

## Bind-group construction (also centralised)

```ts
// src/gpu/buffers.ts
export interface TileBindGroups {
  frame: GPUBindGroup;      // group(0)
  perTile: GPUBindGroup;    // group(1)
  reduction: GPUBindGroup;  // group(2)
}
// Memoised per TileBuffers: every builder receives the SAME objects.
export function createTileBindGroups(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, bufs: TileBuffers,
): TileBindGroups { /* … */ }

// group(3) stays separate so palette / CVD swaps rebind ONLY this group
// (M7's 64-byte rebind contract).
export function createRenderParamsBindGroup(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, paramsBuffer: GPUBuffer,
): GPUBindGroup { /* … */ }
```

`TileBuffers` gained two buffers: `chart` (64 B zero-filled, the G4 slot)
and `reduction` (`sizeOfTileReduction(M)`, the canonical TileReduction
output).

## Tests

### `test/unit/gpu/layouts.test.ts`

Pins the descriptor table in plain Node (no `GPUShaderStage` global — the
suite uses layouts.ts's own `STAGE` constants; referencing the browser
global at module scope would crash every Node import of the barrel):
binding order and types of all four groups, the G17 slot at frame
binding(2), the G4 slot at binding(3) with `CHART_UNIFORMS_SIZE === 64`,
per-tile storage read-write + COMPUTE|FRAGMENT, reduction compute-only,
render fragment-only. Plus an access-mode sweep over the real shader
sources: any `@group(1)` storage declaration in any `.wgsl` file must say
`read_write`.

### `test/integration/layout_compat.test.ts`

The originally drafted test only called `setBindGroup` and never
dispatched — WebGPU validates bind-group/pipeline compatibility at
**dispatch/draw time**, so it asserted nothing (same failure class as
D12.1's vacuous acceptance checks). As landed, gated on WebGPU:

1. `buildLayouts` memoisation: two calls return the same object.
2. Builds the REAL pipelines (simulate + layer-0 render via `wgslLink`,
   reduce, render graph) over one `TileBuffers`; asserts the builders
   handed back the *same* bind-group objects
   (`pl.bindGroupSim === rp.bgInput === rg.bgStorage`); then inside
   `pushErrorScope('validation')` actually dispatches simulate, dispatches
   reduce, and draws the render graph (all four groups bound, real target
   texture) and asserts `popErrorScope()` returns null.

## Run it

```bash
npm test -- --run test/unit/gpu/layouts
npm test -- --run test/integration/layout_compat
```

## Acceptance check

```bash
npm test -- --run test/integration/layout_compat
```

Plus, on a real device: `npm run gpu:check` and the m5 / m7 / g17 /
depth-stress page checks — `dev/render_graph.ts` alone exercises the
shared set across compute (M3 simulate), layer-0 render, and the M7
render graph in one page.

## Notes for the implementer

- **Visibility unions.** Each binding's `visibility` flag is the union
  of every stage the binding is *statically used* in across all
  pipelines. Overspecification is fine; underspecification fails at
  pipeline creation. TileRequest is COMPUTE|FRAGMENT because
  `render_graph.wgsl` declares it in a fragment module even though
  `fs_main` doesn't read it today.
- **`storage` vs `read-only-storage`.** The layout entry type and the
  shader's access mode must match exactly. One shared read-write layout +
  `var<storage, read_write>` in every group(1) shader is the price of
  cross-pipeline bind-group sharing, and it's cheap: fragment-stage
  read-write storage is within default limits and has been proven on
  swiftshader since G17.
- **Render-only group(3)** stays separate so that palette swaps and
  CVD-mode toggles only rebind one group (the one with `RenderParams`),
  leaving the per-tile and frame groups intact.
- **Pipeline labels.** All `label:` strings flow through to the
  browser's GPU validation messages. Worth keeping; debugging
  validation errors is much easier with named layouts.
- **Future room.** G4 packs real per-chart knobs into the already-bound
  `bufs.chart` at frame binding(3) — no layout change. G7's ensemble
  dispatch rides on existing slots too. Resist the urge to add new
  groups; the stable shape here is part of the architectural contract.
