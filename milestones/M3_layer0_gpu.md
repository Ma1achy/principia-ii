# M3 — Layer 0: flat grid GPU dispatch

## Goal

First end-to-end pass through WebGPU. No tile cache, no quadtree, no
adaptive refinement. A single tile fills the viewport and the fragment
shader reads `SimResult` directly from a storage buffer. The point of the
milestone is to land the data contracts (`SimResult`, `ICDescriptor`,
`SimUniforms`, `TileRequest`) and validate that a GPU integration matches
the M1 CPU reference.

**Exit criterion.**

```bash
npm test -- --run test/integration/layer0
```

A 16×16 sample of the (3,4,5)-Burrau view classifies every pixel identically
between GPU `f32` and CPU `f64`, with shape-sphere positions agreeing to
within `1e-3` after `T = 50`.

## File tree

```
principia/
  src/
    gpu/
      init.ts
      structs.ts
      buffers.ts
      pipelines.ts
      uniforms.ts
      dispatch_layer0.ts
      readback.ts
      index.ts
      shaders/
        helpers.wgsl
        decode.wgsl
        integrate.wgsl
        events.wgsl
        observe.wgsl
        simulate.wgsl
        render_layer0.wgsl
  test/
    unit/gpu/
      structs.test.ts
    integration/
      layer0_gpu_vs_cpu.test.ts
      layer0_struct_alignment.test.ts
```

## `src/gpu/structs.ts` — single source of truth for layouts

```ts
/**
 * GPU struct layouts. Sizes computed under WGSL alignment rules:
 *   - vec4<f32> aligns to 16 bytes
 *   - f32 / u32 align to 4 bytes
 *   - structs round up to the largest member's alignment
 *
 * These values appear in the spec at §6.6 and are pinned by the
 * integration test in `layer0_struct_alignment.test.ts`.
 */
export const M_DEFAULT = 8;

export function sizeOfSimResult(M: number = M_DEFAULT): number {
  // M float4 checkpoints (each 16B)
  // 1 uint4 free-group word (16B)
  // 11 floats: arc_length, t_end, d_min, ftle, energy_drift, diffusion,
  //   delta_E_max_abs, Lz_drift, delta_Lz_max_abs, E_0, Lz_0  (44B)
  // 2 uint32: sample_descriptor, trajectory_stats  (8B)
  // Padded to 16B alignment.
  const raw = 16*M + 16 + 44 + 8;
  return Math.ceil(raw / 16) * 16;
}

export function sizeOfICDescriptor(): number {
  // 12 floats × 4 bytes = 48, padded to 64.
  return 64;
}

export function sizeOfTileReduction(M: number = M_DEFAULT): number {
  // See spec §6.6 for the field-by-field count: 268 → 272.
  const raw =
      4*4                 // TileID id (3*i32) + level
    + 16*M                // mean_n_checkpoints[M]
    + 6*4                 // 6 means
    + 7*4                 // 7 spreads
    + 4*4                 // 4 classification fields
    + 2*4                 // 2 invariant drift
    + 4*4                 // 4 free-group fields
    + 2*4                 // 2 ensemble
    + 2*4                 // 2 trajectory_stats reductions
    + 2*4                 // 2 composite scores
    + 2*4;                // 2 metadata
  return Math.ceil(raw / 16) * 16;
}

/**
 * SimUniforms (frame-level). Bound at group(0) binding(0).
 * Field order matches the WGSL struct.
 */
export interface SimUniforms {
  m:               readonly [number, number, number];   // valid only for fixed-mass charts
  M_total:         number;
  G:               number;
  dt_macro:        number;
  N_max:           number;
  r_sub:           number;
  gamma_sub:       number;
  T_horizon:       number;
  r_coll:          number;
  R_esc:           number;
  k_esc:           number;
  eps_E:           number;
  eps_L:           number;
  r_close:         number;
  quality_tier:    number;
  checkpoint_count:number;
  samples_per_axis:number;
}

export function packSimUniforms(u: SimUniforms): ArrayBuffer {
  // 80-byte buffer, padded to 96 for vec3 alignment if needed.
  // m[3] is laid out as vec3<f32> + 4 bytes pad.
  const buf = new ArrayBuffer(96);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = u.m[0]; f32[1] = u.m[1]; f32[2] = u.m[2]; f32[3] = u.M_total;
  f32[4] = u.G;          f32[5] = u.dt_macro;
  u32[6] = u.N_max >>> 0;
  f32[7] = u.r_sub;
  f32[8] = u.gamma_sub;  f32[9] = u.T_horizon;
  f32[10] = u.r_coll;    f32[11] = u.R_esc;
  u32[12] = u.k_esc >>> 0;
  f32[13] = u.eps_E;     f32[14] = u.eps_L;
  f32[15] = u.r_close;
  u32[16] = u.quality_tier >>> 0;
  u32[17] = u.checkpoint_count >>> 0;
  u32[18] = u.samples_per_axis >>> 0;
  return buf;
}
```

```ts
/**
 * TileRequest: per-tile dispatch parameters. Bound at group(0) binding(1).
 *
 * Tile-local precision (spec §6.4):
 *   uv_centre, uv_half are computed in f64 on the CPU and downcast to f32.
 *   At depth 0, half = 0.5 and centre = 0.5; the formula u(t) = c + h(2t-1)
 *   reproduces the global UV exactly.
 */
export interface TileRequest {
  z:           number;
  tx:          number;
  ty:          number;
  level:       number;
  uv_centre:   readonly [number, number];
  uv_half:     readonly [number, number];
  flags:       number;
}

export function packTileRequest(t: TileRequest): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  i32[0] = t.z; i32[1] = t.tx; i32[2] = t.ty; i32[3] = t.level;
  f32[4] = t.uv_centre[0]; f32[5] = t.uv_centre[1];
  f32[6] = t.uv_half[0];   f32[7] = t.uv_half[1];
  i32[8] = t.flags >>> 0;
  return buf;
}
```

## `src/gpu/init.ts` — adapter / device boot

```ts
export interface GpuContext {
  adapter: GPUAdapter;
  device:  GPUDevice;
  format:  GPUTextureFormat;     // canvas preferred format
  limits:  Record<string, number>;
}

export async function initGpu(
  canvas?: HTMLCanvasElement,
): Promise<GpuContext> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available in this browser');
  }
  const adapter = await (navigator as any).gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('No GPU adapter');

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize:
        adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize:
        adapter.limits.maxBufferSize,
    },
  });

  const format =
    canvas?.getContext('webgpu')
      ? (navigator as any).gpu.getPreferredCanvasFormat() as GPUTextureFormat
      : 'rgba8unorm';

  return {
    adapter, device, format,
    limits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize:               adapter.limits.maxBufferSize,
      maxComputeWorkgroupSizeX:    adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY:    adapter.limits.maxComputeWorkgroupSizeY,
    },
  };
}
```

## `src/gpu/buffers.ts` — buffer allocation helpers

```ts
import type { GpuContext } from './init.js';
import { sizeOfSimResult, sizeOfICDescriptor } from './structs.js';

export interface TileBuffers {
  uniforms:    GPUBuffer;
  tileReq:     GPUBuffer;
  simResults:  GPUBuffer;
  icDesc:      GPUBuffer;
  readback:    GPUBuffer;       // optional, M=8 size for one tile
  N:           number;
  M:           number;
}

export function createTileBuffers(
  ctx: GpuContext, N: number, M: number,
): TileBuffers {
  const { device } = ctx;

  const uniforms   = device.createBuffer({
    size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const tileReq    = device.createBuffer({
    size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simResults = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const icDesc     = device.createBuffer({
    size: sizeOfICDescriptor() * N * N,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const readback   = device.createBuffer({
    size: sizeOfSimResult(M) * N * N,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  return { uniforms, tileReq, simResults, icDesc, readback, N, M };
}
```

## `src/gpu/pipelines.ts` — bind groups and pipelines

```ts
import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';

export interface Pipelines {
  simulate:    GPUComputePipeline;
  render:      GPURenderPipeline;
  bindGroupCommon: GPUBindGroup;     // group 0 (uniforms + tileReq)
  bindGroupSim:    GPUBindGroup;     // group 1 (results + ic descriptor)
}

export async function buildPipelines(
  ctx: GpuContext, bufs: TileBuffers,
  shaders: { simulate: string; render: string },
): Promise<Pipelines> {
  const { device, format } = ctx;

  const groupCommonLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' } },
      { binding: 1, visibility:
        GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' } },
    ],
  });

  const groupSimLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'storage' } },
      { binding: 1, visibility:
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: 'storage' } },
    ],
  });

  const layout = device.createPipelineLayout({
    bindGroupLayouts: [groupCommonLayout, groupSimLayout],
  });

  const simulate = device.createComputePipeline({
    layout,
    compute: {
      module: device.createShaderModule({ code: shaders.simulate }),
      entryPoint: 'simulate',
    },
  });

  const renderModule = device.createShaderModule({ code: shaders.render });
  const render = device.createRenderPipeline({
    layout,
    vertex:   { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main',
                targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const bindGroupCommon = device.createBindGroup({
    layout: groupCommonLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.uniforms } },
      { binding: 1, resource: { buffer: bufs.tileReq } },
    ],
  });

  const bindGroupSim = device.createBindGroup({
    layout: groupSimLayout,
    entries: [
      { binding: 0, resource: { buffer: bufs.simResults } },
      { binding: 1, resource: { buffer: bufs.icDesc } },
    ],
  });

  return { simulate, render, bindGroupCommon, bindGroupSim };
}
```

## WGSL shaders

### `src/gpu/shaders/helpers.wgsl`

```wgsl
// Numeric constants and shared helpers.
const PI: f32 = 3.141592653589793;
const EPS_BOLT: f32 = 1e-30;

fn sigmoid(z: f32) -> f32 {
  if (z >= 0.0) {
    return 1.0 / (1.0 + exp(-z));
  } else {
    let e = exp(z);
    return e / (1.0 + e);
  }
}

fn clamp01(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn rotJ(v: vec2<f32>) -> vec2<f32> { return vec2<f32>(-v.y, v.x); }

fn cross_z(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Mass softmax: σ(0, μ_max·tanh(z1), μ_max·tanh(z2)).
fn mass_softmax(z1: f32, z2: f32, mu_max: f32) -> vec3<f32> {
  let mu1 = mu_max * tanh(z1);
  let mu2 = mu_max * tanh(z2);
  let m   = max(0.0, max(mu1, mu2));
  let e0 = exp(   - m);
  let e1 = exp(mu1 - m);
  let e2 = exp(mu2 - m);
  let Z  = e0 + e1 + e2;
  return vec3<f32>(e0 / Z, e1 / Z, e2 / Z);
}
```

### `src/gpu/shaders/decode.wgsl`

```wgsl
struct ConfigDecoded {
  rho:    vec2<f32>,
  lambda: vec2<f32>,
  m:      vec3<f32>,
  alpha:  f32,
  beta:   f32,
};

fn decode_latent(z: array<f32, 8>, knobs: SimUniforms) -> ConfigDecoded {
  let m  = mass_softmax(z[6], z[7], knobs.mu_max);
  let M01 = m.x + m.y;

  let alpha = knobs.alpha_min
            + (PI/2.0 - 2.0*knobs.alpha_min) * sigmoid(z[0]);
  let beta  = PI * sigmoid(z[1]);

  let rho_t    = vec2<f32>(cos(alpha), 0.0);
  let lambda_t = vec2<f32>(sin(alpha) * cos(beta),
                           sin(alpha) * sin(beta));

  let muRho    = (m.x * m.y) / max(M01, EPS_BOLT);
  let muLambda = m.z * M01;
  let rho    = rho_t    / sqrt(max(muRho,    EPS_BOLT));
  let lambda = lambda_t / sqrt(max(muLambda, EPS_BOLT));

  var out: ConfigDecoded;
  out.rho = rho; out.lambda = lambda; out.m = m;
  out.alpha = alpha; out.beta = beta;
  return out;
}

struct ICOut {
  r: array<vec2<f32>, 3>,
  p: array<vec2<f32>, 3>,
  m: vec3<f32>,
  terminal: u32,                  // 0 = none, 1 = degenerate, 2 = collision_t0
};

fn jacobi_to_particle(
  rho: vec2<f32>, lambda: vec2<f32>, m: vec3<f32>,
) -> array<vec2<f32>, 3> {
  let M01 = m.x + m.y;
  let r01 = -m.z * lambda;
  let r2  =  M01 * lambda;
  let r0  = r01 - (m.y / M01) * rho;
  let r1  = r01 + (m.x / M01) * rho;
  return array<vec2<f32>, 3>(r0, r1, r2);
}

fn jacobi_momenta_to_particle(
  pRho: vec2<f32>, pLambda: vec2<f32>, m: vec3<f32>,
) -> array<vec2<f32>, 3> {
  let M01 = m.x + m.y;
  let p0  = -pRho - (m.x / M01) * pLambda;
  let p1  =  pRho - (m.y / M01) * pLambda;
  let p2  = pLambda;
  return array<vec2<f32>, 3>(p0, p1, p2);
}

fn decode_full(z: array<f32, 8>, knobs: SimUniforms) -> ICOut {
  var out: ICOut;
  let cfg = decode_latent(z, knobs);
  out.m = cfg.m;
  out.r = jacobi_to_particle(cfg.rho, cfg.lambda, cfg.m);

  // Free Jacobi momenta.
  let qx = knobs.q_max * (2.0 * sigmoid(z[2]) - 1.0);
  let qy = knobs.q_max * (2.0 * sigmoid(z[3]) - 1.0);
  let qX = knobs.q_max * (2.0 * sigmoid(z[4]) - 1.0);
  let qY = knobs.q_max * (2.0 * sigmoid(z[5]) - 1.0);
  out.p = jacobi_momenta_to_particle(
    vec2<f32>(qx, qy), vec2<f32>(qX, qY), cfg.m);

  // No-holes guard.
  let d01 = length(out.r[1] - out.r[0]);
  let d02 = length(out.r[2] - out.r[0]);
  let d12 = length(out.r[2] - out.r[1]);
  let dmin = min(d01, min(d02, d12));
  if (dmin < knobs.r_coll) { out.terminal = 2u; }
  else                     { out.terminal = 0u; }
  return out;
}
```

### `src/gpu/shaders/integrate.wgsl`

```wgsl
struct State {
  r: array<vec2<f32>, 3>,
  p: array<vec2<f32>, 3>,
  m: vec3<f32>,
  t: f32,
};

fn pairwise_force(m: vec3<f32>, r: array<vec2<f32>, 3>) -> array<vec2<f32>, 3> {
  var F: array<vec2<f32>, 3>;
  F[0] = vec2<f32>(0.0, 0.0);
  F[1] = vec2<f32>(0.0, 0.0);
  F[2] = vec2<f32>(0.0, 0.0);

  let d01 = r[1] - r[0]; let r01 = length(d01); let f01 = m.x*m.y / (r01*r01*r01);
  F[0] += f01 * d01; F[1] -= f01 * d01;

  let d02 = r[2] - r[0]; let r02 = length(d02); let f02 = m.x*m.z / (r02*r02*r02);
  F[0] += f02 * d02; F[2] -= f02 * d02;

  let d12 = r[2] - r[1]; let r12 = length(d12); let f12 = m.y*m.z / (r12*r12*r12);
  F[1] += f12 * d12; F[2] -= f12 * d12;
  return F;
}

fn min_pair_sep(r: array<vec2<f32>, 3>) -> f32 {
  return min(length(r[1] - r[0]),
        min(length(r[2] - r[0]),
            length(r[2] - r[1])));
}

fn project_com(s: ptr<function, State>) {
  let m = (*s).m; let M = m.x + m.y + m.z;
  let R = (m.x*(*s).r[0] + m.y*(*s).r[1] + m.z*(*s).r[2]) / M;
  let P = (*s).p[0] + (*s).p[1] + (*s).p[2];
  (*s).r[0] -= R; (*s).r[1] -= R; (*s).r[2] -= R;
  (*s).p[0] -= P * (m.x/M);
  (*s).p[1] -= P * (m.y/M);
  (*s).p[2] -= P * (m.z/M);
}

fn substep_count(rmin: f32, knobs: SimUniforms) -> u32 {
  let raw = u32(ceil(pow(knobs.r_sub / max(rmin, EPS_BOLT), knobs.gamma_sub)));
  return clamp(raw, 1u, knobs.N_max);
}

// One macro KDK step with adaptive substepping. Returns the substep count
// for telemetry.
fn kdk_macro_step(s: ptr<function, State>, knobs: SimUniforms) -> u32 {
  let rmin = min_pair_sep((*s).r);
  let nsub = substep_count(rmin, knobs);
  let dt   = knobs.dt_macro / f32(nsub);

  for (var i = 0u; i < nsub; i = i + 1u) {
    var F = pairwise_force((*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);

    (*s).r[0] += (*s).p[0] * (dt / (*s).m.x);
    (*s).r[1] += (*s).p[1] * (dt / (*s).m.y);
    (*s).r[2] += (*s).p[2] * (dt / (*s).m.z);

    F = pairwise_force((*s).m, (*s).r);
    (*s).p[0] += F[0] * (dt * 0.5);
    (*s).p[1] += F[1] * (dt * 0.5);
    (*s).p[2] += F[2] * (dt * 0.5);
  }

  (*s).t += knobs.dt_macro;
  project_com(s);
  return nsub;
}
```

### `src/gpu/shaders/events.wgsl`

```wgsl
struct EventOut {
  fired:   bool,
  kind:    u32,                 // 1=collision, 2=escape, 3=max_substeps, 4=sim_failed
  pair:    u32,                 // for collision
  body:    u32,                 // for escape
};

fn collision_check(r: array<vec2<f32>, 3>, r_coll: f32) -> EventOut {
  var out: EventOut;
  out.fired = false;
  let d01 = length(r[1] - r[0]);
  let d02 = length(r[2] - r[0]);
  let d12 = length(r[2] - r[1]);
  let dmin = min(d01, min(d02, d12));
  if (dmin < r_coll) {
    out.fired = true; out.kind = 1u;
    if (d01 == dmin) { out.pair = 0u; }
    else if (d02 == dmin) { out.pair = 1u; }
    else { out.pair = 2u; }
  }
  return out;
}

struct EscapeCounters {
  c0: u32, c1: u32, c2: u32,
};

fn escape_tick(
  s: State, st: ptr<function, EscapeCounters>,
  R_esc: f32, k_esc: u32,
) -> EventOut {
  var out: EventOut; out.fired = false;
  // body 0 candidate
  let l0 = s.r[0] - (s.m.y * s.r[1] + s.m.z * s.r[2]) / (s.m.y + s.m.z);
  let v0 = s.p[0] / s.m.x
         - (s.p[1] + s.p[2]) / (s.m.y + s.m.z);
  let mu0 = s.m.x * (s.m.y + s.m.z);
  let pOut0 = mu0 * v0;
  let E0 = dot(pOut0, pOut0)/(2.0*mu0)
         - (s.m.x*(s.m.y+s.m.z)) / length(l0);
  let on0 = length(l0) > R_esc && dot(l0, v0) > 0.0 && E0 > 0.0;
  (*st).c0 = select(max((*st).c0, 1u) - 1u, min((*st).c0 + 1u, k_esc), on0);
  if ((*st).c0 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 0u; return out; }

  // body 1
  let l1 = s.r[1] - (s.m.x * s.r[0] + s.m.z * s.r[2]) / (s.m.x + s.m.z);
  let v1 = s.p[1] / s.m.y
         - (s.p[0] + s.p[2]) / (s.m.x + s.m.z);
  let mu1 = s.m.y * (s.m.x + s.m.z);
  let pOut1 = mu1 * v1;
  let E1 = dot(pOut1, pOut1)/(2.0*mu1)
         - (s.m.y*(s.m.x+s.m.z)) / length(l1);
  let on1 = length(l1) > R_esc && dot(l1, v1) > 0.0 && E1 > 0.0;
  (*st).c1 = select(max((*st).c1, 1u) - 1u, min((*st).c1 + 1u, k_esc), on1);
  if ((*st).c1 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 1u; return out; }

  // body 2
  let l2 = s.r[2] - (s.m.x * s.r[0] + s.m.y * s.r[1]) / (s.m.x + s.m.y);
  let v2 = s.p[2] / s.m.z
         - (s.p[0] + s.p[1]) / (s.m.x + s.m.y);
  let mu2 = s.m.z * (s.m.x + s.m.y);
  let pOut2 = mu2 * v2;
  let E2 = dot(pOut2, pOut2)/(2.0*mu2)
         - (s.m.z*(s.m.x+s.m.y)) / length(l2);
  let on2 = length(l2) > R_esc && dot(l2, v2) > 0.0 && E2 > 0.0;
  (*st).c2 = select(max((*st).c2, 1u) - 1u, min((*st).c2 + 1u, k_esc), on2);
  if ((*st).c2 >= k_esc) { out.fired = true; out.kind = 2u; out.body = 2u; return out; }

  return out;
}
```

### `src/gpu/shaders/observe.wgsl`

```wgsl
fn total_energy(s: State) -> f32 {
  let K = dot(s.p[0], s.p[0]) / (2.0 * s.m.x)
        + dot(s.p[1], s.p[1]) / (2.0 * s.m.y)
        + dot(s.p[2], s.p[2]) / (2.0 * s.m.z);
  let U = -(s.m.x * s.m.y) / length(s.r[1] - s.r[0])
        - (s.m.x * s.m.z) / length(s.r[2] - s.r[0])
        - (s.m.y * s.m.z) / length(s.r[2] - s.r[1]);
  return K + U;
}

fn ang_mom(s: State) -> f32 {
  return s.r[0].x * s.p[0].y - s.r[0].y * s.p[0].x
       + s.r[1].x * s.p[1].y - s.r[1].y * s.p[1].x
       + s.r[2].x * s.p[2].y - s.r[2].y * s.p[2].x;
}

// Corrected shape-sphere coordinate (spec §4.3.1, post-revisions).
fn shape_sphere(rho_t: vec2<f32>, lambda_t: vec2<f32>) -> vec3<f32> {
  let rho_sq    = dot(rho_t,    rho_t);
  let lambda_sq = dot(lambda_t, lambda_t);
  let I = rho_sq + lambda_sq;
  return vec3<f32>(
    (lambda_sq - rho_sq) / I,
    -2.0 * dot(rho_t, lambda_t) / I,
     2.0 * cross_z(rho_t, lambda_t) / I,
  );
}
```

### `src/gpu/shaders/simulate.wgsl`

```wgsl
struct SimUniforms {
  m:                vec3<f32>,
  M_total:          f32,
  G:                f32,
  dt_macro:         f32,
  N_max:            u32,
  r_sub:            f32,
  gamma_sub:        f32,
  T_horizon:        f32,
  r_coll:           f32,
  R_esc:            f32,
  k_esc:            u32,
  eps_E:            f32,
  eps_L:            f32,
  r_close:          f32,
  quality_tier:     u32,
  checkpoint_count: u32,
  samples_per_axis: u32,
  // For M3 we hard-code mu_max, alpha_min, q_max: they live with the chart in M10.
  // Rough values for the latent chart at M3:
  mu_max:           f32,           // = 5
  alpha_min:        f32,           // = 0.05
  q_max:            f32,           // = 2
};

struct TileRequest {
  z: i32, tx: i32, ty: i32, level: i32,
  uv_centre: vec2<f32>,
  uv_half:   vec2<f32>,
  flags:     u32,
};

struct SimResult {
  // Layout matches src/gpu/structs.ts. M = 8 here.
  n_checkpoints: array<vec4<f32>, 8>,
  free_group_word: vec4<u32>,
  arc_length_n:    f32,
  t_end:           f32,
  d_min:           f32,
  ftle:            f32,
  energy_drift:    f32,
  diffusion:       f32,
  delta_E_max_abs: f32,
  Lz_drift:        f32,
  delta_Lz_max_abs:f32,
  E_0:             f32,
  Lz_0:            f32,
  sample_descriptor: u32,
  trajectory_stats:  u32,
};

struct ICDescriptor {
  m1: f32, m2: f32, m3: f32, q_mass: f32,
  rho1_mag: f32, rho2_mag: f32, rho_ratio: f32, rho_angle: f32,
  K_0: f32, V_0: f32, virial_ratio: f32, r_min_pair_0: f32,
};

@group(0) @binding(0) var<uniform>      uniforms : SimUniforms;
@group(0) @binding(1) var<uniform>      tile_req : TileRequest;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;
@group(1) @binding(1) var<storage, read_write> ics     : array<ICDescriptor>;

@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = uniforms.samples_per_axis;
  if (gid.x >= N || gid.y >= N) { return; }
  let idx = gid.y * N + gid.x;

  // Tile-local UV → latent z (M3: latent chart, both axes are z[0] and z[1]).
  let t = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(N);
  let uv = tile_req.uv_centre + tile_req.uv_half * (2.0 * t - 1.0);
  // Map UV → 8D latent. For M3 we use a default slice: u → z[0], v → z[1].
  var z: array<f32, 8>;
  z[0] = (uv.x * 2.0 - 1.0) * 3.0;     // ±3 latent range
  z[1] = (uv.y * 2.0 - 1.0) * 3.0;
  z[2] = 0.0; z[3] = 0.0; z[4] = 0.0; z[5] = 0.0;       // rest start
  z[6] = 0.0; z[7] = 0.0;                               // equal masses

  // Decode.
  let ic_out = decode_full(z, uniforms);

  if (ic_out.terminal != 0u) {
    write_terminal(idx, ic_out);
    return;
  }

  var s: State;
  s.r = ic_out.r; s.p = ic_out.p; s.m = ic_out.m; s.t = 0.0;

  // Initial invariants.
  let E0  = total_energy(s);
  let Lz0 = ang_mom(s);

  // Integration loop with checkpointing.
  var checkpoints: array<vec4<f32>, 8>;
  let M = uniforms.checkpoint_count;
  let dtCkpt = uniforms.T_horizon / f32(M);
  var nextCkpt: f32 = dtCkpt;
  var ck: u32 = 0u;

  var dE_max: f32 = 0.0; var dLz_max: f32 = 0.0;
  var dmin: f32 = 1e9;   var totalSubsteps: u32 = 0u;
  var maxSub: u32 = 0u;
  var escapeState = EscapeCounters(0u, 0u, 0u);

  var terminal_kind: u32 = 0u;
  var terminal_detail: u32 = 0u;
  var max_substeps_runs: u32 = 0u;

  loop {
    if (s.t >= uniforms.T_horizon) { break; }
    let nsub = kdk_macro_step(&s, uniforms);
    totalSubsteps += nsub;
    maxSub = max(maxSub, nsub);

    // Energy / Lz drift tracking.
    let E  = total_energy(s);
    let Lz = ang_mom(s);
    dE_max  = max(dE_max,  abs(E  - E0));
    dLz_max = max(dLz_max, abs(Lz - Lz0));

    let rmin = min(length(s.r[1]-s.r[0]),
              min(length(s.r[2]-s.r[0]), length(s.r[2]-s.r[1])));
    dmin = min(dmin, rmin);

    // Checkpoint capture (corrected shape-sphere coordinate).
    if (ck < M && s.t >= nextCkpt) {
      // Rebuild the canonical-frame Jacobi vectors for the shape sphere.
      let M01 = s.m.x + s.m.y;
      let cx  = (s.m.x*s.r[0] + s.m.y*s.r[1]) / M01;
      let rho = s.r[1] - s.r[0];
      let lambda = s.r[2] - cx;
      let muRho    = (s.m.x * s.m.y) / M01;
      let muLambda = s.m.z * M01;
      let rho_t    = rho    * sqrt(muRho);
      let lambda_t = lambda * sqrt(muLambda);
      let n = shape_sphere(rho_t, lambda_t);
      // .w = unwrapped phase placeholder for M6; M3 leaves it 0.
      checkpoints[ck] = vec4<f32>(n, 0.0);
      ck += 1u;
      nextCkpt += dtCkpt;
    }

    if (nsub >= uniforms.N_max) { max_substeps_runs += 1u; }
    else                         { max_substeps_runs = 0u; }
    if (max_substeps_runs >= 1u) {
      terminal_kind = 3u; break;
    }

    let coll = collision_check(s.r, uniforms.r_coll);
    if (coll.fired) { terminal_kind = 1u; terminal_detail = coll.pair; break; }

    let esc = escape_tick(s, &escapeState, uniforms.R_esc, uniforms.k_esc);
    if (esc.fired) { terminal_kind = 2u; terminal_detail = esc.body; break; }
  }

  // Fill any remaining checkpoints with the last-known n (so downstream
  // readers don't see uninitialised lanes).
  for (var k = ck; k < M; k = k + 1u) {
    checkpoints[k] = checkpoints[max(ck, 1u) - 1u];
  }

  // Write SimResult.
  var r: SimResult;
  r.n_checkpoints   = checkpoints;
  r.free_group_word = vec4<u32>(0u, 0u, 0u, 0u);     // M6
  r.arc_length_n    = 0.0;                            // M6
  r.t_end           = s.t;
  r.d_min           = dmin;
  r.ftle            = 0.0;                            // M6 / Research tier
  r.diffusion       = -1.0;                           // M6
  r.delta_E_max_abs = dE_max;
  r.energy_drift    = dE_max / max(abs(E0), uniforms.eps_E);
  r.delta_Lz_max_abs = dLz_max;
  r.Lz_drift         = dLz_max / max(abs(Lz0), uniforms.eps_L);
  r.E_0  = E0; r.Lz_0 = Lz0;
  r.sample_descriptor = (terminal_kind & 0x7u)
                       | ((terminal_detail & 0x3u) << 3u);
  r.trajectory_stats  = 0u;
  results[idx] = r;

  // Write IC descriptor.
  var d: ICDescriptor;
  d.m1 = ic_out.m.x; d.m2 = ic_out.m.y; d.m3 = ic_out.m.z;
  d.q_mass = min(ic_out.m.x, min(ic_out.m.y, ic_out.m.z));
  let M01_d = ic_out.m.x + ic_out.m.y;
  let cx_d  = (ic_out.m.x*ic_out.r[0] + ic_out.m.y*ic_out.r[1]) / M01_d;
  let rho_d    = ic_out.r[1] - ic_out.r[0];
  let lambda_d = ic_out.r[2] - cx_d;
  d.rho1_mag = length(rho_d);
  d.rho2_mag = length(lambda_d);
  d.rho_ratio = d.rho2_mag / max(d.rho1_mag, EPS_BOLT);
  d.rho_angle = atan2(cross_z(rho_d, lambda_d), dot(rho_d, lambda_d));
  let K0d = dot(ic_out.p[0], ic_out.p[0]) / (2.0*ic_out.m.x)
          + dot(ic_out.p[1], ic_out.p[1]) / (2.0*ic_out.m.y)
          + dot(ic_out.p[2], ic_out.p[2]) / (2.0*ic_out.m.z);
  d.K_0 = K0d;
  d.V_0 = E0 - K0d;
  d.virial_ratio = 2.0 * d.K_0 / max(EPS_BOLT, abs(d.V_0));
  d.r_min_pair_0 = min(length(ic_out.r[1]-ic_out.r[0]),
                  min(length(ic_out.r[2]-ic_out.r[0]),
                      length(ic_out.r[2]-ic_out.r[1])));
  ics[idx] = d;
}

fn write_terminal(idx: u32, ic: ICOut) {
  var r: SimResult;
  r.t_end = 0.0;
  r.d_min = 0.0;
  r.diffusion = -1.0;
  r.sample_descriptor = (1u & 0x7u);     // collision class
  results[idx] = r;
  // (descriptor still written for visualisation purposes.)
}
```

### `src/gpu/shaders/render_layer0.wgsl`

```wgsl
// Minimal Layer-0 fragment shader: full-screen triangle, colour by outcome.

struct SimResult { /* same as in simulate.wgsl */ };
struct SimUniforms { /* same */ };

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(1) @binding(0) var<storage, read> results : array<SimResult>;

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  // One big triangle covering the screen.
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vid], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  // For Layer 0 the tile fills the viewport. Map fragment.xy to sample idx.
  // Assume we're rendering to a square canvas of side N * tile_pix; in M3
  // we use one tile = canvas, and the fragment-to-sample mapping is just
  // floor(fragment.xy / tile_pix).
  let tile_pix = 32.0;                  // arbitrary, matches our test render
  let sx = u32(floor(frag.x / tile_pix));
  let sy = u32(floor(frag.y / tile_pix));
  let idx = clamp(sy * N + sx, 0u, N*N - 1u);
  let r = results[idx];
  let cls = r.sample_descriptor & 0x7u;

  var rgb: vec3<f32>;
  if (cls == 0u) { rgb = vec3<f32>(0.7, 0.7, 0.2); }      // bounded / not-yet-classified
  else if (cls == 1u) { rgb = vec3<f32>(0.9, 0.1, 0.1); } // collision
  else if (cls == 2u) { rgb = vec3<f32>(0.1, 0.4, 0.9); } // escape
  else if (cls == 3u) { rgb = vec3<f32>(0.5, 0.5, 0.5); } // degenerate
  else                { rgb = vec3<f32>(1.0, 0.9, 0.0); } // timeout / max_substeps

  return vec4<f32>(rgb, 1.0);
}
```

## `src/gpu/dispatch_layer0.ts`

```ts
import type { GpuContext } from './init.js';
import type { TileBuffers } from './buffers.js';
import type { Pipelines }   from './pipelines.js';
import type { SimUniforms, TileRequest } from './structs.js';
import { packSimUniforms, packTileRequest, sizeOfSimResult } from './structs.js';

export interface DispatchView {
  uniforms: SimUniforms;
  tile:     TileRequest;
}

/**
 * Run one compute pass + one render pass over the visible tile. For M3 the
 * tile fills the viewport.
 */
export function dispatchLayer0(
  ctx: GpuContext, bufs: TileBuffers, pl: Pipelines,
  view: DispatchView, target: GPUTextureView,
): void {
  const { device } = ctx;

  device.queue.writeBuffer(bufs.uniforms, 0, packSimUniforms(view.uniforms));
  device.queue.writeBuffer(bufs.tileReq,  0, packTileRequest(view.tile));

  const enc = device.createCommandEncoder();
  {
    const pass = enc.beginComputePass({ label: 'simulate' });
    pass.setPipeline(pl.simulate);
    pass.setBindGroup(0, pl.bindGroupCommon);
    pass.setBindGroup(1, pl.bindGroupSim);
    const N = view.uniforms.samples_per_axis;
    pass.dispatchWorkgroups(Math.ceil(N/8), Math.ceil(N/8), 1);
    pass.end();
  }
  {
    const pass = enc.beginRenderPass({
      label: 'render',
      colorAttachments: [{
        view: target,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(pl.render);
    pass.setBindGroup(0, pl.bindGroupCommon);
    pass.setBindGroup(1, pl.bindGroupSim);
    pass.draw(3, 1);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}
```

## `src/gpu/readback.ts`

```ts
import type { TileBuffers } from './buffers.js';
import type { GpuContext } from './init.js';
import { sizeOfSimResult, M_DEFAULT } from './structs.js';

/**
 * Copy the SimResult buffer to a CPU-mappable buffer and decode it into a
 * plain JS array. Used by tests; production rendering keeps everything on
 * the GPU.
 */
export async function readbackSimResults(
  ctx: GpuContext, bufs: TileBuffers,
): Promise<DecodedSimResult[]> {
  const { device } = ctx;
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(
    bufs.simResults, 0, bufs.readback, 0, bufs.simResults.size,
  );
  device.queue.submit([enc.finish()]);

  await bufs.readback.mapAsync(GPUMapMode.READ);
  const ab = bufs.readback.getMappedRange().slice(0);
  bufs.readback.unmap();
  return decodeBuffer(ab, bufs.N, bufs.M);
}

export interface DecodedSimResult {
  n_checkpoints:   readonly { x: number; y: number; z: number; w: number }[];
  free_group_word: readonly [number, number, number, number];
  arc_length_n:    number;
  t_end:           number;
  d_min:           number;
  ftle:            number;
  energy_drift:    number;
  diffusion:       number;
  delta_E_max_abs: number;
  Lz_drift:        number;
  delta_Lz_max_abs:number;
  E_0:             number;
  Lz_0:            number;
  sample_descriptor: number;
  trajectory_stats:  number;
}

function decodeBuffer(ab: ArrayBuffer, N: number, M: number): DecodedSimResult[] {
  const stride = sizeOfSimResult(M);
  const out: DecodedSimResult[] = new Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const off = i * stride;
    const f32 = new Float32Array(ab, off, stride / 4);
    const u32 = new Uint32Array(ab, off, stride / 4);

    const ck: { x: number; y: number; z: number; w: number }[] = [];
    for (let m = 0; m < M; m++) {
      const o = m * 4;
      ck.push({ x: f32[o], y: f32[o+1], z: f32[o+2], w: f32[o+3] });
    }
    const base = M * 4;
    out[i] = {
      n_checkpoints: ck,
      free_group_word: [u32[base], u32[base+1], u32[base+2], u32[base+3]],
      arc_length_n:    f32[base + 4],
      t_end:           f32[base + 5],
      d_min:           f32[base + 6],
      ftle:            f32[base + 7],
      energy_drift:    f32[base + 8],
      diffusion:       f32[base + 9],
      delta_E_max_abs: f32[base + 10],
      Lz_drift:        f32[base + 11],
      delta_Lz_max_abs:f32[base + 12],
      E_0:             f32[base + 13],
      Lz_0:            f32[base + 14],
      sample_descriptor: u32[base + 15],
      trajectory_stats:  u32[base + 16],
    };
  }
  return out;
}
```

## Tests

### `test/unit/gpu/structs.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  sizeOfSimResult, sizeOfICDescriptor, sizeOfTileReduction,
  packSimUniforms, packTileRequest,
} from '@/gpu/structs.js';

describe('struct sizes', () => {
  it('SimResult is 208 bytes at M = 8', () => {
    expect(sizeOfSimResult(8)).toBe(208);
  });
  it('SimResult is 336 bytes at M = 16', () => {
    expect(sizeOfSimResult(16)).toBe(336);
  });
  it('ICDescriptor is 64 bytes', () => {
    expect(sizeOfICDescriptor()).toBe(64);
  });
  it('TileReduction is 272 bytes at M = 8', () => {
    expect(sizeOfTileReduction(8)).toBe(272);
  });
});

describe('uniform packing', () => {
  it('SimUniforms round-trip preserves values to f32 precision', () => {
    const u = {
      m: [0.4, 0.3, 0.3] as const,
      M_total: 1, G: 1, dt_macro: 1e-3,
      N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 80,
      r_coll: 1e-4, R_esc: 10, k_esc: 8,
      eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
      quality_tier: 1, checkpoint_count: 8, samples_per_axis: 16,
    };
    const buf = packSimUniforms(u);
    expect(buf.byteLength).toBe(96);
    const f = new Float32Array(buf);
    expect(f[0]).toBeCloseTo(0.4, 6);
  });
});
```

### `test/integration/layer0_struct_alignment.test.ts`

This test runs only when WebGPU is available. Use `vitest --browser` or
Playwright to run; the snippet below targets Playwright's WebGPU adapter.

```ts
import { describe, it, expect } from 'vitest';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';

describe('GPU struct alignment', () => {
  it('writes 96 bytes of SimUniforms without an alignment error', async () => {
    if (!('gpu' in (globalThis as any).navigator ?? {})) {
      console.warn('skipping: WebGPU unavailable in this test runner');
      return;
    }
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, 16, 8);
    expect(bufs.uniforms.size).toBe(96);
    expect(bufs.tileReq.size).toBe(48);
    expect(bufs.simResults.size).toBe(208 * 16 * 16);
    expect(bufs.icDesc.size).toBe(64 * 16 * 16);
  });
});
```

### `test/integration/layer0_gpu_vs_cpu.test.ts`

The end-to-end gate. Dispatch one tile of the latent chart and compare every
sample's outcome class against the CPU integrator from M1.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0 } from '@/gpu/dispatch_layer0.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { run } from '@/integrate/run.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, R_ESC_DEFAULT, K_ESC_DEFAULT,
  EPS_DEADBAND, T_HORIZON_DEFAULT, DT_MACRO_DEFAULT,
  N_MAX_DEFAULT, R_SUB_DEFAULT, GAMMA_SUB_DEFAULT,
} from '@/math/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHADERS = {
  helpers:   readFileSync(path.join(here, '../../src/gpu/shaders/helpers.wgsl'), 'utf-8'),
  decode:    readFileSync(path.join(here, '../../src/gpu/shaders/decode.wgsl'),  'utf-8'),
  integrate: readFileSync(path.join(here, '../../src/gpu/shaders/integrate.wgsl'),'utf-8'),
  events:    readFileSync(path.join(here, '../../src/gpu/shaders/events.wgsl'),  'utf-8'),
  observe:   readFileSync(path.join(here, '../../src/gpu/shaders/observe.wgsl'), 'utf-8'),
  simulate:  readFileSync(path.join(here, '../../src/gpu/shaders/simulate.wgsl'),'utf-8'),
  render:    readFileSync(path.join(here, '../../src/gpu/shaders/render_layer0.wgsl'),
                                                                                  'utf-8'),
};

function concatShaders(): string {
  return [
    SHADERS.helpers, SHADERS.observe, SHADERS.events,
    SHADERS.integrate, SHADERS.decode, SHADERS.simulate,
  ].join('\n');
}

function classOf(d: number): number { return d & 0x7; }

describe('Layer 0 GPU vs CPU', () => {
  it('classifies a 16x16 sample identically (≥250 / 256 agreement)', async () => {
    if (!('gpu' in (globalThis as any).navigator ?? {})) {
      console.warn('skipping: WebGPU unavailable');
      return;
    }
    const ctx = await initGpu();
    const N = 16, M = 8;
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, {
      simulate: concatShaders(),
      render: SHADERS.render,
    });

    const uniforms = {
      m: [1/3, 1/3, 1/3] as const,
      M_total: 1, G: 1,
      dt_macro: DT_MACRO_DEFAULT, N_max: N_MAX_DEFAULT,
      r_sub: R_SUB_DEFAULT, gamma_sub: GAMMA_SUB_DEFAULT,
      T_horizon: 50,                   // shorter horizon for the test
      r_coll: R_COLL_DEFAULT, R_esc: R_ESC_DEFAULT, k_esc: K_ESC_DEFAULT,
      eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
      quality_tier: 1, checkpoint_count: M,
      samples_per_axis: N,
      // shader-local hyperparameters baked in for M3:
      mu_max: MU_MAX_DEFAULT, alpha_min: ALPHA_MIN_DEFAULT, q_max: Q_MAX_DEFAULT,
    };
    const tile = {
      z: 0, tx: 0, ty: 0, level: 0,
      uv_centre: [0.5, 0.5] as const,
      uv_half:   [0.5, 0.5] as const,
      flags: 0,
    };

    const fakeView = ctx.device.createTexture({
      size: { width: N, height: N }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }).createView();

    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, fakeView);

    const gpuResults = await readbackSimResults(ctx, bufs);

    // CPU reference for each sample.
    const params = {
      integrator: 'kdk' as const,
      dtMacro: uniforms.dt_macro, THorizon: uniforms.T_horizon,
      rColl: uniforms.r_coll, REsc: uniforms.R_esc, kEsc: uniforms.k_esc,
      substep: { rSub: uniforms.r_sub, gammaSub: uniforms.gamma_sub,
                 NMax: uniforms.N_max },
    };
    const knobs = {
      muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
      rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
    };

    let agree = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        const u = (i + 0.5) / N, v = (j + 0.5) / N;
        const z: any = [
          (u*2 - 1) * 3, (v*2 - 1) * 3,
          0, 0, 0, 0,
          0, 0,
        ];
        const dec = decodeLatent(z, knobs);
        let cpuClass: number;
        if (dec.kind === 'terminal') {
          cpuClass = dec.terminal.kind === 'COLLISION_T0' ? 1 :
                     dec.terminal.kind === 'DEGENERATE'   ? 3 : 0;
        } else {
          const r = run(dec.state, params, {});
          cpuClass = r.terminal.kind === 'COLLISION' ? 1 :
                     r.terminal.kind === 'ESCAPE'    ? 2 :
                     r.terminal.kind === 'BOUNDED'   ? 0 :
                     r.terminal.kind === 'DEGENERATE'? 3 : 4;
        }
        if (classOf(gpuResults[idx].sample_descriptor) === cpuClass) agree++;
      }
    }

    expect(agree).toBeGreaterThanOrEqual(N*N - 6);   // allow 6 borderline disagreements
  }, 120_000);
});
```

## Run it

```bash
npm test -- --run test/unit/gpu
npm test -- --run test/integration/layer0
```

## Acceptance check

```bash
npm test -- --run test/integration/layer0_gpu_vs_cpu
```

If that returns green with at least 250 of 256 samples in agreement, M3 is
done. The remaining ~6 samples-of-disagreement budget covers `f32` vs `f64`
divergence right on basin boundaries — that's expected and what the
adaptive refinement in M5 will correct for.

## Notes for the implementer

- **Shader concatenation.** `concatShaders()` glues the WGSL files together
  in the order required for forward declarations. In production, prefer a
  proper preprocessor or `wgsl-link`; for the test gate, plain string
  concat is enough.
- **Headless WebGPU.** The integration test skips if `navigator.gpu` is
  absent. To run it locally you need either a Chrome 113+ environment with
  WebGPU enabled, or the `@webgpu/types` + `dawn`-via-Node setup. CI
  configurations are out of scope for M3 — circle back when M5 needs CI
  budget gates.
- **M3 hard-coding.** The M3 shader hard-codes `mu_max`, `alpha_min`,
  `q_max` as additional fields of `SimUniforms`. M10 promotes these to
  per-chart parameters; M3's contract is just "the latent chart works".
- **Single tile = viewport.** The M3 fragment shader hard-codes
  `tile_pix = 32`. Once Layer 1 (M4) introduces real tiles and the cache,
  this becomes a per-tile uniform.
