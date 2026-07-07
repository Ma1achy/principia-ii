# Principia documentation

Principia is a browser-based WebGPU instrument for exploring the planar
three-body problem's initial-condition manifold. Start here.

## Guides

- [User guide](user-guide.md) — what the tool is, the charts, the controls and
  keyboard shortcuts, and what the render modes show.
- [Architecture](architecture.md) — the chart contract, the three-layer tile
  system, the two-stage decode/render pipeline, and the GPU/CPU boundary.
- [ADR index](adr-index.md) — the seven ratified cross-milestone contracts.
- [Glossary](glossary.md) — the domain vocabulary in one place.

## Runbooks

- [Add a new chart](runbooks/add-a-chart.md) — the canonical `(Y, Φ)`-only
  extension path.

## Project records

- [Build decisions ledger](build-decisions-ledger.md) — every non-obvious
  choice made while building, newest first.
- [Test & CI strategy](test-and-ci-strategy.md) — the test pyramid, the GPU
  boundary, fixture policy, and the CI matrix.
- [Integrity pass](integrity-pass.md) — the pre-build cohesion audit.

## Build plans (authoritative)

The detailed, copy-paste-runnable build plan lives in the milestone series. The
docs above synthesise it; the milestones remain the source of truth.

- [Milestone index](../milestones/README.md)
- M-series:
  [M0](../milestones/M0_foundations.md) ·
  [M1](../milestones/M1_cpu_integrator.md) ·
  [M2](../milestones/M2_decoder_atlas.md) ·
  [M3](../milestones/M3_layer0_gpu.md) ·
  [M4](../milestones/M4_layer1_cache.md) ·
  [M5](../milestones/M5_layer2_refinement.md) ·
  [M6](../milestones/M6_metrics.md) ·
  [M7](../milestones/M7_render_graph.md) ·
  [M8](../milestones/M8_interaction.md) ·
  [M9](../milestones/M9_inspector.md) ·
  [M10](../milestones/M10_charts.md) ·
  [M11](../milestones/M11_burrau.md) ·
  [M12](../milestones/M12_export.md)
- G-series:
  [G1](../milestones/G1_shader_composition.md) ·
  [G2](../milestones/G2_frame_loop.md) ·
  [G3](../milestones/G3_bind_group_layouts.md) ·
  [G4](../milestones/G4_chart_parameters.md) ·
  [G5](../milestones/G5_inverses.md) ·
  [G6](../milestones/G6_linearised_decoder.md) ·
  [G7](../milestones/G7_device_loss_ensemble_spreads.md) ·
  [G8](../milestones/G8_ui_ci_perf.md) ·
  [G9](../milestones/G9_capability_detection.md) ·
  [G10](../milestones/G10_perf_profiling.md) ·
  [G11](../milestones/G11_error_telemetry.md) ·
  [G12](../milestones/G12_ui_shell.md) ·
  [G13](../milestones/G13_accessibility_cvd.md) ·
  [G14](../milestones/G14_e2e_regression_ci.md) ·
  [G15](../milestones/G15_build_deploy_hosting.md) ·
  [G16](../milestones/G16_documentation_onboarding.md) ·
  [G17](../milestones/G17_debug_harness.md) ·
  [G18](../milestones/G18_debug_hud.md) ·
  [G19](../milestones/G19_close_encounter_regularization.md)

## API reference

`npm run docs:api` generates the TypeScript API reference into `docs/api/`
(TypeDoc; gitignored). Open `docs/api/index.html`.

## Contributing

The architecture and conventions are codified as skills under `.claude/skills/`
and summarised in [CLAUDE.md](../CLAUDE.md). Read the relevant skill before
touching a load-bearing seam (GPU struct layout, symplectic integration, the
decode totality contract, the chart contract).
