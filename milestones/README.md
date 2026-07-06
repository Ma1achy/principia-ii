# Principia milestones — index

The high-level plan lives in `../principia_milestones.md`. This directory has
one detailed file per milestone with copy-paste-runnable TypeScript and WGSL.

| File | What it stands up | Depends on |
|------|-------------------|------------|
| [M0_foundations.md](M0_foundations.md) | Project bootstrap, math primitives, CI gate | — |
| [M1_cpu_integrator.md](M1_cpu_integrator.md) | f64 KDK + Yoshida, COM projection, events, Burrau golden | M0 |
| [M2_decoder_atlas.md](M2_decoder_atlas.md) | Mass / configuration / momentum decoders, canonicaliser, inverses | M0 (M1 only for golden tests) |
| [M3_layer0_gpu.md](M3_layer0_gpu.md) | First WebGPU pass: simulate.wgsl, render.wgsl, struct contracts | M0, M1, M2 |
| [M4_layer1_cache.md](M4_layer1_cache.md) | Tile cache, ancestor fallback, slippy-map navigation | M3 |
| [M5_layer2_refinement.md](M5_layer2_refinement.md) | reduce.wgsl + lifecycle / coherence / split / priority / eviction | M4 |
| [M6_metrics.md](M6_metrics.md) | Corrected shape sphere + phase + diffusion + FTLE + free-group word + packing | M3, M5 |
| [M7_render_graph.md](M7_render_graph.md) | Colour / brightness / combiner / post + OKLAB + VMF + CVD | M6 |
| [M8_interaction.md](M8_interaction.md) | ViewState, sliders, zoom, tilt with Gram–Schmidt, lock, lookup, named directions, lock preservation | M4, M7 |
| [M9_inspector.md](M9_inspector.md) | f64 Dormand–Prince RK45, hover streamline, match-integrator mode, validation panel | M1, M2, M6, M8 |
| [M10_charts.md](M10_charts.md) | Chart registry, latent / (Lz, E) / (Lz, K) / shape sphere / mass simplex / Burrau Euclid / mixed-axis | M2, M3, M8 |
| [M11_burrau.md](M11_burrau.md) | Euclid parametrisation, primitive triples, acute angle, mass simplex, bifurcation strips, Stage 4 probe | M10 |
| [M12_export.md](M12_export.md) | ViewState schema, URL sharing, static / animated / live exports, Timeline keyframes, sub-buffer partitioning, sidecar reproducibility, all six §7 acceptance gates | M11 (transitively: M1, M5, M6, M8, M10 — acceptance touches the whole pipeline) |
| [G1_shader_composition.md](G1_shader_composition.md) | WGSL preprocessor / linker — `@import` / `@export` directives, dependency resolution, cycle detection | M3, M5, M6 (the shaders it links) |
| [G2_frame_loop.md](G2_frame_loop.md) | Top-level `App` with frame loop, store, input handlers, GPU job ledger | M5, M8 (transitively: M3, M4, M7, M9, M10, M12 — orchestrates everything) |
| [G3_bind_group_layouts.md](G3_bind_group_layouts.md) | Single-source `Layouts` module shared across simulate/reduce/render pipelines | M3, M5, M7 |
| [G4_chart_parameters.md](G4_chart_parameters.md) | Promote mu_max / alpha_min / q_max into per-chart `ChartUniforms` (group 0 binding 2) | G3, M10 |
| [G5_inverses.md](G5_inverses.md) | Closed-form `inverseEncode` for (Lz,E), (Lz,K), shape sphere, mass simplex, Burrau, mixed-axis | M10 |
| [G6_linearised_decoder.md](G6_linearised_decoder.md) | f64 reference IC + Jacobian, f32 GPU evaluation, depth-20 switchover | M3, M5 |
| [G7_device_loss_ensemble_spreads.md](G7_device_loss_ensemble_spreads.md) | Device-loss recovery, ensemble dispatch with Halton/stratified jitter, spread second-pass shader | M5 |
| [G8_ui_ci_perf.md](G8_ui_ci_perf.md) | Vanilla TS reactive UI shell, GitHub Actions + Playwright CI, hot-path allocation patches | G2 (transitively: M1, M5, M6, M7, M8, M9 — hot-path patches reach into each) |
| [G9_capability_detection.md](G9_capability_detection.md) | WebGPU capability detection + graceful degradation: `CapabilityProfile`, per-tier caps, full-retention viewport math, typed `UnsupportedError` | M3 (pairs with G7) |
| [G10_perf_profiling.md](G10_perf_profiling.md) | `PerfMonitor` in the frame loop: rolling CPU/GPU per-pass timings (`timestamp-query` when present), budget feedback + tier-drop, BufferPool hot-path patches | G2, G8 (pairs with G9/G7) |
| [G11_error_telemetry.md](G11_error_telemetry.md) | `ErrorBoundary` + structured telemetry: closed `AppErrorKind`, user-facing messages, M5 `status_flags` → tile-failure overlays, pluggable sink | G2, G7, G9 |
| [G12_ui_shell.md](G12_ui_shell.md) | Full vanilla-TS shell: ControlPanel/Canvas/Inspector, ChartBrowser presets, rebindable keymap, responsive layout, loading chrome, ViewState undo/redo (render-only changes excluded) | G2, G8 (G9/G10/G11) |
| [G13_accessibility_cvd.md](G13_accessibility_cvd.md) | Accessibility + CVD UI: render-only `cvdMode` toggle, keyboard nav + roving tabindex, ARIA + live region, high-contrast/font-scale, reduced-motion | G12, M7 |
| [G14_e2e_regression_ci.md](G14_e2e_regression_ci.md) | Real-Chrome WebGPU e2e (nightly/opt-in; swiftshader stays the per-PR fallback), golden-PNG visual diff, perf-regression + axe a11y gates; §7 job off `needs-gpu` | G8, G12, G13, M3, M12 |
| [G15_build_deploy_hosting.md](G15_build_deploy_hosting.md) | Production Vite build (hashed chunks, `?raw` shaders, base path), shader compression, env injection, GitHub Pages deploy, optional PWA; pure config validator | G1, G8, G14 |
| [G16_documentation_onboarding.md](G16_documentation_onboarding.md) | User guide, architecture guide, ADR index, "add-a-chart" runbook, glossary, TypeDoc API; pure docs-completeness/link checker | most milestones |
| [G17_debug_harness.md](G17_debug_harness.md) | Debugging & bring-up harness: standalone dev-harness page + buffer/struct dumpers, GPU readback helpers, headless capture so M3's first pass is inspectable the moment it exists | M3 |
| [G18_debug_hud.md](G18_debug_hud.md) | Debug HUD integration: in-app overlay wiring G17's dumpers to live perf/error/telemetry feeds, toggleable diagnostics layer over the running shell | G17, G2, G8, G10, G11, M9 |

The G-series files are gap-fill milestones written after v1 and
project-wide planning self-reviews; they cover the load-bearing seams the
M-series milestones left implicit. (G9+ come from the second, project-wide
review — see the cross-cutting workstream in the plan.)

**G1/G3 ordering (adopted ruling).** G1 (the WGSL `@import`/`@export` linker)
and G3 (the single-source `Layouts` authority) are written as if they precede
the GPU milestones — "G1 unblocks every GPU milestone, G3 must land before any
pipeline allocates real bind groups" — but M3 already compiles WGSL and
allocates bind groups long before either G-file exists, and M5/M7 do the same.
That apparent contradiction is resolved by treating G1 and G3 as *refactors*,
not prerequisites: **M3, M5, and M7 land with PROVISIONAL inline shader strings
and per-pipeline bind-group definitions; G1 and G3 are explicit LATER refactors
that centralise those shaders into the linker and those bind-group definitions
into the `Layouts` module.** So the G-series is implemented after the relevant
M-series milestones, and G1/G3 retroactively consolidate what M3/M5/M7 each
defined provisionally. Beyond G1/G3: G4 simplifies M10 once it's in, G5 makes
M8's chart-switch path actually preserve the lock, and G2 ties the whole thing
together into a runnable shell.

**G17/G18 ordering (debug tooling).** G17 (the debugging & bring-up harness) is
written late in the G-series but **builds right after M3** — the earliest point
at which there is anything to debug, since M3 is the first milestone that puts
real numbers into a GPU buffer. Standing G17 up there means M3's first
simulate/render pass is inspectable the moment it exists, rather than weeks
later. G18 (the in-app debug HUD) **builds after G11** and pairs with G12: it
needs the frame loop (G2), the UI shell hooks (G8), and live perf/error/
telemetry feeds (G10/G11) to overlay, plus the inspector (M9), so it lands
alongside the full shell rather than during bring-up.

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

## Deliverable policy

Every milestone declares a single **Deliverable** line up front, stating what
actually works at the end of it and what is see/run-able by a human — a page to
open, a harness to launch, a visible behaviour to exercise — or the explicit
tag `internal — tests only` when the milestone ships no user-facing surface and
is gated purely by its acceptance test. The Deliverable is about observability,
not just passing tests: it answers "if I finish this, what can I look at?"
GPU milestones in particular must not be invisible — **M3 (via G17), M5, and
M7** each ship a standalone dev-harness page so their GPU output is inspectable
on its own, independent of the full application shell.

## How to follow along

Each milestone file is structured the same way:

1. **Goal** — the single executable acceptance test that gates the milestone.
2. **File tree** — exactly which files are created or modified.
3. **Implementations** — full code, ready to paste.
4. **Tests** — runnable Vitest specs, structured as `describe` / `it` blocks.
5. **Run it** — the one-liner to execute the gate test.

If a milestone references the spec, the section number cited is from
`../principia_spec_revised.tex`.

## Design references

The author's design/planning PDFs live in `../research/design/` with a triaged
index (`../research/design/README.md`). Canonical sources still win (spec, ADRs,
these milestones); the design docs are references. Key mappings:

- **`principia_gui_spec.pdf`** — authoritative UI design (component inventory,
  Layer 1/2 panels, keyboard scope + DAS/ARR, interaction flows, reactive store).
  Reconcile into **G8, G12, G13, M8, M9** just-in-time when they are built.
  **⚠ It says the latent is 10D (`Z0..Z9`); it is 8D (`Z0..Z7`, masses at
  `Z6`/`Z7`) — see the design README correction.**
- **`render_quadtree_design.pdf`** — architecture provenance for **M3–M7, G1,
  G17** (confirms the render-graph + slippy quadtree; validates G17's
  debug-shaders-first-class and G1's hot-reload).
- **`com_projection_mini_spec.pdf`** — **M1** / `principia-numerics` (project COM,
  monitor-don't-enforce E/`Lz`).
- **`spherical_colour_map_spec.pdf`** — provenance for **M7**; its colour science
  is already canonical in spec §21–24 (the extra pattern modes are out of scope).
