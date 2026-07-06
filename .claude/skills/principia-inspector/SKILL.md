---
name: principia-inspector
description: CPU f64 inspector conventions for Principia (M9+) — the DOPRI5 adaptive integrator vs match-integrator split, step control and the h_min abort, shadow-trajectory FTLE seeding, hover-streamline debounce/session pattern, and the GPU validation-panel seam. Consult when implementing or reviewing anything in src/inspector/ or comparing CPU and GPU trajectories.
---

# Principia inspector conventions

The inspector lands in M9 (`src/inspector/`), is surfaced by G12's shell,
and feeds M12's §7 acceptance. It is the instrument's ground truth: a
pure-CPU f64 recompute of a single locked IC.

## Two integrators, two jobs — never mix their comparisons

- **DOPRI5 RK45 (`runInspector`)** is the default: adaptive steps chase
  near-collision singularities (h collapses with r_min) where the GPU's
  fixed-budget symplectic path gives up with `MAX_SUBSTEPS`.
- **Match-integrator (`inspectorMatch`)** re-runs the SAME KDK/Yoshida
  coefficients as the GPU pipeline (via `@/integrate/run`) at f64 — the
  only apples-to-apples cross-check. **Comparing energy traces between
  non-symplectic RK45 and symplectic Yoshida on long bounded orbits is
  meaningless** (RK45 drifts secularly; symplectic oscillates boundedly).
  Compare RK45 vs GPU only on event outcomes/times, never on drift.

## Adaptive step control

`tol = epsAbs + epsRel·max(‖r‖, ‖p‖, 1)`; accept iff errNorm ≤ tol; grow
with `SAFETY·ratio^(1/5)` capped at hMax. Two rules that were wrong in
the milestone doc and must not regress:

- **The h_min abort lives in the REJECT branch.** A step rejected at
  h ≤ hMin would otherwise be retried at hMin forever (infinite loop —
  the doc placed the check after `continue`, unreachable). Abort with
  `SIM_FAILED('h_min reached')`, outcome `'failed'`.
- **`projectCOM` after every ACCEPTED step** (cheap at f64); never on
  rejects.

`TrajState` is fully readonly — stepped states are constructed with
their new `t`, never mutated (`s5.t = …` does not typecheck).

## Energy-drift expectations (calibrated, not aspirational)

RK45 is not symplectic: energy error accumulates with steps. At the
default `epsRel 1e-10 / epsAbs 1e-12`, a Kepler binary over T=1000 holds
`deltaEMax` to ~1e-11–1e-12 — gates below that need tighter tolerances,
and f64 roundoff floors the achievable drift near 1e-13 for ~1e5 steps.
Don't pin drift numbers without an empirical run first (the M1 Burrau
lesson).

## Shadow-trajectory FTLE

- Seed perturbs **all 12 phase-space components** (positions AND
  momenta), total magnitude δ0 — ADR-0003: a position-only seed measured
  in the phase-space norm must not be called canonical FTLE.
- Separation/renormalisation use the **mass-weighted phase-space norm**
  (`m·|δr|² + |δp|²/m`), matching M6's `massWeightedNorm`.
- Renormalise every 50 accepted steps; `valid` requires ≥1 renorm;
  non-finite or zero separation → `{lambda: 0, valid: false}`, never NaN.
- The shadow reuses the base step's h (documented simplification; decouple
  only if FTLE accuracy demands it).

## Hover streamline

Session-counter supersession + 30 ms debounce (`setTimeout`), 8 ms soft
budget. The contract under test: **only the newest session's decode runs**
— stale sessions return before decoding. Keep the gesture logic free of
UI/RAF specifics (G12 swaps in requestIdleCallback).

## Validation panel seam

`InspectorResult.validation` (`gpuOutcomeAgrees`/`gpuFtleDelta`/
`gpuWordAgrees`) is optional and CPU-side-empty in M9; the tile cache's
`SimResult` fills it on lock, and M12's §7 gate consumes it. Optional
fields are added by conditional spread (`exactOptionalPropertyTypes`).

## Testing

- Unit: one-step DOPRI5 accuracy, accept/reject behaviour, debounce
  session logic (real timers, ~60 ms waits are fine), match-integrator
  smoke.
- Golden: Kepler long-horizon drift (tolerance calibrated empirically),
  Burrau near-collision chase (assert classification + d_min, not exact
  values — chaos), adaptive-vs-match `t_end` agreement on a SMOOTH orbit
  only.
