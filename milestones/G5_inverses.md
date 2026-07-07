# G5 — Closed-form inverses for invariant charts

## Goal

Replace the M10 placeholder inverses (which return
`{ kind: 'projected', reason: '...' }`) with real, closed-form
inverse-encode for every chart.  Without G5, the
"lookup → lock → switch chart → preserve physical IC" round trip
in M8 only works on the affine latent-slice chart; with G5 it works
across all six registered charts plus the mixed-axis factory.

After G5: `chart.inverseEncode(ic, view?)` returns either
`{ kind: 'exact', pixel }` (the pixel decodes back to the same physical
state) or `{ kind: 'projected', pixel, reason, clamped: true }` (nearest
chart-feasible pixel with a specific cause). The **optional `view`
parameter** carries the chart knobs (`Kmax`, `gammaK`, `poleBuffer`, the
latent slice frame …); charts fall back to their decode defaults when it
is absent, so pre-G5 callers (M8's lookup/lock paths) keep working
unchanged.

**Exit criterion.**

```bash
npm test -- --run test/golden/chart_inverse
```

The golden pins **state equivalence**, not pixel equality: for every
registered chart (plus a mixed-axis factory instance), decoding a random
pixel, inverse-encoding the state, and re-decoding the inverse's pixel
reproduces the original canonical state componentwise (`m` to 1e-9,
`r`/`p` to 1e-6). Charts with no declared redundancy additionally
recover the original pixel to 1e-6. See "Why state equivalence" below.

**Deliverable:** internal — tests only; real closed-form `inverseEncode` for every chart makes the lookup → lock → switch-chart round trip preserve the physical IC across all charts, pinned by golden `test/golden/chart_inverse`.

## File tree

```
principia/
  src/
    chart_atlas/
      types.ts                     # G5: inverseEncode gains optional view param
      charts/
        latent_slice.ts            # G5: projects z − z0 onto the slice for a pixel
        lz_e.ts                    # G5: shared closed-form inverse (inverseLzChart)
        lz_k.ts                    # G5: inherits lz_e's inverse via the spread
        shape_sphere.ts            # G5: θ/φ read-back from the Hopf vector
        mass_simplex.ts            # already exact from M10 (see below)
        burrau_euclid.ts           # G5: ν via recoverNuFromTriangle
        mixed_axis.ts              # G5: latent × latent via inverseEncodeLatent
  test/
    unit/charts/
      inverse_lz_e.test.ts
      inverse_lz_k.test.ts
      inverse_shape_sphere.test.ts
      inverse_mass_simplex.test.ts
      inverse_burrau_euclid.test.ts
      inverse_latent.test.ts       # latent_slice view projection + mixed_axis factory
    golden/
      chart_inverse.test.ts
```

## Why state equivalence (golden design)

A pixel-equality golden fails for structural reasons on three charts:

- **latent_slice** had no pixel at all pre-G5 (it returned only `z`),
  and an off-slice IC has no exact pixel by definition.
- **burrau_euclid**'s u axis is display-only — every u decodes to the
  same state, so the inverse's `u = 0.5` convention can't match a random
  input u.
- **shape_sphere**'s realisation map folds `θ ↔ π−θ` (u ↔ 1−u) onto the
  same state, so half the pixel square inverts to the other half.

The robust fact — per the ratified golden pattern, "assert robust facts,
don't pin gauge" — is that `decode(inverseEncode(state).pixel)`
reproduces `state`. Both decode outputs pass through the canonicaliser,
so they are directly comparable componentwise with no gauge freedom
left. Exact pixel recovery is pinned **additionally** for the charts
with no declared redundancy (latent_slice on-slice, lz_e, lz_k,
mass_simplex, mixed_axis latent×latent).

## The maths

For each chart we need the inverse of `decode(uv) → physical IC`.
Starting from a physical IC `(m, r, p)`:

### `(L_z, E)` and `(L_z, K)` charts — one shared inverse

Both charts pixel-map through K — the (L_z, E) energy axis is
`E = U + K*` at the frozen geometry — so one inverse serves both,
exactly like the shared decode (`inverseLzChart`, exported from
`lz_e.ts`; `lz_k.ts` inherits it via the object spread):

```
L_z = Σᵢ (rᵢ × pᵢ)_z
K   = Σᵢ |pᵢ|² / 2mᵢ            [read directly — no U(r) needed]
I   = Σᵢ mᵢ |rᵢ|²               [from the IC, NOT assumed 1]

v = (K / K_max)^(1/γ_K)
L_max = √(2 I K)
u = (L_z + L_max) / (2 L_max)
```

`I` is the COM-frame moment of inertia of the **actual IC**: decode
outputs sit at the R̃ = 1 gauge where I = 1, but a foreign IC arriving
through an M8 chart switch need not.

Edge cases:
- `K ≤ 0` (rest start) → `L_z = 0` is mandated and the u axis is
  degenerate → exact `(0.5, 0)`.
- `K > K_max` → projected onto the top edge `t = 1` with u read at
  `L_max(K_max)`, `clamped: true`, reason names both values.
- `|L_z| > L_max (1 + 1e-9)` → projected to the rim (`u → 0` or `1`).
  Cauchy–Schwarz makes this unreachable for genuine states
  (`|L_z| ≤ √(2IK)` always, with equality at rigid rotation); the guard
  absorbs floating-point error at the rim.

### Shape sphere chart

The realised configuration's Hopf vector is

```
n = (sin θ cos φ,  sin θ sin φ,  |cos θ|)
```

— derived by composing the realisation map `2α = arccos(−sinθ cosφ)`,
`β = atan2(cosθ, −sinθ sinφ)` (β-folded into [0, π]) with the M6 Hopf
components. Two consequences:

- **The u axis carries the redundancy, not φ/v.** The β-fold collapses
  `θ ↔ π−θ` (u ↔ 1−u) onto the same state; `n₁` and `n₂` distinguish
  every `φ ∈ [0, 2π)`, so v is faithful. (An earlier revision of this
  doc claimed the fold lived on the φ axis — wrong, and now pinned the
  right way round by `inverse_shape_sphere.test.ts`.)
- **Canonical states have n₃ ≥ 0** (the mirror rule enforces
  λ̃_y ≥ 0), so `θ = arccos(n₃)` lands in [0, π/2] and the inverse
  returns the canonical `u ≤ 0.5` representative;
  `decode(inverse(x))` reproduces x's state exactly.

The inverse: compute `n` via `particlePositionsToJacobi` →
`massWeightedJacobi` → `shapeSphere`, then

```
θ = arccos(clamp(n₃))          φ = atan2(n₂, n₁) wrapped to [0, 2π)
u = (θ − ε) / (π − 2ε)         v = φ / 2π
```

with `ε` read from `view.chartParams['poleBuffer']` (default 0.05, the
same value the forward decode uses). `θ` inside the pole buffer →
projected to the buffer edge (`s = 0` or `1`), keeping the recovered v.
At a pole (`sin θ < 1e-9`) φ is degenerate — pick 0.

### Mass simplex chart

**Already exact from M10 — no G5 work.** The landed forward map is the
bilinear `m₁ = u, m₂ = (1−u)·v, m₀ = (1−u)(1−v)` (see
`decodeMassSimplex`), whose inverse is closed-form:

```
raw = (m − ε_m) / (1 − 3 ε_m)         [undo the interior buffer]
u = raw₁            v = raw₂ / (1 − raw₁)
```

Any raw component outside [0, 1] marks the result projected. (An
earlier revision of this doc derived a Newton iteration for the cubic
`m₁v³ − m₂v + m₂ = 0`, which inverts the parameterisation
`m₁ = u(1 − uv)` — a map that was never landed. Removed.)

### Burrau Euclid chart

Recover ν from the triangle's leg ratio (`recoverNuFromTriangle`,
M11 — hypot distances, so rotation-invariant and safe on canonicalised
states), then `t = (ν − 1/32) / (30/32)`. ν outside [1/32, 31/32] →
projected to the nearer edge. The horizontal axis is display-only
(Burrau Euclid is a 1D physical chart), so `s = 0.5` by convention.

### Latent slice chart

Pre-G5 this chart's inverse returned only the latent `z` (M8's lookup
projects it against its own view). G5 adds the pixel when a `view` is
supplied: run `inverseEncodeLatent`, project `z − z0` onto the slice
axes `q1`/`q2` (independent least-squares per axis), and map back
through `mag`. An off-plane residual above 1e-6 means the IC does not
live on this 2D slice — still return the nearest pixel, marked
projected with reason `'IC lies off this 2D latent slice'`.

### Mixed-axis chart

For the latent × latent variant (the only one constructible in M10):
run `inverseEncodeLatent` to recover the full latent z, then read each
axis back through its construction-time range with clamping. Other axis
kinds are unconstructible in M10's factory (decode throws), so their
inverse stays `projected` with reason `'mixed_axis inverse depends on
factory args'` — M11/M12 fill them in alongside their decodes.

## Tests

Unit suites (`test/unit/charts/inverse_*.test.ts`) pin, per chart:

- **lz_e** — rest start ↔ `(0.5, 0)`; interior round trips to 1e-9;
  no-view fallback equals the with-view result at default knobs;
  invariance under in-plane rotation of the IC; a rigidly rotating
  equal-mass triangle sits exactly on the feasibility rim (`u = 1`,
  the Cauchy–Schwarz equality case); `K > K_max` → projected top edge;
  all-at-rest with arbitrary geometry → apex.
- **lz_k** — `lzKChart.inverseEncode` is **the same function object**
  as lz_e's (inherited via the spread); round trip through its own
  decode; `Kmax` from the view shifts the v read-back as expected.
- **shape_sphere** — u < 0.5 pixels round-trip exactly (including
  v near 1, pinning the φ wrap); u > 0.5 folds to the canonical 1−u
  representative; u and 1−u decode to the same state; the equal-mass
  equilateral (Lagrange) configuration projects into the pole buffer;
  no-view fallback uses the default buffer.
- **mass_simplex** — interior round trips to 1e-10; the inverse reads
  only masses (geometry perturbation is invisible); sub-buffer masses
  → projected.
- **burrau_euclid** — v round trips to 1e-9 with `s = 0.5`; u is
  display-only (identical states for any u); ν outside range →
  projected.
- **inverse_latent** — latent_slice on-slice round trip through the
  view; no-view returns z only (pre-G5 behaviour); off-slice IC →
  projected with reason and the nearest pixel; mixed_axis
  latent × latent round trip; non-latent pairings stay projected.

The golden (`test/golden/chart_inverse.test.ts`) sweeps 100 LCG-seeded
pixels (seed 17) per chart over `allCharts()` plus a mixed-axis factory
instance: every ok decode must inverse-encode to a pixel in [0, 1]²,
every `exact` result must re-decode to the same canonical state, and
no-redundancy charts must also recover the original pixel. Guard
thresholds (> 50 ok decodes, > 30 exact inversions per chart) keep the
sweep from passing vacuously.

## Run it

```bash
npm test -- --run test/unit/charts
npm test -- --run test/golden/chart_inverse
```

## Acceptance check

```bash
npm test -- --run test/golden/chart_inverse
```

Every chart's `decode ∘ inverseEncode ∘ decode` is a state identity on
exact pixels; projected results carry a specific `reason` and a nearest
feasible pixel.

## Notes for the implementer

- **The interface change is additive.** `inverseEncode(ic, view?)` —
  the second parameter is optional and every chart falls back to its
  decode defaults, so M8's `lookup`/`lock`/`preserve` (which call
  `inverseEncodeLatent` directly or pass no view) are untouched.
- **Compute I from the IC.** The decode side works at the R̃ = 1 gauge
  where I = 1, but the inverse must serve foreign ICs (M8 chart
  switches) whose moment of inertia is arbitrary. `L_max = √(2IK)` with
  the actual I is what makes the rim test land exactly at u = 1 for a
  rigid rotor of any size.
- **The rim branch is a float guard, not a reachable region.**
  `|L_z| > √(2IK)` violates Cauchy–Schwarz for genuine states; the
  `(1 + 1e-9)` tolerance keeps rigid-rotation equality cases (the
  physical rim) on the exact path.
- **Pole buffer for shape sphere.** Inverse calls inside the buffer
  return `kind: 'projected'`. The buffer width comes from the same
  `chartParams['poleBuffer']` the forward decode reads (and G4 packs
  into `ChartUniforms.pole_buffer`), so the two sides agree by
  construction.
- **`(L_z, E)` infeasibility.** When `K > K_max` the IC exists
  physically but not at this chart's v range. The inverse projects to
  the top edge and reports it via the `reason` string; M8's
  lock-preservation policy reads the reason and chooses whether to
  refuse the chart switch.
- **Mixed-axis latent read-back is range-relative.** The factory
  closes over its construction-time axis ranges; the inverse reads
  `z[axis.index]` back through the same range. The latent components it
  does not display are simply not represented — that information lives
  in the returned `z`, which M8 uses for slice re-centring.
