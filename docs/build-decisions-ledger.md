# Build decisions ledger

A running log of decisions made while building the milestones autonomously —
anything where the code, the milestone doc, or a default had to be chosen or
corrected. Each entry: what was decided, why, and what it touched. Newest first.

The intent (per the build authorisation) is that every non-obvious choice is
flagged here so it can be reviewed rather than buried in a diff.

---

## Depth-stress harness (user-requested, between M8 and M9)

Branch `feat/depth-stress-harness`. The user asked whether refinement
works at higher resolutions and deeper depths — the M5 harness had only
validated one fixed level (z=2, N=16). New `dev:depth` harness +
`dev/out/depth_stress_check.mjs` (20/20 checks pass on real GPU):

- **Descends the real pipeline level by level** (simulate → reduce →
  schema-checked readback → coherence → decideSplit → priority) at
  N=32/tile (4× M5's resolution), chasing the max-impurity child
  (boundary) and min-impurity child (uniform) from z=2.
- **Boundary chase: 13 consecutive levels of splits (z=2 → z=15),
  impurity pinned at 45–63% the whole way** — the fractal basin boundary
  never smooths out, exactly as the physics demands — and is stopped
  only by the AT_F32_FLOOR keep guard, at precisely the depth
  `pyramid.reachedF32Floor(z, 32)` predicts (z=15).
- **Uniform chase settles to keep('coherent') at z=13** with impurity
  3.9%; instructive: even "uniform" children hovered at ~20% impurity
  (above the 10% force-split) for 11 levels in this latent region.
- τ(ℓ) escalation, split-reason/metric consistency, children-tile-parent
  geometry, sample_count = N² at every level, and a one-tile N=64
  (4096-sample) hi-res smoke all validated.

### DS.1 — nothing in production sets AT_F32_FLOOR yet
`decideSplit` honours `TILE_STATUS.AT_F32_FLOOR` and `camera.effectiveZ`
clamps requests above the floor, but no production code path currently
SETS the bit — the harness sets it CPU-side from
`pyramid.reachedF32Floor(z, N)`, mirroring the scheduler's intended
wiring. Defensive today (the camera clamp makes below-floor requests
unreachable), but the scheduler should set the bit when it enqueues
at-floor tiles; flagged for the G-series/M12 integration wiring.

---

## M8 — Interaction

Branch `feat/m8-interaction` off `webgpu-rewrite`. Acceptance gate
(`npm test -- --run test/integration/interact`) green first run; 19 unit
+ 2 integration tests; full suite 249 passed / 1 skipped; typecheck +
lint clean. Deliverable is internal (tests only) per the milestone doc.
The `principia-interaction` skill was authored just-in-time, and carries
the GUI-spec reconciliation notes (8D not 10D; keyboard/DAS/ARR stays in
G12 — M8 is headless).

### D8.1 — lookup tests asserted gauge-dependent absolute coordinates
The doc's Pythag test expected the decoded `lockedPhysical.r[1]` to sit
within 0.05 of the *requested* absolute position (0.6, 0). But the 8D
chart is scale- and frame-gauged: configuration lives on the shape sphere
at hyperradius R̃ = 1 and decode reconstructs in the canonical COM frame,
so absolute positions shift (COM projection alone moves body 1 to
(0.4, −0.2) — 0.28 away) and absolute scale is renormalised. What DOES
survive: the mass tuple (exactly), distance ratios, and angles. As built,
the tests assert those invariants (side ratios 4/3 and 5/3, right angle
at body 0 to 1e-6; equilateral side-ratio 1 for the mass-only default) —
the M1-ratified "don't pin the gauge, assert robust facts" pattern, now
codified in the `principia-interaction` skill. The doc's misnamed
"rejects on a degenerate latent" test (which rejected nothing) was
renamed to what it pins: decode totality — saturated latents never throw.

### D8.2 — strict-TS reconciliation in doc listings
Same class as D4.3/D5.3: `ViewState['lockedPhysical']['m']` is an indexed
access through an `| undefined` union (fixed with `NonNullable<…>`);
`reason: enc.clamped ? … : undefined` is illegal under
`exactOptionalPropertyTypes` (fixed with a conditional spread);
`named_directions.ts` had unused imports (`normalize8`, `scale8`, `sub8`,
`MU_MAX_DEFAULT`) and an unused `muMax` parameter (dropped); tuple
indexing under `noUncheckedIndexedAccess` needs `!` in the r[i][j] loops.
All folded back into the doc listings.

---

## M7 — Render graph

Branch `feat/m7-render-graph` off `webgpu-rewrite`. Acceptance gate
(`npm test -- --run test/integration/render_graph`) green; 14 unit + 6
integration tests; full suite 225 passed / 1 skipped; typecheck + lint
clean. Real-GPU validation: `dev:render` harness + Playwright check
(dev/out/m7_render_check.mjs) — 10/10 checks pass (module compiles, all
four stages respond independently, deterministic repaints, achrom is
grey). The `principia-render` skill was authored just-in-time before this
milestone, per the planning obligation.

### D7.1 — doc's WGSL matrices computed the transposed transform
The doc wrote the OKLAB (`M1_TO_LMS` …) and CVD matrices in row-major
reading order, fed them to WGSL's **column-major** `mat3x3` constructor,
and multiplied `M * v` — mathematically the transpose of the intended
transform (silently rotates hues; the classic plausible-but-wrong render
failure). As built, the constants keep the row-major reading order
(matching the TS mirrors) and are applied as `v * M` (row-vector
product), which is the correct composition. Folded back into the doc with
a warning comment.

### D7.2 — doc's `palette_div_symlog` had its select() arms swapped
WGSL `select(f, t, cond)` returns `t` when cond is true; the doc's call
put the log branch in the false arm, so values inside the linear window
got `1 + log(x/eps)` (negative → sign flip) and values outside grew
linearly unbounded. Swapped. Also renamed the local `signed` — a WGSL
reserved word (same class as G17's D17.2 `debug` → `dbg`).

### D7.3 — modes 21/22 were the same colouring in the doc's shader
The doc's TS declares two hue tables (`HUE_OKLAB` for `shape_sphere_vmf`,
`HUE_OKABE_ITO` for `shape_sphere_okabe_ito`) but its WGSL had a single
`vmf_okabe_ito` used by both switch cases — collapsing two documented
modes into one. As built, `vmf_blend6(…, scheme)` selects the hue table
(scheme 0 = OKLAB, 1 = Okabe–Ito); case 21u/22u pass different schemes;
`stability_x_hue` uses the Okabe–Ito base per its reference test. A unit
test + the real-GPU check pin that the two modes differ.

### D7.4 — OKLAB inverse matrices derived exactly, not pinned approximations
The doc pinned Ottosson's published approximate inverses, which close the
rgb→oklab→rgb round-trip only to ~2e-6 — failing the doc's own 1e-6
acceptance line. As built, `invertMat3(M1)`/`invertMat3(M2)` are computed
at module load: exact to machine precision, no fixture to maintain. The
WGSL keeps the published constants (f32 dominates on GPU). The doc's
over-precise M1/M2 literals also tripped `no-loss-of-precision`; rounded
to the canonical published values (identical f64s).

### D7.5 — stability×hue test asserted an impossible luminance
The doc's "Lagrange poles are light" asserted linear-sRGB luminance
> 0.5, but the mode's own formula caps OKLAB lightness at L = 0.525 —
linear luminance ≈ 0.14 (OKLAB L ≈ cube root of luminance). The doc
conflated the two scales. As built, the test measures OKLAB L, the
quantity the mode actually sets (0.25 at BCs, 0.525 at poles), keeping
the dark/light/ordering intent. Same reconciliation family as D4.1
(doc test contradicting the doc's own formula — keep the formula).

### D7.6 — palette-swap test strengthened from a tautology to a byte pin
The doc's second test packed `{...defaults, wallClockTime: defaults.wallClockTime}`
— asserting a buffer equals itself. As built: (1) a palette swap changes
EXACTLY bytes 16..19 (the palette_id lane), (2) packing is deterministic,
(3) the buffer is 64 bytes with a zero reserved tail. The real-GPU side
(groups 0/1/2 untouched) is exercised by the harness check.

### D7.7 — buildRenderGraph returns all four bind groups; empty group 2 must be set
The doc's `RenderGraph` returned only the group-3 bind group, leaving the
caller unable to draw: the doc creates the group-0/1 layouts inline (so
M3's bind groups — built on different layouts, with the G17 debug binding
and `'storage'` buffer type — are incompatible), and WebGPU requires even
an EMPTY bind-group layout at index 2 to have an empty bind group set at
draw time. As built, `buildRenderGraph` creates and returns
`bgTile`/`bgStorage`/`bgEmpty`/`bgRenderParams`. Also applied the
standalone-module rule (D3.3/D5.2): render_graph.wgsl repeats
SimUniforms/TileRequest/SimResult/ICDescriptor verbatim from simulate.wgsl
(the doc used them undeclared), with ICDescriptor in simulate.wgsl's field
order, not the doc's re-ordered variant. Dropped from the doc's file tree:
`physics_overlay.wgsl` (its own implementer note defers overlays to M10)
and `src/gpu/render_pipeline.ts` (listed with no listing; superseded by
`src/render/pipeline.ts`).

### D7.8 — offscreen validation textures must match the pipeline's format
Harness lesson (folded into the doc's dev-harness section): validating
pixels off an `rgba8unorm` offscreen texture fails silently when the
pipeline's colour target is the canvas-preferred `bgra8unorm` — the
render pass fails validation, the readback is all-black, and nothing hits
the console unless a `device.addEventListener('uncapturederror', …)`
listener is installed. The harness now uses `ctx.format` for offscreen
targets and installs the listener.

---

## M6 — Stability metrics

Branch `feat/m6-metrics` off `webgpu-rewrite`. Acceptance gate (the three
goldens) green first run; 24 unit + 5 golden tests; full suite 205 passed /
1 skipped; typecheck + lint clean. `metrics.wgsl` validated on a real GPU
(compile + pipeline creation, zero errors). The `principia-metrics` skill was
authored just-in-time before this milestone, per the planning obligation.

### D6.1 — figure-8 word golden uses the rescaled IC, not the textbook one
The doc's `figure8IC()` mis-halved the standard Chenciner–Montgomery
velocities (its own comment contradicted the code) and used the unit-mass
period 6.32 at m = 1/3 — dynamically wrong at Σm = 1, where velocities scale
by 1/√3 and the period by √3 (≈ 10.9568): the M1 lesson, already pinned in
`figure8_reference.json`. A non-periodic orbit never closes the word. As
built, the test loads the M1 fixture, runs 4 true periods, accepts cyclic
rotations of `abAB` in either orientation (the doc's 4-rotation list missed
the inverse-orientation words), and asserts every 4-symbol block repeats the
same base — strictly stronger than the doc's startsWith check. Passes with a
clean word.

### D6.2 — FTLE "regular" reference orbit was unbound
The doc's binary had p = ±0.7071 at m ≈ ½ each and separation 1 — pair
energy E = +0.75, an escaping (not regular) configuration. Circular momentum
is p = m·v with v² = F·r/m → p = 0.25. Fixed; Burrau FTLE ≥ 10× the regular
orbit's, as gated. Also removed the unused `totalEnergy` import.

### D6.3 — pickEndpoint computed a wrong partial cross product
The doc's `sin ∠(b̂, north)` used two hand-expanded (and mis-indexed) cross
components, evaluating to |b_y| — so the equator basepoint (1,0,0) got the
SOUTH endpoint while the doc's own unit test expects NORTH. As built it takes
the norm of the full `cross3(b, NORTH)`, matching the WGSL `length(cross())`
version, which was already correct.

### D6.4 — Smaller strict/lint corrections folded back
Unused imports in the doc's listings (`Vec2` in metrics/types, `normalize3`
in free_group, `Checkpoint` in observe_extended), and dead confused lines in
the diffusion sentinel test. `metrics.wgsl` is function-definitions-only
(composes with helpers.wgsl for PI); validated by compiling
helpers+metrics+a probe entry point on the real GPU.

---

## M5 — Layer 2: GPU reduction + adaptive refinement

Branch `feat/m5-layer2-refinement` off `webgpu-rewrite`. Acceptance gate
(`npm test -- --run test/integration/layer2`) green first run; 65 M5-touched
tests; full suite 176 passed / 1 skipped; typecheck + lint clean. Real-GPU
validation: the new `dev:layer2` harness ran the full M3 simulate → M5 reduce
→ schema-checked readback pipeline for 16/16 tiles headlessly (real impurity
0.17–0.5 force-splitting the boundary-rich slice; β→π−β mirror symmetry
visible in the reduction means), and `gpu:check` is unchanged (95/81/10).

### D5.1 — TileReduction head layout: no TileID pad (272 bytes, not 288)
The doc's WGSL declared `TileID { z, tx, ty, _pad }` with the decoder reading
`level` at lane 4 and checkpoints from lane 8 — that layout is 288 bytes,
contradicting ADR-0006 and M3's pinned `sizeOfTileReduction(8) = 272`.
Resolved per the ratified contract: TileID is 3 × i32 (no pad), `level` packs
at byte 12, the checkpoint array lands naturally 16-aligned at byte 16, and
scalars start at lane `4 + M*4` — total 268 → 272. WGSL, decoder, and the
golden all agree; doc corrected.

### D5.2 — reduce.wgsl: version bits, standalone structs, complete writes
Three defects in the doc's shader listing: (a) it wrote `status_flags = 0u`,
so `decodeTileReduction` would throw a schema mismatch on every readback —
the version must be ORed into bits 6-7; (b) it referenced `SimUniforms` /
`TileRequest` without defining them — the module compiles standalone, so the
structs are repeated in full (M3's D3.3 class); (c) it summed diffusion but
never wrote `mean_diffusion` (and the valid-count was per-lane only), and
left mean_ftle / word / ensemble / trajectory fields and the checkpoint means
unwritten — stale-buffer leaks. As built: a `shared_diff_n` reduction feeds a
sentinel-respecting mean, and every output field is written explicitly.

### D5.3 — Authored the two test files the doc omitted + lint fixes
The doc's file tree lists `priority.test.ts` and the ADR-0006
`tile_reduction_layout.test.ts` golden but provides no listing for either.
Authored both: the golden hand-pins all 31 scalar lanes (sentinel = 100+index
— a deliberate second copy of the field order so a constant-size reorder
fails loudly), checks version-bit stripping, the schema-mismatch throw, and
string-matches `reduce.wgsl` against `wgslTileReductionStruct(8)`. Also
removed the off-screen test's unused `FifoComputeQueue`.

### D5.4 — Dev harness is `dev:layer2` (Vite), reusing G17 infrastructure
The M5 dev-harness section pre-dated G17; as built it follows the G17
pattern: `dev/layer2_refinement.{html,ts}` + `npm run dev:layer2`, painting
the decision map on a 2D canvas (sidestepping the known headless WebGPU
presentation glitch) and validated headlessly with Playwright.

---

## M4 — Layer 1: tile cache and ancestor fallback

Branch `feat/m4-layer1-cache` off `webgpu-rewrite`. All 40 M4 tests green
first run (6 unit suites + both integration tests, including the acceptance
gate `npm test -- --run test/integration/layer1`); full suite 148 passed / 1
skipped; typecheck + lint clean. Pure-CPU milestone — no GPU/doc surprises.

### D4.1 — zoomLevel doc tests contradicted the doc's own formula
The doc pins `z_base = ⌊log₂(W / (T_pix × Δu_view))⌋` but its test expected
`zoomLevel(1024, 1.0, 256) === 0` — the formula gives 2, and 2 is physically
right (a 1024-px viewport of 256-px tiles needs 4×4 tiles fully zoomed out;
z=0 would render one tile stretched 4×). Kept the spec formula, fixed the
expectations (2 and 4), and added the true z=0 case (`zoomLevel(256, 1.0,
256)`). Doc updated.

### D4.2 — effectiveZ reuses pyramid.reachedF32Floor
The doc's `camera.ts` duplicated the f32-floor logic in a private helper
(`require_f32_floor_check_failure`) instead of importing `reachedF32Floor`
from `pyramid.ts` — two copies of a precision threshold is exactly the drift
the non-negotiables warn about. Implemented with the single shared function
and added unit tests for `effectiveZ` (untested in the doc). Doc updated.

### D4.3 — Strict/lint fixes to doc listings
`pyramid.ts` imported `tileBounds` unused; `layer1_panning` had a write-only
`frameNum` and an un-narrowed `split('/')` destructuring
(`noUncheckedIndexedAccess`); `layer1_zoom_handoff` imported `tileKey`
unused. Also added a `flush()` keeps-inflight test the doc's queue suite
lacked. All folded back.

---

## G17 — Debugging & bring-up harness

Branch `feat/g17-debug-harness` off `webgpu-rewrite`. Exit gate green first run
(`npm test -- --run test/unit/debug`: **23 tests**, ≥18 required); full suite
108 passed / 1 skipped; typecheck + lint clean; `npm run gpu:check` ok with
numbers **identical to M3** (gpuDisagree 95, cpuSelfFlip 81, histDelta 10) —
proving debug mode 0 is byte-for-byte the M3 colouring. The Vite dev page was
exercised headlessly end-to-end (boot → dispatch → mode switch → pick-sample
inspector → struct dump → NaN scan all verified via DOM assertions).

### D17.1 — DebugUniform rides through M3's explicit pipeline layout
The doc said "the harness creates its own debug buffer and a debug-aware
render path", leaving M3's `buildPipelines` untouched. That cannot work: M3
uses an **explicit** pipeline layout, and WebGPU rejects a pipeline whose
shader statically uses a binding (`group(0) binding(2)`) absent from the
layout. Fixed additively: `createTileBuffers` allocates a 16-byte `debug`
uniform buffer (WebGPU zero-fills it → mode 0 → M3 colouring unchanged for
every existing caller, including `dev/gpu_check.html`), and `buildPipelines`
adds binding 2 (FRAGMENT, uniform) to the common layout + bind group. The
harness writes modes via `bufs.debug`. Doc updated.

### D17.2 — WGSL debug uniform named `dbg`, not `debug`
Renamed the shader-side variable to `dbg` to steer clear of WGSL
reserved-word ambiguity (`debugger` is reserved; implementations have varied
on neighbours). Cosmetic; the TS side keeps the doc's names verbatim.

### D17.3 — Reapplied D3.3 to the doc's render-shader listing
The G17 doc's modified `render_layer0.wgsl` again showed placeholder structs
(`struct SimResult { /* same */ };`) and `var<storage, read>` — both invalid
against the standalone module + 'storage' layout (the exact M3 D3.3 defect).
Built with full repeated structs and `read_write`; doc listing replaced with
the real source.

### D17.4 — Vite introduced for the dev page only
Added `vite` (^8.1.3) devDep, root `vite.config.ts` (`@` → `src`, WGSL as
`?raw`), and the `dev:debug` script, per the doc's "Run it" pinning. `dev/`
and `vite.config.ts` stay outside the tsconfig/lint scope — dev-only DOM glue,
consistent with M3's `dev/gpu_check` precedent; everything it calls into
(`src/debug/*`) is unit-tested.

### D17.5 — Headless canvas presentation glitch persists (known from M3)
In headless Chromium/swiftshader the live WebGPU canvas presents corrupted
blocks (M3-documented artifact); compute output underneath is correct (the
inspector decodes real per-sample data; `gpu:check`'s 2D readback redraw
matches). Visual confirmation of the canvas is the headed-browser
`npm run dev:debug` — exactly this milestone's Deliverable.

---

## M3 — Layer 0 GPU dispatch

Branch `feat/m3-layer0-gpu` off `webgpu-rewrite`. Node gate green (85 tests
total; GPU tests self-skip without WebGPU) **and** validated on a real WebGPU
device via a new Playwright/Chromium harness (`npm run gpu:check`): WGSL
compiles with **zero validation errors**, dispatch + readback work, and the
chaos-calibrated agreement gate passes (see D3.2).

### D3.1 — Stood up a real-GPU dev harness beyond M3's file tree
M3's GPU tests self-skip in Node, which would have left ~500 lines of WGSL
completely unexecuted — unacceptable given the project's "GPU failures are
silent" non-negotiable. Added `dev/gpu_check.html` + `dev/gpu_check.mjs`
(Playwright + headless Chromium + `--enable-unsafe-swiftshader`, an
`npm run gpu:check` script, `@webgpu/types` + `playwright` devDeps). This is
explicitly the **seed of G17** (M3's Deliverable already said the viewable
artifact ships with G17) and CI-parity with G8's swiftshader smoke job. It
renders the outcome grid (first on-screen pixels), redraws the readback buffer
on a 2D canvas for a trustworthy artifact, and saves `dev/out/gpu_check.png`.

### D3.2 — Replaced the exact-agreement gate with a chaos-calibrated gate
The doc's gate ("≥250/256 identical classes + shape positions to 1e-3 at
T=50") is unattainable in principle: the latent slice is dominated by
rest-start collapse orbits with fractal basin boundaries. Measured: GPU-vs-CPU
flips 95/256 pixels while CPU-vs-CPU under a 1e-4 IC nudge (the f32-error
scale) flips 81 — the GPU is statistically indistinguishable from an f32-scale
perturbation of the same map. Bug-vs-chaos was discriminated three ways:
(a) class histograms agree to 10/256; (b) mirror pairs (β→π−β) show identical
deviations on both sides (a layout/indexing bug would shatter this);
(c) smooth BOUNDED samples' shape-sphere checkpoints agree to ~3e-3 at T=5
with error growing along the Lyapunov spectrum (a systematic bug corrupts all
samples equally — not observed). New gate: gpuDisagree ≤ max(6,
1.5×cpuSelfFlip) AND per-class histogram delta ≤ 15% AND zero WebGPU
validation errors. Same decision pattern as M1's D1.1 (user-ratified: don't
pin chaos; assert robust facts).

### D3.3 — render_layer0.wgsl needed real structs and read_write access
The doc's render shader had `struct SimResult { /* same */ };` placeholders —
not valid WGSL (the module compiles standalone) — and declared
`var<storage, read>` against a bind-group layout of type 'storage'
(read_write), which fails pipeline validation. Fixed: full struct definitions
repeated (pinned byte-identical to simulate.wgsl/structs.ts) and read_write
access. Doc updated.

### D3.4 — Smaller doc corrections folded back
`structs.test.ts` was missing the three chart hyperparameters
(`mu_max`/`alpha_min`/`q_max`) that its own C3 fix added to `SimUniforms` —
wouldn't have compiled; also gained offset assertions (u32[6], u32[12],
f32[19..21]) and a TileRequest packing test. Robust `navigator.gpu` guard
(direct `'gpu' in navigator` throws when `navigator` is undefined in older
Node). `dispatch_layer0.ts` dropped an unused import; readback/test indexing
non-null assertions for `noUncheckedIndexedAccess`. `uniforms.ts` from the
file tree was never specified by the doc and is not needed (packers live in
`structs.ts`) — not created.

---

## M2 — Decoder atlas

Branch `feat/m2-decoder-atlas` off `webgpu-rewrite`. Acceptance gate
`npm test -- --run test/unit/decode test/golden/decode_landmarks` — **green on
first run** (21 tests: 1000-point encode/decode round-trip at 1e-9, 10000-point
totality, landmarks); full suite 77; typecheck/lint clean.

### D2.1 — `TerminalLabel` DEGENERATE reason: `string` → `number` (ADR-0007 alignment)
M0's `TerminalLabel` typed the DEGENERATE reason as `string`, but ADR-0007 (and
M2's `DegenerateReason` enum, codes 10–17) make it a closed numeric code shared
byte-for-byte with WGSL — and M2's pipeline passes the enum value. Changed the
base type in `src/math/types.ts` to `number` with a comment pointing at the
enum (not imported there, to keep `math` the base layer with no dependency on
`decode`). M0 doc listing updated to match. No existing producer of DEGENERATE
used a string.

### D2.2 — Doc listings cleaned for strict mode / lint (no semantic changes)
Unused type imports removed from the M2 doc's listings (`Triple` in
decode/types, `Vec3` in canonicalise, `TrajState` in no_holes, `Vec8` + the
whole unused `rotate.js` import in inverse); non-null assertions on loop-index
tuple reads in five test listings; the landmark test's `rhoT`/`lambdaT` typed
`as const` and its reconstructed `r` actually asserted on. All folded back into
`milestones/M2_decoder_atlas.md`; the committed code is semantically identical
to the doc.

### D2.3 — `no_holes.ts` stays out of the barrel (doc-faithful)
The doc's `index.ts` deliberately omits `no_holes.js` (its `safeguardDecode` is
an internal guard, first consumed in M3's dispatch path). Kept the barrel
exactly as the doc lists it rather than "completing" it.

---

## M1 — CPU reference integrator

Branch `feat/m1-cpu-integrator` off `webgpu-rewrite`. Acceptance gate
`npm test -- --run test/golden` — **green** (figure-8 strict golden + Burrau
physical validation); 16 unit integrate tests also green; typecheck/lint clean.

### D1.1 — Replaced the unachievable Burrau precision golden with a two-part golden (user-ratified)
The M1 doc gated on Burrau 3-4-5 reaching escape with `< 1e-7` energy drift.
Empirically (resolution sweep on the real integrator): `dt=1e-4` blows up at the
t≈16.5 encounter regardless of `NMax`; `dt=5e-5` completes (ESCAPE body 2,
t≈66.9) at 2e-2 drift; `dt=2.5e-5` gives a *different* escape time (t≈46) at
1.2e-1; `dt=1e-5` blows up. Not converged — the Pythagorean problem's deep
encounters need regularization the spec's per-macro-step adaptive substepping
doesn't have. Per the fixture policy (pin only trustworthy high-precision runs),
the golden was split: **(a)** figure-8 choreography as the strict 1e-7 pinned-
checkpoint golden (drift 8.5e-13 measured, checkpoints convergence-verified
1e-4 vs 2e-5 to <3e-6); **(b)** Burrau kept as physical validation asserting
only the robust Szebehely–Peters outcome (lightest body ejected) + drift/Lz
envelope; **(c)** new milestone `G19_close_encounter_regularization.md`
(Levi-Civita/KS) as the future home of a true Burrau precision golden.
Discussed with and approved by the user before implementing.

### D1.2 — Fixed a real MAX_SUBSTEPS bug: Yoshida sums vs the per-step cap
`run()` compared the macro step's substep count against `NMax`, but a Yoshida
step returns the *sum* over its constituent KDK steps (7 for Y6) — so a Y6 step
whose parts each used e.g. 60 substeps (< NMax=64) reported 420 and spuriously
terminated MAX_SUBSTEPS. Every step function now also returns `maxSub` (peak
per-constituent-KDK count); the saturation terminal and the `maxSubstepCount`
diagnostic key off it. Folded into the M1 doc listings.

### D1.3 — The doc's escaping body was wrong: body 2 (lightest), not body 1
The M1 doc asserted body 1 (mass 4/12) escapes. The literature (Szebehely &
Peters 1967) and both completed integrations agree it is the **lightest** body
— body 2, mass 3/12 — that is ejected, leaving the two heavier bodies as a
binary. The committed Burrau test asserts body 2. Doc corrected.

### D1.4 — Fixed a defective unit-test IC: equilateral-at-rest is a triple-collision orbit
The doc's Yoshida-vs-KDK drift comparison used three equal masses released from
rest at an equilateral triangle — a homothetic orbit that collapses to a
*triple collision* in finite time, so both integrators diverge (Y4 "drift" came
out 1343). Replaced with a smooth bound binary (same family the Y6-vs-Y4 test
already used). Both order-comparison tests now pass meaningfully. Doc updated
with a warning note.

### D1.5 — Strict-mode fixes in the doc's M1 source listings
`types.ts` re-exported `Force` alongside its own declaration (TS2484 conflict) —
removed from the re-export list. `run.ts:isFiniteState` indexed tuples by loop
variable (fails `noUncheckedIndexedAccess`) — hoisted with non-null assertions.
Both folded into the doc.

---

## M0 — Foundations

Branch `feat/m0-foundations` off `webgpu-rewrite`. Acceptance gate
`npm test -- --run test/unit/math` — **green, 38 tests** (≥30 required);
`npm run typecheck` and `npm run lint` also clean.

### D0.1 — Kept the existing richer `.gitignore` instead of the milestone's 5-line one
The M0 doc specifies a minimal `.gitignore` (`node_modules`, `dist`, `coverage`,
`*.log`, `.DS_Store`). The repo already had a fuller, deliberately-authored
`.gitignore` (covers all of those plus `.claude/*` allow-listing, lockfiles,
editor cruft). Kept the existing one — it is a superset and the `.claude/`
handling is load-bearing for the skills/hooks. No functional gap versus the doc.

### D0.2 — Added a minimal `.eslintrc.cjs` (not in the M0 file tree)
`package.json` ships a `lint` script (`eslint src test --ext .ts`) and the
test/CI strategy's G8 unit job runs `lint → typecheck → test`, but the M0 file
tree lists no ESLint config, so `npm run lint` would error with "no config".
Added a minimal `.eslintrc.cjs` (`eslint:recommended` +
`@typescript-eslint/recommended`, `no-explicit-any` off for the tuple-cast math
primitives). Low-risk, unblocks the advertised script and the future CI job.

### D0.3 — Did **not** add a GitHub Actions workflow in M0
M0's Deliverable says "green CI gate," which could be read as a workflow file.
Per `docs/test-and-ci-strategy.md` ("M0 — config foundation … the *workflows*
arrive in G8"), M0 owns only the config that CI runs (`package.json` scripts +
`vitest.config`), and `.github/workflows/*` is a G8 deliverable. Kept M0 scoped
to config; the "gate" is the green `npm test`. Avoids duplicating/rewriting the
workflow in G8.

### D0.4 — Fixed two incorrect test **assertions** in the M0 doc (impls were correct)
The milestone's copy-paste tests failed against the correct implementations —
the assertions were wrong, not the code. Fixed in both the working tree and
`milestones/M0_foundations.md` (living-document discipline):

- **`sigmoid(-1000)` stability test.** Asserted `toBeGreaterThan(0)`, but
  `e^-1000 ≈ 5e-435` is below the smallest float64 subnormal, so `sigmoid`
  *correctly* saturates to exactly `0.0`. The real guarantee is finite / never
  NaN. Changed to `toBeGreaterThanOrEqual(0)` (kept the `< 1e-100` and
  `Number.isFinite` checks).
- **`smoothstep` endpoint-derivative test.** Asserted the forward-difference
  slope `< 1e-9`, but a forward difference of a function with zero first
  derivative and nonzero curvature is `O(eps) ≈ 3·eps ≈ 3e-6`, never `< 1e-9`.
  The `smoothstep` impl is the standard correct Hermite. Relaxed the threshold to
  `1e-4` (still ~5 orders below the interior slope `s'(0.5)=1.5`, so it genuinely
  tests "flat at the endpoints").

### D0.5 — Satisfied strict-mode lint/typecheck in the M0 doc's tests
Under the strict tsconfig (`noUncheckedIndexedAccess`) and ESLint, the doc's
verbatim tests didn't compile/lint clean. Fixed in tree + doc:

- Non-null assertions on in-range indexed reads in the numeric-loop assertions
  (`m2[i]!`, `m[i]!` in softmax; `lhs[i]!`, `rhs[i]!` in vec) — the indices are
  provably in bounds.
- Removed two unused imports (`scale2`, `dot3`) from `vec.test.ts`.

These are test-only edits; no production `src/math` code changed from the doc.
