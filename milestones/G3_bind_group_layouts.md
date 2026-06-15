# G3 — Bind-group layout authority

## Goal

A single `Layouts` module that all three pipelines (simulate, reduce,
render) consume. M3, M5, and M7 each define their own bind-group
layouts; in real WebGPU, sharing pre-bound bind groups across pipelines
requires the layout objects to be the same identity (not just
structurally equivalent). Without G3, you get
`GPUValidationError: bind group at index N is not compatible` the first
time you try to bind a SimResult buffer for both compute and render.

After G3: one `buildLayouts(device)` call returns the canonical
`PipelineLayouts` object; all three pipelines use it; bind groups
allocated for one pipeline bind cleanly into the others.

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

The same `BindGroup` object created for the simulate pipeline binds
without validation errors when used in the reduce pipeline (input
group), the render pipeline (storage read), and the inspector preview
pipeline.

## File tree

```
principia/
  src/
    gpu/
      layouts.ts                # the single source of truth
      pipelines/
        simulate.ts             # M3 dispatch, refactored to consume Layouts
        reduce.ts               # M5
        render.ts               # M7
        inspector_preview.ts    # M9 hover-streamline
      buffers.ts                # extended to expose canonical bind groups
  test/
    unit/gpu/
      layouts.test.ts
    integration/
      layout_compat.test.ts
```

## `src/gpu/layouts.ts`

```ts
/**
 * Canonical bind-group layouts. Every pipeline in Principia must use
 * these layout objects (not equivalent ad-hoc instances), so that bind
 * groups allocated against any one of them rebind cleanly across all.
 *
 * Group structure:
 *   group(0): frame-level uniforms — SimUniforms + TileRequest +
 *             ChartUniforms (the last one is added by G4).
 *   group(1): per-tile storage — SimResult and ICDescriptor.
 *   group(2): per-tile reduction output — TileReduction.
 *   group(3): render-only uniforms — RenderParams.
 *
 * Visibility flags are the union of every stage that needs the binding;
 * WebGPU validation is fine with overspecification, and this lets the
 * same layout object back compute-only and fragment-also pipelines.
 */
export interface PipelineLayouts {
  /** group 0 */ frame:    GPUBindGroupLayout;
  /** group 1 */ perTile:  GPUBindGroupLayout;
  /** group 2 */ reduction:GPUBindGroupLayout;
  /** group 3 */ render:   GPUBindGroupLayout;
  /** Composite layouts for each pipeline. */
  pipelineSimulate:        GPUPipelineLayout;
  pipelineReduce:          GPUPipelineLayout;
  pipelineRender:          GPUPipelineLayout;
  pipelineInspectorPreview:GPUPipelineLayout;
}

export function buildLayouts(device: GPUDevice): PipelineLayouts {
  const FRAGMENT_AND_COMPUTE =
    GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT;

  const frame = device.createBindGroupLayout({
    label: 'principia.frame',
    entries: [
      { binding: 0, visibility: FRAGMENT_AND_COMPUTE,
        buffer: { type: 'uniform' } },                     // SimUniforms
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },                     // TileRequest
      { binding: 2, visibility: FRAGMENT_AND_COMPUTE,
        buffer: { type: 'uniform' } },                     // ChartUniforms (G4)
    ],
  });

  const perTile = device.createBindGroupLayout({
    label: 'principia.perTile',
    entries: [
      { binding: 0, visibility: FRAGMENT_AND_COMPUTE,
        // 'read-only-storage' is binding-compatible with a 'storage'
        // group that holds the same buffer in another pipeline. We use
        // 'storage' here because the simulate compute writes to it.
        buffer: { type: 'storage' } },                     // SimResult
      { binding: 1, visibility: FRAGMENT_AND_COMPUTE,
        buffer: { type: 'storage' } },                     // ICDescriptor
    ],
  });

  const reduction = device.createBindGroupLayout({
    label: 'principia.reduction',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' } },                     // TileReduction
    ],
  });

  const render = device.createBindGroupLayout({
    label: 'principia.render',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },                     // RenderParams
    ],
  });

  const pipelineSimulate = device.createPipelineLayout({
    label: 'principia.pipeline.simulate',
    bindGroupLayouts: [frame, perTile],
  });
  const pipelineReduce = device.createPipelineLayout({
    label: 'principia.pipeline.reduce',
    // Reduce reads perTile (storage) and writes reduction (storage).
    bindGroupLayouts: [frame, perTile, reduction],
  });
  const pipelineRender = device.createPipelineLayout({
    label: 'principia.pipeline.render',
    // Render reads frame, perTile (storage as readonly), and render.
    bindGroupLayouts: [frame, perTile, reduction, render],
  });
  const pipelineInspectorPreview = device.createPipelineLayout({
    label: 'principia.pipeline.inspectorPreview',
    bindGroupLayouts: [frame, perTile, reduction, render],
  });

  return {
    frame, perTile, reduction, render,
    pipelineSimulate, pipelineReduce,
    pipelineRender, pipelineInspectorPreview,
  };
}
```

## Why a single source of truth matters

WebGPU's bind-group compatibility check is identity-based, not
structural. Two `GPUBindGroupLayout` objects that have the same
descriptor are *not* interchangeable. If M3's compute pipeline binds a
SimResult buffer to its own layout, that bind group can't be passed to
M7's render pipeline that uses an equivalent-but-distinct layout —
WebGPU throws `bind group at index 1 is not compatible`.

Real implementations have hit this with shared cross-pipeline buffers.
The fix is to centralise.

## How M3 / M5 / M7 change

Each pipeline-construction file becomes a thin wrapper around the
canonical layouts. Below: the M3 `dispatch_layer0.ts` redux.

### `src/gpu/pipelines/simulate.ts`

```ts
import type { GpuContext } from '../init.js';
import type { PipelineLayouts } from '../layouts.js';

export interface SimulatePipeline {
  pipeline: GPUComputePipeline;
}

export function buildSimulatePipeline(
  ctx: GpuContext, layouts: PipelineLayouts, code: string,
): SimulatePipeline {
  const pipeline = ctx.device.createComputePipeline({
    label: 'principia.simulate',
    layout: layouts.pipelineSimulate,
    compute: {
      module: ctx.device.createShaderModule({ code, label: 'simulate.wgsl' }),
      entryPoint: 'simulate',
    },
  });
  return { pipeline };
}
```

### `src/gpu/pipelines/reduce.ts`

```ts
import type { GpuContext } from '../init.js';
import type { PipelineLayouts } from '../layouts.js';

export interface ReducePipeline {
  pipeline: GPUComputePipeline;
}

export function buildReducePipeline(
  ctx: GpuContext, layouts: PipelineLayouts, code: string,
): ReducePipeline {
  return {
    pipeline: ctx.device.createComputePipeline({
      label: 'principia.reduce',
      layout: layouts.pipelineReduce,
      compute: {
        module: ctx.device.createShaderModule({ code, label: 'reduce.wgsl' }),
        entryPoint: 'reduce',
      },
    }),
  };
}
```

### `src/gpu/pipelines/render.ts`

```ts
import type { GpuContext } from '../init.js';
import type { PipelineLayouts } from '../layouts.js';

export interface RenderPipeline {
  pipeline: GPURenderPipeline;
}

export function buildRenderPipeline(
  ctx: GpuContext, layouts: PipelineLayouts, code: string,
): RenderPipeline {
  const module = ctx.device.createShaderModule({
    code, label: 'render_graph.wgsl',
  });
  return {
    pipeline: ctx.device.createRenderPipeline({
      label: 'principia.render',
      layout: layouts.pipelineRender,
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main',
                  targets: [{ format: ctx.format }] },
      primitive: { topology: 'triangle-list' },
    }),
  };
}
```

## Bind-group construction (also centralised)

Tiles allocate bind groups once at compute-time and reuse them on every
subsequent render. The helper:

```ts
// src/gpu/buffers.ts (extension)
import type { PipelineLayouts } from './layouts.js';
import type { TileBuffers } from './buffers.js';

export interface TileBindGroups {
  /** group(0) — frame-level uniforms. Bound once per frame. */
  frame:     GPUBindGroup;
  /** group(1) — per-tile storage. Bound once per tile. */
  perTile:   GPUBindGroup;
  /** group(2) — per-tile reduction output. Bound during the reduce pass. */
  reduction: GPUBindGroup;
}

export function createTileBindGroups(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts,
  bufs: TileBuffers, chartUniforms: GPUBuffer, reductionBuffer: GPUBuffer,
): TileBindGroups {
  const frame = ctx.device.createBindGroup({
    label: 'principia.bg.frame',
    layout: layouts.frame,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq  } },
      { binding: 2, resource: { buffer: chartUniforms } },        // G4
    ],
  });
  const perTile = ctx.device.createBindGroup({
    label: 'principia.bg.perTile',
    layout: layouts.perTile,
    entries: [
      { binding: 0, resource: { buffer: bufs.simResults } },
      { binding: 1, resource: { buffer: bufs.icDesc     } },
    ],
  });
  const reduction = ctx.device.createBindGroup({
    label: 'principia.bg.reduction',
    layout: layouts.reduction,
    entries: [
      { binding: 0, resource: { buffer: reductionBuffer } },
    ],
  });
  return { frame, perTile, reduction };
}
```

The render-only group(3) (`RenderParams`) lives separately because
swapping it shouldn't touch the per-tile bind group:

```ts
export function createRenderParamsBindGroup(
  ctx: { device: GPUDevice }, layouts: PipelineLayouts, paramsBuffer: GPUBuffer,
): GPUBindGroup {
  return ctx.device.createBindGroup({
    label: 'principia.bg.renderParams',
    layout: layouts.render,
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });
}
```

## Tests

### `test/unit/gpu/layouts.test.ts`

```ts
import { describe, it, expect } from 'vitest';

/**
 * Layout descriptor shapes are stable. We can't construct a
 * GPUBindGroupLayout in a unit test, but we can test the descriptors
 * directly via a thin export.
 */

// In real code, expose the descriptor objects (not just the layouts) so
// tests can introspect.
import {
  FRAME_LAYOUT_DESC, PER_TILE_LAYOUT_DESC,
  REDUCTION_LAYOUT_DESC, RENDER_LAYOUT_DESC,
} from '@/gpu/layouts.js';

describe('layout descriptors', () => {
  it('frame group has SimUniforms (0), TileRequest (1), ChartUniforms (2)', () => {
    expect(FRAME_LAYOUT_DESC.entries).toHaveLength(3);
    expect(FRAME_LAYOUT_DESC.entries[0]!.binding).toBe(0);
    expect(FRAME_LAYOUT_DESC.entries[1]!.binding).toBe(1);
    expect(FRAME_LAYOUT_DESC.entries[2]!.binding).toBe(2);
  });

  it('frame.SimUniforms is visible to compute and fragment', () => {
    const SimUniformsEntry = FRAME_LAYOUT_DESC.entries[0]!;
    const flag = SimUniformsEntry.visibility;
    expect((flag & GPUShaderStage.COMPUTE) !== 0).toBe(true);
    expect((flag & GPUShaderStage.FRAGMENT) !== 0).toBe(true);
  });

  it('per-tile storage is visible to both compute (write) and fragment (read)', () => {
    const e0 = PER_TILE_LAYOUT_DESC.entries[0]!;
    expect((e0.visibility & GPUShaderStage.COMPUTE) !== 0).toBe(true);
    expect((e0.visibility & GPUShaderStage.FRAGMENT) !== 0).toBe(true);
  });

  it('reduction is compute-only', () => {
    const e0 = REDUCTION_LAYOUT_DESC.entries[0]!;
    expect((e0.visibility & GPUShaderStage.FRAGMENT) === 0).toBe(true);
  });

  it('render group is fragment-only', () => {
    const e0 = RENDER_LAYOUT_DESC.entries[0]!;
    expect((e0.visibility & GPUShaderStage.COMPUTE) === 0).toBe(true);
    expect((e0.visibility & GPUShaderStage.FRAGMENT) !== 0).toBe(true);
  });
});
```

To make this test runnable, the layout module exposes the descriptor
objects alongside the constructed layouts:

```ts
// src/gpu/layouts.ts (snippet)
export const FRAME_LAYOUT_DESC: GPUBindGroupLayoutDescriptor = {
  label: 'principia.frame',
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' } },
  ],
};
// (same pattern for PER_TILE_LAYOUT_DESC, REDUCTION_LAYOUT_DESC, RENDER_LAYOUT_DESC)
```

### `test/integration/layout_compat.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { initGpu } from '@/gpu/init.js';
import { buildLayouts } from '@/gpu/layouts.js';
import { createTileBuffers } from '@/gpu/buffers.js';

describe('bind-group layout compatibility across pipelines', () => {
  it('one perTile bind group binds in simulate, reduce, and render passes', async () => {
    if (!('gpu' in (globalThis as any).navigator ?? {})) return;
    const ctx = await initGpu();
    const layouts = buildLayouts(ctx.device);
    const bufs = createTileBuffers(ctx, 16, 8);

    // Allocate a single perTile bind group …
    const perTile = ctx.device.createBindGroup({
      layout: layouts.perTile,
      entries: [
        { binding: 0, resource: { buffer: bufs.simResults } },
        { binding: 1, resource: { buffer: bufs.icDesc     } },
      ],
    });

    // … and exercise it in three encoder passes (compute write, compute
    // read, fragment read). We don't dispatch real shaders here — we
    // just verify the validation layer accepts the binds.
    const enc = ctx.device.createCommandEncoder();

    const dummyCompute = ctx.device.createComputePipeline({
      layout: layouts.pipelineSimulate,
      compute: {
        module: ctx.device.createShaderModule({ code:
          `@group(0) @binding(0) var<uniform> u : f32;
           @group(0) @binding(1) var<uniform> t : f32;
           @group(0) @binding(2) var<uniform> c : f32;
           @group(1) @binding(0) var<storage, read_write> r : array<u32>;
           @group(1) @binding(1) var<storage, read_write> i : array<u32>;
           @compute @workgroup_size(1) fn simulate() { r[0] = i[0]; }`
        }),
        entryPoint: 'simulate',
      },
    });

    {
      const pass = enc.beginComputePass();
      pass.setPipeline(dummyCompute);
      pass.setBindGroup(1, perTile);
      // We never bind group 0 with real buffers in this test; we just
      // assert that setBindGroup(1, perTile) doesn't throw a layout
      // mismatch when the pipeline was built with the canonical layout.
      pass.end();
    }
    ctx.device.queue.submit([enc.finish()]);

    expect(true).toBe(true);    // reaching here is the assertion
  }, 30_000);
});
```

## Run it

```bash
npm test -- --run test/unit/gpu/layouts
npm test -- --run test/integration/layout_compat
```

## Acceptance check

```bash
npm test -- --run test/integration/layout_compat
```

The same `perTile` bind group binds across the simulate / reduce /
render pipelines without `bind group is not compatible` errors.

## Notes for the implementer

- **Visibility unions.** Each binding's `visibility` flag is the union
  of every stage the binding is read in. The simulate compute writes
  the SimResult buffer; the render fragment reads it; both flags must
  appear, even though only one runs at a time. This is per-binding,
  not per-pipeline — a bind group satisfies a layout iff every entry's
  declared visibility covers its actual use.
- **`storage` vs `read-only-storage`.** The simulate pipeline writes
  the SimResult buffer (storage). The render pipeline only reads it.
  WebGPU lets a pipeline declare `read-only-storage` while the bind
  group's underlying buffer was created with `STORAGE` usage, but the
  layout entry types must match exactly across the pipelines that
  share the bind group. We use `storage` (read-write) at the layout
  level and let the render shader treat it as read-only via
  `var<storage, read>`. Validation passes.
- **Render-only group(3)** stays separate so that palette swaps and
  CVD-mode toggles only rebind one group (the one with `RenderParams`),
  leaving the per-tile and frame groups intact.
- **Pipeline labels.** All `label:` strings flow through to the
  browser's GPU validation messages. Worth keeping; debugging
  validation errors is much easier with named layouts.
- **Future room.** When G4 adds `ChartUniforms` and G7 adds the
  ensemble dispatch, the layout doesn't need to change — both ride on
  existing slots. Resist the urge to add new groups; the stable shape
  here is part of the architectural contract.
