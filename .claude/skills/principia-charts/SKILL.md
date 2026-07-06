---
name: principia-charts
description: Chart-atlas conventions for Principia (M10+) — the total decode/inverseEncode/validate chart contract, compatibility flags and their consumers, the deterministic (Lz, K) momentum construction with ADR-0007 failure codes 15/16, the shape-sphere realisation map and hemisphere fold, and the single-makeDescriptor rule. Consult when implementing or reviewing anything in src/chart_atlas/ or adding a new view of the IC manifold.
---

# Principia chart conventions

Charts land in M10 (`src/chart_atlas/`); M11 (Burrau) and M12 (export)
extend them. A chart is the ONLY thing that changes between views —
the decoder helpers, canonicaliser, simulation, and rendering are shared,
and the GPU shader stays chart-agnostic: it consumes `(m_i, r_i, p_i)`
and never branches on chart kind.

## The contract: three total operations

Every `Chart` implements:

- `decode(uv, view) → ChartDecodeOut` — **total on [0,1]²**. Every pixel
  returns `{kind:'ok', state, descriptor}` or
  `{kind:'terminal', terminal, descriptor}`. Never throw, never NaN.
  (Exception: the mixed-axis factory throws for axis combinations M10
  doesn't ship — those combinations are *unconstructible*, not
  per-pixel failures; a constructed mixed-axis chart is still total.)
- `inverseEncode(ic) → EncodeResult` — projects a physical IC back to
  pixel space. `'exact'` when the map inverts cleanly, `'projected'`
  with a `reason` when chart params are needed or the inverse is not
  unique. It takes no view — charts whose inverse needs `chartParams`
  return `'projected'` hints, they don't guess.
- `validate(uv, view) → ValidationResult` — pre-dispatch check for
  user-entered points. `'reject'` only for uv outside [0,1]²;
  `'project'` for representable-after-projection points (e.g. mass
  simplex saturation). Validate must agree with decode: never flag a
  pixel that decodes 'ok' with slack (false 'project' over interior
  regions is a usability bug — check the *actual* parametrisation).

## Compatibility flags and who reads them

- `forbids_energy_normalisation` (`FLAGS_INVARIANT`) — set by (Lz, E) /
  (Lz, K): the chart already pins the invariants, so a global energy
  renormalisation would silently move every pixel off its axis value.
  Enforced by `compatible()` in `validation.ts`; M12's export acceptance
  re-checks it per configuration.
- `has_redundant_hemisphere` (`FLAGS_SPHERE`) — shape sphere: φ ∈ (π, 2π)
  is the mirror copy of φ ∈ (0, π); decode folds β into [0, π].
- `requires_per_pixel_mass` (`FLAGS_MASS_VARYING`) — mass simplex and any
  mixed-axis chart with a mass axis: downstream may NOT hoist `m` out of
  the per-pixel loop. The mixed-axis factory must propagate this.

## Deterministic momentum construction (Lz, K) — `momentum_construction.ts`

One implementation, kind-tagged result, imported by every invariant chart.
Never copy it inline.

1. Gauge: canonical COM frame with R̃ = 1 ⇒ moment of inertia
   I = Σ mᵢ|rᵢ|² = |ρ̃|² + |λ̃|² = 1. Rigid part: ω = Lz/I,
   v^L_i = ω·J(rᵢ), which carries K_min = Lz²/(2I) exactly.
2. Feasibility: K* < K_min ⇒ `{kind:'infeasible'}` →
   `DegenerateReason.INFEASIBLE_ENERGY` (15, ADR-0007). Clamp the mix
   amplitude `a = √(max(0, 2(K*−K_min)))` — K* can sit within fp noise
   below K_min and a bare sqrt yields NaN.
3. Seed field w: subtract COM drift, subtract the Lz component
   (β = L(w)/I, w −= β·J(r)), normalise in the mass-weighted norm
   Σ mᵢ|wᵢ|² = 1. Because Σ mᵢ v^L_i·wᵢ = ω·L(w) = 0 after projection,
   v = v^L + a·w hits K* and Lz *exactly* (no iteration).
4. **Seed footgun:** the all-body rotational seed `[J(r₀), J(r₁), J(r₂)]`
   is the pure-rotation field — the Lz projection annihilates it to zero
   every time. Use partial fields (`[J(r₀), J(r₁), 0]`,
   `[0, 0, J(r₂)]`) alongside the radial seeds. All seeds degenerate ⇒
   `{kind:'seeds_exhausted'}` → `MOMENTUM_SEEDS_EXHAUSTED` (16).
5. The (Lz, E) and (Lz, K) charts share one decode: with the frozen
   configuration, E = U(r) + K*, so the E-axis warped relative to U is
   numerically the K-warp `K* = Kmax·v^γ`. They differ only in id,
   labelling, and inverse-encode semantics.

## Frozen-configuration realisation (sphere / invariant / simplex charts)

Charts that fix geometry build it hyperspherically at R̃ = 1:
`ρ̃ = [cos α, 0]`, `λ̃ = [sin α cos β, sin α sin β]`, then unweight by
√μ_ρ, √μ_λ and run `jacobiToParticlePositions`. Construct ρ̃/λ̃ directly —
do NOT call `decodeConfigCanonical` and mutate its result (its `Vec2`s
are readonly tuples; the M10 doc's mutation listing does not typecheck).

Shape-sphere realisation map ((θ, φ) → (α, β), spec revision):
`2α = arccos(−sin θ cos φ)`, `β = atan2(cos θ, −sin θ sin φ)` folded into
[0, π] (hemisphere rule). Pole buffer is enforced in θ(u), so validate
needs no extra pole check.

## The single-makeDescriptor rule

`makeDescriptor` (and `makeTerminal`) live in `@/decode/pipeline.js` and
are exported for chart use. Never re-implement them per chart: the M10
doc's inline copies drifted (`qMass: Math.min(...m)` instead of the
canonical `m_min/M_total`). One artifact, one home — same discipline as
GPU struct layout. Terminal-with-state (canonicalise says terminal) uses
`makeDescriptor(c.state)`; terminal-before-geometry uses
`makeTerminal(label, m)`.

## Registry discipline

`registerChart` throws on duplicate ids; `src/chart_atlas/index.ts` is
the single place instances register (import it for side effects in
tests). The mixed-axis *factory* is exported but never registered — each
constructed instance is view-specific. The renderer resolves charts only
through `getChart(id)` and never branches on `chart.kind`.
