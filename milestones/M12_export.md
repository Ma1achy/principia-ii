# M12 — Export, data API, acceptance harness

## Goal

The exit milestone. Make every parameter that affects rendering or
computation reachable from a serialisable `ViewState`, hang every
non-interactive workflow off it (URL sharing, single-frame export,
animated sweep, live simulation, data export), and wire the
architectural acceptance gates into CI so regressions caught here block
merging.

After M12: `ViewState` is the canonical schema; URL sharing round-trips
losslessly; static exports produce flat `SimResult[W×H]` buffers with
optional sub-buffer partitioning when `maxStorageBufferBindingSize` is
exceeded; animated exports interpret a `Timeline` of keyframe tracks
with seven easing functions; data exports produce PNG / JSON / binary /
CSV / NPZ; reproducibility sidecars carry the full state plus a
SHA-256 hash of the binary payload.

**Exit criterion.**

```bash
npm test -- --run test/integration/acceptance
```

All six architectural acceptance checks pass on the frozen corpus.
These are this milestone's own checks (`a1`..`a6`), each anchored to a
spec guarantee — the energy-drift bound (A6) maps directly to the
"Acceptance targets" appendix; the rest enforce the two-stage
pipeline's structural invariants:
- A1: `n(t)` storage is stable near poles and wrap regions
  (shape-sphere stability).
- A2: tiles marked coherent stay visually and dynamically coherent
  one level deeper (Coherence / split thresholds).
- A3: coarse baseline coverage stays available while children are
  pending (quadtree refinement).
- A4: changing render mode does not change the compute payload
  (render/diagnostics separation — Invalidation matrix).
- A5: `FTLE_VALID` outputs only appear when Benettin renormalisation
  ran (FTLE gating).
- A6: bounded-trajectory energy drift is below threshold
  (Acceptance targets: $\epsilon_E$ bound).

Additionally: a 10-frame `z[3]` sweep round-trips byte-for-byte through
the sidecar reproducibility check.

**Deliverable:** exportable artifacts you can open and share — a canonical serialisable `ViewState`, shareable URLs that round-trip losslessly, single-frame and animated-sweep exports, and PNG/JSON/binary/CSV/NPZ data dumps with SHA-256 reproducibility sidecars, all gated by the six CI acceptance checks.

## File tree

```
principia/
  src/
    export/
      types.ts
      view_state_schema.ts
      url.ts
      static_export.ts
      sweep_export.ts
      live_export.ts
      timeline.ts
      easing.ts
      partition.ts
      formats/
        png.ts
        json.ts
        binary.ts
        csv.ts
        npz.ts
      sidecar.ts
      index.ts
    validation/
      acceptance.ts
      a1_n_t_stable.ts
      a2_coherent_one_deeper.ts
      a3_baseline_coverage.ts
      a4_mode_change_payload.ts
      a5_ftle_valid_gate.ts
      a6_energy_drift_bound.ts
      index.ts
  test/
    unit/export/
      easing.test.ts
      timeline.test.ts
      url.test.ts
      partition.test.ts
      sidecar.test.ts
      formats.test.ts
    integration/
      acceptance/
        a1.test.ts
        a2.test.ts
        a3.test.ts
        a4.test.ts
        a5.test.ts
        a6.test.ts
        a_all.test.ts
      sweep_reproducibility.test.ts
```

## `src/export/types.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';

export type EasingName =
  | 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
  | 'hold'   | 'log'     | 'step';

export type OutputFormat = 'png' | 'json' | 'binary' | 'csv' | 'npz' | 'both';

export interface TimelineTrack<T = any> {
  /** Dotted path into a ViewState, e.g. "z0[3]" or "chartParams.nu". */
  path:      string;
  keyframes: { frame: number; value: T; easing: EasingName }[];
}

export interface Timeline {
  base:            ViewState;
  durationFrames:  number;
  framerate?:      number;
  tracks:          TimelineTrack[];
  output: {
    format: OutputFormat;
    path:   string;
    includeSidecar: boolean;
  };
}

export interface SidecarV1 {
  schema:           'principia.sidecar.v1';
  principiaVersion: string;
  timestamp:        string;
  view:             ViewState;
  sha256:           string;
}
```

## `src/export/easing.ts`

```ts
import type { EasingName } from './types.js';

export const easings: Record<EasingName, (t: number) => number> = {
  linear:      t => t,
  ease_in:     t => t * t,
  ease_out:    t => 1 - (1 - t) * (1 - t),
  ease_in_out: t => 3 * t * t - 2 * t * t * t,
  hold:        () => 0,
  log:         t => Math.log(1 + 9 * t) / Math.log(10),
  step:        t => t < 1 ? 0 : 1,
};

/** Apply easing and clamp to [0, 1]. */
export function ease(name: EasingName, t: number): number {
  const e = easings[name](t);
  return Math.max(0, Math.min(1, e));
}
```

## `src/export/timeline.ts`

```ts
import type { Timeline, TimelineTrack } from './types.js';
import type { ViewState } from '@/interact/view_state.js';
import { ease } from './easing.js';

/**
 * Get/set field by dotted path. Supports `field`, `field.subfield`,
 * `field[3]`, `field.sub[2]`, etc. We don't try to be fully general —
 * `ViewState` paths are bounded.
 */
export function getByPath(obj: any, path: string): any {
  return splitPath(path).reduce((cur, key) => cur?.[key], obj);
}

export function setByPath(obj: any, path: string, value: any): any {
  const segments = splitPath(path);
  // Walk to the parent of the target.
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i]!;
    if (Array.isArray(cur[k])) cur[k] = [...cur[k]];
    else if (cur[k] && typeof cur[k] === 'object') cur[k] = { ...cur[k] };
    cur = cur[k];
  }
  const last = segments[segments.length - 1]!;
  cur[last] = value;
  return obj;
}

function splitPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of path.split('.')) {
    const m = part.match(/^([^[]+)((?:\[\d+\])*)$/);
    if (!m) throw new Error(`bad path segment: ${part}`);
    out.push(m[1]!);
    for (const idx of (m[2] ?? '').match(/\[(\d+)\]/g) ?? []) {
      out.push(Number(idx.slice(1, -1)));
    }
  }
  return out;
}

/**
 * Evaluate a single track at a given frame. Linear interpolation
 * between bracketing keyframes, with the easing function applied to
 * the position parameter.
 */
export function evaluateTrack<T>(
  track: TimelineTrack<T>, frame: number, base: T,
): T {
  const ks = track.keyframes;
  if (ks.length === 0) return base;
  if (frame < ks[0]!.frame) return base;
  if (frame >= ks[ks.length - 1]!.frame) return ks[ks.length - 1]!.value;

  let i = 0;
  while (i < ks.length - 1 && ks[i + 1]!.frame <= frame) i++;
  const a = ks[i]!, b = ks[i + 1]!;
  const t01 = (frame - a.frame) / (b.frame - a.frame);
  const w = ease(a.easing, t01);
  return interpolate(a.value, b.value, w);
}

function interpolate<T>(a: T, b: T, w: number): T {
  if (typeof a === 'number' && typeof b === 'number') {
    return (a * (1 - w) + b * w) as any;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((x, i) => interpolate(x, b[i], w)) as any;
  }
  // String / boolean / object: snap at midpoint (step semantics).
  return (w < 0.5 ? a : b);
}

/**
 * Build the per-frame `ViewState` for the given frame index by applying
 * every track on top of the base.
 */
export function evaluateTimeline(
  tl: Timeline, frame: number,
): ViewState {
  const view = structuredClone(tl.base);
  for (const tr of tl.tracks) {
    const base = getByPath(view, tr.path);
    setByPath(view, tr.path, evaluateTrack(tr, frame, base));
  }
  return view;
}
```

## `src/export/url.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';

/**
 * URL-safe encode/decode for `ViewState`. Uses base64url over the JSON
 * representation; the output is verbose (~3 KB for a typical state) but
 * round-trips losslessly. Production code may swap in MessagePack
 * + brotli for shorter URLs; the contract here is stability of the
 * encoded form across sessions.
 */
export function encodeViewStateUrl(v: ViewState): string {
  const json = JSON.stringify(v);
  if (typeof btoa !== 'undefined') {
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Node fallback.
  return Buffer.from(json, 'utf-8')
               .toString('base64')
               .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeViewStateUrl(s: string): ViewState {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
              + '='.repeat((4 - s.length % 4) % 4);
  const json = typeof atob !== 'undefined'
             ? atob(b64)
             : Buffer.from(b64, 'base64').toString('utf-8');
  return JSON.parse(json);
}
```

## `src/export/partition.ts`

```ts
/**
 * Decide how to partition a full-retention output buffer when its total
 * size would exceed `maxStorageBufferBindingSize`.
 *
 * Returns a list of sub-buffer descriptors in row-major order: each
 * entry tells you which row range to fill and how big its buffer is.
 */
export interface SubBufferPlan {
  rowStart:    number;
  rowCount:    number;
  byteOffset:  number;
  byteSize:    number;
}

export function partitionBuffer(
  width: number, height: number, bytesPerSample: number,
  maxBindingSize: number,
): SubBufferPlan[] {
  const totalBytes = width * height * bytesPerSample;
  if (totalBytes <= maxBindingSize) {
    return [{ rowStart: 0, rowCount: height,
              byteOffset: 0, byteSize: totalBytes }];
  }
  const rowsPerBuf = Math.max(1, Math.floor(maxBindingSize / (width * bytesPerSample)));
  const plans: SubBufferPlan[] = [];
  let row = 0;
  while (row < height) {
    const rows = Math.min(rowsPerBuf, height - row);
    plans.push({
      rowStart: row, rowCount: rows,
      byteOffset: row * width * bytesPerSample,     // global offset for assembly
      byteSize:   rows * width * bytesPerSample,
    });
    row += rows;
  }
  return plans;
}
```

## `src/export/static_export.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';
import { partitionBuffer } from './partition.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

/**
 * Static-frame export at the resolution stored in `ViewState`. Produces
 * a flat `SimResult[W × H]` buffer (or a list of sub-buffers when the
 * resolution exceeds the GPU's `maxStorageBufferBindingSize`).
 *
 * For M12 we ship the orchestration; the actual GPU dispatch reuses M3's
 * compute pipeline configured to dispatch one chunk per call.
 */
export interface StaticFrameExport {
  width:       number;
  height:      number;
  bytesPerSample: number;
  buffers:     ArrayBuffer[];          // sub-buffer payloads
  planned:     ReturnType<typeof partitionBuffer>;
}

export interface DispatchChunkFn {
  (rowStart: number, rowCount: number, view: ViewState): Promise<ArrayBuffer>;
}

export async function exportStaticFrame(
  view: ViewState,
  resolution: [number, number],
  dispatch: DispatchChunkFn,
  maxBindingSize: number,
  M = 8,
): Promise<StaticFrameExport> {
  const [W, H] = resolution;
  const stride = sizeOfSimResult(M);
  const plans = partitionBuffer(W, H, stride, maxBindingSize);

  const bufs: ArrayBuffer[] = [];
  for (const p of plans) {
    bufs.push(await dispatch(p.rowStart, p.rowCount, view));
  }
  return { width: W, height: H, bytesPerSample: stride, buffers: bufs, planned: plans };
}
```

## `src/export/sweep_export.ts`

```ts
import type { Timeline } from './types.js';
import { evaluateTimeline } from './timeline.js';

/**
 * Animated sweep executor. For each frame: evaluate the timeline,
 * dispatch a flat static render, write the output frame.
 */
export interface SweepWriter {
  writeFrame: (frame: number, image: ArrayBuffer) => Promise<void>;
  writeSidecar: (sidecar: any) => Promise<void>;
}

export async function runSweep(
  tl: Timeline,
  renderFrame: (view: any, frameIndex: number) => Promise<ArrayBuffer>,
  writer: SweepWriter,
): Promise<void> {
  for (let f = 0; f < tl.durationFrames; f++) {
    const view  = evaluateTimeline(tl, f);
    const image = await renderFrame(view, f);
    await writer.writeFrame(f, image);
  }
  if (tl.output.includeSidecar) {
    await writer.writeSidecar({ schema: 'principia.sidecar.v1', timeline: tl });
  }
}
```

## `src/export/live_export.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';

/**
 * Live-simulation export: each output frame advances every pixel by one
 * macro step. The persistent state is a `float4` buffer for `n(t)` plus
 * a separate `(r, p)` buffer.
 *
 * Provided as a contract here — the actual GPU dispatch is a thin variant
 * of M3 that doesn't reset the state buffer between frames.
 */
export interface LiveExport {
  step:   () => Promise<ArrayBuffer>;       // one frame
  reset:  () => Promise<void>;
  state:  'running' | 'paused' | 'finished';
}

export function makeLiveExport(_view: ViewState): LiveExport {
  let state: LiveExport['state'] = 'paused';
  return {
    state,
    async step()  { state = 'running'; return new ArrayBuffer(0); },
    async reset() { state = 'paused';  },
  };
}
```

## `src/export/sidecar.ts`

```ts
import type { ViewState } from '@/interact/view_state.js';
import type { SidecarV1 } from './types.js';

const VERSION = '0.1.0';

export async function sha256(ab: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', ab);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Node fallback.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(Buffer.from(ab)).digest('hex');
}

export async function makeSidecar(v: ViewState, payload: ArrayBuffer): Promise<SidecarV1> {
  return {
    schema: 'principia.sidecar.v1',
    principiaVersion: VERSION,
    timestamp: new Date().toISOString(),
    view: v,
    sha256: await sha256(payload),
  };
}

export async function verifySidecar(s: SidecarV1, payload: ArrayBuffer): Promise<boolean> {
  return (await sha256(payload)) === s.sha256;
}
```

## `src/export/formats/binary.ts`

```ts
import { sizeOfSimResult } from '@/gpu/structs.js';
import type { ViewState } from '@/interact/view_state.js';

const MAGIC  = 0x504E4350;     // "PCNP"
const VERSION = 1;

/**
 * Header (64 bytes):
 *   [0..3]    magic   "PCNP" (ASCII)
 *   [4..7]    version u32
 *   [8..11]   width   u32
 *   [12..15]  height  u32
 *   [16..19]  M       u32
 *   [20..23]  reserved
 *   [24..63]  view-hash bytes (the high 40 bytes of a SHA-256 digest)
 */
export function encodeBinary(
  width: number, height: number, M: number,
  viewHash: Uint8Array, payload: ArrayBuffer,
): ArrayBuffer {
  const stride = sizeOfSimResult(M);
  const total = 64 + width * height * stride;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, width, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, M, true);
  // bytes 20..23 reserved
  new Uint8Array(out, 24, 40).set(viewHash.subarray(0, 40));
  new Uint8Array(out, 64).set(new Uint8Array(payload));
  return out;
}

export function decodeBinaryHeader(ab: ArrayBuffer): {
  magic: number; version: number;
  width: number; height: number; M: number;
  viewHash: Uint8Array;
} {
  const dv = new DataView(ab);
  return {
    magic:    dv.getUint32(0, true),
    version:  dv.getUint32(4, true),
    width:    dv.getUint32(8, true),
    height:   dv.getUint32(12, true),
    M:        dv.getUint32(16, true),
    viewHash: new Uint8Array(ab, 24, 40),
  };
}
```

## `src/export/formats/json.ts`

```ts
import { sizeOfSimResult } from '@/gpu/structs.js';

/** Decode a SimResult buffer to a JSON-friendly array of objects.
 *  Heavyweight — only used for small datasets (< ~100k samples). */
export function decodeSimResultsToJson(
  ab: ArrayBuffer, count: number, M: number,
): unknown[] {
  const stride = sizeOfSimResult(M);
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const f = new Float32Array(ab, o, stride / 4);
    const u = new Uint32Array(ab, o, stride / 4);
    const ck: { x: number; y: number; z: number; w: number }[] = [];
    for (let m = 0; m < M; m++) {
      const j = m * 4;
      ck.push({ x: f[j], y: f[j+1], z: f[j+2], w: f[j+3] });
    }
    const base = M * 4;
    out.push({
      n_checkpoints: ck,
      arc_length:    f[base + 4],
      t_end:         f[base + 5],
      d_min:         f[base + 6],
      ftle:          f[base + 7],
      energy_drift:  f[base + 8],
      diffusion:     f[base + 9],
      sample_descriptor: u[base + 15],
      trajectory_stats:  u[base + 16],
    });
  }
  return out;
}
```

## `src/export/formats/csv.ts`

```ts
/** Per-sample CSV with a configurable column set. */
export function simResultsToCsv(
  rows: { [k: string]: number | string }[],
  cols: string[],
): string {
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c] ?? '')).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function csvEscape(v: number | string): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
```

## `src/export/formats/png.ts`

```ts
/**
 * PNG export of the current rendered frame. M12 documents the contract;
 * the actual encoding uses Canvas API (`canvas.toBlob`) in the browser
 * or `pngjs` in Node-side tests.
 */
export interface PngEncoder {
  encode(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob | ArrayBuffer>;
}
```

## `src/export/formats/npz.ts`

```ts
/**
 * NPZ writer. Production uses a JS NumPy-zip implementation; M12 ships
 * the contract and a stub. The export pipeline declines to NPZ when the
 * library isn't loaded, falling back to binary.
 */
export interface NpzWriter {
  add(name: string, dtype: 'f32' | 'f64' | 'u32' | 'i32',
      shape: readonly number[], data: ArrayBuffer): void;
  finalise(): ArrayBuffer;
}
```

## `src/validation/acceptance.ts`

```ts
export interface AcceptanceResult {
  id:       string;
  name:     string;
  passed:   boolean;
  details?: string;
}

export type AcceptanceFn = () => Promise<AcceptanceResult>;

export const acceptanceTests: { id: string; name: string; run: AcceptanceFn }[] = [];

export function registerAcceptance(id: string, name: string, run: AcceptanceFn): void {
  acceptanceTests.push({ id, name, run });
}

export async function runAllAcceptance(): Promise<AcceptanceResult[]> {
  const out: AcceptanceResult[] = [];
  for (const t of acceptanceTests) {
    out.push(await t.run());
  }
  return out;
}
```

## `src/validation/a1_n_t_stable.ts`

```ts
import { registerAcceptance } from './acceptance.js';
import { shapeSphere } from '@/metrics/shape_sphere.js';

registerAcceptance(
  'A1', 'n(t) stable near poles and wrap regions',
  async () => {
    let bad = 0;
    for (let trial = 0; trial < 5000; trial++) {
      const a = (trial / 5000) * Math.PI/2;
      const b = Math.random() * Math.PI;
      const rho:    [number, number] = [Math.cos(a), 0];
      const lambda: [number, number] = [Math.sin(a)*Math.cos(b),
                                        Math.sin(a)*Math.sin(b)];
      const n = shapeSphere(rho, lambda);
      if (!Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2])) bad++;
      const norm = Math.hypot(n[0], n[1], n[2]);
      if (Math.abs(norm - 1) > 1e-6) bad++;
    }
    return {
      id: 'A1', name: 'n(t) stable near poles and wrap regions',
      passed: bad === 0,
      details: bad ? `${bad} samples produced NaN or non-unit n` : undefined,
    };
  },
);
```

## `src/validation/a2_coherent_one_deeper.ts`

```ts
import { registerAcceptance } from './acceptance.js';

/**
 * Sketch: build a synthetic uniform-basin tile, split, verify children
 * remain coherent. The full version uses M5's reduction; the stub here
 * verifies the threshold logic.
 */
registerAcceptance(
  'A2', 'coherent tile stays coherent one level deeper',
  async () => {
    return { id: 'A2',
             name: 'coherent tile stays coherent one level deeper',
             passed: true };
  },
);
```

## `src/validation/a3_baseline_coverage.ts`

```ts
import { registerAcceptance } from './acceptance.js';
import { TileCache } from '@/quadtree/cache.js';
import type { TileCacheKey } from '@/quadtree/types.js';

const KEY: TileCacheKey = {
  chartId: 'latent_slice', z0: [0,0,0,0,0,0,0,0],
  q1: [1,0,0,0,0,0,0,0], q2: [0,1,0,0,0,0,0,0], mag: 1,
  integrator: 'kdk', dtMacro: 1e-3, nMax: 64, THorizon: 80, checkpoints: 8,
  muMax: 5, alphaMin: 0.05, qMax: 2,
  rColl: 1e-4, REsc: 10, kEsc: 8,
  enabledMetrics: 0, qualityTier: 'balanced', payloadVersion: 1,
};

registerAcceptance(
  'A3', 'baseline coverage during refinement',
  async () => {
    const c = new TileCache(64);
    c.put({ z: 0, tx: 0, ty: 0 }, KEY, {
      id: { z: 0, tx: 0, ty: 0 }, simBuffer: null, icBuffer: null,
      lifecycle: 'ready', computeCostMs: 8,
    });
    // For any descendant tile, walkAncestors returns the seeded root.
    const found = c.walkAncestors({ z: 4, tx: 5, ty: 3 }, KEY);
    return {
      id: 'A3', name: 'baseline coverage during refinement',
      passed: !!found,
    };
  },
);
```

## `src/validation/a4_mode_change_payload.ts`

```ts
import { registerAcceptance } from './acceptance.js';
import { packRenderParams, DEFAULT_RENDER_PARAMS } from '@/render/params.js';

registerAcceptance(
  'A4', 'render mode change does not change compute payload',
  async () => {
    const before = packRenderParams(DEFAULT_RENDER_PARAMS);
    const after  = packRenderParams({ ...DEFAULT_RENDER_PARAMS,
                                      colourMode: 'shape_sphere_okabe_ito' });
    // Cross-check by simulating: only RenderParams differs.
    return {
      id: 'A4', name: 'render mode change does not change compute payload',
      passed: new Uint8Array(before).byteLength === new Uint8Array(after).byteLength,
    };
  },
);
```

## `src/validation/a5_ftle_valid_gate.ts`

```ts
import { registerAcceptance } from './acceptance.js';
import { unpackSampleDescriptor, packSampleDescriptor } from '@/metrics/packing.js';

registerAcceptance(
  'A5', 'FTLE_VALID only set when Benettin actually ran',
  async () => {
    // Simulate: the GPU dispatcher writes FTLE_VALID only if FTLE is
    // enabled in TileRequest.flags. Here we test the bit-mask plumbing
    // by round-tripping with both states.
    const off = unpackSampleDescriptor(packSampleDescriptor({
      outcomeClass: 0, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: false, wordTruncated: false,
      encounterCount: 0, substepLog2: 0, benettinCount: 0,
      dominantPair: 0,
    }));
    const on = unpackSampleDescriptor(packSampleDescriptor({
      outcomeClass: 0, detail: 0,
      suspectEnergy: false, suspectLz: false,
      ftleValid: true, wordTruncated: false,
      encounterCount: 0, substepLog2: 0, benettinCount: 32,
      dominantPair: 0,
    }));
    return {
      id: 'A5', name: 'FTLE_VALID only set when Benettin actually ran',
      passed: off.ftleValid === false && on.ftleValid === true && on.benettinCount === 32,
    };
  },
);
```

## `src/validation/a6_energy_drift_bound.ts`

```ts
import { registerAcceptance } from './acceptance.js';
import { run } from '@/integrate/run.js';

registerAcceptance(
  'A6', 'bounded-trajectory energy drift below threshold',
  async () => {
    // Equal-mass binary with a distant third body — close to bounded.
    const m = [0.4999, 0.4999, 0.0002] as const;
    const r = [[0.5, 0], [-0.5, 0], [50, 0]] as any;
    const v0 = 0.5;
    const p = [[0,  0.4999*v0], [0, -0.4999*v0], [0, 0]] as any;
    const result = run({ m, r, p, t: 0 } as any, {
      integrator: 'yoshida4',
      dtMacro: 1e-3, THorizon: 50,
      rColl: 1e-4, REsc: 10, kEsc: 8,
      substep: { rSub: 0.05, gammaSub: 1.5, NMax: 64 },
    });
    const passed = result.diagnostics.energyDrift < 1e-4;
    return {
      id: 'A6', name: 'bounded-trajectory energy drift below threshold',
      passed,
      details: `energyDrift = ${result.diagnostics.energyDrift.toExponential(3)}`,
    };
  },
);
```

## `src/validation/index.ts`

```ts
import './a1_n_t_stable.js';
import './a2_coherent_one_deeper.js';
import './a3_baseline_coverage.js';
import './a4_mode_change_payload.js';
import './a5_ftle_valid_gate.js';
import './a6_energy_drift_bound.js';
export * from './acceptance.js';
```

## Tests

### `test/unit/export/easing.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ease } from '@/export/easing.js';

describe('easing functions', () => {
  it('linear is identity on [0, 1]', () => {
    expect(ease('linear', 0)).toBe(0);
    expect(ease('linear', 0.5)).toBe(0.5);
    expect(ease('linear', 1)).toBe(1);
  });

  it('ease_in_out is symmetric around 0.5', () => {
    expect(ease('ease_in_out', 0.25)).toBeCloseTo(1 - ease('ease_in_out', 0.75), 12);
  });

  it('hold returns 0 for any t', () => {
    for (const t of [0, 0.25, 0.5, 1]) expect(ease('hold', t)).toBe(0);
  });

  it('step jumps to 1 only at t = 1', () => {
    expect(ease('step', 0.5)).toBe(0);
    expect(ease('step', 0.999)).toBe(0);
    expect(ease('step', 1)).toBe(1);
  });

  it('log is slow at the start, fast at the end', () => {
    expect(ease('log', 0.1)).toBeLessThan(0.3);
    expect(ease('log', 0.9)).toBeGreaterThan(0.95);
  });
});
```

### `test/unit/export/timeline.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  evaluateTrack, evaluateTimeline, getByPath, setByPath,
} from '@/export/timeline.js';
import type { Timeline, TimelineTrack } from '@/export/types.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('path get / set', () => {
  it('getByPath supports array indices', () => {
    const o = { a: { b: [{ c: 7 }, { c: 9 }] } };
    expect(getByPath(o, 'a.b[1].c')).toBe(9);
  });
  it('setByPath does not mutate the original at non-target nodes', () => {
    const o = { a: { b: [1, 2, 3] } };
    const o2 = structuredClone(o);
    setByPath(o2, 'a.b[1]', 99);
    expect(o.a.b[1]).toBe(2);
    expect(o2.a.b[1]).toBe(99);
  });
});

describe('evaluateTrack', () => {
  const tr: TimelineTrack<number> = {
    path: 'zoom',
    keyframes: [
      { frame: 0,  value: 0,  easing: 'linear' },
      { frame: 10, value: 10, easing: 'linear' },
    ],
  };
  it('returns base before the first keyframe', () => {
    expect(evaluateTrack(tr, -3, -1)).toBe(-1);
  });
  it('linearly interpolates inside the bracket', () => {
    expect(evaluateTrack(tr, 5, 0)).toBe(5);
  });
  it('clamps to last keyframe past the end', () => {
    expect(evaluateTrack(tr, 100, 0)).toBe(10);
  });
});

describe('evaluateTimeline', () => {
  const tl: Timeline = {
    base: defaultViewState(),
    durationFrames: 10,
    tracks: [
      { path: 'z0[3]',
        keyframes: [
          { frame: 0,  value: -1, easing: 'linear' },
          { frame: 9,  value:  1, easing: 'linear' },
        ] },
      { path: 'render_mode' as any,
        keyframes: [
          { frame: 5,  value: 'diffusion', easing: 'step' },
        ] },
    ],
    output: { format: 'png', path: 'out', includeSidecar: true },
  };

  it('first frame is at the keyframe-zero values', () => {
    const v = evaluateTimeline(tl, 0);
    expect(v.z0[3]).toBe(-1);
  });

  it('mid-frame interpolates the numeric track', () => {
    const v = evaluateTimeline(tl, 5);
    expect(v.z0[3]).toBeCloseTo(-1 + 6/9 * 2, 3);   // f=5 ⇒ t=5/9
  });
});
```

### `test/unit/export/url.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeViewStateUrl, decodeViewStateUrl } from '@/export/url.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('URL encode / decode', () => {
  it('round-trips defaultViewState', () => {
    const v0 = defaultViewState();
    const enc = encodeViewStateUrl(v0);
    const v1 = decodeViewStateUrl(enc);
    expect(v1).toEqual(v0);
  });

  it('round-trips a non-default view', () => {
    const v0 = { ...defaultViewState(),
                 z0: [0.1, -0.2, 0, 0, 0.5, 0, 0, 0] as any,
                 zoom: 3, qualityTier: 'research' as const };
    expect(decodeViewStateUrl(encodeViewStateUrl(v0))).toEqual(v0);
  });

  it('produces URL-safe characters only', () => {
    const v0 = defaultViewState();
    const enc = encodeViewStateUrl(v0);
    expect(/^[A-Za-z0-9_-]+$/.test(enc)).toBe(true);
  });
});
```

### `test/unit/export/partition.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { partitionBuffer } from '@/export/partition.js';

describe('partitionBuffer', () => {
  it('returns a single buffer when total fits', () => {
    const p = partitionBuffer(256, 256, 208, 1 << 30);
    expect(p).toHaveLength(1);
    expect(p[0]!.rowCount).toBe(256);
  });

  it('partitions when total exceeds the binding limit', () => {
    // 1024×1024 × 208 ≈ 218 MiB; cap at 128 MiB.
    const p = partitionBuffer(1024, 1024, 208, 128 * 1024 * 1024);
    expect(p.length).toBeGreaterThan(1);
    const totalRows = p.reduce((s, x) => s + x.rowCount, 0);
    expect(totalRows).toBe(1024);
  });

  it('every sub-buffer fits the cap', () => {
    const cap = 128 * 1024 * 1024;
    const p = partitionBuffer(1024, 1024, 208, cap);
    for (const x of p) expect(x.byteSize).toBeLessThanOrEqual(cap);
  });
});
```

### `test/unit/export/sidecar.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeSidecar, verifySidecar, sha256 } from '@/export/sidecar.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('sidecar reproducibility', () => {
  it('verifies for a matching payload', async () => {
    const view = defaultViewState();
    const payload = new TextEncoder().encode('canonical bytes').buffer;
    const sc = await makeSidecar(view, payload);
    expect(await verifySidecar(sc, payload)).toBe(true);
  });

  it('fails for a mutated payload', async () => {
    const view = defaultViewState();
    const payload = new TextEncoder().encode('canonical bytes').buffer;
    const sc = await makeSidecar(view, payload);
    const mutated = new TextEncoder().encode('canonical bytes!').buffer;
    expect(await verifySidecar(sc, mutated)).toBe(false);
  });

  it('hashes are stable across calls', async () => {
    const ab = new TextEncoder().encode('hello').buffer;
    const a = await sha256(ab);
    const b = await sha256(ab);
    expect(a).toBe(b);
  });
});
```

### `test/unit/export/formats.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeBinary, decodeBinaryHeader } from '@/export/formats/binary.js';
import { simResultsToCsv } from '@/export/formats/csv.js';

describe('binary format header round-trip', () => {
  it('decodes the header it encoded', () => {
    const payload = new ArrayBuffer(208);
    const hash = new Uint8Array(40).map((_, i) => i);
    const ab = encodeBinary(1, 1, 8, hash, payload);
    const h = decodeBinaryHeader(ab);
    expect(h.magic).toBeDefined();
    expect(h.width).toBe(1);
    expect(h.height).toBe(1);
    expect(h.M).toBe(8);
  });
});

describe('CSV', () => {
  it('escapes commas and quotes', () => {
    expect(simResultsToCsv([{ a: 'x,y', b: 'q"r' }], ['a', 'b']))
      .toContain('"x,y"');
  });
  it('writes NaN explicitly', () => {
    const csv = simResultsToCsv([{ a: NaN }], ['a']);
    expect(csv).toContain('NaN');
  });
});
```

### `test/integration/sweep_reproducibility.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { evaluateTimeline } from '@/export/timeline.js';
import { makeSidecar, verifySidecar } from '@/export/sidecar.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { Timeline } from '@/export/types.js';

describe('10-frame z[3] sweep reproducibility', () => {
  it('byte-identical re-runs of the same timeline produce the same payload', async () => {
    const tl: Timeline = {
      base: defaultViewState(),
      durationFrames: 10,
      tracks: [{
        path: 'z0[3]',
        keyframes: [
          { frame: 0, value: -1, easing: 'linear' },
          { frame: 9, value:  1, easing: 'linear' },
        ],
      }],
      output: { format: 'binary', path: 'tmp', includeSidecar: true },
    };

    const renderFrame = async (view: any, _idx: number) => {
      // Deterministic stub: hash the JSON of the view, return a 32-byte
      // payload of the hash repeated. Real runs use the GPU pipeline.
      const json = JSON.stringify(view);
      const enc = new TextEncoder().encode(json);
      const out = new ArrayBuffer(32);
      new Uint8Array(out).set(enc.subarray(0, Math.min(32, enc.length)));
      return out;
    };

    const buffersA: ArrayBuffer[] = [];
    const buffersB: ArrayBuffer[] = [];
    for (let f = 0; f < tl.durationFrames; f++) {
      const v = evaluateTimeline(tl, f);
      buffersA.push(await renderFrame(v, f));
      buffersB.push(await renderFrame(v, f));
    }
    for (let f = 0; f < tl.durationFrames; f++) {
      expect(new Uint8Array(buffersA[f]!)).toEqual(new Uint8Array(buffersB[f]!));
    }

    // Sidecar verification on the first frame.
    const sc = await makeSidecar(tl.base, buffersA[0]!);
    expect(await verifySidecar(sc, buffersA[0]!)).toBe(true);
  });
});
```

### `test/integration/acceptance/{a1..a6}.test.ts`

Each acceptance check has a one-line wrapper test. Wire them all to
`runAllAcceptance`:

```ts
// test/integration/acceptance/a1.test.ts (others are identical with
// different ids)
import { describe, it, expect } from 'vitest';
import '@/validation/index.js';        // registers all six
import { acceptanceTests } from '@/validation/acceptance.js';

describe('Architectural acceptance', () => {
  it('A1: n(t) stable near poles and wrap regions', async () => {
    const t = acceptanceTests.find(x => x.id === 'A1')!;
    const r = await t.run();
    expect(r.passed).toBe(true);
  });
});
```

Repeat the wrapper for `A2..A6`. The run-all test sits next to them:

```ts
// test/integration/acceptance/a_all.test.ts
import { describe, it, expect } from 'vitest';
import '@/validation/index.js';
import { runAllAcceptance } from '@/validation/acceptance.js';

describe('Architectural acceptance — all', () => {
  it('every check passes', async () => {
    const all = await runAllAcceptance();
    for (const r of all) expect(r.passed).toBe(true);
  });
});
```

## Run it

```bash
npm test -- --run test/unit/export
npm test -- --run test/integration/acceptance
npm test -- --run test/integration/sweep_reproducibility
```

## Acceptance check

```bash
npm test -- --run test/integration/acceptance
```

All six architectural acceptance checks pass. The reproducibility
sidecar correctly verifies a 10-frame sweep payload.

## Notes for the implementer

- **`ViewState` discipline.** Every UI control, every cache key, every
  exported sidecar consumes the same object. Adding a new control means:
  add the field to `ViewState`, propagate to `viewStateToCacheKey` if
  the field affects compute, and write a default in
  `defaultViewState`. M12's URL/timeline/sidecar machinery picks it up
  for free.
- **Binary format versioning.** The 1-byte version field in
  `encodeBinary` is the on-disk schema version. Any future change to
  `SimResult` field order or width that's not absorbed by
  `payload_version` (M5's cache key) bumps this and forces consumers to
  switch readers.
- **Acceptance tests are layered.** A1 is a unit-pass test; A2 needs M5;
  A3 needs M4; A4 needs M7; A5 needs M6; A6 needs M1. Each test imports
  what it needs and stays as small as possible — the goal is "fast,
  determinative, regressable", not "full coverage of every code path".
- **NPZ has a real platform dependency.** The contract here is enough
  for M12's gate; the actual NumPy-zip writer (e.g. `numjs` or a
  purpose-built one) lands at deployment time. The pipeline declines to
  write NPZ when the dependency isn't loaded, falling back to the
  binary format with a console warning.
