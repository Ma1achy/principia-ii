---
name: principia-architecture
description: >-
  Core architectural contracts of Principia: the chart contract (chart
  coordinates Phi, decoder D, canonicaliser C) and the rule that the GPU shader
  is chart-agnostic, the symmetry-reduction gauges, the three-layer tile/quadtree
  architecture (flat grid, cached slippy map, adaptive refinement) and where data
  is allowed to cross GPU<->CPU, the parameter-domain (not physical) nature of the
  tree, and the two-stage diagnostics/render pipeline that decouples palette
  changes from integration cost. Use this skill whenever adding a new chart or
  view, editing the decoder/canonicaliser pipeline, working on the
  tile/quadtree/cache/scheduler layers, or wiring data flow between GPU
  simulation, GPU rendering, and CPU scheduling. Apply it even for a contained
  change: these contracts are what keep views, simulation, and rendering
  decoupled, and a single violation re-couples things that must stay independent.
---

# Principia architecture and contracts

Principia stays tractable because a few contracts hold everywhere: views are
interchangeable coordinate choices over one shared decode-and-simulate pipeline,
the GPU never knows which view it is rendering, and data crosses the GPU/CPU
boundary in exactly one place. Most architectural mistakes are a violation of one
of these. Read this before adding a view or touching the tile system.

## The chart contract

Every view in Principia must define three things:

1. **Chart coordinates** — a map `Phi: [0,1]^d -> Y` producing decode-ready
   parameters.
2. **Decoder** — `D: Y -> (m_i, r_i, p_i)` via the canonical pipeline.
3. **Canonicaliser** — `C` enforcing gauge, scale, and the no-holes guarantee.

The complete map is `F(s) = C(D(Phi(s)))`. **Adding a new view means defining a
new `(Y, Phi)` only** — the decoder `D`, the canonicaliser `C`, the simulation,
and the rendering are shared and unchanged. If implementing a new view tempts you
to fork the simulation or the renderer, you are doing it wrong; the new work
belongs entirely in the chart map.

### Views are charts, not branches

A view mode is a coordinate choice plus a deterministic decode/canonicalise step.
It is **not** a branch in the simulation or render code. Downstream of `C`,
everything is shared. Don't introduce `if (view === ...)` into simulation or
rendering.

### The GPU shader is chart-agnostic

The compute shader reads `(m_i, r_i, p_i)` and **never knows which chart produced
them**. Chart identity must not leak into the shader — lock, tilt, and lookup all
operate on chart coordinates on the CPU side, and the shader sees only decoded
physical state. Keep it that way: a shader that branches on chart type breaks the
single most important decoupling in the system.

## Symmetry reduction and gauges

An initial condition `(m_i, r_i, p_i)` is reduced by quotienting symmetries:

- **Translation** — work in the COM frame (`sum(m_i r_i) = 0`,
  `sum(p_i) = 0`).
- **Rotation and reflection** — decode directly in a canonical frame
  (recommended) rather than rotating after the fact.
- **Scale** — fix `I = sum(m_i |r_i|^2) = 1`.

Prefer canonical-frame decode (hyperspherical mass-weighted Jacobi) over the
rotate-and-mirror approach; it avoids rotation-gauge ill-conditioning when the
configuration is near-degenerate. Permutation symmetry (`S_3` for equal masses)
is **not** quotiented by default.

## Totality is an architectural invariant

The decode pipeline is a total function of the UV coordinate — it never rejects a
point. Decode failures emit `DEGENERATE(reason)`; `t = 0` near-collisions emit
`COLLISION_T0`; otherwise a terminal label is attached after integration. Every
pixel gets a defined output. (The numerical detail lives in the
`principia-numerics` skill; architecturally, the rule is: tag, never throw.)

## The three-layer tile architecture

The quadtree system is built in three layers, and this is the **implementation
order**, not just a mental model. Each layer is a working, testable system, and
later layers add capability **without changing the contracts** earlier layers
established.

- **Layer 0 — flat grid, no cache.** The viewport covers a region of `[0,1]^2`,
  divided into a fixed grid of `T x T` tiles. All tiles are dispatched, each
  writing `T^2` `SimResult` records to a GPU storage buffer; the fragment shader
  reads the buffer and colours pixels. Panning or zooming recomputes everything.
  Data flow: tile uniforms CPU->GPU, `SimResult` stays GPU->GPU, **nothing
  crosses GPU->CPU**. Three contracts are fixed here: `SimResult`, the decoder,
  and the fragment shader.
- **Layer 1 — tile cache and ancestor fallback.** A cache maps tile identity
  `(z, t_x, t_y)` to a GPU buffer of `SimResult`s. On camera moves, visible tiles
  are drawn if cached; if not, the nearest cached ancestor is drawn stretched and
  the missing tile is queued. This is the Google-Maps slippy-map model: panning
  never blanks the screen, and zooming shows blurry ancestors that sharpen as
  children finish. The queue is plain FIFO — no priority yet. Data flow is
  identical to Layer 0; **still nothing crosses GPU->CPU**.
- **Layer 2 — adaptive refinement.** After a tile's simulations finish, a GPU
  reduction pass aggregates the `T^2` `SimResult`s into a `TileReduction`
  (outcome histogram, coherence, suspect fraction, worst energy drift, escape-time
  range, ~80 bytes). The CPU reads this back and uses it for split and priority
  decisions. **This is the only layer where data flows GPU->CPU during normal
  operation**, and `TileReduction` is the only thing that crosses.

If a change routes per-sample data back to the CPU, or makes Layer 2 logic
necessary for Layer 0/1 to function, it breaks the layering. Reduce on the GPU
and keep the boundary narrow.

## Tile identity and the pyramid

Tiles form a pyramid: at level `z` there are `2^z x 2^z` tiles, and tile
`(z, t_x, t_y)` covers `u in [t_x/2^z, (t_x+1)/2^z]` and the analogous `v` range.
**World UVs are never stored** — they are derived from `(z, t_x, t_y)` by
arithmetic. The CPU-side `Tile` object holds identity, the sim buffer, the
reduction, lifecycle state (`unseen | queued | computing | ready |
readyRefinable`), priority, cache age, and parent/child links.

The renderer walks the tree to collect visible tiles (with ancestor fallback);
the scheduler walks the same tree to decide what to compute next, ordered by
priority.

### It is a parameter-domain tree, not a physical one

This is an adaptive **dispatch** tree over patches of IC space — not a spatial
tree over bodies in the simulation. Tiles are regions of parameter space. The
quadtree allocates simulation budget by local *dynamical* complexity: smooth
basin interiors may stay coarse even when large on screen, and filamentary basin
boundaries may need refinement even when small. "Resolution" means both screen
resolution and dynamical-complexity resolution.

### Why the hierarchy is CPU-managed

The hierarchy logic — tile existence, priority, cache eviction, promotion,
parent/child fallback, visibility, dependency tracking, invalidation — is
irregular, branchy, and global, which is CPU-natural. The GPU does the dense
arithmetic: decode, integrate, reduce. Keep orchestration on the CPU and number
crunching on the GPU.

## The two-stage tile pipeline

Per tile, separate the expensive stage from the cheap one:

- **Diagnostics stage (expensive)** — decode + canonicalise + integrate + events
  + stability + time-coherence fit, producing a packed diagnostic payload per
  pixel.
- **Render stage (cheap)** — convert the diagnostic payload to RGBA for the
  chosen render mode.

This decouples palette and render-mode changes from integration cost: **changing
the palette or render mode must never recompute trajectories**. The retained
`SimResult`/diagnostic buffers are read directly by the fragment shader, so
swaps are instant. If a render-side change forces re-integration, the decoupling
is broken.

### Per-pixel compute workflow order

The diagnostics compute shader does, in this order: (1) decode the IC via the
current `(Phi, D, C)` pipeline; (2) integrate the trajectory (macro-step loop
with adaptive substepping); (3) update observables each macro-step (shape-sphere
vector `n(t)`, pairwise distances, energy); (4) update stability accumulators
(unwrapped phase, windowed frequency, optional FTLE shadow); (5) detect terminal
events; (6) write the packed diagnostic payload. Preserve this order — later
stages depend on earlier ones having run.

## The two companion records

`SimResult` captures what the trajectory *did* (the integration output).
`ICDescriptor` captures properties of the initial condition itself — masses,
geometry, energetics — written once per sample after decode and before
integration. They are separate buffers the fragment shader binds together; don't
merge them. (Byte layout lives in the `principia-gpu` skill.)

## The cache signature

All acceptance and numerical constants belong in the cache signature. Changing
any of them changes what a cached tile *means*, so it must invalidate the cache.
When you add a constant that affects results, add it to the signature.

## Before you finish an architectural change — checklist

- Does a new view add only a `(Y, Phi)` chart, leaving `D`, `C`, simulation, and
  rendering untouched?
- Is the GPU shader still chart-agnostic (no branching on view or chart type)?
- Does the decode path tag failures rather than throwing?
- Does only `TileReduction` cross GPU->CPU, and only in Layer 2?
- Are world UVs derived from `(z, t_x, t_y)` rather than stored?
- Can palette and render-mode changes happen without re-integrating?
