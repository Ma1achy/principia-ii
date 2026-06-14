---
name: principia-gpu
description: >-
  Conventions for Principia's WebGPU/WGSL layer. Covers the rule that TypeScript
  struct layouts and their WGSL counterparts must stay byte-for-byte identical,
  workgroup sizing, the f32-on-GPU plus tile-local-precision rule, bind-group
  organisation, the principia_ shader namespace, and what data is allowed to
  cross the GPU<->CPU boundary. Use this skill whenever writing or editing
  anything under src/gpu/, any .wgsl file, any struct shared between TypeScript
  and a shader (SimResult, ICDescriptor, TileReduction, SimUniforms,
  TileRequest), or any compute/render pass dispatch. Apply it even for a small
  tweak: a one-byte layout mismatch silently corrupts every pixel and produces
  no error, so the discipline here is non-negotiable on the GPU path.
---

# Principia GPU / WGSL conventions

The GPU layer is where Principia is least forgiving. A struct that is one byte
out of alignment, a uniform read in the wrong address space, or an `f64` that
leaks onto the device will not throw — it will quietly return wrong numbers for
a million pixels. Everything below exists to keep that from happening. Read it
before touching `src/gpu/` or any `.wgsl` file.

## The cardinal rule: TS and WGSL layouts are one artifact

Every struct that crosses the CPU/GPU boundary has two declarations — a
TypeScript packer and a WGSL struct — and they describe **the same bytes**.
`src/gpu/structs.ts` is the single source of truth: it computes each struct's
size under WGSL alignment rules and exposes `pack*` functions. The sizes are
pinned by `test/.../layer0_struct_alignment.test.ts`. If you change a field,
you change it in **three** places in the same commit:

1. the WGSL struct,
2. the TypeScript `pack*` function and its interface in `structs.ts`,
3. the size assertion in the alignment pin test.

Never hand-edit one side and assume the other still matches. When in doubt,
recompute the size with the helper functions rather than eyeballing it.

### WGSL alignment rules you must apply by hand

WGSL follows std140/std430-style rules. Get these wrong and the device reads
garbage:

| Type | Align | Size |
|------|-------|------|
| `f32`, `u32`, `i32` | 4 | 4 |
| `vec2<f32>` | 8 | 8 |
| `vec3<f32>` | **16** | 12 (occupies 16 in a struct/array) |
| `vec4<f32>` | 16 | 16 |
| struct | max member align (>= 16 if it holds any vec3/vec4) | rounded up to a multiple of its align |
| array element | — | stride = roundUp(sizeof(T), align(T)); **in `uniform` space, array stride rounds up to 16** |

The two traps that bite most often:

- **`vec3` is a lie.** A `vec3<f32>` is sized 12 but aligned 16, so it eats a
  4-byte pad. `SimUniforms` lays `m[3]` out as `vec3<f32>` + 4 bytes of pad
  precisely for this reason (80 bytes of fields -> 96-byte buffer).
- **`uniform` vs `storage` address space differ.** Uniform buffers
  (`SimUniforms`, `TileRequest`) use std140 rules where array strides round up
  to 16. Storage buffers (`SimResult`, `ICDescriptor`, `TileReduction`) use
  std430 and are tighter. Decide the address space first, then lay out.

## Struct layout catalogue

Field order in the WGSL struct, the TS interface, and the TS packer must be
**identical** — the packer writes by byte offset, so order is law, not style.
Default `M = 8` checkpoints.

| Struct | Address space | Binding (typical) | Size at M=8 | Notes |
|--------|---------------|-------------------|-------------|-------|
| `SimResult` | storage (RW) | sim output buffer | 208 B | `16*M + 16 + 44 + 8`, padded to 16. M `float4` checkpoints + 1 `uint4` free-group word + 11 floats + 2 u32. |
| `ICDescriptor` | storage (RW) | companion buffer | 64 B | 12 floats (48) padded to 64. Written once per sample after decode, before integration. |
| `TileReduction` | storage (RW) | reduction out | 272 B | Field-by-field sum 268 -> 272. The **only** struct that crosses GPU->CPU. |
| `SimUniforms` | uniform | group(0) binding(0) | 96 B | Frame-level. 80 B of fields padded to 96 (vec3 `m`). |
| `TileRequest` | uniform | group(0) binding(1) | 48 B | Per-tile dispatch params. Carries `uv_centre`, `uv_half`, `flags`. |

`SimResult` records what the trajectory *did*; `ICDescriptor` records properties
of the initial condition itself (masses, geometry, energetics) and is upstream
of integration. Keep them separate — the fragment shader binds both.

If this catalogue grows or you need the exact field list, the authority is
`src/gpu/structs.ts` and spec §6.6; do not reconstruct field offsets from
memory.

## Precision: the GPU is f32-only

The device never sees `f64`. All deep-zoom precision lives on the CPU and is
handed to the shader as a tile-local frame:

- The CPU computes `uv_centre` and `uv_half` in `f64`, then downcasts to `f32`
  uniforms in `TileRequest`.
- The shader computes sample positions **only** as
  `u = uv_centre.x + uv_half.x * (2t - 1)` (and likewise for v), where `t` is
  the tile-local sample coordinate `(i + 0.5) / N`. It never touches
  `uv_min`/`uv_max` or absolute UV. This keeps full `f32` precision across the
  tile width regardless of absolute zoom depth.
- At extreme zoom (default `l_switch = 20`) a `DECODE_MODE` flag in
  `TileRequest.flags` switches the shader to a linearised decoder using a
  CPU-precomputed reference IC and Jacobian. Same `SimResult` output, same
  reduction, same rendering — only the decode path changes.

If you find yourself wanting to pass an absolute coordinate or a `f64` into a
shader, stop: the answer is to move the precision-sensitive arithmetic to the
CPU and pass a tile-local delta.

## Dispatch and workgroups

- Use `@workgroup_size(8, 8, 1)`. One workgroup covers an 8x8 patch of samples.
  This size behaves well across implementations, keeps shared-memory pressure
  low, and divides the common tile sizes cleanly (N=16 -> 4 workgroups,
  N=32 -> 16).
- **Tiles are the dispatch unit, always.** You cannot submit a million-sample
  job in one compute pass — WebGPU enforces dispatch timeouts. Even full-grid
  export partitions the viewport into fixed-size dispatch chunks (~256x256)
  submitted in raster order. "Flat" means flat hierarchy, not one giant
  dispatch.
- **Dispatches cannot be cancelled mid-flight.** When the user pans away, you
  cannot kill an in-flight pass; you can only skip *subsequent* passes for tiles
  that are no longer visible. Design multi-pass work so it can bail between
  passes.
- Treat `shader-f16` as a capability upgrade to detect and opt into, never a
  requirement. Don't assume large workgroup shared memory exists.

## Bind groups and the data-flow boundary

- Pack per-tile constants into **one** uniform/storage record rather than many
  small bindings; keep bind-group counts modest.
- The canonical layout: `group(0) binding(0)` = `SimUniforms`,
  `binding(1)` = `TileRequest`, with `SimResult` and `ICDescriptor` as storage
  buffers the fragment shader binds directly.
- **Only `TileReduction` crosses GPU->CPU during normal operation, and only in
  the adaptive refinement layer.** `SimResult` and `ICDescriptor` never leave
  the GPU — the fragment shader reads them in place. At Layer 0 (flat grid) and
  Layer 1 (tile cache + ancestor fallback) there is *zero* GPU->CPU traffic. If
  a change would route per-sample data back to the CPU, it is almost certainly
  wrong; reduce on the GPU first.

## Shader library conventions

- Shared helpers live in `src/gpu/shaders/helpers.wgsl` and are imported by both
  built-in and custom shaders.
- **Every library function is prefixed `principia_`** to avoid collisions with
  custom shader code. The shader compiler detects name collisions before they
  reach the WGSL compiler — keep that guarantee intact by never dropping the
  prefix.
- Two shader families share the same compilation pipeline: *sim shaders* read
  `SimResult` (and optionally `ICDescriptor`) per pixel to produce the actual
  visualisation; *tile debug shaders* read tile-level data forwarded via a small
  CPU->GPU buffer and composite overlays in the postprocess stage. Don't couple
  the compute shader to the active render mode — palette and render-mode swaps
  must never trigger recomputation.

### Bit-packing patterns

Register budget on the GPU is tight, so several quantities are bit-packed.
Follow the established conventions exactly so downstream readers stay valid:

- The free-group symbolic word is a `uint4` (thread-local): 2 bits per symbol
  packed from the LSB of `.x` upward through `.y`, `.z`, `.w`, with the word
  length `l` stored in the top 6 bits of `.w` (58 usable symbol slots).
- The shape-sphere checkpoint `float4` uses a dual-use `.w`: `.xyz` carry the
  canonical geometric descriptor `n(t)` in S^2 (primary, never compromised) and
  `.w` carries the **unwrapped phase** accumulated during integration.
  **Contract:** any routine that needs only geometry must ignore `.w`. If you
  add a geometry-only reader, ignore `.w`; if you add a phase reader, don't
  assume `.w` is zero.

## Before you finish any GPU change — checklist

- Did you update all three of: WGSL struct, `structs.ts` packer/interface, and
  the alignment pin test?
- Does field **order** match across the WGSL struct and the TS packer?
- Is the size still a multiple of 16, and did you account for every vec3 pad?
- Did you use the right address space rules (uniform std140 vs storage std430)?
- Is the shader still f32-only, reading sample positions via
  `centre + half*(2t-1)`?
- Did you keep all per-sample data on the GPU, with only `TileReduction`
  crossing back?
- Are new helper functions `principia_`-prefixed?

If you cannot tick all of these, the change is not done.
