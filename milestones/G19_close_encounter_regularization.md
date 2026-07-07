# G19 — Close-encounter regularization (LogH / algorithmic)

*(Folded back as-built. The planning sketch proposed explicit KS/Levi-Civita
pair regularization; the just-in-time hardening chose **algorithmic (LogH)
regularization** instead — see the reconciliations and
`docs/build-decisions-ledger.md` DG19.x.)*

## Goal

Make deep two-body close approaches *resolvable* instead of merely
*survivable*: a regularized f64 CPU-reference integration path so that
near-collision trajectories — Burrau 3-4-5 being the canonical case —
integrate through their encounters with bounded energy error instead of
blowing up or terminating at `MAX_SUBSTEPS`.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/golden/burrau_regularized
```

The canonical Burrau 3-4-5 rest start integrates to its escape with relative
energy drift below `1e-7` (measured ≈ 1.1e-11), a *converged* escape time
(2× step refinement moves it by < 0.1 — measured 0.007), and pinned
checkpoint positions.

**Deliverable:** internal — tests only; gives the project the precision
golden M1 originally wanted and empirically could not have, and gives the M9
inspector a trustworthy reference for near-collision streamlines.

## What landed

```
src/integrate/regularize.ts        # LogH DKD map + Yoshida-composed orders 2/4/6 + runRegularized()
src/integrate/index.ts             # barrel export
test/unit/integrate/regularize.test.ts   # 10 tests: mechanics, Kepler limit, terminals, trace
test/golden/burrau_regularized.test.ts   # 3 tests: the precision golden (exit suite)
```

## Reconciliations against the planning sketch

1. **LogH algorithmic regularization, not explicit Levi-Civita (DG19.1).**
   The sketch proposed transforming the dominant pair into LC coordinates
   (`u² = r`, `ds = dt/r`) with enter/exit hysteresis. Landed instead: the
   Mikkola–Tanikawa / Preto–Tremaine time-transformed leapfrog over the
   FULL system — drifts advance physical time by `δs/(T+B)`, kicks by
   `δs/W` (`W = -U`, `B = -E` a constant of the flow). Same
   fictitious-time idea, but: exact on the Kepler limit (encounters cost
   O(1) steps), no dominant-pair selection, no coordinate switching, no
   hysteresis, and the base map is symmetric 2nd-order so it composes with
   the **landed Yoshida coefficients** to orders 4/6. Empirically it
   delivers drift ≈ 1e-11 through all of Burrau's encounters.
2. **A separate `runRegularized()` entry, not a `run.ts` mode flag
   (DG19.2).** Fictitious-time stepping doesn't fit `RunParams` (`dtMacro`
   / substeps are physical-time concepts). The new entry mirrors `run()`'s
   result contract exactly (`RunResult` / `Diagnostics` / `TerminalLabel`,
   checkpointed trace), so consumers are interchangeable — and the M1
   figure-8 golden passes untouched *by construction*.
3. **Time units: the "famous t ≈ 60 escape" is Szebehely–Peters units
   (DG19.3).** The project normalises to unit hypotenuse + Σm = 1
   (lengths /5, masses /12), so `t_project ≈ 0.3098 · t_SP`. SP's closest
   approach (t_SP ≈ 15.83) lands at t ≈ 4.905 — exactly the landed
   inspector collision truth — and the escape *detection* (REsc = 10 with
   persistence) fires at t ≈ 24.57.

## The map (src/integrate/regularize.ts)

- `loghDKD` — drift(h/2) / kick(h) / drift(h/2) with the two time
  transformations; time advances in drifts only.
- Composition: the same Yoshida solution-A weights as `yoshida.ts`
  (order 4: 3 stages; order 6: 7 stages) over the LogH base map.
- `runRegularized(s0, params, opts)` — mirrors `run()`: `projectCOM` after
  every composed step (non-negotiable), NaN/Inf guard → `SIM_FAILED`,
  optional `rColl` collision check (`0` disables — integrate through),
  the landed three-gate escape detector with persistence, checkpointed
  trace, `maxSteps` backstop → `TIMEOUT`.
- `bindingEnergy` / `stateEnergy` exported for tests.

Non-goals (unchanged): GPU/WGSL regularization (f32 is a different
problem); triple-collision regularization.

## Acceptance check — all measured

1. Regularized canonical Burrau (h = 2.5e-4, order 6, rColl = 0) reaches
   **ESCAPE(body 2)** — the lightest, Szebehely–Peters' classical result —
   at t ≈ 24.5717 with **drift 1.1e-11** (< 1e-7 gate) and Lz drift 5e-8.
2. **Converged**: h vs h/2 escape times agree to **0.007** (< 0.1 gate);
   the h-sweep 5e-4 → 6.25e-5 moves the time monotonically by < 0.009
   total. (h = 2e-3 is genuinely too coarse — it ejects the wrong body;
   the t ≈ 4.9 encounter at r ≈ 8.3e-5 demands the resolution.)
3. The M1 figure-8 golden and both existing Burrau goldens pass untouched
   (746-test suite green; `run.ts` not modified).
4. Checkpoint positions pinned per the fixture policy (8 crossings over
   t ∈ [0, 24], graded tolerances — the r ≈ 8e-5 encounter amplifies
   float-level noise ~1e4×, so pins are regression tripwires; the drift +
   convergence gates carry the accuracy claim).
5. **Cross-integrator validation**: with rColl = 1e-4 ON, the regularized
   run classifies the deep pair-(0,1) encounter as COLLISION at
   t = 4.9047 — agreeing with the pinned f64 DOPRI5 inspector truth
   (test/golden/burrau_family_345) to 4 digits, from a completely
   independent integration scheme.

## Notes for the implementer

- **B is a constant of the run** (`W₀ − T₀ = −E₀`), not re-evaluated —
  re-evaluating it per step breaks the time-transformed symplectic
  structure. Numerical energy drift slowly degrades the Kepler-exactness
  of the transform but never the correctness of the flow.
- **Negative Yoshida weights step fictitious time backwards** — physical
  `δt` goes negative through those stages. That is correct, same as the
  physical-time Yoshida composition.
- **The escape detector's persistence counts steps**, and fictitious steps
  have wildly varying physical duration — near escape `dt` is large, so
  the kEsc = 8 persistence window is conservative there. Fine for the
  golden; revisit only if a caller needs tight escape-time semantics.
- **rColl = 0 is the "integrate through" mode** the golden uses. Any
  caller keeping project thresholds gets the same classifications as the
  unregularized truth (see acceptance 5).
