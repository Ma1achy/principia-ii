---
name: principia-metrics
description: Derived stability observables for Principia (M6+) — corrected shape-sphere coordinate and its landmarks, phase unwrap, arc length, windowed frequency diffusion with sentinels, Benettin FTLE, free-group word encoding with branch cuts and ADR-0004 uncertainty, and the sample_descriptor / trajectory_stats bit packing. Consult when implementing or reviewing metrics code, WGSL metric functions, or anything reading the descriptor uint32s.
---

# Principia metrics conventions

The observables land in M6 (`src/metrics/`) and are consumed by every later
render mode, the M5 coherence score, and the M9 inspector. They fail the same
way GPU structs do — silently, with plausible-looking wrong numbers — so the
conventions below are contracts, not style.

## Corrected shape-sphere coordinate (single formula, two homes)

`n(t) ∈ S²` from **mass-weighted** Jacobi vectors (ρ̃ = √μ_ρ ρ, λ̃ = √μ_λ λ;
μ_ρ = m₀m₁/(m₀+m₁), μ_λ = m₂(m₀+m₁)):

```
I  = |ρ̃|² + |λ̃|²
n₁ = (|λ̃|² − |ρ̃|²) / I
n₂ = −2 ρ̃·λ̃ / I
n₃ =  2 (ρ̃×λ̃)_z / I        (I = 0 ⇒ canonical fallback (0,0,1))
```

The TS (`src/metrics/shape_sphere.ts`) and WGSL (`metrics.wgsl
shape_sphere()`) copies must stay in lockstep — change both in one commit.

**Landmarks (equal masses) — the golden pins these:**
- inner-pair (0,1) collision, ρ̃→0 → **(1, 0, 0)**
- λ̃→0 → (−1, 0, 0)
- other binary collisions → equator at (−1/2, ±√3/2, 0)
- equilateral (Lagrange) configurations → poles (0, 0, ±1)

## Phase and unwrap

θ = `atan2(n₂, n₁)` — i.e. `atan2(n[1], n[0])`, equatorial projection with
(x, y) = (n₁, n₂). Unwrap by minimal-magnitude jump (±2π correction), running
θ̃ accumulates; the sign of net winding feeds the `retrograde` bit.
Checkpoints store `.xyz = n`, `.w = θ̃` (spec §4.3.1).

## Diffusion — sentinels, never NaN

Windowed least-squares slope fit ω over W₁ = [T/4, T/2] and W₂ = [T/2, 3T/4];
diffusion = |ω₂ − ω₁|. The fit needs **≥ 3 samples** (the corrected spec; old
drafts said 4). Any window that can't fit returns the **sentinel −1.0** — the
GPU contract is *no NaN in any metric lane* (the G17 NaN hunter treats any
non-finite lane as a bug). Consumers gate on `>= 0` (see M5 coherence's
`spread_diffusion >= 0` guard).

## FTLE (Benettin, Research tier)

Twin trajectories, renormalise every `M_renorm` (default 50) macro steps:
`λ = (1/T) Σ ln(δ_j/δ₀)`. Norm is the **mass-weighted phase-space norm**
δ² = Σ mᵢ|Δrᵢ|² + α Σ |Δpᵢ|²/mᵢ (α = 1). Non-finite or zero separation ⇒
`valid = false`, λ = 0 — never throw, never NaN. `benettinCount` (number of
renormalisations) goes into descriptor bits 23–29; `FTLE_VALID` is bit 7.
On the GPU this is just 2× state in registers — no inter-thread coordination.

## Free-group word

2-bit symbols `a=00, A=01, b=10, B=11` packed into a `vec4<u32>` (64 slots);
**max length 58** (6 bits reserved for length); overflow sets
`truncated` → descriptor bit 8 (WORD_TRUNCATED). Append does **on-the-fly
free reduction** (aA/Aa/bB/Bb cancel). A symbol is emitted when n crosses the
great-circle branch cut through (b̂ᵢ, ê) — sign of `n·(b̂×ê)` flips; ê is the
north pole unless b̂ is within sin < 0.1 of it (then south).

- **Branch-cut basepoints are mass-dependent.** Defaults b̂₁ = (1,0,0),
  b̂₂ = (−1/2, √3/2, 0) are the *equal-mass* collision points; unequal-mass
  charts must supply their own (M11).
- **ADR 0004:** outside the equal-mass ε band (ε_m = 1e-6 on each pairwise
  difference) the word is computed-but-untrusted: set WORD_UNCERTAIN
  (descriptor bit 9). It must never gate refinement or science off-band.
- Homotopy golden: the figure-8 choreography's word is a power of the
  commutator `abAB` (accept cyclic rotations). Use M1's **rescaled** IC
  (`test/golden/figure8_reference.json`, Σm = 1, period ≈ 10.9568) — the
  textbook CM velocities/period are wrong at m = 1/3 without the √3 rescale.

## Descriptor packing — one layout, three homes

`sample_descriptor` (u32) layout is fixed by the G17 contract table
(`milestones/G17_debug_harness.md`) and lives in THREE places that change
together: `src/metrics/packing.ts` (pack/unpack), `src/debug/
descriptor_bits.ts` (decoder), and the WGSL bit-decode functions in
`render_layer0.wgsl`. Bits: 0–2 class, 3–4 detail, 5 suspectEnergy,
6 suspectLz, 7 ftleValid, 8 wordTruncated, 9 wordUncertain,
10–15 encounterCount (clamp 63), 16–22 substepLog2 (clamp 127),
23–29 benettinCount (clamp 127), 30–31 dominantPair.

`trajectory_stats` (u32): 0–15 tDminFrac, 16–22 totalStepsLog2,
23–28 orbitCount, 29–30 dminPair, 31 retrograde. Pack clamps; unpack is
total. Always round-trip-test both.

## Testing notes

- Landmark/formula assertions use tight tolerances (1e-12) — these are exact
  algebraic identities, not integration results.
- Anything integrated (word golden, FTLE golden) asserts robust facts
  (word ∈ ⟨abAB⟩ powers; λ_chaotic ≥ 10× λ_regular), never pinned floats —
  the M1/M3 chaos lesson.
- A "regular" FTLE reference orbit must actually be bound: for the
  m ≈ (½, ½, ~0) binary at separation 1, circular momentum is |p| = 0.25
  (p = mv, v² = F·r/m). Check E < 0 before trusting a reference orbit.
