# G19 — Close-encounter regularization (KS / Levi-Civita)

> **Status: PLANNED — to be hardened just-in-time** (same discipline as the
> M10/M11 hardening). This file records the motivation, scope, and acceptance
> shape now; the full per-file implementation is authored when the milestone is
> actually scheduled.

## Goal

Make deep two-body close approaches *resolvable* instead of merely *survivable*:
a Levi-Civita (planar Kustaanheimo–Stiefel) regularization layer for the f64
CPU reference integrator, so that near-collision trajectories — Burrau 3-4-5
being the canonical case — integrate through their encounters with bounded
energy error instead of blowing up or terminating at `MAX_SUBSTEPS`.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/golden/burrau_regularized
```

The Burrau 3-4-5 rest start integrates to its escape with relative energy
drift below `1e-7`, a *converged* escape time (stable across a 2× step-size
refinement), and pinned checkpoint positions — the precision golden that M1
originally wanted and empirically could not have (see M1's implementer notes).

**Deliverable:** internal — tests only; upgrades `test/golden/burrau.test.ts`
from qualitative physical validation to a pinned precision golden, and gives
the M9 inspector a trustworthy reference for near-collision streamlines.

## Why (evidence from M1)

Measured on the non-regularized adaptive leapfrog (`yoshida6`):

| config | outcome |
|---|---|
| `dt = 1e-4`, any `NMax` | MAX_SUBSTEPS blow-up at the t ≈ 16.5 encounter |
| `dt = 5e-5` | ESCAPE(body 2) at t ≈ 66.9, drift 2.0e-2 |
| `dt = 2.5e-5` | ESCAPE(body 2) at t ≈ 46.1, drift 1.2e-1 — **not converged** |
| `dt = 1e-5` | blow-up at t ≈ 13.4 |

The substep count adapts once per macro step from the boundary separation, so
an encounter that deepens by orders of magnitude *within* one macro step
outruns it. Shrinking `dt` just moves the failure. The standard fix is to
switch the closest pair into regularized coordinates (Levi-Civita transform
`u² = r` with fictitious time `ds = dt/r`), where the collision singularity
becomes regular and the encounter costs O(1) steps.

## Scope sketch

- `src/integrate/regularize.ts` — planar Levi-Civita transform for the
  dominant pair + the third body as a perturbation; enter/exit criteria
  (e.g. `r_pair < r_reg` with hysteresis); fictitious-time stepping.
- `run.ts` gains a regularization mode flag (default **off** — the GPU
  pipeline and Preview tiers are unaffected; this is a CPU-reference and
  inspector-tier capability).
- Golden: regenerate a **converged** Burrau reference (escape time stable
  under refinement), pin checkpoints, tighten the drift gate to `1e-7`.
- Non-goals: GPU/WGSL regularization (f32 makes it a different problem —
  revisit only if Research tier ever needs it); triple-collision
  regularization (out of scope entirely).

## Dependencies

M1 (the integrator it extends). Nothing depends *on* G19 — it upgrades
reference accuracy but no downstream milestone's contract assumes it, which is
what makes it safely deferrable.

## Acceptance shape

1. Regularized Burrau reaches ESCAPE(body 2) with drift `< 1e-7`.
2. Escape time converged: two runs at `ds` and `ds/2` agree to `< 0.1` in t.
3. The M1 figure-8 golden still passes untouched (regularization off = no
   behaviour change).
4. Checkpoint positions pinned per the fixture policy (generate once at high
   precision, verify convergence, commit).
