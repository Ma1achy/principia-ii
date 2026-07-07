# Architecture

This is a map of the system and a pointer into the skills under
`.claude/skills/`, which carry the load-bearing detail. Read the skill named
at the end of each section before changing that seam.

## The chart contract

A **chart** is the only thing that varies between views. It exposes three
operations over the unit square `[0, 1]²`:

- `decode(uv, view)` → masses, positions, momenta (a `TrajState` + descriptor),
  or a terminal label. **Total**: every pixel gets a result; failures are
  tagged (`DEGENERATE(reason)`, `COLLISION_T0`), never thrown.
- `validate(uv, view)` → `pass` / `project` / `clamp`, so out-of-domain pixels
  are pulled back to the feasible set instead of producing garbage.
- `inverseEncode(ic, view?)` → the pixel for a given IC, so the lock survives
  a chart switch (closed-form for all six registered charts — G5).

Each chart also declares `ChartFlags` (`forbids_energy_normalisation`,
`has_redundant_hemisphere`, `requires_per_pixel_mass`) that downstream code
reads, and packs its per-view constants into a 64-byte `ChartUniforms` block
(G4) so the shader never hard-codes chart parameters. The compute shader is
**chart-agnostic**: it consumes `(mᵢ, rᵢ, pᵢ)` regardless of which chart
produced them. → `principia-architecture`, `src/chart_atlas/types.ts`.

> **A new view is a new `(Y, Φ)` chart only.** The decoder, canonicaliser,
> simulation, and rendering are shared. See
> [Add a new chart](runbooks/add-a-chart.md).

## The three-layer tile system

Navigation is a slippy map over a quadtree of tiles:

- **Layer 0 — GPU simulate.** `simulate.wgsl` decodes and integrates every
  sample in a tile in f32 (with f64 precomputation on the CPU; past the depth
  threshold the CPU linearises the decode at f64 and the GPU applies it —
  G6). Dispatch is one compute pass per tile, abandonable when the camera
  moves (ADR 0005).
- **Layer 1 — tile cache.** A slippy-map cache with ancestor fallback: while
  a tile computes, a coarser ancestor is stretched over its footprint. The
  cache key is a signature of the full view + tier + sampling
  (see [ADR 0006](adr-index.md) for the reduction schema it protects).
- **Layer 2 — refinement.** `reduce.wgsl` rolls per-sample data up into one
  `TileReduction`, computes a **coherence score**, and decides split /
  priority / eviction. This is the *only* layer that moves data GPU→CPU.

> **Only `TileReduction` crosses GPU→CPU, and only in Layer 2.** Per-sample
> data stays on the GPU (retained per-tile buffers the renderer binds
> directly). → `principia-architecture`, `principia-gpu`.

## The two-stage decode / render pipeline

Principia separates *what is computed* from *how it is shown*:

1. **Compute stage** — decode → simulate → reduce. Anything that changes the
   result (chart, view, masses, tier, sampling) invalidates the cache and
   recomputes. Its identity is the tile cache key (M4/M8).
2. **Render stage** — colour / brightness / combiner / palette / CVD
   post-process. All of it is **render-only**: a change rewrites the 64-byte
   `RenderParams` uniform (the render pipeline's group 3) and **never**
   recomputes or touches the cache (M7, enforced live by G13's render-only
   invariant test).

This decoupling is why changing a render mode is instant while changing the
chart triggers a recompute. → `principia-architecture`, `principia-gpu`.

## The GPU / CPU boundary

- **f64 on the host**, **f32 inside shaders**; per-tile uniforms are f32 with
  f64 precomputation on the CPU, and tile-local coordinates keep precision at
  depth.
- Structs shared between TS and WGSL are **one artifact**: the WGSL struct,
  the `src/gpu/structs.ts` packer, and an alignment pin test change together
  in one commit (ADR 0006 makes the reduction's offset map declarative).
  → `principia-gpu`.
- Sentinels, not NaN: `-1.0` is "missing diffusion", `0.0` with a cleared
  validity bit is "unset FTLE".

## Numerics

Symplectic integration only (KDK + Yoshida — the negative middle weights are
correct), and `projectCOM` after **every** macro step. Outcome classes are
pinned (ADR 0002); the checkpoint schedule is closed-form (ADR 0001); event
detection uses escape persistence. → `principia-numerics`.

## The shell and diagnostics

The UI shell (G12) is a vanilla reactive store — no framework. Interaction
history records only compute-affecting edits; the error boundary (G11)
classifies every failure into a closed `AppErrorKind` and keeps technical
detail in telemetry; the developer HUD (G17/G18, `~`) surfaces perf timings,
error feeds, tile status flags, and deterministic frame capture.

## Where to read more

| Concern | Skill |
|---------|-------|
| Chart contract, layers, two-stage boundary | `principia-architecture` |
| WGSL, struct layout, GPU↔CPU | `principia-gpu` |
| Integrators, COM, events, totality | `principia-numerics` |
| Vitest, tolerances, golden fixtures | `principia-testing` |
| Milestone shape and build order | `principia-milestone-workflow` |

The [test & CI strategy](test-and-ci-strategy.md) covers how all of this is
gated.
