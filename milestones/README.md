# Principia milestones — index

The high-level plan lives in `../principia_milestones.md`. This directory has
one detailed file per milestone with copy-paste-runnable TypeScript and WGSL.

| File | What it stands up | Depends on |
|------|-------------------|------------|
| [M0_foundations.md](M0_foundations.md) | Project bootstrap, math primitives, CI gate | — |
| [M1_cpu_integrator.md](M1_cpu_integrator.md) | f64 KDK + Yoshida, COM projection, events, Burrau golden | M0 |
| [M2_decoder_atlas.md](M2_decoder_atlas.md) | Mass / configuration / momentum decoders, canonicaliser, inverses | M0, M1 |
| [M3_layer0_gpu.md](M3_layer0_gpu.md) | First WebGPU pass: simulate.wgsl, render.wgsl, struct contracts | M0, M2 |
| [M4_layer1_cache.md](M4_layer1_cache.md) | Tile cache, ancestor fallback, slippy-map navigation | M3 |
| [M5_layer2_refinement.md](M5_layer2_refinement.md) | reduce.wgsl + lifecycle / coherence / split / priority / eviction | M4 |
| [M6_metrics.md](M6_metrics.md) | Corrected shape sphere + phase + diffusion + FTLE + free-group word + packing | M3, M5 |
| [M7_render_graph.md](M7_render_graph.md) | Colour / brightness / combiner / post + OKLAB + VMF + CVD | M6 |
| [M8_interaction.md](M8_interaction.md) | ViewState, sliders, zoom, tilt with Gram–Schmidt, lock, lookup, named directions, lock preservation | M7 |
| [M9_inspector.md](M9_inspector.md) | f64 Dormand–Prince RK45, hover streamline, match-integrator mode, validation panel | M2, M8 |
| [M10_charts.md](M10_charts.md) | Chart registry, latent / (Lz, E) / (Lz, K) / shape sphere / mass simplex / Burrau Euclid / mixed-axis | M8 |
| [M11_burrau.md](M11_burrau.md) | Euclid parametrisation, primitive triples, acute angle, mass simplex, bifurcation strips, Stage 4 probe | M10 |
| [M12_export.md](M12_export.md) | ViewState schema, URL sharing, static / animated / live exports, Timeline keyframes, sub-buffer partitioning, sidecar reproducibility, all six §7 acceptance gates | M11 |
| [G1_shader_composition.md](G1_shader_composition.md) | WGSL preprocessor / linker — `@import` / `@export` directives, dependency resolution, cycle detection | M3 |
| [G2_frame_loop.md](G2_frame_loop.md) | Top-level `App` with frame loop, store, input handlers, GPU job ledger | M5, M8 |
| [G3_bind_group_layouts.md](G3_bind_group_layouts.md) | Single-source `Layouts` module shared across simulate/reduce/render pipelines | M3, M5, M7 |
| [G4_chart_parameters.md](G4_chart_parameters.md) | Promote mu_max / alpha_min / q_max into per-chart `ChartUniforms` (group 0 binding 2) | M3, M10 |
| [G5_inverses.md](G5_inverses.md) | Closed-form `inverseEncode` for (Lz,E), (Lz,K), shape sphere, mass simplex, Burrau, mixed-axis | M10 |
| [G6_linearised_decoder.md](G6_linearised_decoder.md) | f64 reference IC + Jacobian, f32 GPU evaluation, depth-20 switchover | M3, M5 |
| [G7_device_loss_ensemble_spreads.md](G7_device_loss_ensemble_spreads.md) | Device-loss recovery, ensemble dispatch with Halton/stratified jitter, spread second-pass shader | M5 |
| [G8_ui_ci_perf.md](G8_ui_ci_perf.md) | Vanilla TS reactive UI shell, GitHub Actions + Playwright CI, hot-path allocation patches | G2 |
| [G9_capability_detection.md](G9_capability_detection.md) | WebGPU capability detection + graceful degradation: `CapabilityProfile`, per-tier caps, full-retention viewport math, typed `UnsupportedError` | M3 (pairs with G7) |
| [G10_perf_profiling.md](G10_perf_profiling.md) | `PerfMonitor` in the frame loop: rolling CPU/GPU per-pass timings (`timestamp-query` when present), budget feedback + tier-drop, BufferPool hot-path patches | G2, G8 (pairs with G9/G7) |
| [G11_error_telemetry.md](G11_error_telemetry.md) | `ErrorBoundary` + structured telemetry: closed `AppErrorKind`, user-facing messages, M5 `status_flags` → tile-failure overlays, pluggable sink | G2, G7, G9 |

The G-series files are gap-fill milestones written after v1 and
project-wide planning self-reviews; they cover the load-bearing seams the
M-series milestones left implicit. (G9+ come from the second, project-wide
review — see the cross-cutting workstream in the plan.) Implement them after M-series in a logical order: G1
unblocks every GPU milestone, G3 must land before any pipeline
allocates real bind groups, G4 simplifies M10 once it's in, G5 makes
M8's chart-switch path actually preserve the lock, and G2 ties the
whole thing together into a runnable shell.

## Conventions

- TypeScript on the host, WGSL on the GPU, Vitest for unit/integration tests.
- f64 everywhere except inside GPU shaders (f32) and the per-tile uniforms
  (f32, with f64 precomputation on the CPU).
- Mass-weighted inner product is `<a, b>_m = Σᵢ mᵢ aᵢ·bᵢ`.
- The 90° rotation in the plane is `J(x, y) = (-y, x)`.
- Bodies are 0-indexed everywhere except inside the Burrau classical-notation
  section in M11.
- Sentinel values: `-1.0` for missing diffusion (NaN forbidden under WGSL),
  `0.0` for unset FTLE (`FTLE_VALID` bit drives interpretation).

## How to follow along

Each milestone file is structured the same way:

1. **Goal** — the single executable acceptance test that gates the milestone.
2. **File tree** — exactly which files are created or modified.
3. **Implementations** — full code, ready to paste.
4. **Tests** — runnable Vitest specs, structured as `describe` / `it` blocks.
5. **Run it** — the one-liner to execute the gate test.

If a milestone references the spec, the section number cited is from
`../principia_spec_revised.tex`.
