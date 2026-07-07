# G6 — Linearised decoder for deep zoom

## Goal

The full nonlinear decoder is fine at shallow zoom but hits its `f32`
precision floor around depth 20–23 — adjacent samples within a tile
decode to bitwise-identical ICs because the decode chain (sigmoid →
softmax → trig → canonicalise) loses significant digits faster than
the tile narrows. (In fact the INPUT already collapses: at depth 30 the
per-sample latent offsets are ~2⁻³³ against O(1) latent values — far
below one f32 ulp — so every sample in the tile is bitwise-identical
before any decode arithmetic runs; the golden demonstrates this.)

Spec §6.5 describes the fix: at the tile centre, evaluate the full
decoder at `f64` on the CPU to get a reference IC `x_0`, plus its
Jacobian. Pass both to the GPU as `f32` uniforms. The GPU shader then
computes per-sample ICs as

```
x(t) = x_0 + J · δ,     δ = (2 t_u − 1, 2 t_v − 1) ∈ [−1, 1]²
```

**Convention (one artifact with the code):** `J` is stored in half-tile
δ-units — `J = ∂D/∂δ = ∂D/∂(tile uv) / 2`, the spec's chart-space
`J_D · h` at tile scale — so `δ = 2t − 1` reaches the tile edges at ±1
with NO half-width factor at apply time. Both `applyLinearised` (CPU)
and `decode_linear` (WGSL) use exactly this formula. (An earlier
revision of this doc built J per tile-uv unit but applied it with
δ = 2t − 1 — a factor-2 error its own affine round-trip test caught.)

After G6: a `LinearisedRef` uniform at group(0) binding(4) carrying
`x_0` and `J`; a `decode_linear` shader unit selected by a
`TileRequest.flags` bit; a CPU side that builds the reference at `f64`
via Richardson-extrapolated central differences with a two-scale
smoothness check; and a depth-20 switchover policy. The G2 frame loop
wires the policy to dispatch.

**Exit criterion.**

```bash
npm test -- --run test/golden/linearised_decoder
```

At depth 30 (tile half-width 2⁻³¹), the linearised decoder produces
≥240 distinct ICs across a 16×16 tile and matches the full `f64`
decoder to within 1e-13 in phase-space norm; the golden also pins the
motivating f32 floor (every per-sample latent offset in the tile rounds
away at f32). The GPU side is proven by `npm run gpu:check`'s G6 A/B
gate: a flag-selected `decode_linear` dispatch must agree with the CPU
twin per-sample (max |ΔE₀| < 1e-2; measured ~4e-8).

**Deliverable:** internal — tests only; a linearised decoder (`x_0` + Jacobian uniforms with a `decode_linear` shader path and a depth-20 switchover) keeps deep-zoom samples distinct past the `f32` precision floor, pinned by golden `test/golden/linearised_decoder`.

## File tree

```
principia/
  src/
    decode/
      linearised.ts              # CPU-side reference + Jacobian builder
    gpu/
      linearised_uniforms.ts     # 256-byte uniform packing (beside chart_uniforms.ts)
      layouts.ts                 # frame layout gains b4 (compute-only uniform)
      buffers.ts                 # bufs.linearised + frame bind-group entry
      structs.ts                 # TILE_REQUEST_FLAGS.DECODE_LINEAR
      dispatch_layer0.ts         # DispatchView.linearised (+ flag/ref guard)
      shaders/
        decode_linear.wgsl       # LinearisedRef struct + decode_linear + flag const
        simulate.wgsl            # flag branch: decode_linear vs decode_full
    quadtree/
      decode_mode.ts             # depth-driven switchover
    debug/
      struct_dump.ts             # linearisedRefLayout (G17 companion)
  dev/
    gpu_check.html               # G6 A/B gate (flag dispatch vs CPU twin)
    shader_modules.ts            # decode_linear.wgsl joins the simulate family
  test/
    unit/decode/linearised.test.ts
    unit/gpu/linearised_uniforms.test.ts     # packer lanes + WGSL pin + flag pin
    unit/quadtree/decode_mode.test.ts
    integration/linearised_gpu.test.ts       # real-dispatch A/B (self-skips w/o GPU)
    golden/linearised_decoder.test.ts
```

## Building the reference (`src/decode/linearised.ts`)

`buildLinearised(decodeAtUV, centreUV = [0.5, 0.5], fdStep = 0.25)`
takes a closure mapping TILE-LOCAL uv to a decoded state (or null for
terminal pixels) and returns `{ x0, descriptor0, J_r, J_p, J_m }` or
null. Nine decoder evaluations per tile — centre, ±h and ±h/2 per axis
— amortised over N² GPU samples.

- **The FD step is tile-scale, not chart-scale.** `fdStep` is in
  tile-local units and defaults to 0.25 — probes INSIDE the tile. (An
  earlier revision used 1e-6, which at depth 30 probes a ~1e-15-wide
  physical interval: the f64 difference quotient on O(1) decode outputs
  is then ~10% cancellation noise, and the linear reconstruction misses
  the 1e-13 gate by five orders of magnitude. At deep zoom, a large
  tile-relative step is MORE accurate: the decode is smooth across the
  tile precisely because the tile is tiny.)
- **Richardson extrapolation.** J combines central differences at h and
  h/2 — `(4·C(h/2) − C(h))/3` — killing the O(h²) truncation term; the
  probes double as the smoothness check's second scale for free.
- **Two-scale smoothness check.** A smooth decode's forward/backward
  asymmetry `|fwd − bwd|` is `h·|D''| + O(h³)` — it halves when the
  step halves — while a kink (mirror deadband, feasibility projection,
  sigmoid saturation edge) keeps a constant O(|slope jump|) asymmetry
  at every scale. A lane is non-smooth when the half-step asymmetry
  retains > 0.75 of the full-step asymmetry AND exceeds a rounding-noise
  floor of `1e-12 · max(1, |lane values|) / h` (at deep zoom the true
  differences approach f64 rounding noise, which neither decays nor
  matters — without the floor every deep tile false-positives). A
  single-scale fwd-vs-bwd comparison cannot make this distinction: a
  smooth extremum (J ≈ 0, fwd ≈ −bwd) looks exactly like a kink.
- **Bail semantics.** Terminal centre/probe or a detected kink returns
  null; the caller falls back to the full nonlinear path. Decode stays
  total either way. `descriptor0` comes from the one `makeDescriptor`
  (D10.1) — per-tile descriptors are centre-point anyway.

`applyLinearised(ref, t)` is the CPU twin of the WGSL `decode_linear` —
identical arithmetic, used by the golden and the A/B gates.

## GPU surface

- **`decode_linear.wgsl`** exports the `LinearisedRef` struct (16
  vec4<f32> lanes = 256 B, every member vec4 so offsets are index×16),
  `decode_linear(t, lin, r_coll) -> ICOut`, and the flag constant
  `TILE_REQ_DECODE_LINEAR = 1u`. It imports `ICOut` from decode.wgsl and
  applies the SAME no-holes guard as `decode_full` (dmin < r_coll →
  terminal 2u): the decode pipeline is total on this path too.
- **`simulate.wgsl`** declares `@group(0) @binding(4) var<uniform>
  linearised : LinearisedRef;` and branches on
  `tile_req.flags & TILE_REQ_DECODE_LINEAR` (uniform control flow) —
  linearised path or the M3 default-slice `decode_full` path. No
  per-pixel mixing.
- **`src/gpu/linearised_uniforms.ts`** packs the struct; it lives beside
  chart_uniforms.ts in src/gpu (a GPU-byte-layout concern, not a decode
  one). The doc's original packer and WGSL struct disagreed — the packer
  padded each r_i to its own vec4 (r1 at f[4]) while the struct packed
  r0/r1 into one vec4 (r1 at f[2]), and the struct summed to 224 B
  against a 256 B buffer. Landed: the tight layout, 256 B with two
  reserved vec4s, pinned three ways (packer-lane unit test, WGSL
  field-order pin against `linearisedRefLayout()` in struct_dump, and
  the real-GPU A/B in gpu_check).
- **Layouts/buffers**: frame layout gains binding 4 (compute-only
  uniform); `bufs.linearised` is zero-filled 256 B and only read when
  the flag is set. `TILE_REQUEST_FLAGS` in structs.ts is the dispatch
  request-flag namespace — distinct from the `TILE_STATUS` reduction
  flags in quadtree/reduction_types.ts, which also have a DECODE_LINEAR
  bit (the tile REPORTING it decoded linearised).
- **`dispatchLayer0`** accepts `view.linearised` and THROWS when the
  flag is set without a reference — a zero LinearisedRef would decode
  every sample to the origin with zero masses, silently.

## `src/quadtree/decode_mode.ts`

```ts
export const LINEARISED_DECODER_DEPTH = 20;
export function shouldLineariseAtDepth(depth: number, atF32Floor = false): boolean {
  return atF32Floor || depth >= LINEARISED_DECODER_DEPTH;
}
```

`atF32Floor` is the adaptive override: a tile whose reduction reports
`TILE_STATUS.AT_F32_FLOOR` (M5) linearises even above the threshold.
The G2 frame loop calls this when assembling dispatch flags, builds the
reference via `buildLinearised`, and hands both to `dispatchLayer0`.

## Tests

- **unit/decode/linearised** — affine decoder reconstructed exactly at
  the corners (pins the δ-convention end to end); smooth nonlinear
  decoder approximated to second order; kink (|u − 0.5|) → null;
  terminal centre/probe → null; FD_STEP_DEFAULT pinned at 0.25;
  descriptor0 from makeDescriptor.
- **unit/gpu/linearised_uniforms** — 256 B; x0/J/half lanes pinned;
  reserved tail zero; WGSL struct field order == linearisedRefLayout()
  (alignment pin); TILE_REQ_DECODE_LINEAR == TILE_REQUEST_FLAGS bit.
- **unit/quadtree/decode_mode** — threshold 20 + AT_F32_FLOOR override.
- **golden/linearised_decoder** — depth-30 tile at a generic centre:
  the f32 floor demonstrated (fround collapses every sample offset);
  ≥240 distinct samples across 16×16 at f64; 1e-13 phase-norm agreement
  with the full decoder on a 5×5 grid; centre reproduces exactly.
- **integration/linearised_gpu** (self-skips without WebGPU) — two real
  dispatches over a depth-10 tile: flag=0 vs flag=1, comparing E₀
  per-sample between the two GPU paths and against the CPU twin; plus
  the dispatch flag/ref guard.
- **gpu:check** — the page gained a G6 A/B gate (flag-selected dispatch
  vs CPU twin, max |ΔE₀| < 1e-2) folded into its overall `ok`.

## Run it

```bash
npm test -- --run test/unit/decode/linearised
npm test -- --run test/golden/linearised_decoder
npm run gpu:check
```

## Acceptance check

```bash
npm test -- --run test/golden/linearised_decoder
```

At depth 30, the linearised decoder produces ≥240 distinct samples
across a 16×16 tile and matches the full f64 decoder to 1e-13 in
phase-space norm, while the full path's f32 inputs are bitwise-constant
across the same tile.

## Notes for the implementer

- **Why the f32 floor is an INPUT problem.** At depth d the per-sample
  latent offset is ~2^(−d−4)·range against O(1) latent values; below
  one f32 ulp (~1.2e-7 at |z| ≈ 1) all samples enter the decode
  identical. The linearised path never forms `centre + tiny` at f32 on
  the input side — t is tile-local (exactly representable) and the
  J·δ products live at the offset scale, where f32 has full relative
  precision. The reconstructed x = x0 + Jδ does collapse in ABSOLUTE
  f32 terms, but the offsets themselves (what the dynamics of nearby
  samples differ by) survive; distinctness at the IC level is the
  f64-golden's claim, and the GPU-side value is that decode noise no
  longer amplifies through the nonlinear chain.
- **CPU cost is amortised.** Nine full f64 decodes per tile buys 256
  GPU evaluations of a ~30-flop linear map. Breakeven is immediate at
  any tile size.
- **Charts that aren't smooth.** `(L_z, E)` near the feasibility
  parabola, the mirror deadband, sigmoid saturation: all are caught by
  the two-scale check because the probe interval spans the kink — the
  tile falls back to full decode. No special cases per chart.
- **No precision degradation at shallow depth.** The switchover is per
  tile, never per pixel. Above the threshold always linearised; below,
  always full. AT_F32_FLOOR can pull the switchover earlier per tile.
