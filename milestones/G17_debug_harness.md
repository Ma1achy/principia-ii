# G17 — Debugging & bring-up harness

## Goal

M3 lands the first end-to-end GPU pass, but the only way to *see* it is the
`layer0_gpu_vs_cpu` integration test, and the only way to inspect a single
sample is to drop a `console.log` into the test and re-run it. That is the wrong
loop for bring-up: when the GPU `f32` path disagrees with the CPU `f64`
reference, you need to point at one pixel and read its decoded `SimResult`, its
`sample_descriptor` bitfields, and the exact `SimUniforms`/grid that produced it
— live, in a browser, without editing a test.

G17 ships a **standalone** debugging harness that wires the M3 surfaces
(`initGpu` → `createTileBuffers` → `buildPipelines` → `dispatchLayer0`) to a
**live canvas**, plus a small toolbox the implementer reaches for during every
later milestone: a GPU buffer inspector, debug render modes (a one-uniform
extension of `render_layer0.wgsl`), a TS↔WGSL struct-offset dump, a
non-finite-lane hunter, deterministic frame capture (serialise → reload →
re-dispatch), and a minimal levelled logger.

It builds **right after M3**, so it depends on M3 and **only** M3. There is no
`App`, no frame loop, no `PerfMonitor`, no `ErrorBoundary`, no inspector panel,
no capability layer yet — G17 stands entirely on its own. The render-mode
toolbox here is the seed that **G18** (the follow-on) folds into an
app-integrated HUD once the shell exists; the logger is the seam **G11
Telemetry** later subsumes.

**Deliverable:** you can open a page and SEE the M3 grid render + inspect any
sample.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/debug
```

passes with at least **18** green tests covering: the struct-offset table
(matching `structs.ts` byte offsets for `SimResult`/`SimUniforms`), the
non-finite-lane hunter (clean buffer → empty, seeded NaN/Inf → exact sample
indices + field names), the bitfield decoder for `sample_descriptor` (outcome
class, detail bits, the `FTLE_VALID` / suspect-energy / suspect-Lz flags),
debug-mode enumeration + colour-LUT totality, the levelled logger
(level-gating + pluggable sink + ring capture), and frame-capture round-trip
(`SimUniforms` + grid → JSON → parse → identical pack bytes). The harness
integration test (`test/integration/debug_harness.test.ts`) dispatches one tile
through the real M3 pipeline and round-trips a captured frame; it **skips**
cleanly when `navigator.gpu` is absent (mirrors M3).

## File tree

```
principia/
  src/
    debug/
      descriptor_bits.ts     # NEW: sample_descriptor bit layout decoder (class + detail + flags)
      struct_dump.ts         # NEW: TS↔WGSL field-offset table for SimResult / SimUniforms
      finite_scan.ts         # NEW: non-finite-lane hunter over a readback ArrayBuffer
      debug_modes.ts         # NEW: DebugMode enum, colour LUTs, packDebugUniform
      frame_capture.ts       # NEW: serialise/restore SimUniforms + grid (JSON, versioned)
      logger.ts              # NEW: minimal levelled logger (pluggable sink, ring capture)
      inspector.ts           # NEW: pickSample → decoded table rows (uses readback/decodeBuffer)
      index.ts               # NEW: barrel
    gpu/
      buffers.ts             # MODIFIED: TileBuffers gains `debug` (16B DebugUniform buffer)
      pipelines.ts           # MODIFIED: common layout + bind group gain binding 2 (see D17.1)
      shaders/
        render_layer0.wgsl   # MODIFIED: + DebugUniform @group(0) @binding(2), debug fs branch
  vite.config.ts             # NEW: @ → src alias, WGSL as ?raw (dev page only)
  dev/
    debug_harness.html       # NEW: Vite entry page (canvas + controls)
    debug_harness.ts         # NEW: wires initGpu+createTileBuffers+buildPipelines+dispatchLayer0
  test/
    unit/
      debug/
        descriptor_bits.test.ts  # NEW
        struct_dump.test.ts      # NEW
        finite_scan.test.ts      # NEW
        debug_modes.test.ts      # NEW
        frame_capture.test.ts    # NEW
        logger.test.ts           # NEW
    integration/
      debug_harness.test.ts      # NEW: real dispatch + capture round-trip, skipped w/o WebGPU
      layer0_struct_alignment.test.ts  # MODIFIED: pins bufs.debug.size === 16
```

## Depends on / pairs with

- **M3** — the *only* dependency. Reuse surfaces, by exact name/path:
  - `src/gpu/readback.ts`: `readbackSimResults(ctx, bufs)`, `decodeBuffer`
    (exported since M3 — the inspector still calls the higher-level
    `readbackSimResults`), and the `DecodedSimResult` interface;
    `sizeOfSimResult(8) = 208`.
  - `src/gpu/dispatch_layer0.ts`: `dispatchLayer0(ctx, bufs, pl, view, target)`,
    `DispatchView`.
  - `src/gpu/init.ts`: `initGpu(canvas)`, `GpuContext`.
  - `src/gpu/buffers.ts`: `createTileBuffers(ctx, N, M)`, `TileBuffers`.
  - `src/gpu/pipelines.ts`: `buildPipelines(ctx, bufs, { simulate, render })`,
    `Pipelines`.
  - `src/gpu/structs.ts`: `SimUniforms`, `packSimUniforms`, `TileRequest`,
    `packTileRequest`, `sizeOfSimResult`, `M_DEFAULT`.
  - `src/gpu/shaders/render_layer0.wgsl`: `fs_main` (5 outcome-class colours),
    extended below with a debug-mode uniform.
- **Chart-agnostic.** G17 reads decoded `SimResult` and the `sample_descriptor`
  contract; it never inspects the latent chart or the decoder math. A new
  `(Y, Φ)` chart needs no change here.
- **Follow-ons (not dependencies):** G18 promotes `debug_modes` + the inspector
  into an app HUD; G11 Telemetry subsumes `logger.ts`; M8/G7 extend
  `frame_capture` to carry `ViewState` + ensemble seeds (the JSON schema below
  is versioned for exactly that).

## Contract: `sample_descriptor` bit layout

M3 writes `sample_descriptor = (terminal_kind & 0x7) | ((terminal_detail & 0x3) << 3)`.
G17 fixes the **full** bit layout so later milestones (M6 sets FTLE/suspect
bits) and the debug render modes share one decoder. Bits above M3's three are
reserved-zero today and decode to `false`/`0` until their producer ships.

| bits    | field            | meaning                                                            |
|---------|------------------|-------------------------------------------------------------------|
| 0..2    | `outcomeClass`   | 0 BOUNDED · 1 COLLISION · 2 ESCAPE · 3 DEGENERATE · 4 TIMEOUT      |
| 3..4    | `detail`         | collision pair (0/1/2) or escape body (0/1/2)                     |
| 5       | `suspectEnergy`  | energy drift exceeded `eps_E` band (M6 sets it; M3 = 0)           |
| 6       | `suspectLz`      | Lz drift exceeded `eps_L` band (M6 sets it; M3 = 0)              |
| 7       | `ftleValid`      | FTLE lane is finite & meaningful (M6 sets it; M3 = 0)             |
| 8       | `wordTruncated`  | WORD_TRUNCATED (M6 sets it; M3 = 0)                               |
| 9       | `wordUncertain`  | WORD_UNCERTAIN — ADR 0004 (M6 sets it; M3 = 0)                    |
| 10..15  | `encounterCount` | close-encounter count, 0..63 (`& 0x3f`) (M6 sets it; M3 = 0)      |
| 16..22  | `substepLog2`    | log2 substep budget, 0..127 (M6 sets it; M3 = 0)                  |
| 23..29  | `benettinCount`  | Benettin renormalisation count, 0..127 (M6 sets it; M3 = 0)       |
| 30..31  | `dominantPair`   | dominant pair (0/1/2) (M6 sets it; M3 = 0)                        |

This table is the **exact** M6 layout (`milestones/M6_metrics.md` §6.6 packer)
and is the single source for `descriptor_bits.ts` and the WGSL debug branch;
keep the three in lockstep.

## `src/debug/descriptor_bits.ts`

```ts
/**
 * Decoder for the SimResult.sample_descriptor bitfield (see G17 contract table).
 * Pure, GPU-free. The WGSL debug branch in render_layer0.wgsl mirrors these
 * masks/shifts exactly — change both in the same commit.
 */

export enum OutcomeClass {
  Bounded = 0,
  Collision = 1,
  Escape = 2,
  Degenerate = 3,
  Timeout = 4,
}

export const OUTCOME_NAMES: readonly string[] = [
  'BOUNDED', 'COLLISION', 'ESCAPE', 'DEGENERATE', 'TIMEOUT',
  'RESERVED5', 'RESERVED6', 'RESERVED7',
];

export interface DescriptorBits {
  raw: number;
  outcomeClass: number;       // bits 0..2 (only 0..4 defined)
  outcomeName: string;
  detail: number;             // bits 3..4: collision pair / escape body
  suspectEnergy: boolean;     // bit 5
  suspectLz: boolean;         // bit 6
  ftleValid: boolean;         // bit 7
  wordTruncated: boolean;     // bit 8 (WORD_TRUNCATED)
  wordUncertain: boolean;     // bit 9 (WORD_UNCERTAIN — ADR 0004)
  encounterCount: number;     // bits 10..15, 0..63
  substepLog2: number;        // bits 16..22, 0..127
  benettinCount: number;      // bits 23..29, 0..127
  dominantPair: number;       // bits 30..31, 0..2
}

const bit = (v: number, n: number): boolean => ((v >>> n) & 1) === 1;

/**
 * Decode a raw u32 descriptor into named fields. Never throws.
 * Mirrors M6's `unpackSampleDescriptor` (milestones/M6_metrics.md §6.6) exactly.
 */
export function decodeDescriptor(raw: number): DescriptorBits {
  const r = raw >>> 0;
  const outcomeClass = r & 0x7;
  return {
    raw: r,
    outcomeClass,
    outcomeName: OUTCOME_NAMES[outcomeClass] ?? `CLASS${outcomeClass}`,
    detail: (r >>> 3) & 0x3,
    suspectEnergy: bit(r, 5),
    suspectLz: bit(r, 6),
    ftleValid: bit(r, 7),
    wordTruncated: bit(r, 8),
    wordUncertain: bit(r, 9),
    encounterCount: (r >>> 10) & 0x3f,
    substepLog2: (r >>> 16) & 0x7f,
    benettinCount: (r >>> 23) & 0x7f,
    dominantPair: (r >>> 30) & 0x3,
  };
}

/** Convenience: just the outcome class, matches M3's outcome-class mask (descriptor & 0x7). */
export function classOf(raw: number): number {
  return (raw >>> 0) & 0x7;
}
```

> Note on enums: project convention bans cross-module `const enum`
> (`isolatedModules`), so `OutcomeClass` is a **plain `enum`** — safe to
> re-export through the barrel. The acceptance tests import only the functions,
> never the enum, so the build stays clean either way.

## `src/debug/struct_dump.ts`

```ts
/**
 * TS↔WGSL field-offset table for the M3 GPU structs. Complements (does not
 * replace) the layer0_struct_alignment pin test: that test pins *sizes*; this
 * dumps *per-field byte offsets* so a layout drift is readable at a glance
 * during bring-up. Offsets are derived from src/gpu/structs.ts packers and the
 * WGSL struct field order in simulate.wgsl, under std140-ish WGSL rules
 * (vec4 → 16B align, f32/u32 → 4B).
 */
import { sizeOfSimResult, M_DEFAULT } from '@/gpu/structs.js';

export interface FieldOffset {
  name: string;
  offset: number;       // byte offset
  size: number;         // byte size
  wgslType: string;
}

export interface StructLayout {
  struct: string;
  totalSize: number;
  fields: readonly FieldOffset[];
}

/** SimUniforms layout — mirrors packSimUniforms (96 bytes). */
export function simUniformsLayout(): StructLayout {
  const f = (name: string, offset: number, wgslType: string, size = 4): FieldOffset =>
    ({ name, offset, size, wgslType });
  return {
    struct: 'SimUniforms',
    totalSize: 96,
    fields: [
      f('m', 0, 'vec3<f32>', 12),
      f('M_total', 12, 'f32'),
      f('G', 16, 'f32'),          f('dt_macro', 20, 'f32'),
      f('N_max', 24, 'u32'),      f('r_sub', 28, 'f32'),
      f('gamma_sub', 32, 'f32'),  f('T_horizon', 36, 'f32'),
      f('r_coll', 40, 'f32'),     f('R_esc', 44, 'f32'),
      f('k_esc', 48, 'u32'),      f('eps_E', 52, 'f32'),
      f('eps_L', 56, 'f32'),      f('r_close', 60, 'f32'),
      f('quality_tier', 64, 'u32'),
      f('checkpoint_count', 68, 'u32'),
      f('samples_per_axis', 72, 'u32'),
      f('mu_max', 76, 'f32'),     f('alpha_min', 80, 'f32'),
      f('q_max', 84, 'f32'),
      // f32[22..23] (offsets 88, 92) are trailing pad to 96.
    ],
  };
}

/**
 * SimResult layout at the given M. Field order/offsets mirror the decode in
 * readback.ts decodeBuffer: M vec4 checkpoints, one vec4<u32> free-group word,
 * then 11 f32 metrics, then two u32 (descriptor, trajectory_stats), padded to
 * sizeOfSimResult(M).
 */
export function simResultLayout(M: number = M_DEFAULT): StructLayout {
  const fields: FieldOffset[] = [];
  for (let m = 0; m < M; m++) {
    fields.push({ name: `n_checkpoints[${m}]`, offset: m * 16, size: 16, wgslType: 'vec4<f32>' });
  }
  let off = M * 16;
  fields.push({ name: 'free_group_word', offset: off, size: 16, wgslType: 'vec4<u32>' });
  off += 16;
  const f32Fields = [
    'arc_length_n', 't_end', 'd_min', 'ftle', 'energy_drift', 'diffusion',
    'delta_E_max_abs', 'Lz_drift', 'delta_Lz_max_abs', 'E_0', 'Lz_0',
  ];
  for (const name of f32Fields) {
    fields.push({ name, offset: off, size: 4, wgslType: 'f32' });
    off += 4;
  }
  fields.push({ name: 'sample_descriptor', offset: off, size: 4, wgslType: 'u32' }); off += 4;
  fields.push({ name: 'trajectory_stats', offset: off, size: 4, wgslType: 'u32' }); off += 4;
  return { struct: `SimResult(M=${M})`, totalSize: sizeOfSimResult(M), fields };
}

/** Render a layout as a fixed-width text table (for console / dev page). */
export function formatLayout(layout: StructLayout): string {
  const head = `${layout.struct}  (${layout.totalSize} bytes)`;
  const rows = layout.fields.map(
    (x) => `  ${String(x.offset).padStart(4)}  ${x.wgslType.padEnd(10)} ${x.name}` +
           `  (${x.size}B)`,
  );
  return [head, ...rows].join('\n');
}

/** Dump both M3 structs to a sink (defaults to console.log). */
export function dumpStructLayouts(M = M_DEFAULT, sink: (s: string) => void = console.log): void {
  sink(formatLayout(simUniformsLayout()));
  sink(formatLayout(simResultLayout(M)));
}
```

## `src/debug/finite_scan.ts`

```ts
/**
 * Non-finite-lane hunter. Scans a readback SimResult ArrayBuffer (the same
 * bytes readbackSimResults reads) for NaN / ±Inf in any f32 metric lane and
 * reports the exact (sample index, field name) pairs. M3 should never emit a
 * non-finite metric for a non-degenerate sample; when it does, this is the
 * first stop.
 */
import { sizeOfSimResult, M_DEFAULT } from '@/gpu/structs.js';

export interface NonFiniteHit {
  sample: number;       // flat sample index (row-major, y*N + x)
  field: string;        // field name from the SimResult layout
  value: number;        // the offending value (NaN encoded as NaN)
}

const F32_FIELD_NAMES: readonly string[] = [
  'arc_length_n', 't_end', 'd_min', 'ftle', 'energy_drift', 'diffusion',
  'delta_E_max_abs', 'Lz_drift', 'delta_Lz_max_abs', 'E_0', 'Lz_0',
];

/**
 * Scan `count` samples (default N*N inferred from buffer length) for non-finite
 * f32 lanes: the M checkpoint vec4 lanes plus the 11 scalar metrics. Returns one
 * hit per offending lane; an all-finite buffer returns []. Pure; no GPU.
 */
export function scanNonFinite(
  ab: ArrayBuffer, N: number, M: number = M_DEFAULT,
): NonFiniteHit[] {
  const stride = sizeOfSimResult(M);
  const count = N * N;
  const hits: NonFiniteHit[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * stride;
    const f32 = new Float32Array(ab, off, stride / 4);
    // checkpoint vec4 lanes
    for (let m = 0; m < M; m++) {
      const o = m * 4;
      for (let c = 0; c < 4; c++) {
        const v = f32[o + c]!;
        if (!Number.isFinite(v)) {
          hits.push({ sample: i, field: `n_checkpoints[${m}].${'xyzw'[c]}`, value: v });
        }
      }
    }
    // scalar metrics (skip the vec4<u32> free-group word at lane base = M*4)
    const base = M * 4 + 4;
    for (let k = 0; k < F32_FIELD_NAMES.length; k++) {
      const v = f32[base + k]!;
      if (!Number.isFinite(v)) {
        hits.push({ sample: i, field: F32_FIELD_NAMES[k]!, value: v });
      }
    }
  }
  return hits;
}

/** Just the distinct offending sample indices, sorted ascending. */
export function nonFiniteSamples(hits: readonly NonFiniteHit[]): number[] {
  return [...new Set(hits.map((h) => h.sample))].sort((a, b) => a - b);
}
```

## `src/debug/debug_modes.ts`

```ts
/**
 * Debug render modes. Each mode is a recolouring of the same SimResult buffer;
 * the active mode rides in a tiny DebugUniform (group(0) binding(2)) consumed by
 * the extended render_layer0.wgsl fs_main. The colour math lives in WGSL for the
 * live page; the TS LUTs/labels below drive the dev-page legend and the unit
 * test that asserts the enum ↔ label ↔ swatch mapping is total.
 */

export enum DebugMode {
  Outcome = 0,                // M3 default: colour by outcome class (byte-for-byte M3)
  Detail = 1,                 // colour by detail bits (descriptor bits 3..4)
  FtleValid = 2,              // green = FTLE_VALID (bit 7), grey = not
  Suspect = 3,               // suspect = suspectEnergy (bit 5) OR suspectLz (bit 6)
  EnergyDriftHeat = 4,        // heatmap of SimResult.delta_E_max_abs (normalised)
  CheckpointCompleteness = 5, // fraction of non-zero checkpoints / M
}

export interface DebugModeInfo {
  mode: DebugMode;
  label: string;
  /** Legend swatch (sRGB 0..1), representative of the mode's "on"/max colour. */
  swatch: readonly [number, number, number];
  continuous: boolean;  // heatmap (true) vs categorical (false)
}

export const DEBUG_MODES: readonly DebugModeInfo[] = [
  { mode: DebugMode.Outcome,                label: 'Outcome class',         swatch: [0.7, 0.7, 0.2], continuous: false },
  { mode: DebugMode.Detail,                 label: 'Detail bits',           swatch: [0.8, 0.4, 0.8], continuous: false },
  { mode: DebugMode.FtleValid,              label: 'FTLE_VALID',            swatch: [0.2, 0.9, 0.3], continuous: false },
  { mode: DebugMode.Suspect,                label: 'Suspect (E or Lz)',     swatch: [0.9, 0.2, 0.2], continuous: false },
  { mode: DebugMode.EnergyDriftHeat,        label: 'Energy-drift heatmap',  swatch: [1.0, 0.5, 0.0], continuous: true  },
  { mode: DebugMode.CheckpointCompleteness, label: 'Checkpoint completeness', swatch: [0.9, 0.9, 0.9], continuous: true },
];

/** Total label lookup (never throws; reserved values fall through to a stub). */
export function debugModeLabel(mode: number): string {
  return DEBUG_MODES.find((m) => m.mode === mode)?.label ?? `MODE${mode}`;
}

/**
 * Pack the DebugUniform: 16 bytes (vec4 alignment).
 *   f32[0]=mode (as float for cheap WGSL compare), f32[1]=heatScale,
 *   u32[2]=checkpointCount, f32[3]=pad.
 * heatScale maps a drift value into [0,1] in the shader (value/heatScale).
 */
export function packDebugUniform(
  mode: DebugMode, heatScale: number, checkpointCount: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = mode;
  f32[1] = heatScale > 0 ? heatScale : 1;
  u32[2] = checkpointCount >>> 0;
  f32[3] = 0;
  return buf;
}
```

## `src/debug/frame_capture.ts`

```ts
/**
 * Deterministic frame capture. Serialise the full dispatch input (SimUniforms +
 * grid TileRequest + N/M) to JSON, reload it, and re-dispatch to reproduce a
 * frame exactly. M3's dispatch is a pure function of (SimUniforms, TileRequest),
 * so byte-identical packed inputs ⇒ identical GPU output. The schema is
 * versioned: M8/G7 later extend `CapturedFrame` with ViewState + ensemble seeds
 * under the same `version` gate.
 */
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { packSimUniforms, packTileRequest } from '@/gpu/structs.js';

export const FRAME_CAPTURE_VERSION = 1 as const;

export interface CapturedFrame {
  version: number;
  N: number;
  M: number;
  uniforms: SimUniforms;
  tile: TileRequest;
  /** Free-form note (e.g. "disagreement at (7,3)"); ignored on restore. */
  label?: string;
}

/** Capture the current dispatch input. */
export function captureFrame(
  N: number, M: number, uniforms: SimUniforms, tile: TileRequest, label?: string,
): CapturedFrame {
  const frame: CapturedFrame = { version: FRAME_CAPTURE_VERSION, N, M, uniforms, tile };
  if (label !== undefined) frame.label = label;     // exactOptionalPropertyTypes
  return frame;
}

/** Serialise to a JSON string (stable: arrays stay arrays, numbers as-is). */
export function serializeFrame(frame: CapturedFrame): string {
  return JSON.stringify(frame, null, 2);
}

/**
 * Parse + validate a captured frame. Throws on a version mismatch or missing
 * required fields — a corrupt capture should fail loudly, not silently
 * re-dispatch garbage.
 */
export function deserializeFrame(json: string): CapturedFrame {
  const raw = JSON.parse(json) as Partial<CapturedFrame>;
  if (raw.version !== FRAME_CAPTURE_VERSION) {
    throw new Error(`frame-capture version ${String(raw.version)} != ${FRAME_CAPTURE_VERSION}`);
  }
  if (raw.uniforms === undefined || raw.tile === undefined ||
      typeof raw.N !== 'number' || typeof raw.M !== 'number') {
    throw new Error('frame-capture missing required fields');
  }
  return raw as CapturedFrame;
}

/**
 * Determinism proof used by the round-trip test: a frame and its
 * serialise→deserialise twin must produce byte-identical packed inputs.
 */
export function packedInputs(frame: CapturedFrame): { uniforms: ArrayBuffer; tile: ArrayBuffer } {
  return {
    uniforms: packSimUniforms(frame.uniforms),
    tile: packTileRequest(frame.tile),
  };
}
```

## `src/debug/logger.ts`

```ts
/**
 * Minimal levelled logger. Pluggable sink + an in-memory ring so the dev page
 * (and tests) can read back what was logged. This is deliberately tiny: G11
 * Telemetry later subsumes it behind the same `LogSink` seam — keep the sink
 * signature stable so G11 can swap the sink without touching call sites.
 */

export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
}

export interface LogRecord {
  level: LogLevel;
  msg: string;
  ts: number;            // ms epoch (injectable for tests)
  data?: unknown;
}

/** The seam G11 Telemetry replaces. A sink receives every record at/above the
 *  logger's threshold. */
export type LogSink = (rec: LogRecord) => void;

export interface LoggerOpts {
  level?: LogLevel;
  sink?: LogSink;
  ringSize?: number;     // 0 disables the ring
  now?: () => number;
}

export class Logger {
  private level: LogLevel;
  private sink: LogSink;
  private ring: LogRecord[] = [];
  private ringSize: number;
  private now: () => number;

  constructor(opts: LoggerOpts = {}) {
    this.level = opts.level ?? LogLevel.Info;
    this.sink = opts.sink ?? (() => {});
    this.ringSize = opts.ringSize ?? 256;
    this.now = opts.now ?? (() => Date.now());
  }

  setLevel(level: LogLevel): void { this.level = level; }

  private emit(level: LogLevel, msg: string, data?: unknown): void {
    if (level < this.level) return;
    const rec: LogRecord = { level, msg, ts: this.now() };
    if (data !== undefined) rec.data = data;        // exactOptionalPropertyTypes
    if (this.ringSize > 0) {
      this.ring.push(rec);
      if (this.ring.length > this.ringSize) this.ring.shift();
    }
    this.sink(rec);
  }

  debug(msg: string, data?: unknown): void { this.emit(LogLevel.Debug, msg, data); }
  info(msg: string, data?: unknown): void  { this.emit(LogLevel.Info, msg, data); }
  warn(msg: string, data?: unknown): void  { this.emit(LogLevel.Warn, msg, data); }
  error(msg: string, data?: unknown): void { this.emit(LogLevel.Error, msg, data); }

  /** Snapshot the ring (most recent last). */
  records(): readonly LogRecord[] { return [...this.ring]; }
  clear(): void { this.ring = []; }
}

/** A console sink for the dev page. */
export const consoleSink: LogSink = (rec) => {
  const tag = LogLevel[rec.level] ?? String(rec.level);
  const line = `[${tag}] ${rec.msg}`;
  if (rec.level >= LogLevel.Error) console.error(line, rec.data ?? '');
  else if (rec.level >= LogLevel.Warn) console.warn(line, rec.data ?? '');
  else console.log(line, rec.data ?? '');
};
```

## `src/debug/inspector.ts`

```ts
/**
 * GPU buffer inspector: pick a sample (x, y) on the M3 grid → readback the
 * SimResult buffer (via M3's readbackSimResults) → return a flat table of rows
 * for the decoded DecodedSimResult plus the decoded sample_descriptor bitfields.
 * The dev page renders these rows verbatim. Production never calls this — the
 * readback crosses GPU→CPU, so it lives behind the debug module only.
 */
import type { GpuContext } from '@/gpu/init.js';
import type { TileBuffers } from '@/gpu/buffers.js';
import { readbackSimResults, type DecodedSimResult } from '@/gpu/readback.js';
import { decodeDescriptor } from './descriptor_bits.js';

export interface InspectRow {
  field: string;
  value: string;
}

export interface SampleInspection {
  sample: number;        // flat index
  x: number;
  y: number;
  decoded: DecodedSimResult;
  rows: readonly InspectRow[];
}

/** Build the flat table of rows for one decoded SimResult. Pure. */
export function inspectionRows(d: DecodedSimResult): InspectRow[] {
  const bits = decodeDescriptor(d.sample_descriptor);
  const r = (field: string, value: string | number): InspectRow =>
    ({ field, value: typeof value === 'number' ? formatNum(value) : value });
  const ckRows = d.n_checkpoints.map((c, i) =>
    r(`n[${i}]`, `(${formatNum(c.x)}, ${formatNum(c.y)}, ${formatNum(c.z)}, ${formatNum(c.w)})`));
  return [
    r('outcome', `${bits.outcomeName} (${bits.outcomeClass})`),
    r('detail', bits.detail),
    r('suspect_energy', String(bits.suspectEnergy)),
    r('suspect_Lz', String(bits.suspectLz)),
    r('FTLE_VALID', String(bits.ftleValid)),
    r('word_truncated', String(bits.wordTruncated)),
    r('word_uncertain', String(bits.wordUncertain)),
    r('encounter_count', bits.encounterCount),
    r('substep_log2', bits.substepLog2),
    r('benettin_count', bits.benettinCount),
    r('dominant_pair', bits.dominantPair),
    r('t_end', d.t_end),
    r('d_min', d.d_min),
    r('ftle', d.ftle),
    r('energy_drift', d.energy_drift),
    r('delta_E_max_abs', d.delta_E_max_abs),
    r('Lz_drift', d.Lz_drift),
    r('delta_Lz_max_abs', d.delta_Lz_max_abs),
    r('E_0', d.E_0),
    r('Lz_0', d.Lz_0),
    r('arc_length_n', d.arc_length_n),
    r('diffusion', d.diffusion),
    r('descriptor(raw)', `0x${(d.sample_descriptor >>> 0).toString(16)}`),
    ...ckRows,
  ];
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);     // NaN / Infinity surface as-is
  return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? v.toFixed(6) : v.toExponential(4);
}

/**
 * Readback the whole tile and inspect one sample. `N` must match the dispatch
 * grid. Throws if (x,y) is out of range — picking off-grid is a caller bug.
 */
export async function pickSample(
  ctx: GpuContext, bufs: TileBuffers, N: number, x: number, y: number,
): Promise<SampleInspection> {
  if (x < 0 || y < 0 || x >= N || y >= N) {
    throw new Error(`pickSample out of range: (${x},${y}) for N=${N}`);
  }
  const all = await readbackSimResults(ctx, bufs);
  const sample = y * N + x;
  const decoded = all[sample]!;
  return { sample, x, y, decoded, rows: inspectionRows(decoded) };
}
```

## `src/debug/index.ts`

```ts
export * from './descriptor_bits.js';
export * from './struct_dump.js';
export * from './finite_scan.js';
export * from './debug_modes.js';
export * from './frame_capture.js';
export * from './logger.js';
export * from './inspector.js';
```

## `src/gpu/shaders/render_layer0.wgsl` (modified)

Extend the M3 fragment shader with a `DebugUniform` at `group(0) @binding(2)`
and branch on `dbg.mode`. The default mode (`0` = Outcome) is **byte-for-byte
the M3 colouring**: the `debug` buffer in `TileBuffers` is zero-filled at
creation, and a zero-filled uniform reads `mode = 0`, so every existing caller
gets the original picture (verified: `gpu:check` numbers identical to M3).

Two as-built corrections to the original listing (D17.1–D17.3): the structs are
repeated **in full** (the module compiles standalone — placeholders are invalid
WGSL, M3's D3.3), `results` is `read_write` to match the 'storage' layout, the
uniform variable is named `dbg` (reserved-word safety), and the binding rides
through `buffers.ts`/`pipelines.ts` because M3's **explicit** pipeline layout
rejects a shader that statically uses a binding absent from the layout. The
modified source (structs elided here only for the doc — they are repeated in
full in the file, byte-identical to `simulate.wgsl`/`structs.ts`):

```wgsl
// Layer-0 fragment shader with debug render modes (G17).
// mode 0 (Outcome) reproduces the original M3 colouring exactly.

struct SimUniforms { /* full definition repeated in the real file */ };
struct SimResult   { /* full definition repeated in the real file */ };

// Three-place rule: this struct + packDebugUniform (src/debug/debug_modes.ts)
// + the 16-byte pin in test/unit/debug/debug_modes.test.ts change together.
struct DebugUniform {
  mode:             f32,   // DebugMode (see src/debug/debug_modes.ts)
  heat_scale:       f32,   // drift heatmaps: t = clamp(value / heat_scale, 0, 1)
  checkpoint_count: u32,   // for checkpoint-completeness
  _pad:             f32,
};

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
@group(0) @binding(2) var<uniform> dbg      : DebugUniform;
@group(1) @binding(0) var<storage, read_write> results : array<SimResult>;

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vid], 0.0, 1.0);
}

// --- descriptor bit decode (mirror of src/debug/descriptor_bits.ts / M6) ---
fn outcome_class(d: u32) -> u32 { return d & 0x7u; }
fn detail_bits(d: u32) -> u32 { return (d >> 3u) & 0x3u; }
fn suspect_energy(d: u32) -> bool { return ((d >> 5u) & 1u) == 1u; }
fn suspect_lz(d: u32) -> bool { return ((d >> 6u) & 1u) == 1u; }
fn ftle_valid(d: u32) -> bool { return ((d >> 7u) & 1u) == 1u; }
fn word_truncated(d: u32) -> bool { return ((d >> 8u) & 1u) == 1u; }
fn word_uncertain(d: u32) -> bool { return ((d >> 9u) & 1u) == 1u; }
fn encounter_count(d: u32) -> u32 { return (d >> 10u) & 0x3fu; }
fn substep_log2(d: u32) -> u32 { return (d >> 16u) & 0x7fu; }
fn benettin_count(d: u32) -> u32 { return (d >> 23u) & 0x7fu; }
fn dominant_pair(d: u32) -> u32 { return (d >> 30u) & 0x3u; }

// Simple blue→red heat ramp for t in [0,1].
fn heat(t: f32) -> vec3<f32> {
  let c = clamp(t, 0.0, 1.0);
  return vec3<f32>(c, 0.4 * (1.0 - abs(2.0 * c - 1.0)), 1.0 - c);
}

fn colour_outcome(cls: u32) -> vec3<f32> {
  if (cls == 0u) { return vec3<f32>(0.7, 0.7, 0.2); }      // bounded
  else if (cls == 1u) { return vec3<f32>(0.9, 0.1, 0.1); } // collision
  else if (cls == 2u) { return vec3<f32>(0.1, 0.4, 0.9); } // escape
  else if (cls == 3u) { return vec3<f32>(0.5, 0.5, 0.5); } // degenerate
  else { return vec3<f32>(1.0, 0.9, 0.0); }                // timeout
}

// Distinct hues for a small categorical code (e.g. detail bits 0..3).
fn colour_category(k: u32) -> vec3<f32> {
  let h = f32(k) * 0.61803398875;          // golden-ratio hue stepping
  let frac = h - floor(h);
  return heat(frac);
}

@fragment
fn fs_main(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let N = uniforms.samples_per_axis;
  let tile_pix = 32.0;
  let sx = u32(floor(frag.x / tile_pix));
  let sy = u32(floor(frag.y / tile_pix));
  let idx = clamp(sy * N + sx, 0u, N * N - 1u);
  var r = results[idx];   // var: mode 5 dynamically indexes r.n_checkpoints
  let d = r.sample_descriptor;
  let cls = outcome_class(d);

  var rgb: vec3<f32>;
  let mode = u32(dbg.mode + 0.5);
  switch mode {
    case 0u: { rgb = colour_outcome(cls); }                       // Outcome (M3 default)
    case 1u: { rgb = colour_category(detail_bits(d)); }           // Detail bits (3..4)
    case 2u: {                                                     // FtleValid (bit 7)
      rgb = select(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.2, 0.9, 0.3), ftle_valid(d));
    }
    case 3u: {                                                     // Suspect: bit 5 OR bit 6
      let suspect = suspect_energy(d) || suspect_lz(d);
      rgb = select(vec3<f32>(0.3, 0.3, 0.3), vec3<f32>(0.9, 0.2, 0.2), suspect);
    }
    case 4u: {                                                     // EnergyDriftHeat
      rgb = heat(clamp(r.delta_E_max_abs / dbg.heat_scale, 0.0, 1.0));
    }
    case 5u: {                                                     // CheckpointCompleteness
      // fraction of non-zero checkpoints / M (dbg.checkpoint_count = M).
      var written = 0u;
      for (var m = 0u; m < dbg.checkpoint_count; m = m + 1u) {
        let c = r.n_checkpoints[m];
        if (any(c != vec4<f32>(0.0))) { written = written + 1u; }
      }
      let frac = f32(written) / max(f32(dbg.checkpoint_count), 1.0);
      rgb = heat(clamp(frac, 0.0, 1.0));
    }
    default: { rgb = colour_outcome(cls); }
  }
  return vec4<f32>(rgb, 1.0);
}
```

> Three-place rule reminder (GPU non-negotiable): the `DebugUniform` is a new
> shared struct. If you change it, change all three in one commit — this WGSL
> struct, `packDebugUniform` in `debug_modes.ts`, and add a size pin to
> `debug_modes.test.ts`. The debug uniform is **bring-up only**; G3's `Layouts`
> authority owns the real bind-group layout later, and G18 wires this branch
> into the app HUD.

## `dev/debug_harness.ts`

```ts
/**
 * Standalone dev harness. Boots the M3 pipeline against a live canvas, renders
 * the grid, and wires the debug toolbox (mode switch, sample inspector, struct
 * dump, NaN scan, frame capture). No app shell, no frame loop — just M3 + G17.
 *
 * Served by Vite: `npm run dev:debug` opens dev/debug_harness.html.
 */
import { initGpu } from '@/gpu/init.js';
import { createTileBuffers } from '@/gpu/buffers.js';
import { buildPipelines } from '@/gpu/pipelines.js';
import { dispatchLayer0, type DispatchView } from '@/gpu/dispatch_layer0.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { packDebugUniform, DebugMode, DEBUG_MODES, debugModeLabel } from '@/debug/debug_modes.js';
import { pickSample } from '@/debug/inspector.js';
import { dumpStructLayouts } from '@/debug/struct_dump.js';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { readbackSimResults } from '@/gpu/readback.js';
import { captureFrame, serializeFrame, deserializeFrame } from '@/debug/frame_capture.js';
import { Logger, consoleSink } from '@/debug/logger.js';

const N = 16;
const M = 8;
const TILE_PIX = 32;

const log = new Logger({ sink: consoleSink });

const DEFAULT_UNIFORMS: SimUniforms = {
  m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
  mu_max: 5, alpha_min: 0.05, q_max: 2,
};
const DEFAULT_TILE: TileRequest = {
  z: 0, tx: 0, ty: 0, level: 0,
  uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
};

async function main(): Promise<void> {
  const canvas = document.getElementById('grid') as HTMLCanvasElement;
  canvas.width = N * TILE_PIX;
  canvas.height = N * TILE_PIX;

  if (!('gpu' in navigator)) {
    document.body.append(Object.assign(document.createElement('p'), {
      textContent: 'WebGPU unavailable in this browser.',
    }));
    return;
  }

  const ctx = await initGpu(canvas);
  const gpuCtx = canvas.getContext('webgpu')!;
  gpuCtx.configure({ device: ctx.device, format: ctx.format, alphaMode: 'opaque' });

  const bufs = createTileBuffers(ctx, N, M);
  // Shaders arrive as Vite `?raw` static imports, concatenated in the same
  // order as the M3 integration test (helpers, observe, events, integrate,
  // decode, simulate) plus the standalone render module.
  const pl = await buildPipelines(ctx, bufs, loadShaders());

  // The DebugUniform buffer is `bufs.debug` — created zero-filled (mode 0 =
  // M3 colouring) by createTileBuffers and bound at group(0) binding(2) by
  // buildPipelines (D17.1: M3's explicit pipeline layout must carry the
  // binding, so it cannot be a harness-local buffer). G3 later formalises the
  // bind-group layout authority.

  let mode: DebugMode = DebugMode.Outcome;
  let heatScale = 1e-3;

  function frame(): void {
    ctx.device.queue.writeBuffer(bufs.debug, 0, packDebugUniform(mode, heatScale, M));
    const view: DispatchView = { uniforms: DEFAULT_UNIFORMS, tile: DEFAULT_TILE };
    dispatchLayer0(ctx, bufs, pl, view, gpuCtx.getCurrentTexture().createView());
    log.debug(`dispatched mode=${debugModeLabel(mode)}`);
  }
  frame();

  buildControls({
    onMode: (m) => { mode = m; frame(); },
    onHeat: (h) => { heatScale = h; frame(); },
    onPick: async (x, y) => {
      const ins = await pickSample(ctx, bufs, N, x, y);
      renderInspectorTable(ins.rows);
      log.info(`picked sample (${x},${y}) #${ins.sample}`);
    },
    onDump: () => dumpStructLayouts(M, (s) => log.info(s)),
    onScan: async () => {
      const ab = await readbackToArrayBuffer(ctx, bufs);
      const hits = scanNonFinite(ab, N, M);
      log.warn(`non-finite samples: ${JSON.stringify(nonFiniteSamples(hits))}`);
    },
    onCapture: () => {
      const json = serializeFrame(captureFrame(N, M, DEFAULT_UNIFORMS, DEFAULT_TILE, 'dev capture'));
      void deserializeFrame(json);   // validate round-trip before download
      downloadJson('frame.json', json);
    },
  });
}

// loadShaders / buildControls / renderInspectorTable / readbackToArrayBuffer /
// downloadJson are small dev-only DOM/IO helpers; see debug_harness.html for the
// glue. They are intentionally untested (DOM-bound); the logic they call into
// (debug/*) is covered by test/unit/debug/*.

void main().catch((e) => log.error('harness failed', e));
```

## `dev/debug_harness.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Principia · M3 debug harness (G17)</title>
    <style>
      body { font: 13px/1.4 monospace; margin: 16px; display: flex; gap: 24px; }
      canvas { image-rendering: pixelated; border: 1px solid #444; }
      #controls { min-width: 280px; }
      #inspector td { padding: 1px 8px; border-bottom: 1px solid #222; }
      .legend span { display: inline-block; width: 12px; height: 12px; margin-right: 4px; }
    </style>
  </head>
  <body>
    <canvas id="grid"></canvas>
    <div id="controls">
      <div id="mode-buttons"></div>
      <label>heat scale <input id="heat" type="number" step="1e-4" value="0.001" /></label>
      <div>pick: x <input id="px" type="number" value="0" min="0" />
                y <input id="py" type="number" value="0" min="0" />
        <button id="pick">inspect</button></div>
      <button id="dump">struct dump</button>
      <button id="scan">NaN scan</button>
      <button id="capture">capture frame</button>
      <table id="inspector"></table>
      <pre id="log"></pre>
    </div>
    <!-- Vite resolves @/ via tsconfig paths; shaders are imported as ?raw. -->
    <script type="module" src="./debug_harness.ts"></script>
  </body>
</html>
```

> The `?raw` shader imports and `@/` resolution are provided by the Vite config
> the `dev:debug` script points at. Because this repo is pre-tooling at M3, the
> milestone's "Run it" section pins the exact `package.json`/`vite.config`
> additions so the page actually serves; nothing else in the build needs to
> change.

## Tests

### `test/unit/debug/descriptor_bits.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decodeDescriptor, classOf, OUTCOME_NAMES } from '@/debug/descriptor_bits.js';

describe('decodeDescriptor', () => {
  it('M3 collision with pair=2 → class 1, detail 2, no flags', () => {
    const raw = (1 & 0x7) | ((2 & 0x3) << 3);     // exactly what simulate.wgsl writes
    const b = decodeDescriptor(raw);
    expect(b.outcomeClass).toBe(1);
    expect(b.outcomeName).toBe('COLLISION');
    expect(b.detail).toBe(2);
    expect(b.suspectEnergy).toBe(false);
    expect(b.suspectLz).toBe(false);
    expect(b.ftleValid).toBe(false);
    expect(b.wordTruncated).toBe(false);
    expect(b.wordUncertain).toBe(false);
    expect(b.encounterCount).toBe(0);
    expect(b.substepLog2).toBe(0);
    expect(b.benettinCount).toBe(0);
    expect(b.dominantPair).toBe(0);
  });

  it('decodes the upper M6 fields (exact M6 layout)', () => {
    const raw =
      (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) |
      ((0x2a & 0x3f) << 10) |    // encounterCount = 42
      ((0x55 & 0x7f) << 16) |    // substepLog2 = 85
      ((0x33 & 0x7f) << 23) |    // benettinCount = 51
      ((2 & 0x3) << 30);         // dominantPair = 2
    const b = decodeDescriptor(raw);
    expect(b.suspectEnergy).toBe(true);
    expect(b.suspectLz).toBe(true);
    expect(b.ftleValid).toBe(true);
    expect(b.wordTruncated).toBe(true);
    expect(b.wordUncertain).toBe(true);
    expect(b.encounterCount).toBe(42);
    expect(b.substepLog2).toBe(85);
    expect(b.benettinCount).toBe(51);
    expect(b.dominantPair).toBe(2);
  });

  it('classOf matches the M3 mask', () => {
    expect(classOf(0xffffffff)).toBe(7);
    expect(classOf(4)).toBe(4);
  });

  it('OUTCOME_NAMES covers classes 0..4', () => {
    expect(OUTCOME_NAMES.slice(0, 5)).toEqual(
      ['BOUNDED', 'COLLISION', 'ESCAPE', 'DEGENERATE', 'TIMEOUT']);
  });
});
```

### `test/unit/debug/struct_dump.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { simUniformsLayout, simResultLayout, formatLayout } from '@/debug/struct_dump.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

describe('simUniformsLayout', () => {
  const L = simUniformsLayout();
  it('totals 96 bytes and matches packSimUniforms offsets', () => {
    expect(L.totalSize).toBe(96);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['M_total']).toBe(12);
    expect(off['samples_per_axis']).toBe(72);
    expect(off['mu_max']).toBe(76);
    expect(off['q_max']).toBe(84);
  });
  it('every field fits inside the struct', () => {
    for (const f of L.fields) expect(f.offset + f.size).toBeLessThanOrEqual(96);
  });
});

describe('simResultLayout', () => {
  it('M=8 totals 208 bytes; descriptor at offset 188', () => {
    const L = simResultLayout(8);
    expect(L.totalSize).toBe(sizeOfSimResult(8));
    expect(L.totalSize).toBe(208);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['free_group_word']).toBe(128);
    expect(off['arc_length_n']).toBe(144);
    expect(off['sample_descriptor']).toBe(188);
    expect(off['trajectory_stats']).toBe(192);
  });
  it('formatLayout produces a non-empty table header', () => {
    expect(formatLayout(simResultLayout(8))).toContain('SimResult(M=8)');
  });
});
```

### `test/unit/debug/finite_scan.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

const N = 4, M = 8, STRIDE = sizeOfSimResult(M);

function blankBuffer(): ArrayBuffer { return new ArrayBuffer(STRIDE * N * N); }

describe('scanNonFinite', () => {
  it('an all-zero (finite) buffer yields no hits', () => {
    expect(scanNonFinite(blankBuffer(), N, M)).toEqual([]);
  });

  it('finds a NaN in energy_drift and an Inf in a checkpoint lane', () => {
    const ab = blankBuffer();
    // sample 5: energy_drift NaN. scalar base lane = M*4 + 4 = 36; energy_drift is index 4.
    new Float32Array(ab, 5 * STRIDE, STRIDE / 4)[36 + 4] = NaN;
    // sample 9: n_checkpoints[2].y = +Inf (lane 2*4 + 1 = 9).
    new Float32Array(ab, 9 * STRIDE, STRIDE / 4)[9] = Infinity;
    const hits = scanNonFinite(ab, N, M);
    expect(hits.some((h) => h.sample === 5 && h.field === 'energy_drift')).toBe(true);
    expect(hits.some((h) => h.sample === 9 && h.field === 'n_checkpoints[2].y')).toBe(true);
    expect(nonFiniteSamples(hits)).toEqual([5, 9]);
  });

  it('does NOT flag the u32 free-group word (it is not scanned as f32)', () => {
    const ab = blankBuffer();
    // Set the free-group word bytes to a u32 that, as f32, would be NaN.
    new Uint32Array(ab, 3 * STRIDE, STRIDE / 4)[M * 4] = 0x7fc00000;
    expect(scanNonFinite(ab, N, M)).toEqual([]);
  });
});
```

### `test/unit/debug/debug_modes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  DebugMode, DEBUG_MODES, debugModeLabel, packDebugUniform,
} from '@/debug/debug_modes.js';

describe('debug modes', () => {
  it('DEBUG_MODES is total over the enum values', () => {
    const enumVals = Object.values(DebugMode).filter((v) => typeof v === 'number') as number[];
    const lutVals = DEBUG_MODES.map((m) => m.mode);
    expect(new Set(lutVals)).toEqual(new Set(enumVals));
    expect(DEBUG_MODES).toHaveLength(enumVals.length);
  });

  it('every swatch is a valid sRGB triple', () => {
    for (const m of DEBUG_MODES) {
      expect(m.swatch).toHaveLength(3);
      for (const c of m.swatch) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
  });

  it('debugModeLabel never throws and falls through for reserved values', () => {
    expect(debugModeLabel(DebugMode.Outcome)).toBe('Outcome class');
    expect(debugModeLabel(99)).toBe('MODE99');
  });

  it('packDebugUniform is 16 bytes; mode/scale/checkpoints round-trip', () => {
    const buf = packDebugUniform(DebugMode.EnergyDriftHeat, 2e-3, 8);
    expect(buf.byteLength).toBe(16);
    const f = new Float32Array(buf); const u = new Uint32Array(buf);
    expect(f[0]).toBe(DebugMode.EnergyDriftHeat);
    expect(f[1]).toBeCloseTo(2e-3, 9);
    expect(u[2]).toBe(8);
  });

  it('packDebugUniform clamps a non-positive heat scale to 1', () => {
    expect(new Float32Array(packDebugUniform(DebugMode.EnergyDriftHeat, 0, 8))[1]).toBe(1);
  });
});
```

### `test/unit/debug/frame_capture.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  captureFrame, serializeFrame, deserializeFrame, packedInputs, FRAME_CAPTURE_VERSION,
} from '@/debug/frame_capture.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';

const uniforms: SimUniforms = {
  m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: 8, samples_per_axis: 16,
  mu_max: 5, alpha_min: 0.05, q_max: 2,
};
const tile: TileRequest = {
  z: 0, tx: 0, ty: 0, level: 0, uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
};

const bytesEqual = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

describe('frame capture round-trip', () => {
  it('serialise → deserialise yields byte-identical packed inputs (determinism)', () => {
    const f0 = captureFrame(16, 8, uniforms, tile, 'note');
    const f1 = deserializeFrame(serializeFrame(f0));
    const p0 = packedInputs(f0), p1 = packedInputs(f1);
    expect(bytesEqual(p0.uniforms, p1.uniforms)).toBe(true);
    expect(bytesEqual(p0.tile, p1.tile)).toBe(true);
    expect(f1.label).toBe('note');
  });

  it('rejects a version mismatch', () => {
    const bad = serializeFrame(captureFrame(16, 8, uniforms, tile)).replace(
      `"version": ${FRAME_CAPTURE_VERSION}`, '"version": 999');
    expect(() => deserializeFrame(bad)).toThrow(/version/);
  });

  it('rejects a capture missing required fields', () => {
    expect(() => deserializeFrame(JSON.stringify({ version: FRAME_CAPTURE_VERSION })))
      .toThrow(/required/);
  });
});
```

### `test/unit/debug/logger.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Logger, LogLevel, type LogRecord } from '@/debug/logger.js';

describe('Logger', () => {
  it('gates below the threshold', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Warn, sink: (r) => seen.push(r) });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(seen.map((r) => r.msg)).toEqual(['w', 'e']);
  });

  it('captures into a bounded ring and clears', () => {
    const log = new Logger({ level: LogLevel.Debug, ringSize: 2, now: () => 42 });
    log.info('a'); log.info('b'); log.info('c');
    expect(log.records().map((r) => r.msg)).toEqual(['b', 'c']);
    expect(log.records()[0]!.ts).toBe(42);
    log.clear();
    expect(log.records()).toEqual([]);
  });

  it('passes structured data through to the sink', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Debug, sink: (r) => seen.push(r) });
    log.info('with data', { sample: 7 });
    expect(seen[0]!.data).toEqual({ sample: 7 });
  });

  it('setLevel changes gating at runtime', () => {
    const seen: LogRecord[] = [];
    const log = new Logger({ level: LogLevel.Error, sink: (r) => seen.push(r) });
    log.warn('hidden');
    log.setLevel(LogLevel.Debug);
    log.warn('shown');
    expect(seen.map((r) => r.msg)).toEqual(['shown']);
  });
});
```

### `test/integration/debug_harness.test.ts`

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
import { inspectionRows } from '@/debug/inspector.js';
import { scanNonFinite, nonFiniteSamples } from '@/debug/finite_scan.js';
import { captureFrame, serializeFrame, deserializeFrame, packedInputs } from '@/debug/frame_capture.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = (f: string) => readFileSync(path.join(here, '../../src/gpu/shaders', f), 'utf-8');
// Same concat order as the M3 layer0 test, with the G17-modified render module.
const simulate = [S('helpers.wgsl'), S('observe.wgsl'), S('events.wgsl'),
  S('integrate.wgsl'), S('decode.wgsl'), S('simulate.wgsl')].join('\n');
const render = S('render_layer0.wgsl');

// Robust guard (M3 D3.4): a bare `'gpu' in navigator` throws when `navigator`
// itself is undefined in the Node test runner.
function hasWebGPU(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator;
  return !!nav && typeof nav === 'object' && 'gpu' in nav;
}

describe.skipIf(!hasWebGPU())('debug harness (real M3 dispatch)', () => {
  const N = 16, M = 8;
  const uniforms: SimUniforms = {
    m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
    dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
    r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
    quality_tier: 1, checkpoint_count: M, samples_per_axis: N,
    mu_max: 5, alpha_min: 0.05, q_max: 2,
  };
  const tile: TileRequest = {
    z: 0, tx: 0, ty: 0, level: 0, uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
  };

  it('dispatches, inspects a sample, scans for NaN, and round-trips a capture', async () => {
    const ctx = await initGpu();
    const bufs = createTileBuffers(ctx, N, M);
    const pl = await buildPipelines(ctx, bufs, { simulate, render });

    const fakeView = ctx.device.createTexture({
      size: { width: N * 32, height: N * 32 }, format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }).createView();
    dispatchLayer0(ctx, bufs, pl, { uniforms, tile }, fakeView);

    const all = await readbackSimResults(ctx, bufs);
    expect(all).toHaveLength(N * N);

    // Inspector produces a non-empty table for a real sample.
    const rows = inspectionRows(all[Math.floor(N * N / 2)]!);
    expect(rows.some((r) => r.field === 'outcome')).toBe(true);

    // A correct M3 run emits no non-finite metric lanes.
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(bufs.simResults, 0, bufs.readback, 0, bufs.simResults.size);
    ctx.device.queue.submit([enc.finish()]);
    await bufs.readback.mapAsync(GPUMapMode.READ);
    const ab = bufs.readback.getMappedRange().slice(0);
    bufs.readback.unmap();
    expect(ab.byteLength).toBe(sizeOfSimResult(M) * N * N);
    expect(nonFiniteSamples(scanNonFinite(ab, N, M))).toEqual([]);

    // Capture this exact frame and confirm the round-trip re-packs identically.
    const f1 = deserializeFrame(serializeFrame(captureFrame(N, M, uniforms, tile)));
    const re = packedInputs(f1);
    expect(re.uniforms.byteLength).toBe(96);
    expect(re.tile.byteLength).toBe(48);
  }, 120_000);
});
```

## Run it

The dev page needs a Vite entry: a `vite` devDependency (as-built: ^8.1.3),
the script below, and a minimal root `vite.config.ts` that maps `@/` → `src/`
and serves `dev/`. Vite resolves the project's `.js`-suffixed TS imports
natively; `dev/` and `vite.config.ts` stay outside the tsconfig/eslint scope
(dev-only DOM glue — the logic it calls lives in `src/debug/*`, which is
unit-tested).

```jsonc
{
  "scripts": {
    "dev:debug": "vite dev --open /dev/debug_harness.html"
  }
}
```

```ts
// vite.config.ts (additions for the dev harness)
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // WGSL imported as ?raw in debug_harness.ts's loadShaders().
  assetsInclude: ['**/*.wgsl'],
});
```

Then:

```bash
npm test -- --run test/unit/debug              # the exit gate (≥18 tests)
npm test -- --run test/integration/debug_harness   # real GPU only; skips otherwise
npm run dev:debug                              # opens the live M3 grid + toolbox
```

## Acceptance check

```bash
npm test -- --run test/unit/debug
```

returns green with at least **18** tests (as built: **23**) across the six
`test/unit/debug/*` suites, AND `npm run dev:debug` opens a page that renders the M3 grid to a live
canvas, lets you switch debug render modes, inspect any sample's decoded
`SimResult` + `sample_descriptor` bitfields, dump struct offsets, scan for
non-finite lanes, and capture/reload a frame. The harness integration test
passes on a WebGPU-capable machine and skips cleanly without one.

**Deliverable:** you can open a page and SEE the M3 grid render + inspect any
sample.

## Notes for the implementer

- **M3 is the only dependency.** There is no `App`, frame loop, capability
  layer, error boundary, or inspector panel yet. Everything here stands alone on
  the M3 reuse surfaces named above. Do not import from any `G*`/`M4+` module —
  they do not exist when G17 builds.
- **Default debug mode = M3 colouring.** A zero-filled `DebugUniform` reads
  `mode = 0` (Outcome), which is byte-for-byte the original M3 fragment output.
  Any existing M3 render path that never binds `binding(2)` is unaffected; the
  extension is additive.
- **The descriptor table is the contract.** `descriptor_bits.ts` and the WGSL
  decode functions in `render_layer0.wgsl` must stay in lockstep — they are two
  copies of the same bit layout (the exact M6 §6.6 layout, mirror of the GPU
  three-place rule). M3 only populates bits 0..4; bits 5..31 read as `false`/`0`
  until M6 ships their producers, and the tests assert exactly that.
- **finite_scan skips the u32 free-group word on purpose.** It is a bitfield,
  not a float; reinterpreting it as f32 would produce spurious NaN hits. The
  test pins this.
- **frame_capture is the determinism harness.** M3's dispatch is a pure function
  of the packed `SimUniforms`/`TileRequest`, so a serialise→reload→re-dispatch
  reproduces a frame exactly. The schema is `version`-gated so M8/G7 can add
  `ViewState` + ensemble seeds without breaking older captures (bump the version
  and branch in `deserializeFrame`).
- **The logger is a seam, not a product.** Keep `LogSink` stable: G11 Telemetry
  replaces the sink (network/buffered) without touching call sites. Do not grow
  the logger here — that is G11's milestone.
- **Bring-up bind group is provisional — but it lives in M3's layout (D17.1).**
  M3's `buildPipelines` uses an *explicit* pipeline layout, and WebGPU rejects
  a pipeline whose shader statically uses a binding absent from that layout —
  so the `DebugUniform` cannot be a harness-local buffer. `createTileBuffers`
  allocates `bufs.debug` (16 B, zero-filled → mode 0 → M3 colouring) and
  `buildPipelines` carries binding 2 in the common layout/bind group. **G3**
  later owns the bind-group layout authority and **G18** folds the debug modes
  + inspector into the app HUD.
- **G18 follow-on.** This milestone is deliberately standalone. G18 ("debug HUD,
  app-integrated") promotes `debug_modes`, the inspector table, and the
  frame-capture button into the real UI shell once it exists, reusing every pure
  module here verbatim.
