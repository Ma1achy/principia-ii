# Runbook: add a new chart

The canonical extension path. **A new view is a new `(Y, Φ)` chart only** —
you do *not* touch the decoder, canonicaliser, simulation, or rendering. The
compute shader stays chart-agnostic.

## 1. Define `(Y, Φ)`

Decide the two axes and the map `Φ: [0, 1]² → IC`. `Y` is the latent target
the two axes parametrise; `Φ` turns a pixel `(u, v)` into masses, positions,
and momenta. Pick a `ChartKind` (`affine` / `invariant` / `sphere` /
`mass_simplex` / `mixed`) and the `ChartFlags`
(`forbids_energy_normalisation`, `has_redundant_hemisphere`,
`requires_per_pixel_mass`).

## 2. Implement `decode` / `validate` / `inverseEncode`

In `src/chart_atlas/` (one file per chart, mirroring the six landed charts):

- **`decode(uv, view)`** — return `{ kind: 'ok', state, descriptor }` or a
  terminal. It must be **total**: never throw. Tag degeneracies with a
  `DegenerateReason` (ADR 0007, codes 10–17) or `COLLISION_T0`; every pixel
  gets a label. Reuse `makeDescriptor` / `makeTerminal` from
  `@/decode/pipeline.js` — the one descriptor home.
- **`validate(uv, view)`** — return `pass`, or `project` / `clamp` with the
  pulled-back pixel, so out-of-domain input lands on the feasible set.
- **`inverseEncode(ic, view?)`** — the closed-form inverse so the lock
  survives a chart switch (G5). Derive `K`/`I` from the *actual* IC, not a
  gauge assumption; if the chart has a redundant fold (like the shape
  sphere's hemisphere), map to the canonical representative and document it.
  If a true inverse is impossible, document the nearest-point fallback.

Keep f64 on the host; the per-pixel uniforms are f32 with f64 precomputation.

## 3. Register the chart

Add the `ChartId` to `src/chart_atlas/types.ts`, register the chart object in
the registry (`src/chart_atlas/index.ts`), and implement
`chartUniforms(view)` — promote any per-chart constants (mass bounds, shape
limits) into the 64-byte `ChartUniforms` block (group 0, binding 3, per
G4/G3) rather than hard-coding them in the shader.

## 4. Add tests

Mirror the landed chart suites (`test/unit/charts/`, `test/golden/`):

- **Totality** — `decode` over a `[0, 1]²` sweep returns ok-or-terminal for
  every pixel (no NaN, no throw).
- **Landmark** — pin a point with a known IC and outcome (a central
  configuration, a Burrau triple) within an explicit tolerance.
- **Round-trip** — `decode ∘ inverseEncode ∘ decode` reaches state
  equivalence for interior points (pixel equality only where the chart has
  no redundancy — see G5's golden design).
- **Hand-off** — a cross-chart lock transfer lands where the shared point
  should (mirrors M10's shape-sphere → `lz_e` test).

## 5. Update the docs

Nothing here changes the GPU struct layout or the two-stage boundary, so no
ADR moves. Add the chart to the [user guide](../user-guide.md) chart table,
and — if it introduces vocabulary — to the [glossary](../glossary.md).

> Checklist: defined `(Y, Φ)`; total `decode`; `validate` projects/clamps;
> `inverseEncode` round-trips; registered with `chartUniforms`; totality +
> landmark + round-trip tests green. → `principia-architecture`,
> `src/chart_atlas/`.
