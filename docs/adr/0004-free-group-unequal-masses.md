# ADR 0004: Free-group word encoding for unequal masses

- **Status:** Accepted (ratified into the spec 2026-06-15)
- **Date:** 2026-06-15
- **Gates:** M6, M10, M11
- **Recommendation:** Scope v1 to equal masses: the F2 word with fixed equator generators (1,0,0)/(-1/2,±√3/2,0) is the only validated, golden-pinned regime; unequal-mass slices compute the word against decoder-derived collision points but flag it WORD_UNCERTAIN and never gate refinement or science on it until a future ADR ratifies the general rule.

---

## Context

The free-group word is an open **contract** shared by three milestones: M6 (it is the last derived observable, packed into `sample_descriptor` / `trajectory_stats`), M10, and M11 (Burrau, which is intrinsically *unequal*-mass — masses 3:4:5). Multiple build agents will implement `src/metrics/free_group.ts`, the `metrics.wgsl` shader, the `WORD_TRUNCATED` packing bit, and the golden tests. If they each guess at the unequal-mass rule, the bit layout and the symbol semantics will silently diverge between the CPU reference and the GPU shader, and between M6 and M11.

What the spec **defines** (§4.6, `sec:free_group`). For equal masses the construction is complete and unambiguous: π₁ of the thrice-punctured shape sphere is "the *free group on two generators* $F_2=\langle a,b\rangle$"; generators are pinned to $\hat{\mathbf b}_1=(1,0,0)$, $\hat{\mathbf b}_2=(-\tfrac12,\tfrac{\sqrt3}{2},0)$, with $\hat{\mathbf b}_3=(-\tfrac12,-\tfrac{\sqrt3}{2},0)$ "expressible in terms of $a$ and $b$ via the punctured-sphere relation"; branch cuts $C_a,C_b$ are great-circle arcs from $\hat{\mathbf b}_1,\hat{\mathbf b}_2$ to the north pole $\hat{\mathbf l}^+$; crossing detection is the sign change of $d(t)=\mathbf n(t)\cdot(\hat{\mathbf p}\times\hat{\mathbf q})$; free reduction cancels $aA/Aa/bB/Bb$.

What the spec **omits**. The entire unequal-mass rule is one hand-wave paragraph: "the collision points $\hat{\mathbf b}_j$ shift from their equal-mass positions on the equator. The branch cuts must be adjusted accordingly: connect each generator's collision point to a reference point … via a great-circle arc *that avoids the other collision points*. The encoding scheme and crossing detection are otherwise identical." There is **no formula** for where $\hat{\mathbf b}_j$ shift to, no rule for choosing the branch-cut endpoint when $\hat{\mathbf l}^+$ no longer cleanly separates the punctures, and no statement of which two of the three punctures remain the generators. The render-mode section concedes the same gap from the visualisation side ("For unequal masses, either retain the equal-mass overlay as a pedagogical frame … Otherwise users may overinterpret equal-mass landmarks").

Why this is risky beyond "missing detail." The lit review names this exact construction as a **novel, unproven contribution**: "the present work proposes equipping the encounter alphabet with orientation … and the algebraic structure of a free group … it is *not established in the prior literature*" (§ Symbolic Dynamics, *Proposed contribution*), and lists it under Gaps as something that "has not, to our knowledge, been reported." Prior art (Tanikawa–Mikkola) uses *unsigned* shape-sphere sequences and only ever on the *equal-mass / free-fall* sphere. So for unequal masses we would be shipping an unvalidated rule on top of an unvalidated formulation, with no golden orbit (the figure-8 is equal-mass) to pin it.

One fact that bounds the risk: the collision points are not actually unknown — they are computable. Each $\hat{\mathbf b}_j$ is the image under the existing decoder `shapeSphere(massWeightedJacobi(...))` of the configuration where the corresponding pair coincides (one mass-weighted Jacobi vector → 0). The inner-pair collision stays at $(1,0,0)$ for any masses (it is the $\tilde\rho\to0$ limit). The topological *type* (thrice-punctured sphere, $F_2$, two generators suffice) is mass-independent because moving punctures continuously does not change the homotopy type. What is genuinely undetermined is the **branch-cut endpoint / generator choice** when the shifted punctures no longer sit symmetrically, and whether the pair-labelling and prograde sign conventions survive.

## Options

### Option A — Equal-mass-only contract; unequal-mass word computed-but-untrusted (recommended)

How it works. v1 ratifies the word as a *science-grade* invariant **only** in the equal-mass regime, with the generators frozen at the literal constants the spec gives. For any chart whose masses are not (within $\varepsilon_m$) equal, the GPU/CPU still *run* the same crossing detector — but against collision points obtained from the decoder (`shapeSphere(massWeightedJacobi(collisionConfig, m))`), with both branch cuts anchored at $\hat{\mathbf l}^+$ exactly as written — and set a new descriptor bit `WORD_UNCERTAIN`. When that bit is set, the word may be displayed (labelled "approximate") but must **not** drive refinement, boundary detection, clustering, or any published diagnostic. `DEFAULT_BRANCH_CUTS` stays the equal-mass constants; unequal-mass charts pass mass-derived $\hat{\mathbf b}_i$ through the existing `BranchCutCfg` hook (already present in `observe_extended.ts`).

- Pros: the only regime that is *provable today* (golden figure-8 → power of `abAB`) is the only regime we make claims about. Burrau (M11) still gets a word for exploration without forcing a correctness commitment the science can't back. No new math invented; uses the decoder that already exists. Multi-agent safe: one constant table, one extra flag, one rule ("uncertain ⇒ non-gating"). Cheapest. Fully reversible — a later ADR can promote `WORD_UNCERTAIN` words to trusted without changing the bit layout.
- Cons: M11/Burrau cannot use the word as a primary classifier in v1 (must lean on FTLE, frequency diffusion, outcome class — all already Tier-A/C and unaffected). The displayed unequal-mass word is best-effort and may mislead if users ignore the flag (mitigated by mandatory labelling).
- Cost: Low. One descriptor bit + its packing test; one guard in refinement; relabel overlay; the decoder-derived collision-point helper (small, reuses `shapeSphere`/`massWeightedJacobi`).

### Option B — General construction now: derive shifted punctures + adaptive branch-cut endpoint

How it works. Specify the full rule: compute $\hat{\mathbf b}_1,\hat{\mathbf b}_2,\hat{\mathbf b}_3$ from the decoder for the slice masses; keep $(a,b)$ on $\hat{\mathbf b}_1,\hat{\mathbf b}_2$; choose, per slice, a branch-cut endpoint $\hat{\mathbf e}$ (a pole or a computed safe point) such that $C_a,C_b$ provably avoid the third puncture; bake all of it into the shader and a Burrau golden.

- Pros: one uniform code path for every mass; M11 gets a first-class word; closes the gap "properly."
- Cons: commits the whole pipeline to an **unproven** invariant (lit review flags it as such) in its hardest regime, with *no* known periodic unequal-mass orbit to pin it — the verification fixture would itself be unvalidated. The "endpoint that avoids the other puncture" is underspecified for extreme ratios (the existing `pickEndpoint` north/south fallback is an ad-hoc patch, not a theorem). High risk of silent CPU/GPU divergence and of baking a wrong convention into M6/M10/M11 simultaneously. Hard to walk back once goldens encode it.
- Cost: High — new derivation, new shader branch logic, a Burrau golden whose "expected" word must itself be researched and defended.

### Option C — Drop generators to one; record unsigned winding count for unequal masses

How it works. Where masses are unequal, abandon $F_2$ and emit only a coarse signed/unsigned crossing count (closer to Tanikawa–Mikkola), reusing the same `uint4` field as a counter.

- Pros: defensible against prior art; avoids the unproven $F_2$ claim entirely off the equal-mass sphere.
- Cons: two different *semantics* in the same bitfield depending on masses — a multi-agent footgun and a consumer nightmare (render modes, ML pairs, clustering all branch on regime). Throws away the topological structure that is the whole point of the field. Still needs the shifted-puncture computation.
- Cost: Medium, but with the worst long-term semantics tax.

## Decision

**Adopt Option A.** Ratify the free-group word as a trusted invariant **only in the equal-mass regime**, with generators frozen at the spec's literal constants $\hat{\mathbf b}_1=(1,0,0)$, $\hat{\mathbf b}_2=(-\tfrac12,\tfrac{\sqrt3}{2},0)$ and both branch cuts anchored at $\hat{\mathbf l}^+=(0,0,1)$. Defer the general unequal-mass *rule* to a future ADR. For unequal-mass charts, compute the word with the identical detector against decoder-derived collision points, but stamp `WORD_UNCERTAIN` and forbid it from gating refinement, boundary detection, or any published diagnostic.

Rationale, ordered by the brief's priorities — simplest option that satisfies the science *and* a multi-agent build:

1. **Honest about correctness risk.** The lit review is explicit that the $F_2$ formulation is unproven and unprecedented; the spec gives no unequal-mass formula. Option B would hard-code that unproven rule into three milestones' goldens with no orbit to validate against — exactly the silent-drift failure this contract exists to prevent. Option A confines every *claim* to the one regime with a provable fixture (figure-8 → `abAB^k`).
2. **Multi-agent consistency.** A single frozen constant table plus one flag and one rule ("uncertain ⇒ non-gating") is far harder to implement inconsistently than a per-slice adaptive endpoint (B) or a regime-switched bitfield semantics (C).
3. **Doesn't block M11.** Burrau still receives a word for *exploration* and still has FTLE, frequency diffusion, outcome class, and arc length as its trusted diagnostics — none of which depend on this decision.
4. **Reversible.** Bit layout is unchanged; promoting unequal-mass words to trusted later is a flag-policy change, not a data-format migration.

This is a recommendation for human ratification. The one substantive thing it asks the maintainer to accept is: *Burrau's primary classification in v1 is not the free-group word.*

## Consequences

Structs / types (`src/metrics/types.ts`, `packing.ts`):
- Add `WORD_UNCERTAIN` as a new `sample_descriptor` bit. `wordTruncated` already occupies bit 8; place `wordUncertain` at **bit 9** (shifting `encounter_count` to bits 10–15, range 0–63) and update `SampleDescriptorFields`, `packSampleDescriptor`/`unpackSampleDescriptor`, and the spec's §6.6 bit table (now done — the `WORD_UNCERTAIN` row sits between `WORD_TRUNCATED` and `encounter_count`). Do **not** repurpose any existing bit.
- `FreeGroupWord`, the `uint4` layout, 58-slot capacity, and 2-bit symbol codes are **unchanged** in every regime.

Metrics / decoder:
- `DEFAULT_BRANCH_CUTS` in `observe_extended.ts` stays the equal-mass literals `b1=[1,0,0]`, `b2=[-0.5,√3/2,0]`. Unequal-mass charts pass `BranchCutCfg` derived from the decoder via a new helper `collisionPoints(m)` that returns `shapeSphere(massWeightedJacobi(collisionConfig_j, m))` for each pair — reusing existing functions, inventing no new math.
- `metricsTick` / `freeGroupTick` set `wordUncertain` whenever the active masses are outside the equal-mass $\varepsilon_m$ band. The `pickEndpoint` north/south fallback is retained only as a numerical guard, explicitly **not** as the unequal-mass rule.

Refinement / render / skills:
- The tile-refinement and boundary-detection code (M5/M10 coherence path) must treat `wordUncertain` words as carrying *no* signal. Any "word changed between adjacent pixels ⇒ boundary" logic gates on `!wordUncertain`.
- The shape-sphere overlay (§ render modes, ~line 1727) follows the existing "retain equal-mass overlay as pedagogical frame" option and labels unequal-mass words "approximate."

Milestones:
- **M6**: goldens stay equal-mass (figure-8, equal-mass landmarks) — already the case; add the `WORD_UNCERTAIN` packing round-trip test. Exit criterion ("periodic figure-8 produces a power of `abAB`") is untouched.
- **M10/M11**: must select non-word diagnostics as Burrau's primary classifier; may surface the word read-only with the uncertain flag. The decode/branch-cut hook is wired but its output is advisory.
- A follow-up ADR (`free-group-unequal-masses-general`) owns Option B if/when a validated unequal-mass reference orbit exists.

## Verification

Pin the decision with two fixtures so it cannot silently drift:

1. **Equal-mass trusted word (already specified, keep as the anchor).** `test/golden/figure8_word.test.ts` — the Chenciner–Montgomery figure-8 reduces to a power of `abAB` (cyclic rotations allowed), and `wordUncertain` is `false`. This is the *only* regime in which a non-trivial word value is asserted.

2. **Unequal-mass flag fixture (new, the actual guard for this ADR).** A golden that runs any unequal-mass IC (e.g. the Burrau 3:4:5 rest start) through `metricsTick` and asserts:
   - `unpackSampleDescriptor(packed).wordUncertain === true` for unequal masses, and `=== false` for the equal-mass figure-8;
   - the equal-mass generator constants are byte-for-byte identical between the CPU `DEFAULT_BRANCH_CUTS` and the values baked into `metrics.wgsl` (a small cross-check test reading both), so the two code paths can never diverge on the frozen regime;
   - a refinement-layer unit test asserting that a synthetic word-difference between two adjacent samples does **not** trigger a boundary split when either sample has `wordUncertain` set.

Together these lock in: (a) the equal-mass word is correct and trusted, (b) unequal-mass words are always flagged, and (c) flagged words never leak into a gating decision — the three properties Option A commits to.
