# ADR 0001: Shape-sphere checkpoint-time schedule

- **Status:** Proposed (not yet ratified into the spec)
- **Date:** 2026-06-15
- **Gates:** M3, M6, inspector
- **Recommendation:** Adopt closed-form equal spacing with no t=0 anchor: t_m = m·T/M for m=1..M (right-aligned endpoints, t_M = T), fixed for all tiers and charts.

---

## Context

The spec elevates the checkpointed shape-sphere path to *the* canonical per-sample object. The boxed "Core architectural principle" in Part IV (§4.3, spec line 858) states that "the primary geometric object is the checkpointed shape-sphere path $Z_n = (\mathbf n(t_1),\ldots,\mathbf n(t_M))$" and that it is "the shared representation for: stability analysis, adaptive refinement, tile summarisation, animation playback, representative-tile rendering, caching and invalidation, and similarity/coherence comparisons." §4.3.1 (line 1042) then says only: "Given fixed checkpoints $t_1,\ldots,t_M$, the canonical sampled path descriptor is $Z_n$." The phrase "fixed checkpoints" is asserted but **never defined** — the spec specifies *what* is stored, not *at which times*.

This is an open contract, not a local implementation choice, because the same $t_1..t_M$ must be produced by three independent code paths that have to agree bit-for-comparison:

1. The **f32 GPU integrator** (M3, `simulate.wgsl`), which captures checkpoints inline during the macro loop.
2. The **f64 CPU reference / inspector** (M1, `metricsTick` in `observe_extended.ts`), whose `Checkpoint.t` field must line up with the GPU's so cross-validation (M3's "agree within 1e-3 after T" gate) is meaningful.
3. The **derived-metric consumers** — chiefly frequency diffusion (M6), whose two-window fit is the binding constraint.

The diffusion contract pins the schedule tightly. §4.3.2 (lines 1073–1079) fixes windows $W_1\in[T/4,T/2]$ and $W_2\in[T/2,3T/4]$, requires "a minimum of *three* checkpoints per window," and states for the Interactive default "For $M=8$ checkpoints ... each full window contains exactly three checkpoint times, which is the minimum supported." Any schedule that does not place exactly three checkpoints in each of those closed intervals at $M=8$ silently breaks the diffusion metric — and because the spec mandates a $-1.0$ sentinel rather than NaN, the breakage is *silent*: a wrong schedule degrades the science without throwing.

Two further spec hooks make this a hard, recorded contract rather than a convention. §6.5 (line 2452) requires every cached payload to carry a compatibility signature covering "checkpoint schedule" — so the rule must be a stable, nameable thing that gates cache reuse. §9 validation (line 2897) explicitly lists "Diffusion robustness to checkpoint schedule" as a test target. And $M$ itself is a tier knob: §11 (line 2995) says "$M\in[8,16]$ for first implementation," so the rule must be parameterised by $M$ and produce a valid diffusion layout at both ends of that range, not just at 8.

What the code already assumes: M3's `simulate.wgsl` (line 757) computes `dtCkpt = T_horizon / M`, initialises `nextCkpt = dtCkpt`, and increments by `dtCkpt` — i.e. it already emits checkpoints at $m\cdot T/M$ with no $t=0$ sample. That is one of the candidate options below; this ADR's job is to ratify it (or overrule it) explicitly so the inspector and reduction passes are built against a decision rather than an accident.

## Options

### Option A — Equal spacing, no anchor (right-aligned): $t_m = m\,T/M$, $m=1..M$

How it works: a single closed form, $t_m = m\cdot(T/M)$. Endpoints are $t_1 = T/M$ and $t_M = T$; there is **no** $t_0=0$ checkpoint. Integrator side: a running `nextCkpt`, initialised to $T/M$ and incremented by $T/M$, captures $\mathbf n$ the first macro step at/after each threshold (exactly the M3 code).

Diffusion check at $M=8$: times are $\{T/8, T/4, 3T/8, T/2, 5T/8, 3T/4, 7T/8, T\}$. Closed $W_1=[T/4,T/2]$ contains $\{T/4, 3T/8, T/2\}$ (3); closed $W_2=[T/2,3T/4]$ contains $\{T/2, 5T/8, 3T/4\}$ (3). Matches §4.3.2 exactly. At $M=16$ each window holds 5 — also valid.

Pros: closed-form and stateless, so f32 GPU and f64 CPU produce identical target times with zero shared mutable state (only $T$, $M$ cross the boundary); already implemented in M3; satisfies the diffusion three-per-window constraint at both $M=8$ and $M=16$; $t_M=T$ gives a natural terminal checkpoint for arc length and the figure-8 word golden; trivially captured by the cache signature (just the pair $(T,M)$).

Cons: no sample at $t=0$, so the initial configuration is not in $Z_n$ (it is available separately as the IC descriptor / decode output, so no information is actually lost); window boundaries land *on* checkpoints, making "inclusive vs exclusive" at $T/2$ a detail that must be written down (resolved below).

Implementation cost: zero net new code — ratifies existing M3 behaviour; CPU side is one line in the checkpoint scheduler.

### Option B — Equal spacing with a fixed $t_0=0$ anchor: $t_m = (m-1)\,T/(M-1)$, $m=1..M$

How it works: first checkpoint is the initial state, last is $T$; $M$ points span $[0,T]$ inclusive with spacing $T/(M-1)$.

Diffusion check at $M=8$: spacing $T/7$; times $\{0, T/7, 2T/7, 3T/7, 4T/7, 5T/7, 6T/7, T\}$. None of these equals $T/4$, $T/2$, or $3T/4$, and the count falling inside $[T/4,T/2]$ is $\{3T/7\}$ — **one** checkpoint, plus $2T/7\approx0.286T$ which is just above $T/4$, giving at most two. This **fails** the "exactly three per window / minimum supported" requirement (§4.3.2, line 1079) at the Interactive default.

Pros: includes the initial configuration in the canonical path; symmetric endpoints.

Cons: directly violates the diffusion-window contract at $M=8$; would force either re-deriving the windows as functions of the anchored grid (a spec change rippling through M6) or downgrading diffusion to "unavailable" at the default tier (§4.3.2's own fallback) — a real loss of the metric the milestone exists to deliver; the $M-1$ denominator makes the cache signature and the GPU loop slightly more error-prone.

Implementation cost: low in code, high in spec/consistency cost (would invalidate the M6 diffusion golden and §4.3.2's stated $M=8$ guarantee).

### Option C — Encounter-adaptive (denser near close approaches)

How it works: allocate checkpoint times non-uniformly, concentrating them around detected close-encounter / minimum-separation events so chaotic tangles near the collision singularities are better resolved (motivated by Fig. "shape_trajectories", line 1047, and the knot-sample rationale at line 1371).

Pros: best geometric fidelity per checkpoint for chaotic samples; aligns with the "knot samples" rendering preference for chaotic trajectories.

Cons: **not deterministic across f32/f64** — encounter detection depends on the trajectory, and f32 GPU vs f64 CPU will detect close approaches at different macro steps, so the two paths would checkpoint at *different* times, breaking the cross-validation gate and making $Z_n$ non-comparable between tiers and across cache reuse; the diffusion windows assume a known time grid, so $W_1/W_2$ membership becomes sample-dependent and the "three per window" guarantee is unprovable; the cache compatibility signature (§6.5) can no longer be a small constant — it would have to encode a per-sample schedule; coherence comparisons across nearby ICs (the refinement signal) assume checkpoints at *shared* times so $\mathbf n_i(t_m)$ and $\mathbf n_j(t_m)$ are comparable (line 1218, line 1312 mean-resultant-length $R_m$), which adaptive per-sample times destroy.

Implementation cost: high — needs an event-time pass, per-sample schedule storage, and a redesign of the diffusion and coherence contracts. Disqualifying for v1.

## Decision

**Adopt Option A: equal spacing with no anchor, $t_m = m\,T/M$ for $m=1,\ldots,M$, with $t_M=T$.**

Window membership is defined as **closed-closed**, with the shared boundary $t=T/2$ assigned to **both** windows (it is the natural endpoint of $W_1$ and start of $W_2$), which reproduces the spec's "exactly three per window" at $M=8$. This boundary convention is the one load-bearing detail and is pinned by the verification fixture below.

Rationale:

- It is the **simplest rule that satisfies the science.** It is a single closed form, $t_m=m\,T/M$, requiring only $(T,M)$ to cross the GPU/CPU boundary — no shared mutable state, no event detection, no per-sample schedule. Determinism across f32 and f64 is automatic.
- It is the **only candidate that satisfies the binding diffusion constraint** (§4.3.2, line 1079) at the Interactive default $M=8$ *and* at $M=16$, with the documented three- and five-per-window layouts respectively. Option B fails it; Option C makes it unprovable.
- It **matches what M3 already ships** (`simulate.wgsl` line 757), so ratifying it costs nothing and prevents the inspector and reduction passes from being built against a different assumption.
- The supposed downside of Option A — no $t=0$ sample — is not a real loss: the initial configuration is fully recoverable from the IC descriptor and decode output, and the canonical-path consumers (coherence, diffusion, arc length, animation) all want *interior + terminal* samples, not the trivial IC point.

This is a recommendation for human ratification. The rule should be recorded in the spec at §4.3.1 immediately after line 1042 ("Given fixed checkpoints $t_1,\ldots,t_M$...") as: *"The schedule is $t_m=m\,T/M$, $m=1..M$ (equal spacing, right-aligned, no $t=0$ anchor); diffusion windows are inclusive at both bounds with $t=T/2$ shared."*

## Consequences

This commits the following downstream artefacts, which must be built or audited to reflect the rule:

- **Spec §4.3.1 (line 1042)** and **§4.3.2 (line 1073)**: add the explicit schedule sentence and the closed-closed window-boundary convention. These living documents become the citable source for the contract.
- **`SimUniforms` (M3, `structs.ts` / `simulate.wgsl`)**: `checkpoint_count` ($M$) and `T_horizon` ($T$) are the *only* schedule inputs; no new field is needed. The GPU loop's `dtCkpt = T_horizon / M`, `nextCkpt = dtCkpt` is now contractually fixed, not incidental.
- **`MetricsAccumulator` / `metricsTick` (M6, `observe_extended.ts`)**: the CPU checkpoint scheduler must emit at the same $m\,T/M$ thresholds. The `emitCheckpoint` flag the function currently delegates to the caller must be driven by a shared helper, e.g. `checkpointTimes(T, M) -> number[]` returning `[T/M, 2T/M, ..., T]`, used by both the CPU integrator loop and any test harness. `Checkpoint.t` must equal the scheduled time, not the post-macro-step `s.t`, to avoid drift between tiers (or the comparison must be tolerance-based and documented).
- **`diffusion()` / `defaultDiffusionWindows()` (M6, `diffusion.ts`)**: the existing `[T/4,T/2]`/`[T/2,3T/4]` windows are correct under this schedule; the in-window predicate `t >= start && t <= end` (closed-closed) is the ratified convention — keep it, and add an assertion/test that it yields 3 samples at $M=8$.
- **`fitOmega` minimum-sample gate (M6)**: stays at `>= 3`, consistent with §4.3.2; the comment in `diffusion.ts` ("M=8 default produces 3 samples per full window") is now a guaranteed invariant, not a hope.
- **Reduction pass `mean_n_checkpoints[M]` (M5/`reduce.wgsl`, struct at line 2623)**: cross-sample means and the mean-resultant-length $R_m$ (line 1312) are well-defined *only because* all samples share $t_m$; this rule is the precondition for that pass.
- **Cache compatibility signature (§6.5, line 2452)**: "checkpoint schedule" reduces to the literal pair $(T, M)$ plus the rule name `equal-no-anchor`. Encode it so a payload computed at one $(T,M)$ is never silently reused at another.
- **Inspector (f64)**: must reuse the same `checkpointTimes(T,M)` helper so its overlaid checkpoints land exactly where the GPU's did.
- **M3 / M6 milestone docs**: M6's figure-8 word golden and shape-sphere landmark goldens are unaffected (they don't depend on schedule), but the diffusion golden in M6 must assert the three-per-window layout.

## Verification

Pin the decision with a small, fast golden fixture that fails if any agent changes the schedule, the boundary convention, or the $M$-default window layout. Two layers:

1. **Pure-function golden (`test/unit/metrics/checkpoint_schedule.test.ts`)** — the canonical pin, runs without a GPU:
   - `checkpointTimes(T, M)` returns exactly `[T/M, 2T/M, ..., T]` for $(T=80, M=8)$: assert the literal array `[10,20,30,40,50,60,70,80]`, assert `length === M`, assert `times[M-1] === T` and `times[0] === T/M`, and assert there is **no** `0` entry (anchor-free).
   - Diffusion-layout invariant: for $(T=80, M=8)$, exactly **3** of the returned times fall in closed $[T/4,T/2]=[20,40]$ (i.e. `{20,30,40}`) and exactly **3** in closed $[T/2,3T/4]=[40,60]$ (i.e. `{40,50,60}`), with $t=40$ counted in both. For $M=16$, assert **5** per window. This is the test that catches Option B / Option C regressions.

2. **Cross-tier consistency assertion (extend M3's `layer0_gpu_vs_cpu.test.ts`)** — when WebGPU is present, assert that the GPU `n_checkpoints[m].xyz` and the CPU reference's `checkpoints[m].n` correspond to the *same* scheduled $t_m$ (compare at index $m$, tolerance 1e-3 as the milestone already allows). This guarantees the two implementations did not silently diverge on the grid.

A frozen literal fixture file (e.g. `test/golden/checkpoint_times_T80_M8.json` containing `[10,20,30,40,50,60,70,80]`) referenced by test 1 makes the schedule a versioned artefact, so any change is a visible diff reviewed against this ADR and §4.3.1.
