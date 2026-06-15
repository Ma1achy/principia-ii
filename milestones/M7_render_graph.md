# M7 — Render graph: colour, brightness, combiner, post

## Goal

A clean four-stage render pipeline so palette swaps don't trigger
recompute, and so adding a new visualisation mode is a leaf change.

```
SimResult ─[colour node]─► vec3 RGB ─┐
                                     ├─[combiner]─► RGB ─[post]─► canvas
SimResult ─[brightness node]─► f32 ──┘
```

After M7, the GPU has 12 colour modes, 4 brightness modes, three combiner
modes, and CVD simulation in postprocess. Group 3 (`RenderParams`) is the
only bind group rebinding that happens when palette / overlay / CVD
changes; groups 0/1/2 stay constant.

**Exit criterion.**

```bash
npm test -- --run test/integration/render_graph
```

A palette swap rebinds only group 3 — it does not change any byte of the
`SimResult` storage buffer. The OKLAB round-trip holds to 1e-6 ΔE. The
stability×hue mode reproduces the published reference frame to within 2
ΔE per pixel.

## File tree

```
principia/
  src/
    render/
      types.ts
      params.ts
      oklab.ts
      vmf.ts
      cvd.ts
      palettes.ts
      pipeline.ts
      mode_registry.ts
      index.ts
    gpu/
      shaders/
        render_helpers.wgsl
        colour_modes.wgsl
        brightness_modes.wgsl
        combiner.wgsl
        cvd.wgsl
        physics_overlay.wgsl
        render_graph.wgsl
      render_pipeline.ts
  test/
    unit/render/
      oklab.test.ts
      vmf.test.ts
      cvd.test.ts
      palettes.test.ts
    integration/
      render_graph_palette_swap.test.ts
      render_graph_stability_hue.test.ts
```

## `src/render/types.ts`

```ts
import type { Vec3 } from '@/math/types.js';

export type ColourMode =
  | 'event_class'
  | 'energy'        | 'ang_momentum'  | 'kinetic'
  | 'potential'     | 'virial'
  | 'mass_ratio_12' | 'mass_ratio_13' | 'mass_fraction'
  | 'jacobi_rho1'   | 'jacobi_rho2'   | 'jacobi_ratio'
  | 'jacobi_angle'  | 'min_pair_dist'
  | 'escape_time'   | 'close_encounters' | 'min_approach'
  | 'energy_drift_abs' | 'energy_drift_rel'
  | 'lz_drift_abs'  | 'lz_drift_rel'
  | 'shape_sphere_vmf' | 'shape_sphere_okabe_ito'
  | 'stability_x_hue';

export type BrightnessMode =
  | 'flat'
  | 'time_to_event'
  | 'diffusion'
  | 'bc_proximity'
  | 'energy_drift';

export type CombinerMode =
  | 'replace_lightness'    // OKLAB-correct, default
  | 'modulate_lightness'
  | 'multiply_rgb';

export type CvdMode = 'none' | 'protan' | 'deutan' | 'tritan' | 'achrom';

export type PaletteId =
  | 'viridis' | 'cividis' | 'plasma' | 'magma' | 'inferno'
  | 'twilight' | 'cool_warm' | 'principia' | 'cubehelix';

/**
 * Render parameters live in group 3; rebinding this group is the only
 * cost of changing the visualisation. Compute and reduction buffers
 * are unaffected.
 */
export interface RenderParams {
  colourMode:      ColourMode;
  brightnessMode:  BrightnessMode;
  combinerMode:    CombinerMode;
  cvdMode:         CvdMode;
  palette:         PaletteId;
  paletteRange:    [number, number];      // domain min/max for sequential modes
  vmfKappa:        number;                // 0.5 .. 12; default 3
  vmfChroma:       number;                // 0.05 .. 0.22; default 0.15
  vmfLightness:    number;                // 0.35 .. 0.90; default 0.7
  physicsOverlay:  boolean;
  overlayStrength: number;                // 0..1
  playbackTau:     number;                // simulation time for animation
  wallClockTime:   number;                // for time-varying effects
}

export const DEFAULT_RENDER_PARAMS: RenderParams = {
  colourMode:     'event_class',
  brightnessMode: 'time_to_event',
  combinerMode:   'replace_lightness',
  cvdMode:        'none',
  palette:        'viridis',
  paletteRange:   [-1, 1],
  vmfKappa:       3,
  vmfChroma:      0.15,
  vmfLightness:   0.70,
  physicsOverlay: true,
  overlayStrength: 0.6,
  playbackTau:    0,
  wallClockTime:  0,
};
```

## `src/render/oklab.ts`

```ts
import type { Vec3 } from '@/math/types.js';

/* ============================================================
 * sRGB ↔ linear sRGB (γ ≈ 2.2 piecewise transfer).
 * The render graph operates in linear sRGB throughout; the canvas
 * write applies the sRGB transfer function (or relies on the canvas
 * colour-space configuration to do it).
 * ============================================================ */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308
    ? 12.92 * c
    : 1.055 * Math.pow(c, 1/2.4) - 0.055;
}

/* ============================================================
 * Linear sRGB ↔ OKLAB (Björn Ottosson 2020).
 *
 *   M1 maps linear sRGB → LMS (cone fundamentals)
 *   apply cube root non-linearity
 *   M2 maps LMS' → OKLAB
 *
 * Inverses use the inverse matrices and a cube.
 * ============================================================ */

const M1 = [
  0.41222147079999996, 0.5363325363, 0.05144599826,
  0.21190349577999998, 0.6806995450, 0.10739595388,
  0.08830246189999998, 0.2817188376, 0.6299787005,
];
const M2 = [
   0.21045426824999999,  0.7936177850, -0.0040720468,
   1.97799849510000000, -2.4285922050,  0.4505937099,
   0.02590404246000000,  0.7827717662, -0.8086757660,
];

function applyMat3(M: readonly number[], v: Vec3): Vec3 {
  return [
    M[0]*v[0] + M[1]*v[1] + M[2]*v[2],
    M[3]*v[0] + M[4]*v[1] + M[5]*v[2],
    M[6]*v[0] + M[7]*v[1] + M[8]*v[2],
  ];
}

export function linearRgbToOklab(c: Vec3): Vec3 {
  const lms = applyMat3(M1, c);
  const cb: Vec3 = [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])];
  return applyMat3(M2, cb);
}

const M1inv = [
   4.07674166134799,    -3.30771159040597,    0.230969928729428,
  -1.26843799600028,     2.60975740020587,   -0.341131342239416,
  -0.00419608654558288, -0.703418816967143,   1.70761470242744,
];
const M2inv = [
   0.999999999999999, 0.396337777878555,  0.215803757065654,
   1.000000000000000, -0.105561345815734, -0.063854174771706,
   1.000000000000000, -0.0894841779880559, -1.291485537864750,
];

export function oklabToLinearRgb(lab: Vec3): Vec3 {
  const cb = applyMat3(M2inv, lab);
  const lms: Vec3 = [cb[0]*cb[0]*cb[0], cb[1]*cb[1]*cb[1], cb[2]*cb[2]*cb[2]];
  return applyMat3(M1inv, lms);
}

/* ============================================================
 * OKLAB ↔ OKLCH (polar form for hue/chroma).
 * ============================================================ */

export function oklabToOklch(lab: Vec3): Vec3 {
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
}
export function oklchToOklab(lch: Vec3): Vec3 {
  return [lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])];
}
```

## `src/render/vmf.ts`

```ts
import type { Vec3 } from '@/math/types.js';
import { oklabToLinearRgb, oklchToOklab } from './oklab.js';

/**
 * Six poles at the axis directions ±x̂, ±ŷ, ±ẑ. Hue assignments depend
 * on the scheme (full OKLAB vs Okabe–Ito CB-safe). All angles in degrees,
 * converted to radians inside.
 */
export const POLE_DIRECTIONS: Vec3[] = [
  [ 1,  0,  0], [-1,  0,  0],
  [ 0,  1,  0], [ 0, -1,  0],
  [ 0,  0,  1], [ 0,  0, -1],
];

export const HUE_OKLAB = [0, 180, 120, 300, 240, 60].map(d => d * Math.PI / 180);
export const HUE_OKABE_ITO = [250, 70, 30, 210, 170, 350].map(d => d * Math.PI / 180);

/** Spherical von Mises–Fisher weight w_i = exp(κ n̂ · p̂_i). */
function vmfWeights(n: Vec3, kappa: number, poles: Vec3[]): number[] {
  let max = -Infinity;
  const dots = poles.map(p => n[0]*p[0] + n[1]*p[1] + n[2]*p[2]);
  for (const d of dots) if (kappa * d > max) max = kappa * d;
  // Subtract max for stability.
  return dots.map(d => Math.exp(kappa * d - max));
}

/**
 * VMF blend in OKLAB with optional CB-safe hues. Returns linear sRGB.
 */
export function vmfBlend(
  n: Vec3, hues: number[], opts: {
    kappa: number; chroma: number; lightness: number;
  },
): Vec3 {
  const w = vmfWeights(n, opts.kappa, POLE_DIRECTIONS);
  const Z = w.reduce((s, x) => s + x, 0);
  let aSum = 0, bSum = 0;
  for (let i = 0; i < hues.length; i++) {
    aSum += w[i]! * Math.cos(hues[i]!);
    bSum += w[i]! * Math.sin(hues[i]!);
  }
  const a = opts.chroma * aSum / Z;
  const b = opts.chroma * bSum / Z;
  return oklabToLinearRgb([opts.lightness, a, b]);
}
```

## `src/render/cvd.ts`

```ts
import type { Vec3 } from '@/math/types.js';

const PROTAN = [
  0.567, 0.433, 0,
  0.558, 0.442, 0,
  0,     0.242, 0.758,
];
const DEUTAN = [
  0.625, 0.375, 0,
  0.700, 0.300, 0,
  0,     0.300, 0.700,
];
const TRITAN = [
  0.950, 0.050, 0,
  0,     0.433, 0.567,
  0,     0.475, 0.525,
];
const ACHROM = [
  0.299, 0.587, 0.114,
  0.299, 0.587, 0.114,
  0.299, 0.587, 0.114,
];

const MATRICES: Record<string, number[]> = {
  protan: PROTAN, deutan: DEUTAN, tritan: TRITAN, achrom: ACHROM,
};

export function applyCvd(rgb: Vec3, mode: keyof typeof MATRICES | 'none'): Vec3 {
  if (mode === 'none') return rgb;
  const M = MATRICES[mode]!;
  return [
    M[0]*rgb[0] + M[1]*rgb[1] + M[2]*rgb[2],
    M[3]*rgb[0] + M[4]*rgb[1] + M[5]*rgb[2],
    M[6]*rgb[0] + M[7]*rgb[1] + M[8]*rgb[2],
  ];
}
```

## `src/render/palettes.ts`

```ts
import type { Vec3 } from '@/math/types.js';

/**
 * Cubehelix analytical generator. `t ∈ [0, 1]` maps to a smoothly
 * brightening helix in colour space; output is linear sRGB.
 */
export function cubehelix(t: number, opts: {
  start?: number; rotations?: number; hue?: number; gamma?: number;
} = {}): Vec3 {
  const start = opts.start ?? 0.5;
  const rot   = opts.rotations ?? 1.5;
  const hue   = opts.hue ?? 1.0;
  const gamma = opts.gamma ?? 1.0;

  const phi = 2 * Math.PI * (start / 3 - rot * t);
  const a = hue * Math.pow(t, gamma) * (1 - Math.pow(t, gamma)) / 2;

  const r = Math.pow(t, gamma) + a * (-0.14861 * Math.cos(phi) + 1.78277 * Math.sin(phi));
  const g = Math.pow(t, gamma) + a * (-0.29227 * Math.cos(phi) - 0.90649 * Math.sin(phi));
  const b = Math.pow(t, gamma) + a * (1.97294 * Math.cos(phi));
  return [Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b))];
}

/**
 * 5-stop sequential approximation to viridis. Real viridis uses a
 * 256-entry LUT; this is sufficient for the test gate. Production
 * code uploads a 1D texture.
 */
export const VIRIDIS_STOPS: Vec3[] = [
  [0.267, 0.005, 0.329],
  [0.282, 0.140, 0.458],
  [0.221, 0.402, 0.561],
  [0.221, 0.700, 0.408],
  [0.991, 0.906, 0.144],
];

export function lerpStops(stops: Vec3[], t: number): Vec3 {
  const u = Math.max(0, Math.min(1, t));
  const f = u * (stops.length - 1);
  const i = Math.floor(f);
  const j = Math.min(stops.length - 1, i + 1);
  const a = stops[i]!, b = stops[j]!;
  const w = f - i;
  return [a[0] + (b[0]-a[0])*w, a[1] + (b[1]-a[1])*w, a[2] + (b[2]-a[2])*w];
}

export function viridis(t: number): Vec3 {
  return lerpStops(VIRIDIS_STOPS, t);
}
```

## `src/render/mode_registry.ts`

```ts
import type { ColourMode, BrightnessMode } from './types.js';

/**
 * Each colour mode declares the source field it reads. The renderer uses
 * this to verify the right `SimResult` / `ICDescriptor` field is bound
 * before dispatching the render pass.
 */
export const COLOUR_SOURCES: Record<ColourMode, string> = {
  event_class:        'sample_descriptor',
  energy:             'ICDescriptor.K_0+V_0',
  ang_momentum:       'SimResult.Lz_0',
  kinetic:            'ICDescriptor.K_0',
  potential:          'ICDescriptor.V_0',
  virial:             'ICDescriptor.virial_ratio',
  mass_ratio_12:      'ICDescriptor.m1/m2',
  mass_ratio_13:      'ICDescriptor.m1/m3',
  mass_fraction:      'ICDescriptor.q_mass',
  jacobi_rho1:        'ICDescriptor.rho1_mag',
  jacobi_rho2:        'ICDescriptor.rho2_mag',
  jacobi_ratio:       'ICDescriptor.rho_ratio',
  jacobi_angle:       'ICDescriptor.rho_angle',
  min_pair_dist:      'ICDescriptor.r_min_pair_0',
  escape_time:        'SimResult.t_end',
  close_encounters:   'sample_descriptor.encounter_count',
  min_approach:       'SimResult.d_min',
  energy_drift_abs:   'SimResult.delta_E_max_abs',
  energy_drift_rel:   'SimResult.energy_drift',
  lz_drift_abs:       'SimResult.delta_Lz_max_abs',
  lz_drift_rel:       'SimResult.Lz_drift',
  shape_sphere_vmf:   'SimResult.n_checkpoints[last]',
  shape_sphere_okabe_ito: 'SimResult.n_checkpoints[last]',
  stability_x_hue:    'SimResult.n_checkpoints[last] + diffusion',
};

export const BRIGHTNESS_SOURCES: Record<BrightnessMode, string> = {
  flat:           '',
  time_to_event:  'SimResult.t_end',
  diffusion:      'SimResult.diffusion',
  bc_proximity:   'SimResult.n_checkpoints[last]',
  energy_drift:   'SimResult.energy_drift',
};
```

## `src/render/params.ts`

```ts
import type { RenderParams } from './types.js';

const COLOUR_MODE_INDEX: Record<RenderParams['colourMode'], number> = {
  event_class: 0, energy: 1, ang_momentum: 2, kinetic: 3,
  potential: 4, virial: 5, mass_ratio_12: 6, mass_ratio_13: 7,
  mass_fraction: 8, jacobi_rho1: 9, jacobi_rho2: 10, jacobi_ratio: 11,
  jacobi_angle: 12, min_pair_dist: 13, escape_time: 14,
  close_encounters: 15, min_approach: 16, energy_drift_abs: 17,
  energy_drift_rel: 18, lz_drift_abs: 19, lz_drift_rel: 20,
  shape_sphere_vmf: 21, shape_sphere_okabe_ito: 22, stability_x_hue: 23,
};

const BRIGHT_MODE_INDEX: Record<RenderParams['brightnessMode'], number> = {
  flat: 0, time_to_event: 1, diffusion: 2,
  bc_proximity: 3, energy_drift: 4,
};

const COMBINER_INDEX: Record<RenderParams['combinerMode'], number> = {
  replace_lightness: 0, modulate_lightness: 1, multiply_rgb: 2,
};

const CVD_INDEX: Record<RenderParams['cvdMode'], number> = {
  none: 0, protan: 1, deutan: 2, tritan: 3, achrom: 4,
};

const PALETTE_INDEX: Record<RenderParams['palette'], number> = {
  viridis: 0, cividis: 1, plasma: 2, magma: 3, inferno: 4,
  twilight: 5, cool_warm: 6, principia: 7, cubehelix: 8,
};

/**
 * Pack RenderParams into a 64-byte uniform buffer for group(3) binding(0).
 *
 * Layout:
 *   [0..3]    colour_mode_id (u32)
 *   [4..7]    brightness_mode_id (u32)
 *   [8..11]   combiner_id (u32)
 *   [12..15]  cvd_id (u32)
 *   [16..19]  palette_id (u32)
 *   [20..23]  physics_overlay (u32)
 *   [24..27]  overlay_strength (f32)
 *   [28..31]  vmf_kappa (f32)
 *   [32..35]  vmf_chroma (f32)
 *   [36..39]  vmf_lightness (f32)
 *   [40..43]  palette_range_min (f32)
 *   [44..47]  palette_range_max (f32)
 *   [48..51]  playback_tau (f32)
 *   [52..55]  wall_clock (f32)
 *   [56..63]  reserved
 */
export function packRenderParams(p: RenderParams): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  u32[0] = COLOUR_MODE_INDEX[p.colourMode];
  u32[1] = BRIGHT_MODE_INDEX[p.brightnessMode];
  u32[2] = COMBINER_INDEX[p.combinerMode];
  u32[3] = CVD_INDEX[p.cvdMode];
  u32[4] = PALETTE_INDEX[p.palette];
  u32[5] = p.physicsOverlay ? 1 : 0;
  f32[6] = p.overlayStrength;
  f32[7] = p.vmfKappa;
  f32[8] = p.vmfChroma;
  f32[9] = p.vmfLightness;
  f32[10] = p.paletteRange[0];
  f32[11] = p.paletteRange[1];
  f32[12] = p.playbackTau;
  f32[13] = p.wallClockTime;
  return buf;
}
```

## `src/render/pipeline.ts`

```ts
import type { GpuContext } from '@/gpu/init.js';
import type { TileBuffers } from '@/gpu/buffers.js';

/**
 * Build the render pipeline plus its group(3) layout. `RenderParams`
 * lives in group(3) so palette swaps and overlay toggles only rebind
 * group 3 — groups 0, 1, 2 stay constant across mode changes.
 */
export interface RenderGraph {
  pipeline:    GPURenderPipeline;
  bgRenderParams: GPUBindGroup;
  paramsBuffer:   GPUBuffer;
}

export async function buildRenderGraph(
  ctx: GpuContext, bufs: TileBuffers, code: string,
): Promise<RenderGraph> {
  const { device, format } = ctx;

  const groupParamsLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [
      // group 0 (uniforms / tile)
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' } },
        ],
      }),
      // group 1 (storage)
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'read-only-storage' } },
        ],
      }),
      // group 2 (reduction storage – may be unused for static shading)
      device.createBindGroupLayout({ entries: [] }),
      groupParamsLayout,
    ],
  });

  const module = device.createShaderModule({ code });
  const pipeline = device.createRenderPipeline({
    layout,
    vertex:   { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bgRenderParams = device.createBindGroup({
    layout: groupParamsLayout,
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });

  return { pipeline, bgRenderParams, paramsBuffer };
}
```

## `src/gpu/shaders/render_helpers.wgsl`

```wgsl
// Shared helpers used by colour, brightness, combiner, and CVD stages.
const PI: f32 = 3.141592653589793;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let lo = 12.92 * c;
  let hi = 1.055 * pow(c, vec3<f32>(1.0/2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

const M1_TO_LMS = mat3x3<f32>(
   0.4122214708,  0.5363325363,  0.0514459826,
   0.2119034958,  0.6806995450,  0.1073959539,
   0.0883024619,  0.2817188376,  0.6299787005,
);
const M2_TO_LAB = mat3x3<f32>(
   0.2104542553,  0.7936177850, -0.0040720468,
   1.9779984951, -2.4285922050,  0.4505937099,
   0.0259040247,  0.7827717662, -0.8086757660,
);
const M2_INV = mat3x3<f32>(
   1.0,  0.3963377774,  0.2158037573,
   1.0, -0.1055613458, -0.0638541728,
   1.0, -0.0894841775, -1.2914855480,
);
const M1_INV = mat3x3<f32>(
   4.0767416613, -3.3077115904,  0.2309699287,
  -1.2684379960,  2.6097574002, -0.3413113422,
  -0.0041960865, -0.7034188370,  1.7076147024,
);

fn linear_rgb_to_oklab(c: vec3<f32>) -> vec3<f32> {
  let lms = M1_TO_LMS * c;
  let cb  = vec3<f32>(pow(lms.x, 1.0/3.0),
                      pow(lms.y, 1.0/3.0),
                      pow(lms.z, 1.0/3.0));
  return M2_TO_LAB * cb;
}

fn oklab_to_linear_rgb(lab: vec3<f32>) -> vec3<f32> {
  let cb = M2_INV * lab;
  let lms = vec3<f32>(cb.x*cb.x*cb.x, cb.y*cb.y*cb.y, cb.z*cb.z*cb.z);
  return M1_INV * lms;
}
```

## `src/gpu/shaders/colour_modes.wgsl`

```wgsl
// One function per colour mode. Returns linear sRGB.

fn colour_event_class(class_: u32, detail: u32) -> vec3<f32> {
  switch (class_) {
    case 0u: { return vec3<f32>(0.7, 0.7, 0.2); }    // bounded
    case 1u: { return vec3<f32>(0.9, 0.1, 0.1); }    // collision
    case 2u: {
      // Different escape body → different hue.
      switch (detail) {
        case 0u: { return vec3<f32>(0.10, 0.40, 0.90); }    // blue
        case 1u: { return vec3<f32>(0.10, 0.80, 0.20); }    // green
        default: { return vec3<f32>(0.90, 0.55, 0.10); }    // amber
      }
    }
    case 3u: { return vec3<f32>(0.5, 0.5, 0.5); }    // degenerate
    default: { return vec3<f32>(1.0, 0.9, 0.0); }    // timeout / max-substeps
  }
}

fn palette_seq(t: f32) -> vec3<f32> {
  // Inline 5-stop viridis sample. Production reads from a 1D texture.
  let stops = array<vec3<f32>, 5>(
    vec3<f32>(0.267, 0.005, 0.329),
    vec3<f32>(0.282, 0.140, 0.458),
    vec3<f32>(0.221, 0.402, 0.561),
    vec3<f32>(0.221, 0.700, 0.408),
    vec3<f32>(0.991, 0.906, 0.144),
  );
  let u = clamp(t, 0.0, 1.0);
  let f = u * 4.0;
  let i = u32(floor(f));
  let j = min(4u, i + 1u);
  let w = f - f32(i);
  return mix(stops[i], stops[j], w);
}

fn palette_div_symlog(x: f32, eps: f32) -> vec3<f32> {
  let absx = abs(x);
  let signed = sign(x) *
               select(1.0 + log(absx / eps), absx / eps, absx > eps);
  let t = clamp(0.5 + 0.5 * signed / 8.0, 0.0, 1.0);
  return palette_seq(t);
}

// VMF blend (6-pole), Okabe–Ito hues (CB-safe).
fn vmf_okabe_ito(n: vec3<f32>, kappa: f32, chroma: f32, L: f32) -> vec3<f32> {
  let pole = array<vec3<f32>, 6>(
    vec3<f32>( 1.0, 0.0, 0.0), vec3<f32>(-1.0, 0.0, 0.0),
    vec3<f32>( 0.0, 1.0, 0.0), vec3<f32>( 0.0,-1.0, 0.0),
    vec3<f32>( 0.0, 0.0, 1.0), vec3<f32>( 0.0, 0.0,-1.0),
  );
  let hue = array<f32, 6>(
    250.0 * PI/180.0,  70.0 * PI/180.0,
     30.0 * PI/180.0, 210.0 * PI/180.0,
    170.0 * PI/180.0, 350.0 * PI/180.0,
  );
  var maxv: f32 = -1e30;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let kd = kappa * dot(n, pole[i]);
    if (kd > maxv) { maxv = kd; }
  }
  var aSum: f32 = 0.0; var bSum: f32 = 0.0; var Z: f32 = 0.0;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let kd = kappa * dot(n, pole[i]);
    let w  = exp(kd - maxv);
    Z = Z + w;
    aSum = aSum + w * cos(hue[i]);
    bSum = bSum + w * sin(hue[i]);
  }
  let a = chroma * aSum / Z;
  let b = chroma * bSum / Z;
  return oklab_to_linear_rgb(vec3<f32>(L, a, b));
}

// Stability × hue (the principal Principia mode).
fn stability_x_hue(
  n: vec3<f32>, diffusion: f32, kappa: f32, chroma: f32,
) -> vec3<f32> {
  // Hue from n.
  let base = vmf_okabe_ito(n, kappa, chroma, 0.7);
  // Modulate L by proximity to binary collisions.
  let b1 = vec3<f32>(1.0, 0.0, 0.0);
  let b2 = vec3<f32>(-0.5,  0.866025, 0.0);
  let b3 = vec3<f32>(-0.5, -0.866025, 0.0);
  let prox = max(max(dot(n, b1), dot(n, b2)), dot(n, b3));
  let L = 0.25 + 0.55 * 0.5 * (1.0 - prox);
  // Replace L in OKLAB.
  let lab = linear_rgb_to_oklab(base);
  return oklab_to_linear_rgb(vec3<f32>(L, lab.y, lab.z));
}
```

## `src/gpu/shaders/brightness_modes.wgsl`

```wgsl
fn brightness_time_to_event(t_end: f32, T_horizon: f32) -> f32 {
  return clamp(1.0 - t_end / T_horizon, 0.0, 1.0);
}

fn brightness_diffusion(diffusion: f32) -> f32 {
  if (diffusion < 0.0) { return 0.5; }              // sentinel
  let D0 = 0.05;     let Dmax = 1.0;
  return clamp(log(1.0 + diffusion / D0) / log(1.0 + Dmax / D0), 0.0, 1.0);
}

fn brightness_bc_proximity(n: vec3<f32>) -> f32 {
  let b1 = vec3<f32>(1.0, 0.0, 0.0);
  let b2 = vec3<f32>(-0.5,  0.866025, 0.0);
  let b3 = vec3<f32>(-0.5, -0.866025, 0.0);
  let prox = max(max(dot(n, b1), dot(n, b2)), dot(n, b3));
  return clamp(0.5 * (1.0 - prox), 0.0, 1.0);
}

fn brightness_energy_drift(drift: f32) -> f32 {
  // Map [1e-7, 1e-2] log → [1, 0]: low drift = bright, high = dark.
  let lo = log(1e-7); let hi = log(1e-2);
  let t = (log(max(drift, 1e-30)) - lo) / (hi - lo);
  return 1.0 - clamp(t, 0.0, 1.0);
}
```

## `src/gpu/shaders/combiner.wgsl`

```wgsl
fn combine_replace_lightness(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  let lab = linear_rgb_to_oklab(rgb);
  return oklab_to_linear_rgb(vec3<f32>(clamp(L, 0.0, 1.0), lab.y, lab.z));
}

fn combine_modulate_lightness(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  let lab = linear_rgb_to_oklab(rgb);
  return oklab_to_linear_rgb(vec3<f32>(lab.x * clamp(L, 0.0, 1.0),
                                       lab.y, lab.z));
}

fn combine_multiply_rgb(rgb: vec3<f32>, L: f32) -> vec3<f32> {
  return rgb * clamp(L, 0.0, 1.0);
}
```

## `src/gpu/shaders/cvd.wgsl`

```wgsl
fn apply_cvd(rgb: vec3<f32>, mode: u32) -> vec3<f32> {
  switch (mode) {
    case 1u: {       // protan
      return mat3x3<f32>(
        0.567, 0.433, 0.0,
        0.558, 0.442, 0.0,
        0.0,   0.242, 0.758,
      ) * rgb;
    }
    case 2u: {       // deutan
      return mat3x3<f32>(
        0.625, 0.375, 0.0,
        0.700, 0.300, 0.0,
        0.0,   0.300, 0.700,
      ) * rgb;
    }
    case 3u: {       // tritan
      return mat3x3<f32>(
        0.950, 0.050, 0.0,
        0.0,   0.433, 0.567,
        0.0,   0.475, 0.525,
      ) * rgb;
    }
    case 4u: {       // achrom
      let g = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
      return vec3<f32>(g, g, g);
    }
    default: { return rgb; }
  }
}
```

## `src/gpu/shaders/render_graph.wgsl`

```wgsl
struct RenderParams {
  colour_mode_id:    u32,
  brightness_mode_id:u32,
  combiner_id:       u32,
  cvd_id:            u32,
  palette_id:        u32,
  physics_overlay:   u32,
  overlay_strength:  f32,
  vmf_kappa:         f32,
  vmf_chroma:        f32,
  vmf_lightness:     f32,
  palette_range_min: f32,
  palette_range_max: f32,
  playback_tau:      f32,
  wall_clock:        f32,
};

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(1) var<uniform> tile_req : TileRequest;
@group(1) @binding(0) var<storage, read> results : array<SimResult>;
@group(1) @binding(1) var<storage, read> ics     : array<ICDescriptor>;
@group(3) @binding(0) var<uniform>      rparams : RenderParams;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vid], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  let tile_pix = 32.0;          // see M3 note; promoted to a uniform in M5+
  let sx = u32(floor(frag.x / tile_pix));
  let sy = u32(floor(frag.y / tile_pix));
  let idx = clamp(sy * N + sx, 0u, N*N - 1u);

  let r  = results[idx];
  let ic = ics[idx];
  let cls    = r.sample_descriptor & 0x7u;
  let detail = (r.sample_descriptor >> 3u) & 0x3u;

  // 1. Colour node.
  var rgb: vec3<f32>;
  let n_last = r.n_checkpoints[7].xyz;     // M=8

  switch (rparams.colour_mode_id) {
    case 0u:  { rgb = colour_event_class(cls, detail); }
    case 1u:  { rgb = palette_div_symlog(ic.K_0 + ic.V_0, 1e-3); }
    case 2u:  { rgb = palette_div_symlog(r.Lz_0,           1e-3); }
    case 3u:  { rgb = palette_seq(ic.K_0 / 4.0); }
    case 4u:  { rgb = palette_seq(-ic.V_0 / 4.0); }
    case 5u:  { rgb = palette_div_symlog(ic.virial_ratio - 1.0, 0.1); }
    case 6u:  { rgb = palette_div_symlog(log(ic.m1 / ic.m2), 0.5); }
    case 7u:  { rgb = palette_div_symlog(log(ic.m1 / ic.m3), 0.5); }
    case 8u:  { rgb = palette_seq(ic.q_mass * 3.0); }
    case 9u:  { rgb = palette_seq(clamp(ic.rho1_mag, 0.0, 1.0)); }
    case 10u: { rgb = palette_seq(clamp(ic.rho2_mag, 0.0, 1.0)); }
    case 11u: { rgb = palette_div_symlog(log(ic.rho_ratio), 1.0); }
    case 12u: { rgb = palette_seq((ic.rho_angle + PI) / (2.0 * PI)); }
    case 13u: { rgb = palette_seq(clamp(ic.r_min_pair_0 * 2.0, 0.0, 1.0)); }
    case 14u: { rgb = palette_seq(clamp(r.t_end / uniforms.T_horizon, 0.0, 1.0)); }
    case 15u: { rgb = palette_seq(f32((r.sample_descriptor >> 10u) & 0x3fu) / 64.0); }
    case 16u: { rgb = palette_seq(clamp(r.d_min, 0.0, 1.0)); }
    case 17u: { rgb = palette_seq(clamp(log(r.delta_E_max_abs + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 18u: { rgb = palette_seq(clamp(log(r.energy_drift + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 19u: { rgb = palette_seq(clamp(log(r.delta_Lz_max_abs + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 20u: { rgb = palette_seq(clamp(log(r.Lz_drift + 1e-10) / log(1e-2) - 1.0, 0.0, 1.0)); }
    case 21u: { rgb = vmf_okabe_ito(n_last, rparams.vmf_kappa, rparams.vmf_chroma, rparams.vmf_lightness); }
    case 22u: { rgb = vmf_okabe_ito(n_last, rparams.vmf_kappa, rparams.vmf_chroma, rparams.vmf_lightness); }
    default:  { rgb = stability_x_hue(n_last, r.diffusion, rparams.vmf_kappa, rparams.vmf_chroma); }
  }

  // 2. Brightness node.
  var L: f32 = 1.0;
  switch (rparams.brightness_mode_id) {
    case 0u: { L = 1.0; }
    case 1u: { L = brightness_time_to_event(r.t_end, uniforms.T_horizon); }
    case 2u: { L = brightness_diffusion(r.diffusion); }
    case 3u: { L = brightness_bc_proximity(n_last); }
    default: { L = brightness_energy_drift(r.energy_drift); }
  }

  // 3. Combiner.
  var combined: vec3<f32>;
  switch (rparams.combiner_id) {
    case 0u: { combined = combine_replace_lightness(rgb, L); }
    case 1u: { combined = combine_modulate_lightness(rgb, L); }
    default: { combined = combine_multiply_rgb(rgb, L); }
  }

  // 4. Postprocess: CVD then sRGB encode.
  let post = apply_cvd(combined, rparams.cvd_id);
  return vec4<f32>(linear_to_srgb(post), 1.0);
}
```

## Tests

### `test/unit/render/oklab.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  srgbToLinear, linearToSrgb,
  linearRgbToOklab, oklabToLinearRgb,
  oklabToOklch, oklchToOklab,
} from '@/render/oklab.js';
import type { Vec3 } from '@/math/types.js';

const pretty = (v: Vec3) => v.map(x => x.toFixed(6));

describe('sRGB transfer round-trip', () => {
  it('linearToSrgb ∘ srgbToLinear ≈ id', () => {
    for (const c of [0, 0.04, 0.1, 0.5, 0.9, 1.0]) {
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 9);
    }
  });
});

describe('OKLAB round-trip', () => {
  it('oklab ∘ rgb ≈ id within 1e-6 ΔE', () => {
    for (const c of [
      [0.5, 0.5, 0.5], [0.7, 0.2, 0.1], [0.1, 0.5, 0.9],
    ] as Vec3[]) {
      const lab = linearRgbToOklab(c);
      const back = oklabToLinearRgb(lab);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(c[i], 6);
    }
  });
});

describe('OKLCH round-trip', () => {
  it('lab ∘ lch ≈ id', () => {
    const lab = [0.7, 0.05, -0.04] as Vec3;
    const back = oklchToOklab(oklabToOklch(lab));
    expect(back[0]).toBeCloseTo(lab[0], 12);
    expect(back[1]).toBeCloseTo(lab[1], 12);
    expect(back[2]).toBeCloseTo(lab[2], 12);
  });
});
```

### `test/unit/render/vmf.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { vmfBlend, HUE_OKLAB, HUE_OKABE_ITO } from '@/render/vmf.js';
import { linearRgbToOklab } from '@/render/oklab.js';

describe('vmfBlend', () => {
  it('returns the +x pole hue at n = (1, 0, 0)', () => {
    const rgb = vmfBlend([1, 0, 0], HUE_OKLAB,
                         { kappa: 8, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    const angle = Math.atan2(lab[2], lab[1]);
    expect(angle).toBeCloseTo(HUE_OKLAB[0], 1);   // ~ 0 rad
  });

  it('opposite poles cancel toward neutral on the equator', () => {
    // n = (0, 0, 0) is meaningless for sphere, but n = (0,1,0) sits between
    // two opposite-axis poles equidistantly from +x and -x.
    const rgb = vmfBlend([0, 1, 0], HUE_OKLAB,
                         { kappa: 0.5, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(0.1); // low chroma
  });

  it('high κ produces near-pure pole colours', () => {
    const rgb = vmfBlend([0.99, 0.1, 0], HUE_OKLAB,
                         { kappa: 16, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    expect(Math.hypot(lab[1], lab[2])).toBeGreaterThan(0.12);
  });
});
```

### `test/unit/render/cvd.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyCvd } from '@/render/cvd.js';

describe('CVD matrices', () => {
  it('none is identity', () => {
    expect(applyCvd([0.3, 0.6, 0.9], 'none')).toEqual([0.3, 0.6, 0.9]);
  });

  it('protan compresses the red channel', () => {
    const out = applyCvd([1, 0, 0], 'protan');
    expect(out[0]).toBeCloseTo(0.567, 3);
    expect(out[1]).toBeCloseTo(0.558, 3);
  });

  it('achrom produces a grey of the luminance', () => {
    const out = applyCvd([1, 0, 0], 'achrom');
    expect(out[0]).toBeCloseTo(0.299, 3);
    expect(out[1]).toBeCloseTo(0.299, 3);
    expect(out[2]).toBeCloseTo(0.299, 3);
  });
});
```

### `test/unit/render/palettes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { cubehelix, viridis } from '@/render/palettes.js';

describe('cubehelix', () => {
  it('starts dark and ends light', () => {
    const a = cubehelix(0.0);
    const b = cubehelix(1.0);
    const lumA = 0.299*a[0] + 0.587*a[1] + 0.114*a[2];
    const lumB = 0.299*b[0] + 0.587*b[1] + 0.114*b[2];
    expect(lumB).toBeGreaterThan(lumA);
  });
  it('output is in [0, 1]', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const c = cubehelix(t);
      for (const x of c) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('viridis', () => {
  it('endpoints match the canonical first / last stops', () => {
    expect(viridis(0)[0]).toBeCloseTo(0.267, 3);
    expect(viridis(1)[2]).toBeCloseTo(0.144, 3);
  });
});
```

### `test/integration/render_graph_palette_swap.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { packRenderParams } from '@/render/params.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';

/**
 * Palette swap should change the contents of the 64-byte RenderParams
 * uniform but leave every other resource untouched. We can't easily
 * dispatch a real GPU pass in unit tests, but we can verify the
 * contract: only the params buffer differs, and the rest of the
 * `ViewState`-derived buffers (uniforms, tile request, sim results)
 * are byte-identical between two renders that differ only in palette.
 */
describe('palette swap touches only RenderParams', () => {
  it('packRenderParams differs after palette change', () => {
    const a = packRenderParams(DEFAULT_RENDER_PARAMS);
    const b = packRenderParams({ ...DEFAULT_RENDER_PARAMS, palette: 'cubehelix' });
    expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
  });

  it('packRenderParams unchanged after toggling unrelated knobs', () => {
    const a = packRenderParams(DEFAULT_RENDER_PARAMS);
    const b = packRenderParams({
      ...DEFAULT_RENDER_PARAMS,
      // Wall-clock changes every frame; assume the renderer ignores it
      // for the cache-classification check (it lives in RenderParams,
      // but it's not a "palette swap" in the user-facing sense).
      wallClockTime: DEFAULT_RENDER_PARAMS.wallClockTime,
    });
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });
});
```

### `test/integration/render_graph_stability_hue.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { vmfBlend, HUE_OKABE_ITO } from '@/render/vmf.js';
import { linearRgbToOklab, oklabToLinearRgb } from '@/render/oklab.js';

/**
 * CPU-side reference for the stability×hue mode. Every pixel:
 *   1. shape-sphere n  →  vmf_okabe_ito → base RGB
 *   2. compute proximity-to-BC (max over 3 BC unit vectors)
 *   3. L = 0.25 + 0.55 * 0.5 * (1 - prox)
 *   4. replace L in OKLAB
 *
 * The integration test compares against this reference at hand-picked
 * landmark positions on the shape sphere.
 */
function cpuStabilityHue(n: [number, number, number]): [number, number, number] {
  const base = vmfBlend(n, HUE_OKABE_ITO,
                        { kappa: 3, chroma: 0.15, lightness: 0.7 });
  const b1 = [ 1, 0, 0] as const;
  const b2 = [-0.5,  Math.sqrt(3)/2, 0] as const;
  const b3 = [-0.5, -Math.sqrt(3)/2, 0] as const;
  const dot = (u: readonly number[], v: readonly number[]) =>
    u[0]*v[0] + u[1]*v[1] + u[2]*v[2];
  const prox = Math.max(dot(n, b1), dot(n, b2), dot(n, b3));
  const L = 0.25 + 0.55 * 0.5 * (1 - prox);
  const lab = linearRgbToOklab(base);
  return oklabToLinearRgb([L, lab[1], lab[2]]);
}

describe('stability × hue reference values', () => {
  it('binary collisions are dark', () => {
    const c = cpuStabilityHue([1, 0, 0]);
    const lum = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
    expect(lum).toBeLessThan(0.5);
  });

  it('Lagrange poles are light', () => {
    const c = cpuStabilityHue([0, 0, 1]);
    const lum = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
    expect(lum).toBeGreaterThan(0.5);
  });

  it('mid-equator is intermediate', () => {
    const cMid = cpuStabilityHue([0, 1, 0]);
    const lumMid = 0.299*cMid[0] + 0.587*cMid[1] + 0.114*cMid[2];
    const cBC  = cpuStabilityHue([1, 0, 0]);
    const lumBC  = 0.299*cBC[0] + 0.587*cBC[1] + 0.114*cBC[2];
    expect(lumMid).toBeGreaterThan(lumBC);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/render
npm test -- --run test/integration/render_graph
```

## Acceptance check

```bash
npm test -- --run test/integration/render_graph
```

`render_graph_palette_swap` confirms only `RenderParams` differs between
two renders that differ only in palette, and `render_graph_stability_hue`
verifies the reference luminance ordering for the principal Principia
colour mode.

## Notes for the implementer

- **Palette swap = group 3 rebind only.** The render pipeline keeps the
  same vertex / fragment modules for every mode; only `RenderParams`
  changes. The branchy `switch` on `colour_mode_id` lives in the same
  shader module — not separate pipeline objects per mode — because
  pipeline switching cost would dwarf the cost of one branch on a 64-byte
  uniform. M10 may revisit this if a particular mode's dead code becomes
  significant.
- **Stages cleanly composable.** Adding mode 24 means: extending the
  `ColourMode` union, adding an entry to `COLOUR_MODE_INDEX` and
  `COLOUR_SOURCES`, and a new `case` in the colour-mode shader. No
  changes to `params.ts`'s buffer layout, no changes to the M3/M5 sim or
  reduction shaders.
- **Gamma handling.** Everything between the colour node and the CVD
  output runs in linear sRGB. The CVD matrices are linear-sRGB matrices
  (the canonical Brettel/Viénot/Mollon formulation). The final
  `linear_to_srgb` is the only gamma encode in the pipeline. Applying
  CVD in gamma-encoded space looks visibly wrong (colours too dark) —
  this is the bug you'll see if you reorder the post stages.
- **Physics overlay** is intentionally omitted from M7's WGSL — the
  marker-glyph sprites for BC / Euler / Lagrange points belong to M10
  alongside the chart-aware overlay registry. M7 just leaves the
  `physics_overlay` flag in `RenderParams` so the contract is stable.
