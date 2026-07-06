---
name: principia-render
description: Render-graph conventions for Principia (M7+) — the four-stage colour/brightness/combiner/post pipeline, OKLAB colour science and linear-sRGB gamma discipline, vMF shape-sphere hue blending (OKLAB vs Okabe–Ito hue sets), CVD simulation, the group(3)-only RenderParams rebind contract, and the recipe for adding a new visualisation mode. Consult when implementing or reviewing anything in src/render/ or the render-stage WGSL files.
---

# Principia render-graph conventions

The render graph lands in M7 (`src/render/` + the render-stage WGSL) and is
extended by M10 (chart overlays) and G13 (CVD accessibility). Its failure
modes are visual and silent — colours that are merely *plausible* — so the
rules below are contracts.

## The four-stage pipeline (fixed order)

```
SimResult ─[colour node]─► vec3 linear sRGB ─┐
                                             ├─[combiner]─► RGB ─[post: CVD → sRGB encode]─► canvas
SimResult ─[brightness node]─► f32 L ────────┘
```

One shader module, one pipeline object; every mode is a `switch` case on ids
in the `RenderParams` uniform. Do NOT create per-mode pipelines — pipeline
switching cost dwarfs a uniform branch (M7 implementer note; M10 may revisit).

## Gamma discipline — linear sRGB throughout

Everything between the colour node and the final encode runs in **linear
sRGB**. The CVD matrices are linear-sRGB matrices (Brettel/Viénot/Mollon
formulation). The single `linear_to_srgb` at the very end is the ONLY gamma
encode in the pipeline. **Applying CVD in gamma-encoded space looks visibly
wrong (too dark) — that is the bug you'll see if you reorder the post
stages.** Palettes (viridis stops, cubehelix) are treated as linear-sRGB
values in M7's approximation; combiner lightness maths happens in OKLAB.

## OKLAB is the working perceptual space

- TS home: `src/render/oklab.ts` (sRGB↔linear, linear↔OKLAB via M1/M2 and
  inverses, OKLAB↔OKLCH). WGSL home: `render_helpers.wgsl` (`mat3x3` consts).
  The matrices are pinned by round-trip tests to 1e-6 — don't "re-derive"
  them.
- WGSL `mat3x3<f32>(a,b,c, d,e,f, g,h,i)` is **column-major**: that
  constructor lays down columns, so to match the TS row-major arrays the
  WGSL constants must be the TRANSPOSE of the TS `M1`/`M2` rows, or be
  applied as `v * M`. Get this wrong and hues rotate ~120° — a classic
  silent-plausible failure. Verify with the OKLAB round-trip on the GPU
  harness, not by eye.
- Lightness replacement/modulation (`combine_*_lightness`) goes through
  OKLAB: to-lab, replace/scale `.x`, back. Never scale RGB directly except
  in the explicitly named `multiply_rgb` combiner.
- WGSL cube root: `pow(x, 1/3)` is NaN for negative x. LMS values for
  in-gamut linear sRGB are non-negative, but out-of-gamut intermediates
  (high-chroma OKLCH picks) can go negative — use
  `sign(x)*pow(abs(x),1/3)` if a mode can feed negatives.

## vMF shape-sphere hue blend — two hue sets, one formula

Six poles at ±x̂, ±ŷ, ±ẑ (the shape-sphere landmarks: BCs on the equator,
Lagrange at the poles). Weight `w_i = exp(κ n̂·p̂_i − max)` (subtract max
before exp — κ up to 16 overflows f32 otherwise), then chroma-weighted
circular mean of the pole hues in OKLAB a/b.

- `HUE_OKLAB` = [0, 180, 120, 300, 240, 60]° — the full-gamut set
  (`shape_sphere_vmf`, colour mode 21).
- `HUE_OKABE_ITO` = [250, 70, 30, 210, 170, 350]° — the CB-safe set
  (`shape_sphere_okabe_ito`, mode 22, and the `stability_x_hue` base).
- These are **different modes with different hue tables** — the WGSL takes a
  scheme selector; do not collapse 21/22 into one case.
- `stability_x_hue` (mode 23, the principal Principia mode): Okabe–Ito base
  hue, then L replaced in OKLAB by BC proximity:
  `prox = max(n·b1, n·b2, n·b3)` over the three binary-collision directions
  (1,0,0), (−1/2,±√3/2,0); `L = 0.25 + 0.55·0.5·(1−prox)`. Collisions dark,
  Lagrange poles light — the integration test pins this ordering.

## Sentinels in brightness modes

`diffusion < 0` is the M6 "insufficient data" sentinel — brightness maps it
to a neutral 0.5, never to 0/1 (it would masquerade as extreme stability).
Drift maps are log-scaled with a floor (`max(drift, 1e-30)`) so zero drift
doesn't produce −inf.

## The group(3)-only rebind contract

`RenderParams` (64-byte uniform, packed by `packRenderParams`) lives alone in
group(3). A palette/mode/CVD/overlay change = one 64-byte
`queue.writeBuffer` + rebind of group 3. Groups 0 (SimUniforms/TileRequest),
1 (SimResult/ICDescriptor storage), 2 (reduction, empty until wired) are
NEVER touched by a visualisation change, and no byte of the SimResult buffer
changes. The integration test asserts a palette swap changes exactly the
4 bytes of `palette_id` in the packed params. When adding a field, use the
reserved tail (bytes 56–63) before growing the buffer.

WebGPU footgun: an empty bind-group layout at index 2 still requires an
empty bind group to be **set** at draw time — create it once alongside the
pipeline and always bind it.

## Standalone WGSL module rule (D3.3 / D5.2 / D17.3)

The render module is composed by concatenating, in order:
`render_helpers.wgsl` → `colour_modes.wgsl` → `brightness_modes.wgsl` →
`combiner.wgsl` → `cvd.wgsl` → `render_graph.wgsl`. It repeats
`SimUniforms` / `TileRequest` / `SimResult` / `ICDescriptor` **verbatim from
`simulate.wgsl`** (same field names, same order — `ICDescriptor` is
`m1,m2,m3,q_mass, rho1_mag,rho2_mag,rho_ratio,rho_angle, K_0,V_0,
virial_ratio,r_min_pair_0`). It must NOT be concatenated with
`helpers.wgsl` (duplicate `PI`). Any struct change lands in the WGSL, the
`structs.ts` packer, and the pin test in the same commit.

## Adding a new colour mode (the leaf-change recipe)

1. Extend the `ColourMode` union in `src/render/types.ts`.
2. Add its index to `COLOUR_MODE_INDEX` in `params.ts` (append — never
   renumber existing ids; captured frames store ids).
3. Add its source field to `COLOUR_SOURCES` in `mode_registry.ts`.
4. Add one `case` in the colour switch in `render_graph.wgsl` (and a
   function in `colour_modes.wgsl` if nontrivial).

No change to the params buffer layout, the sim/reduce shaders, or the
pipeline objects. Brightness/combiner/CVD modes extend the same way in
their own registries.

## Testing

- CPU mirrors (`oklab.ts`, `vmf.ts`, `cvd.ts`, `palettes.ts`) are the
  testable reference for the WGSL; unit tests pin round-trips and landmark
  hues, integration tests pin the packing contract and stability×hue
  luminance ordering (`npm test -- --run test/integration/render_graph`).
- WGSL compile + pipeline creation is validated on a real GPU via the dev
  harness page (`npm run dev:render`) + Playwright check — Node can't
  compile WGSL.
- Colour assertions use loose tolerances (ΔE-ish, 1–3 decimals) except the
  matrix round-trips (1e-6): palette stops are approximations, hue maths is
  exact.
