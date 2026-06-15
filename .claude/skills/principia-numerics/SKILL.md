---
name: principia-numerics
description: >-
  Numerical-methods and physics-correctness rules for Principia's three-body
  integration. Covers symplectic integrators (KDK leapfrog, Yoshida 4 and 6 and
  why their middle weights are negative), mandatory COM projection after every
  macro step, adaptive substepping, event detection with escape persistence, the
  totality / "no holes" contract, and invariant monitoring (energy and angular
  momentum drift thresholds). Use this skill whenever writing or editing anything
  under src/integrate/ or the momentum/energy parts of src/decode/, any force,
  integrator, event, or energy routine, the WGSL integrate shader, or any code
  that evolves a trajectory or checks an invariant. Apply it even for a small
  change: swapping in a non-symplectic step or skipping a COM projection
  corrupts the physics secularly with no error and no crash.
---

# Principia numerics and physics correctness

The dynamics are the product. A trajectory that looks plausible but conserves
neither energy nor angular momentum is worthless, and nothing in the type system
will catch it. These rules exist because the failure mode here is silent: the
code runs, pixels get coloured, and the science is wrong. Read this before
touching anything that integrates a trajectory.

## Units

Everything is dimensionless: total mass `M = sum(m_i) = 1`, `G = 1`, and the
mass-weighted moment of inertia `I = sum(m_i |r_i|^2) = 1` (scale gauge). Don't
reintroduce physical constants. The similarity symmetry is `r -> lambda r`,
`t -> lambda^(3/2) t`.

## Use symplectic integrators only

Principia integrates with **symplectic** methods and nothing else. A
non-symplectic scheme (RK4, Euler, anything with secular energy drift) defeats
the entire stability-metric apparatus — the whole point is bounded invariant
error over long horizons. If you reach for a generic ODE solver, stop.

**The one sanctioned exception: the inspector.** The hover/lock inspector
(M9) integrates with an *adaptive non-symplectic* RK45 (Dormand–Prince /
DOPRI5) on purpose — it serves a single short, high-accuracy trajectory for a
streamline overlay, not the long-horizon stability metrics. This is the only
place in Principia where a non-symplectic integrator is correct; do **not**
"fix" the inspector to KDK/Yoshida. Two consequences worth pinning here:
comparing energy traces between the RK45 inspector and the symplectic GPU
pipeline is not apples-to-apples (use the inspector's *match-integrator* mode
for a true cross-check, per spec rev #13), and DOPRI5's step-size error must be
measured in the **mass-weighted phase-space norm**, not Euclidean. The full
inspector contract lives in the `principia-inspector` skill (authored before
M9); everything *outside* the inspector stays symplectic-only.

The family, all built by composing the base KDK step:

- **KDK leapfrog** — the base second-order step (kick / drift / kick). The
  production GPU pipeline runs this in Preview tier.
- **Yoshida 4** — three KDK steps with weights `w1, w2, w3` where the **middle
  weight is negative** (`w2 = -cbrt(2)/(2 - cbrt(2))`). The integrator steps
  *backward* in the middle. This is mathematically required for an explicit
  symplectic method of order > 2 — it is correct, not a bug. Do not "fix" it.
- **Yoshida 6** — seven KDK steps with the palindromic Solution-A weights.
  Negative weights again, again correct. This is the reference integrator for
  golden tests (run at `dt = 1e-4`).

When composing, the substep counts of the constituent KDK steps sum to the
composition's total — preserve that accounting.

## Project to the COM frame after every macro step

Call `projectCOM` after **every** macro step, not just at initialisation. The
decoder already produces a COM-consistent initial state, but `f32`/`f64`
round-off slowly reintroduces the redundant translation and total-momentum
modes. `projectCOM` subtracts the centre-of-mass position and the
total-momentum drift; it is mathematically idempotent and numerically idempotent
to within rounding. It is cheap housekeeping that keeps the redundant modes from
leaking back in. Do not skip it for speed — a drifting COM quietly poisons every
downstream invariant.

## Adaptive substepping

Close encounters need finer time resolution. Compute the substep count per macro
step from the minimum pair separation `r_min`:

```
N_sub = clamp(ceil((r_sub / r_min)^gamma_sub), 1, N_max)
```

with `r_sub = 0.05`, `gamma_sub = 1.5`, `N_max = 64` in production. Guard the
division: use `max(r_min, 1e-30)` so a near-collision can't produce infinity.
Tighter encounters raise `N_sub`; smooth stretches stay at 1. (The Burrau golden
test raises `N_max` to 256 because its encounters are unusually tight — that is a
reference-accuracy choice, not the production default.)

Macro step `dt_macro = 1e-3`; integration horizon `T` in `[50, 200]`.

## Event detection: persistence matters

Terminal events, in the order the per-pixel workflow checks them:

- **Collision**: `r_min < r_coll`, with `r_coll = 1e-4`.
- **Escape**: a **three-gate detector with a persistence counter**. A body must
  satisfy the escape gates for `k_esc = 8` consecutive macro-steps before escape
  fires; escape radius `R_esc = 10`. A single step past the gate is **not** an
  escape — transient excursions happen constantly in chaotic encounters, and
  without the persistence counter you get false positives everywhere. Keep one
  counter per body candidate and reset it when a gate fails.
- **Timeout**: horizon `T` reached.
- **NaN / Inf**: terminal.

## Totality: never reject, always label

The decode-to-simulate pipeline is a **total function of the UV coordinate** —
it must never reject or throw on a parameter point. Pathologies are tagged, not
discarded:

- decode-time failure emits `DEGENERATE(reason)`,
- a `t = 0` near-collision emits `COLLISION_T0`,
- otherwise the trajectory runs and gets a terminal label
  (collision / escape / bounded / timeout).

Every pixel ends with a well-defined output. If you find yourself wanting to
`throw` inside the decode or integrate path, the correct move is to emit a
terminal tag instead. This is the "no holes" guarantee.

## Invariant monitoring is the truth signal

Track energy drift and angular-momentum (`Lz`) drift along every trajectory.
These are how you know whether to trust the result at all:

| Energy drift `eps_E` | Verdict |
|----------------------|---------|
| `< 1e-5` | good |
| `< 1e-4` | acceptable for interactive use |
| `>= 1e-4` | numerically suspect |

A tile with a large fraction of suspect samples should refine, lower its time
step, or be visibly marked — never silently shown as if trustworthy. Energy and
`Lz` drift override appearances: if they drift, the colour is not to be believed
regardless of what outcome it claims.

## Numerical defaults (starting points)

These live in one place and feed the cache signature — changing any of them must
invalidate the cache, because they change what the pixel *means*.

| Quantity | Symbol | Default |
|----------|--------|---------|
| Macro step | `dt_macro` | `1e-3` |
| Max substeps | `N_max` | 64 (256 in Burrau golden) |
| Substep trigger radius | `r_sub` | 0.05 |
| Substep exponent | `gamma_sub` | 1.5 |
| Horizon | `T` | 50–200 |
| Collision radius | `r_coll` | `1e-4` |
| Escape radius | `R_esc` | 10 |
| Escape persistence | `k_esc` | 8 |
| Energy-drift acceptable bound | `eps_E` | `1e-4` |
| Mass logit saturation | `mu_max` | 5 |
| Jacobi guard | `eps` | `1e-6` |
| Mirror tie deadband | `delta_lambda` | `1e-12` |

## Ratified contracts (ADRs)

Two metric contracts are decided and binding (full records in `docs/adr/`):

- **Checkpoint schedule** (ADR 0001): shape-sphere checkpoints are equally
  spaced with **no `t=0` anchor** — `t_m = m·T/M`, so `t_M = T`. Frequency-
  diffusion windows are closed–closed with `t=T/2` counted in **both** `W₁` and
  `W₂`, giving exactly three checkpoints per window at `M=8`. The schedule is
  identical on the f32 GPU and f64 inspector paths and is part of the cache
  signature — don't change it on one side only.
- **FTLE per tier** (ADR 0003): full phase-space Benettin FTLE is the **only**
  FTLE variant and runs in **Research tier only**. Preview/Balanced leave
  `ftle = 0` with `FTLE_VALID` clear (a cheaper proxy may fill `stretch`, never
  flagged valid). IC-manifold / position-only variants are deferred.

## Hot-loop discipline (after correctness)

The inner numeric work should be allocation-free: use the monomorphic flat-array
helpers (the `Flat6` kick/drift pattern) and reuse buffers rather than building
fresh `Triple<Vec2>` arrays each step. This matters for throughput, but never
trade a correctness rule above for an allocation saving — get the physics right
first, then make it tight.

## Before you finish any integration change — checklist

- Is the integrator symplectic (KDK or a Yoshida composition of it)?
- Did you keep the negative Yoshida weights intact?
- Is `projectCOM` called after every macro step?
- Is the substep division guarded against `r_min -> 0`?
- Does escape require `k_esc` consecutive steps, not one?
- Does every failure path emit a terminal tag rather than throwing?
- Are energy and `Lz` drift tracked, and are suspect samples flagged?
