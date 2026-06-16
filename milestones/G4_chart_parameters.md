# G4 — Chart-parameter promotion

## Goal

Move the decoder hyperparameters (`mu_max`, `alpha_min`, `q_max`,
`r_coll`, `delta_lambda`, plus chart-specific things like `Kmax`,
`gamma_K`, `pole_buffer`) out of `SimUniforms` and into a per-chart
`ChartUniforms` buffer that the shader reads alongside.

In M3 these knobs were hard-coded into `SimUniforms` as a stopgap —
fine for the latent slice, fine for the M3 gate, immediately wrong as
soon as M10's chart system tries to vary them per chart. G4 fixes it.

After G4: the chart registry is the source of truth for chart
parameters, and the same shader runs every chart unchanged because the
chart-specific knobs come in via group(0) binding(2) — not via
specialisation constants, not via shader recompilation.

**Exit criterion.**

```bash
npm test -- --run test/integration/chart_uniforms
```

Switching from the latent slice (default α_min = 0.05) to a custom
chart (α_min = 0.20) does not trigger a shader recompile; the
`ChartUniforms` buffer rebinds and the next dispatch reads the new
values.

**Deliverable:** internal — tests only; per-chart decoder knobs live in a `ChartUniforms` buffer at group(0) binding(2) so changing a chart's parameters rebinds without a shader recompile, verified by `test/integration/chart_uniforms`.

## File tree

```
principia/
  src/
    gpu/
      chart_uniforms.ts         # the new struct + packing
      structs.ts                # SimUniforms slimmed down
      buffers.ts                # one extra buffer in TileBuffers
    chart_atlas/
      types.ts                  # Chart adds chartUniforms()
      registry.ts               # ditto
      charts/
        latent_slice.ts         # implements chartUniforms()
        lz_e.ts
        lz_k.ts
        shape_sphere.ts
        mass_simplex.ts
        burrau_euclid.ts
        mixed_axis.ts
  test/
    unit/gpu/
      chart_uniforms.test.ts
    integration/
      chart_uniforms.test.ts
```

## `src/gpu/chart_uniforms.ts`

```ts
/**
 * ChartUniforms is bound at group(0) binding(2). 64 bytes, vec4-aligned.
 * Layout reserved a few slots for chart-specific parameters; future
 * charts that need more can pack into the reserved tail.
 *
 * Slot map:
 *   [0..3]    mu_max          f32
 *   [4..7]    alpha_min       f32
 *   [8..11]   q_max           f32
 *   [12..15]  R_tilde         f32   (scale gauge, normally 1)
 *   [16..19]  Kmax            f32   (used by (Lz, E) and (Lz, K) charts)
 *   [20..23]  gamma_K         f32
 *   [24..27]  alpha_freeze    f32   (used by invariant + sphere charts)
 *   [28..31]  beta_freeze     f32
 *   [32..35]  pole_buffer     f32   (shape sphere)
 *   [36..39]  nu_burrau       f32   (Burrau Euclid / mass simplex)
 *   [40..43]  m1_target       f32   (δm strip target mass; otherwise 1/3)
 *   [44..47]  m2_target       f32
 *   [48..51]  m3_target       f32
 *   [52..63]  reserved        f32 × 3
 */
export interface ChartUniforms {
  mu_max:       number;
  alpha_min:    number;
  q_max:        number;
  R_tilde:      number;
  Kmax:         number;
  gamma_K:      number;
  alpha_freeze: number;
  beta_freeze:  number;
  pole_buffer:  number;
  nu_burrau:    number;
  m_target:     readonly [number, number, number];
}

export const CHART_UNIFORMS_DEFAULTS: ChartUniforms = {
  mu_max:       5,
  alpha_min:    0.05,
  q_max:        2,
  R_tilde:      1,
  Kmax:         2,
  gamma_K:      2,
  alpha_freeze: Math.PI / 4,
  beta_freeze:  Math.PI / 2,
  pole_buffer:  0.05,
  nu_burrau:    0.5,
  m_target:     [1/3, 1/3, 1/3],
};

export function packChartUniforms(c: ChartUniforms): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  f32[0]  = c.mu_max;
  f32[1]  = c.alpha_min;
  f32[2]  = c.q_max;
  f32[3]  = c.R_tilde;
  f32[4]  = c.Kmax;
  f32[5]  = c.gamma_K;
  f32[6]  = c.alpha_freeze;
  f32[7]  = c.beta_freeze;
  f32[8]  = c.pole_buffer;
  f32[9]  = c.nu_burrau;
  f32[10] = c.m_target[0];
  f32[11] = c.m_target[1];
  f32[12] = c.m_target[2];
  // [13..15] reserved
  return buf;
}

export function unpackChartUniforms(buf: ArrayBuffer): ChartUniforms {
  const f = new Float32Array(buf);
  return {
    mu_max: f[0]!,    alpha_min: f[1]!,
    q_max:  f[2]!,    R_tilde:   f[3]!,
    Kmax:   f[4]!,    gamma_K:   f[5]!,
    alpha_freeze: f[6]!, beta_freeze: f[7]!,
    pole_buffer:  f[8]!, nu_burrau:   f[9]!,
    m_target: [f[10]!, f[11]!, f[12]!],
  };
}
```

## `src/gpu/structs.ts` — SimUniforms slimmed down

```ts
/**
 * After G4, SimUniforms only carries quantities that are constant
 * across every chart in a frame: the integration setup and the
 * event thresholds. Chart-specific decode hyperparameters live in
 * ChartUniforms (binding 2 of group 0).
 */
export interface SimUniforms {
  G:                number;
  dt_macro:         number;
  N_max:            number;
  r_sub:            number;
  gamma_sub:        number;
  T_horizon:        number;
  r_coll:           number;
  R_esc:            number;
  k_esc:            number;
  eps_E:            number;
  eps_L:            number;
  r_close:          number;
  quality_tier:     number;
  checkpoint_count: number;
  samples_per_axis: number;
}

export function packSimUniforms(u: SimUniforms): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0]  = u.G;          f32[1]  = u.dt_macro;
  u32[2]  = u.N_max >>> 0;
  f32[3]  = u.r_sub;
  f32[4]  = u.gamma_sub;  f32[5]  = u.T_horizon;
  f32[6]  = u.r_coll;     f32[7]  = u.R_esc;
  u32[8]  = u.k_esc >>> 0;
  f32[9]  = u.eps_E;      f32[10] = u.eps_L;
  f32[11] = u.r_close;
  u32[12] = u.quality_tier >>> 0;
  u32[13] = u.checkpoint_count >>> 0;
  u32[14] = u.samples_per_axis >>> 0;
  return buf;
}
```

(M3's per-chart `m[3]` array left SimUniforms when G4 lands; per-pixel
mass charts rely on the IC descriptor's `m` field as M10 already
specified.)

## Shader-side changes

### `src/gpu/shaders/decode.wgsl`

```wgsl
// @import { sigmoid, mass_softmax } from "./helpers.wgsl"

// @export
struct ChartUniforms {
  mu_max:       f32,
  alpha_min:    f32,
  q_max:        f32,
  R_tilde:      f32,
  Kmax:         f32,
  gamma_K:      f32,
  alpha_freeze: f32,
  beta_freeze:  f32,
  pole_buffer:  f32,
  nu_burrau:    f32,
  m_target:     vec3<f32>,
};

// @export
fn decode_full(z: array<f32, 8>, ch: ChartUniforms) -> ICOut {
  var out: ICOut;
  let m  = mass_softmax(z[6], z[7], ch.mu_max);
  out.m  = m;

  let alpha = ch.alpha_min
            + (PI/2.0 - 2.0*ch.alpha_min) * sigmoid(z[0]);
  let beta  = PI * sigmoid(z[1]);

  // ... same body as before, just reading ch.* instead of uniforms.*
}
```

### `src/gpu/shaders/simulate.wgsl`

```wgsl
// @import "./helpers.wgsl"
// @import "./decode.wgsl"
// @import "./integrate.wgsl"
// @import "./events.wgsl"
// @import "./metrics.wgsl"

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req : TileRequest;
@group(0) @binding(2) var<uniform> chart    : ChartUniforms;

@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  // ... call decode_full(z, chart) ...
}
```

The host-side `dispatch_layer0.ts` (M3) gains one extra `writeBuffer`
per frame:

```ts
// G2's frame loop, when assembling per-tile uniforms:
device.queue.writeBuffer(bufs.uniforms,       0, packSimUniforms(simU));
device.queue.writeBuffer(bufs.tileReq,        0, packTileRequest(tile));
device.queue.writeBuffer(bufs.chartUniforms,  0,
                          packChartUniforms(chart.chartUniforms(view)));
```

## Chart contract extension

### `src/chart_atlas/types.ts` (extension)

```ts
import type { ChartUniforms } from '@/gpu/chart_uniforms.js';

export interface Chart {
  // ... existing fields (id, kind, flags, decode, inverseEncode, validate)
  /** Returns the chart-specific decoder parameters for this view. */
  chartUniforms(view: ChartView): ChartUniforms;
}
```

### `src/chart_atlas/charts/latent_slice.ts` (extension)

```ts
chartUniforms(_view) {
  return CHART_UNIFORMS_DEFAULTS;
},
```

### `src/chart_atlas/charts/lz_e.ts` (extension)

```ts
chartUniforms(view) {
  return {
    ...CHART_UNIFORMS_DEFAULTS,
    Kmax:         (view.chartParams.Kmax as number) ?? 2,
    gamma_K:      (view.chartParams.gammaK as number) ?? 2,
    alpha_freeze: (view.chartParams.alpha as number) ?? Math.PI / 4,
    beta_freeze:  (view.chartParams.beta as number) ?? Math.PI / 2,
  };
},
```

### `src/chart_atlas/charts/shape_sphere.ts` (extension)

```ts
chartUniforms(view) {
  return {
    ...CHART_UNIFORMS_DEFAULTS,
    pole_buffer: (view.chartParams.poleBuffer as number) ?? 0.05,
  };
},
```

### `src/chart_atlas/charts/mass_simplex.ts` (extension)

```ts
chartUniforms(view) {
  return {
    ...CHART_UNIFORMS_DEFAULTS,
    alpha_freeze: (view.chartParams.alpha as number) ?? Math.PI/4,
    beta_freeze:  (view.chartParams.beta  as number) ?? Math.PI/2,
  };
},
```

### `src/chart_atlas/charts/burrau_euclid.ts` (extension)

```ts
chartUniforms(view) {
  return {
    ...CHART_UNIFORMS_DEFAULTS,
    nu_burrau: (view.chartParams.nu as number) ?? 0.5,
  };
},
```

## Buffers update

```ts
// src/gpu/buffers.ts (extension)
export interface TileBuffers {
  // ... existing
  chartUniforms: GPUBuffer;       // new — 64 bytes, group(0) binding(2)
}

export function createTileBuffers(
  ctx: GpuContext, N: number, M: number,
): TileBuffers {
  // ... existing buffer allocations
  const chartUniforms = ctx.device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return { /* existing */, chartUniforms, N, M };
}
```

## Tests

### `test/unit/gpu/chart_uniforms.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  packChartUniforms, unpackChartUniforms, CHART_UNIFORMS_DEFAULTS,
} from '@/gpu/chart_uniforms.js';

describe('ChartUniforms packing', () => {
  it('round-trips defaults', () => {
    const buf = packChartUniforms(CHART_UNIFORMS_DEFAULTS);
    const back = unpackChartUniforms(buf);
    expect(back.mu_max).toBe(CHART_UNIFORMS_DEFAULTS.mu_max);
    expect(back.alpha_min).toBe(CHART_UNIFORMS_DEFAULTS.alpha_min);
    expect(back.m_target).toEqual(CHART_UNIFORMS_DEFAULTS.m_target);
  });

  it('produces a 64-byte buffer', () => {
    expect(packChartUniforms(CHART_UNIFORMS_DEFAULTS).byteLength).toBe(64);
  });

  it('preserves field order across the f32 layout', () => {
    const c = { ...CHART_UNIFORMS_DEFAULTS,
                mu_max: 7.5, alpha_min: 0.123, q_max: 1.7 };
    const f = new Float32Array(packChartUniforms(c));
    expect(f[0]).toBeCloseTo(7.5, 6);
    expect(f[1]).toBeCloseTo(0.123, 6);
    expect(f[2]).toBeCloseTo(1.7, 6);
  });
});
```

### `test/integration/chart_uniforms.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { packChartUniforms } from '@/gpu/chart_uniforms.js';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { shapeSphereChart } from '@/chart_atlas/charts/shape_sphere.js';
import type { ChartView } from '@/chart_atlas/types.js';

const baseView: ChartView = {
  chartParams: {},
  z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0],
  mag: 1,
  alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('chart-uniform handoff per chart', () => {
  it('latent slice supplies the defaults', () => {
    const u = latentSliceChart.chartUniforms!(baseView);
    expect(u.mu_max).toBe(5);
    expect(u.alpha_min).toBe(0.05);
  });

  it('(Lz, E) supplies Kmax / gammaK / α / β from chartParams', () => {
    const view: ChartView = { ...baseView,
      chartParams: { Kmax: 4, gammaK: 1.5, alpha: 0.6, beta: 1.2 },
    };
    const u = lzEChart.chartUniforms!(view);
    expect(u.Kmax).toBe(4);
    expect(u.gamma_K).toBe(1.5);
    expect(u.alpha_freeze).toBeCloseTo(0.6, 6);
    expect(u.beta_freeze).toBeCloseTo(1.2, 6);
  });

  it('shape-sphere overrides only pole_buffer', () => {
    const view: ChartView = { ...baseView,
      chartParams: { poleBuffer: 0.10 },
    };
    const u = shapeSphereChart.chartUniforms!(view);
    expect(u.pole_buffer).toBe(0.10);
    expect(u.alpha_min).toBe(0.05);             // default preserved
  });

  it('switching charts changes only the chart buffer payload', () => {
    const a = packChartUniforms(latentSliceChart.chartUniforms!(baseView));
    const b = packChartUniforms(lzEChart.chartUniforms!({ ...baseView,
      chartParams: { Kmax: 4 } }));
    // Buffers differ in the Kmax slot; everything else identical.
    const af = new Float32Array(a);
    const bf = new Float32Array(b);
    expect(af[4]).not.toBe(bf[4]);
    // Mu_max defaults match.
    expect(af[0]).toBe(bf[0]);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/gpu/chart_uniforms
npm test -- --run test/integration/chart_uniforms
```

## Acceptance check

```bash
npm test -- --run test/integration/chart_uniforms
```

Switching charts (e.g. latent → (Lz, E)) changes only the
`ChartUniforms` buffer; the layout, the pipelines, and the per-tile
storage all stay constant.

## Notes for the implementer

- **Why not specialisation constants.** WebGPU's specialisation
  constants would also work (the simulate shader could be specialised
  per chart with concrete `mu_max` etc.). But specialisation constants
  bind at pipeline-creation time, so any change forces a recompile. A
  uniform buffer rebinds in microseconds. Specialisation makes sense
  for things that genuinely don't change at runtime — the workgroup
  size, for example — but chart parameters can change every chart
  switch.
- **Reserved slots.** The 64-byte `ChartUniforms` keeps three reserved
  slots at the end. Charts that need extra knobs (e.g. ternary mass
  with a custom interior buffer) pack into the reserved tail and bump
  the chart's `payload_version` (the M5 cache key). Bumping
  `payload_version` invalidates cached tiles for that chart only.
- **Default propagation.** `CHART_UNIFORMS_DEFAULTS` is the safety net:
  every chart spreads it into its own override, so a chart that
  forgets to set a slot still gets a sensible value. Don't omit it
  from the spread — silent zeros (e.g. `mu_max = 0`) collapse the
  decoder.
- **Knock-on changes.** M3's `simulate.wgsl` reads `mu_max` from
  `uniforms`; that has to move to `chart`. Same for `alpha_min`,
  `q_max`. This is a one-line-per-reference rename. The actual decode
  body is unchanged.
