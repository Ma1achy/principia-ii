# ADR 0003: Default FTLE perturbation variant per quality tier

- **Status:** Proposed (not yet ratified into the spec)
- **Date:** 2026-06-15
- **Gates:** M6, M9
- **Recommendation:** Full phase-space Benettin FTLE in Research tier only; Preview and Balanced compute no FTLE (FTLE_VALID always clear, ftle=0); FTLE_VALID is set iff the tier enabled FTLE AND benettinCount>0 AND the run is numerically finite.

---

## Context

§4.3.3 (the "Perturbation hierarchy" subsection of the FTLE section) enumerates three FTLE-like measurements "from most to least faithful": (1) "Full phase-space FTLE: perturbation in positions *and* momenta. Measures the canonical FTLE of the physical flow", (2) "Reduced IC-manifold FTLE: perturbation in the 2D chart coordinates only", and (3) "Finite-cloud spread ... This is ensemble spread, not FTLE." The spec is emphatic that "they are not the same object and should not be conflated" and warns that "Position-only perturbations ... should not be labelled as canonical full-state FTLE."

What it does NOT say: which of the three is the *default* the build agents should wire into each quality tier (Preview / Balanced / Research). This is left implicit, and it gates two milestones that multiple build agents touch independently:

- M6 (`src/metrics/ftle.ts`) already hard-codes the norm: its doc comment states "The mass-weighted phase-space norm is the spec's default choice (§4.3.3): δ² = Σ mᵢ|Δrᵢ|² + α Σ (1/mᵢ)|Δpᵢ|²", and `benettinFTLE` returns `valid: renorms > 0`. The packing contract `packSampleDescriptor` exposes `ftleValid` (bit 7) and `benettinCount` (bits 23–29).
- M9 (`src/inspector/shadow.ts`) implements `inspectorWithShadow`, which `perturb`s position only (`r: [[s.r[0][0] + d, ...]]`, momenta untouched) and renormalises in the full mass-weighted phase-space `sep`. That is a position-only *perturbation seed* measured in a *phase-space* norm — which §4.3.3 explicitly cautions must not be mislabelled as canonical FTLE.

Because the tier is "a dispatch-time uniform, not a per-sample decision" (§4.3.3, Compute shader integration paragraph), and because §6.3-adjacent contracts say "When `FTLE_VALID` is clear, the field is 0.0. No proxies, no conditional interpretation", every agent must agree on (a) which variant each tier produces and (b) the exact predicate that sets `FTLE_VALID`. If agents diverge — e.g. one ships IC-manifold FTLE in Balanced and labels it `FTLE_VALID`, another ships position-only in the inspector and calls it canonical — the `ftle` field becomes uninterpretable across the GPU pipeline, the tile reduction (`mean_ftle`/`spread_ftle`), the refinement oracle (split if `S_f > τ_f`), and the M9 validation panel (`gpuFtleDelta`).

The existing rule to preserve: FTLE_VALID only when `benettinCount > 0` (i.e. `renorms > 0`).

## Options

### Option A — Full phase-space FTLE in Research only; no FTLE in Preview/Balanced
How it works: Research tier (Tier C) sets `FTLE_ENABLED` in the dispatch flags and runs the canonical variant from §4.3.3.1: shadow perturbation in **both positions and momenta**, Benettin renormalisation in the mass-weighted phase-space norm, written to `ftle`. Preview and Balanced do not allocate a shadow state at all; `stretch`/`ftle` holds 0.0 and `FTLE_VALID` is clear. This matches the quality-tier table (Stability row: "diffusion only" / "diffusion + coherence" / "+ FTLE") and the spec line "FTLE is not used as the primary adaptive-refinement signal in Preview or Balanced modes."
- Pros: Single canonical variant, so the `ftle` field has one meaning everywhere. Honours §4.3.3's "do not conflate" directive and the "no proxies" rule for the field. Cheapest possible build contract — agents implement exactly one FTLE path. Aligns with the existing `ftle.ts` norm choice and the tier table verbatim. `FTLE_VALID` predicate is trivial.
- Cons: No FTLE signal at all in interactive tiers (acceptable per spec — coherence and ensemble spread drive refinement there). The current M9 `shadow.ts` seeds position-only and must be corrected to perturb momenta too, to be the canonical object.
- Implementation cost: Low. Mostly a deletion of ambiguity plus a one-line fix to `perturb()` in `shadow.ts` and a no-op (leave 0) path for the two cheap tiers.

### Option B — Full phase-space in Research, Reduced IC-manifold in Balanced, none in Preview
How it works: Research = full phase-space (as A). Balanced additionally runs the IC-manifold variant (perturb the 2D chart coordinates, decode each to a full IC, integrate both, renormalise). Both set `FTLE_VALID`.
- Pros: Gives a cheaper FTLE-like signal in the default interactive tier.
- Cons: Directly violates §4.3.3's warning that the IC-manifold variant is "not the same dynamical object" — two tiers would write semantically different numbers into the same `ftle` field, both flagged `FTLE_VALID`, breaking "No proxies, no conditional interpretation". The refinement oracle and `mean_ftle`/`spread_ftle` would mix incomparable quantities. Contradicts the tier table (Balanced = "diffusion + coherence", no FTLE) and "FTLE is a Research-tier scientific overlay." Requires the chart decoder inside the FTLE inner loop (two decodes per renorm).
- Implementation cost: High. New IC-manifold shadow path, decoder coupling, plus a discriminator so consumers know which variant produced a given `ftle`.

### Option C — Position-only everywhere FTLE is enabled (keep current M9 seed)
How it works: Adopt the position-only perturbation seed (as `shadow.ts` currently does) as the standard in whatever tier runs FTLE, measured in the phase-space norm.
- Pros: Zero change to existing M9 code; cheapest shadow seed.
- Cons: §4.3.3 explicitly says position-only "should not be labelled as canonical full-state FTLE", yet it would be written to the canonical `ftle` field under `FTLE_VALID`. Mislabels the science. The golden `ftle_chaotic_vs_regular` test happens to seed position-only too, so it would pass while still being non-canonical — masking the drift rather than catching it.
- Implementation cost: Low, but it bakes a spec violation into the contract.

## Decision

**Adopt Option A.** Full phase-space Benettin FTLE is the default and only FTLE variant; it runs in **Research tier only**. Preview and Balanced compute no FTLE: their `ftle` field is 0.0 and `FTLE_VALID` is clear (Preview/Balanced may still fill `stretch` with a cheaper non-FTLE proxy per §4.3.3, but that proxy is never flagged `FTLE_VALID`).

This is the simplest option that satisfies the science and a multi-agent build: it gives the `ftle` field exactly one meaning, matches the quality-tier table and the "Research-tier scientific overlay" statement verbatim, and obeys §4.3.3's prohibition on conflating the three variants. The IC-manifold variant remains a documented future research toggle but is NOT wired to `FTLE_VALID`.

`FTLE_VALID` predicate (canonical, to be implemented identically on GPU and CPU):

```
ftleValid = FTLE_ENABLED            // tier == Research (dispatch uniform)
         && benettinCount > 0       // renorms > 0  (existing rule, preserved)
         && isFinite(lambda)        // no NaN/Inf from a singular separation
```

When `ftleValid` is false, `ftle = 0.0`. This means `benettinCount > 0` is necessary but not sufficient: the tier gate makes it impossible for a Preview/Balanced sample to ever carry `FTLE_VALID`, even if a proxy accumulator happened to run.

The canonical perturbation seed is **both positions and momenta** (§4.3.3.1). `inspectorWithShadow`'s `perturb()` in M9 must be corrected from its current position-only seed to perturb momenta as well (a normalised split across all 12 phase-space components, or position+momentum components, is acceptable — the renormalisation washes out the exact seed direction, but the seed must span momentum dimensions to be the canonical object).

## Consequences

- M6 `packing.ts` / `SampleDescriptorFields`: `ftleValid` must be computed with the three-clause predicate above. The clamp/round-trip tests are unaffected. Add an invariant that `ftleValid == false` whenever the dispatch tier is not Research.
- M6 `ftle.ts`: `benettinFTLE` already returns `valid: renorms > 0`; callers must additionally AND in the tier gate and `isFinite(lambda)` before setting the bit. Keep the mass-weighted phase-space norm (`massWeightedNorm`) — it is now the *only* FTLE norm.
- M9 `shadow.ts`: fix `perturb()` to seed momenta as well as positions so the inspector's true-FTLE is the canonical full phase-space object. `runInspector` keeps `ftle: 0` until a shadow is requested; when set, it represents the same variant as the GPU's Research-tier `ftle`, so `validation.gpuFtleDelta` is a like-for-like comparison.
- GPU dispatch (M5/M12 path): `FTLE_ENABLED` (dispatch flag bit per §6.3 dispatch table) is set only for Research dispatches. The `quality tier` uniform is the single source of truth; no per-sample tier branching.
- Tile reduction (`mean_ftle`, `spread_ftle`) and refinement oracle (`S_f > τ_f`): unchanged, but now provably operate on a single FTLE variant. `S_f` is zero whenever `FTLE_VALID` is not set, which is automatic for all Preview/Balanced tiles.
- Render modes reading `ftle`: must check `FTLE_VALID` first (already the spec rule); in Preview/Balanced they will always see the bit clear and must fall back to coherence/ensemble, never to the `ftle` number.
- Skills/agents: any agent implementing a tier other than Research must NOT emit FTLE; any agent implementing the inspector must use the phase-space seed. The IC-manifold variant is explicitly out of scope for `FTLE_VALID`.

## Verification

Pin the decision with a golden fixture that an agent cannot satisfy by drifting to another variant or tier:

1. Tier-gate test (new, `test/unit/metrics/ftle_valid_gate.test.ts`): build `SampleDescriptorFields` for each tier. Assert `unpackSampleDescriptor(packSampleDescriptor(f)).ftleValid` is `false` for Preview and Balanced even when `benettinCount = 12` is forced, and `true` for Research only when `benettinCount > 0` AND a finite lambda was produced. Also assert that `benettinCount = 0` with the Research tier yields `ftleValid = false` (preserves the existing rule).

2. Canonical-seed regression in `test/golden/ftle_chaotic_vs_regular.test.ts`: extend the existing Burrau-vs-regular golden. Keep the ≥10× ratio assertion, and add a second assertion that the FTLE is *invariant to the seed split between position and momentum* to within tolerance (run with a position-only seed and a position+momentum seed; the Benettin estimate must agree to, say, 5%). A position-only-only implementation that fails to span momentum will diverge here, catching Option C drift. Assert `valid === true` (i.e. `renorms > 0`) for both runs.

3. Cross-tier field meaning (M9 `test/golden/inspector_match.test.ts` extension): for a Research-tier GPU `SimResult` with `FTLE_VALID` set, assert `Math.abs(adaptive_ftle - gpu_ftle) < tol`; for a Balanced GPU result, assert `FTLE_VALID` is clear and `gpu.ftle === 0`, so the inspector does not attempt a delta. This pins that the `ftle` field carries the same variant across the GPU/CPU boundary and is zero/clear off Research.
