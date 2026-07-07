# Build decisions ledger

A running log of decisions made while building the milestones autonomously —
anything where the code, the milestone doc, or a default had to be chosen or
corrected. Each entry: what was decided, why, and what it touched. Newest first.

The intent (per the build authorisation) is that every non-obvious choice is
flagged here so it can be reviewed rather than buried in a diff.

---

## G4 — Chart-parameter promotion

Branch `feat/g4-chart-parameters`. Acceptance gate
(`npm test -- --run test/integration/chart_uniforms`) green; 399 passed
/ 1 skipped; typecheck + lint + build clean. Real-GPU proof: gpu:check
gpuDisagree = 95 unchanged (the promoted decode is behaviour-identical
to the M3 stopgap) + m5/m7/g17/depth-stress checks pass.

### DG4.1 — doc's WGSL struct contradicted its own slot map (vec3 alignment)
The doc's ChartUniforms WGSL struct declared `m_target: vec3<f32>` while
its slot map placed m1/m2/m3_target at offsets 40/44/48. A vec3<f32>
aligns to 16 and would land at offset 48 — the shader would silently
read the wrong lanes (exactly the failure class the GPU skill's
cardinal rule exists for). As built: three scalar fields
m1_target/m2_target/m3_target; the packer/pin test/struct_dump all
agree, and a test pins the scalar lanes explicitly.

### DG4.2 — decode_full still needs r_coll, which is NOT a chart knob
The doc's new signature `decode_full(z, ch)` dropped the SimUniforms
argument entirely, but the decode's no-holes guard compares
dmin < r_coll — an EVENT threshold that stays in SimUniforms. As built:
`decode_full(z, ch, r_coll)`, with simulate passing uniforms.r_coll.
Folding r_coll into ChartUniforms instead would have let a chart
silently diverge from the integrator's collision radius.

### DG4.3 — chartUniforms is required, and M11's factories implement it too
The doc's integration test called `chart.chartUniforms!(…)` — implying
an optional member. Made REQUIRED: an optional member silently yields
undefined knobs at dispatch (mu_max = 0 collapses the decoder — the
doc's own "silent zeros" warning). Implementors beyond the doc's list:
the mixed-axis factory and M11's Burrau factories (acute_angle,
mass_chart, both bifurcation strips — the doc only covered the M10
six); lz_k inherits lz_e's via its object spread. A registry-wide test
asserts every chart supplies non-zero knobs.

### DG4.4 — frame capture bumped to v2; dev call site had a silent arg shift
Dispatch is now a pure function of (SimUniforms, TileRequest,
ChartUniforms), so G17's CapturedFrame gained a required `chart` field
and FRAME_CAPTURE_VERSION went 1→2 (v1 captures are rejected loudly —
replaying one without chart knobs would silently decode differently).
dev/debug_harness.ts's `captureFrame(N, M, uniforms, tile, 'dev
capture')` now put the LABEL STRING in the chart parameter — dev/ is
outside tsc, so nothing flagged it; caught by re-running the g17 page
check and fixed.

### DG4.5 — SimUniforms slim: one artifact = four WGSL copies + packer + pins
Dropping m/M_total/mu_max/alpha_min/q_max (96→64 B) touches every
repeated copy of the struct: simulate.wgsl, reduce.wgsl,
render_graph.wgsl, render_layer0.wgsl, packSimUniforms, the structs
round-trip test, struct_dump's offset table (+ its new
chartUniformsLayout), the TileBuffers uniform buffer size, and every
SimUniforms literal (4 dev pages, gpu_check.html, 3 test files) — in
one commit, per the cardinal rule. gpu:check's unchanged disagreement
count is the behavioural regression proof.

## G3 — Bind-group layout authority

Branch `feat/g3-bind-group-layouts`. Acceptance gate
(`npm test -- --run test/integration/layout_compat`) green (self-skips
without WebGPU per project GPU-test policy); 385 passed / 1 skipped;
typecheck + lint + build clean. Real-GPU proof: gpu:check (gpuDisagree
95 = D3.2 calibration) + m5/m7/g17/depth-stress checks all pass —
dev/render_graph.ts alone drives the shared bind-group set through the
M3 compute, layer-0 render, and M7 render-graph pipelines in one page.

### DG3.1 — doc's ChartUniforms slot collides with landed G17 DebugUniform
The doc put ChartUniforms at group(0) binding(2). render_layer0.wgsl
has statically read `dbg` at g0b2 since G17 (D17.1). As built: frame =
SimUniforms(0), TileRequest(1), DebugUniform(2, G17), ChartUniforms(3)
— the G4 slot reserved NOW with a 64-byte zero-filled `bufs.chart`
placeholder (the D17.1 pattern), honouring the doc's own "the layout
doesn't need to change when G4 lands" intent. G4's doc retargeted
binding(2)→binding(3) and `chartUniforms`→the existing `bufs.chart`.

### DG3.2 — doc's storage-access claim was false; shaders flipped to read_write
The doc claimed a render shader can declare `var<storage, read>`
against a 'storage'-type layout entry ("Validation passes"). WebGPU
requires the shader's access mode to MATCH the layout's buffer type —
M7's own landed render_layer0.wgsl comment states the rule; the doc
contradicted it. Since cross-pipeline sharing needs ONE perTile layout,
it is 'storage' (read-write) and reduce.wgsl + render_graph.wgsl
flipped their group(1) declarations to `read_write` (render_layer0 was
already correct). A unit test now sweeps every .wgsl file: any
group(1) storage declaration must say read_write.

### DG3.3 — layout AND bind-group identity via memoisation, no signature churn
Bind-group compatibility is identity-based; if buildPipelines and
buildReducePipeline each called a fresh buildLayouts they would get
different objects and sharing would silently break. As built:
buildLayouts memoised per GPUDevice (WeakMap) and createTileBindGroups
memoised per TileBuffers — all three builders keep their (ctx, bufs,
code) signatures and return the SAME canonical bind-group objects
(asserted by identity in layout_compat). The doc's
src/gpu/pipelines/{simulate,reduce,render,inspector_preview}.ts split
was not adopted — landed modules refactored in place; the only renamed
field is RenderGraph.bgEmpty → bgReduction (M7's empty-group(2) hack
replaced by binding the real canonical reduction group, whose buffer
moved to its one home, bufs.reduction).

### DG3.4 — doc's unit test used the GPUShaderStage browser global
`GPUShaderStage` does not exist in Node; referencing it at module scope
in layouts.ts (or in the unit test) would crash every Node import of
the gpu barrel. As built: layouts.ts defines `STAGE = {VERTEX: 0x1,
FRAGMENT: 0x2, COMPUTE: 0x4}` (spec values, pinned by a test) and the
descriptors use it.

### DG3.5 — doc's integration test never dispatched; vacuous like D12.1
setBindGroup alone validates nothing — bind-group/pipeline
compatibility is checked at dispatch/draw. The doc's test set one group
on a dummy pipeline, submitted without dispatching, and asserted
`true`. As built: the real pipelines (wgslLink-linked shaders) over one
TileBuffers, builder-identity assertions, then real dispatches of
simulate + reduce and a real draw of the render graph (all four groups,
real target texture) inside pushErrorScope('validation'), asserting
popErrorScope() === null. inspector_preview pipeline doesn't exist (M9
is CPU-f64) — kept only as a reserved pipeline-layout alias.

## G1 — Shader composition / WGSL linker

Branch `feat/g1-shader-composition`. Acceptance gate
(`npm test -- --run test/integration/shader_compose`) green; 4 unit +
1 integration suites, 36 tests; full suite 374 passed / 1 skipped;
typecheck + lint + build clean. Real-GPU proof: `npm run gpu:check`
plus the m5/m6/m7/g17/depth-stress Playwright checks all pass with
wgslLink-linked modules. First G-series milestone after G17; entries
are numbered DG1.x because M1 already owns D1.x.

### DG1.1 — simulate's `shape_sphere` comes from observe.wgsl, not metrics.wgsl
The doc's Goal and its simulate.wgsl example imported `shape_sphere`
from metrics.wgsl. The real M3 shader takes it from **observe.wgsl**;
metrics.wgsl's copy is a deliberate standalone duplicate (with an
`I == 0` guard variant) consumed only by the M6 WGSL check. As built:
directives follow the measured symbol graph; metrics.wgsl gained
`@import { PI }` so it links as its own entry, and its header now
states the duplication is intentional. Doc corrected.

### DG1.2 — entry-owned structs; validation is declared-imports-only
The doc's Goal promised the linker "validates that every referenced
symbol is either defined locally or imported" — full symbol-use
analysis. That is neither what its own listings do nor what the shader
set permits: `integrate.wgsl` takes `knobs: SimUniforms`, and
SimUniforms lives in simulate.wgsl (the entry that imports integrate) —
importing it back would be a cycle. As built and now documented: the
shared structs are **entry-owned** and referenced by imported units
without directives (WGSL module-scope forward references make the
concatenated module legal), and `validateImports` checks declared
imports only — target exists, symbol exported, graph acyclic.

### DG1.3 — parser keeps a pending `@export` across comments; doc test contradicted its own parser
The doc's parser listing explicitly lets comments and blank lines sit
between `@export` and the declaration (only non-comment code resets
`pendingExport`), but its test "ignores @export when followed by a
non-decl line" used `// stray comment` — which that parser does NOT
ignore. Kept the comments-allowed behaviour (doc comments between
`@export` and a fn are desirable) and fixed the test to use a genuine
non-declaration (`var<private>`), plus a positive test pinning the
comments-allowed case.

### DG1.4 — integration-test WebGPU guard had a precedence bug
`if (!('gpu' in (globalThis as any).navigator ?? {}))` parses as
`!(('gpu' in navigator) ?? {})` — the `in` throws before `??` can
default when navigator is undefined (Node). As built:
`const nav = globalThis.navigator; if (!nav?.gpu) return;` (and skip
when requestAdapter returns null). Doc listing corrected with a note.

### DG1.5 — `?raw` glue centralised in dev/; src/ and test/ stay tsc-clean
The doc's migration example put `?raw` imports in M3's
`dispatch_layer0.ts` (under src/). No `*.wgsl?raw` module declaration
exists and tsconfig compiles `src/**` + `test/**`, so that would break
`npm run build`. As built: one glue module `dev/shader_modules.ts`
(dev/ is outside tsconfig) exports SIMULATE_MODULE /
RENDER_GRAPH_MODULE / RENDER_LAYER0_MODULE / REDUCE_MODULE; all four
dev pages import them, gpu_check.html links over fetched sources, and
the two GPU-gated tests (layer0_gpu_vs_cpu, debug_harness) read units
with node:fs — the M3 stub `concatShaders()` and the M7 hand-ordered
RENDER_MODULE concat are gone.

### DG1.6 — equivalence asserted as unit-set + verbatim bodies, not byte-equality
The linked module cannot be byte-identical to the old hand concat: the
topo sort orders dependencies before dependents (helpers, decode,
integrate, events, observe, simulate vs M3's helpers, observe, events,
integrate, decode, simulate). WGSL allows module-scope forward
references, so concatenation order is semantically irrelevant — the
real-shader tests therefore pin the unit SET, entry-last, and each
unit's directive-stripped source verbatim in the output; the real-GPU
checks (gpu:check exit 0 with the same measured gpuDisagree = 95 as
D3.2's calibration; m7 render check ALL PASS) close the loop.

### DG1.7 — listing hygiene
Namespace imports (`* as h`) are documentation-only — WGSL has no
namespaces, so `h.sigmoid(x)` can never compile; parsed and validated
like a side-effect import, noted in the doc. link.ts's separate
reachability pass was redundant (visit(entry) only touches reachable
units) — merged into the topo walk, with a missing-entry check up
front; its private `formatLinkErrors` duplicate now reuses
format_error.ts's `formatErrors`; `stripDirectives` is exported for the
equivalence tests. `resolveImport` throws on nested paths — the
validator catches it per-import and reports a LinkError with file/line
context instead of an uncontextualised throw (the doc's listing would
have thrown out of `validateImports` entirely on the first `../`).
The `principia-gpu` skill's shader-composition section was rewritten
from the pre-implementation sketch to the landed conventions
(entry-owned structs, one-directory rule, two helper roots,
metrics/observe duplication, declared-imports-only scope).

## M12 — Export, data API, acceptance harness

Branch `feat/m12-export`. Acceptance gate
(`npm test -- --run test/integration/acceptance`) green — all six
architectural checks pass; 6 unit + 8 integration suites, 35 tests;
full suite 338 passed / 1 skipped; typecheck + lint + build clean.
Deliverable: serialisable ViewState + URL round-trip + static/sweep/
live export orchestration + PNG/JSON/binary/CSV/NPZ contracts +
SHA-256 sidecars + the A1–A6 acceptance registry. This closes the
M-series.

### D12.1 — two acceptance checks in the doc were vacuous; made real
The doc's A2 unconditionally returned `passed: true` ("stub verifies
the threshold logic" — it verified nothing), and A4 compared byte
LENGTHS of two packRenderParams buffers (always 64 = always passes).
As built: A2 drives M5's real `compositeCoherence`/`decideSplit` — a
uniform-basin reduction keeps at ℓ and all four synthetic children keep
at ℓ+1 (τ(ℓ) loosens with depth), plus a must-split impure contrast
case so the thresholds are proven live; A4 asserts a colour-mode swap
perturbs ONLY bytes 0..3 of RenderParams (M7 rebind contract) and that
the serialised compute cache key is untouched (render params are not
inputs to `viewStateToCacheKey` — a mode change can never invalidate a
tile). A1's `Math.random` became a deterministic LCG — a flaky
acceptance gate is worse than none.

### D12.2 — binary header hash field: SHA-256 is 32 bytes, not 40
The doc's header reserved bytes [24..63] for "the high 40 bytes of a
SHA-256 digest" — no such thing exists (the digest is 32 bytes; the
doc's own hash-literal test padded with zeros silently). As built:
[24..55] holds the full 32-byte digest, [56..63] reserved; the test
round-trips the exact bytes and pins the "PCNP" magic in file order.

### D12.3 — JSON export reuses the ONE SimResult decoder
The doc's `decodeSimResultsToJson` hand-rolled the lane offsets — a
second copy of the SimResult layout that had ALREADY drifted (it
dropped `free_group_word` and all the drift/invariant lanes).
`decodeSimResults(ab, count, M)` was extracted from M3's
`decodeBuffer` (additive; `decodeBuffer` delegates with count = N²)
and json.ts wraps it — same single-source rule as
TILE_REDUCTION_FIELDS.

### D12.4 — live-export `state` was captured by value
The doc returned `{ state, step, reset }` where `state` is a local —
the property froze at 'paused' forever while step()/reset() mutated an
invisible variable. As built: a getter (`get state()`), with the
interface field declared readonly.

### D12.5 — listing/test hygiene
Timeline test's mid-frame expectation used t = 6/9 for frame 5 of a
0..9 bracket (it's 5/9); its second track targeted `render_mode`, which
is not a ViewState field (render params are deliberately separate) —
retargeted to `zoom`, which also exercises the single-keyframe snap.
A5's descriptor literals were missing the `wordUncertain` field
(ADR-0004 bit 9; type error). `details: undefined` returns violate
exactOptionalPropertyTypes → conditional spreads. `registerAcceptance`
now throws on duplicate ids.

## M11 — Burrau family progression

Branch `feat/m11-burrau`. Acceptance gate
(`npm test -- --run test/golden/burrau_family_345
test/golden/burrau_persistence_probe`) green; 4 unit + 2 golden suites,
22 tests, all green first run; full suite 303 passed / 1 skipped;
typecheck + lint + build clean. Deliverable is internal (tests only).

### D11.1 — M1's Burrau golden was the LEGS-SWAPPED variant, not the canonical IC
Reconciling M11 against the spec's canonical Burrau positions
(eq. `burrau_positions`: each mass opposite its own side, so mass 4/12
on the 0.6 leg and mass 3/12 on the 0.8 leg — matching Szebehely &
Peters' published coordinates) revealed that M1's ratified golden
fixture has the legs swapped (mass 4/12 at (0.8, 0)). Empirical
consequences, measured this session:
- The CANONICAL IC's f64 truth at project thresholds is a sub-`r_coll`
  encounter at t = 4.9047 — the adaptive inspector classifies it
  `collision` IDENTICALLY across epsRel 1e-9..1e-11 and hMax 1e-2/2e-3
  (ΔE_max down to 4.6e-9). Converged and tolerance-robust.
- The non-regularized symplectic path steps over that minimum and blows
  up: outcome ESCAPE(body 1) with energy drift ~4e+4 — numerically
  meaningless. The famous t ≈ 60 escape of the lightest body needs G19
  regularization.
- The swapped variant's encounter history is milder, which is the only
  reason M1's symplectic run completes with a stable outcome (lightest
  ejected, drift ~2e-2) — the ratified physical fact held by luck of
  genericity, not because the fixture was the classical problem.
Resolution: the user-ratified M1 golden is KEPT byte-for-byte in its
assertions but relabelled honestly ("legs-swapped variant — integrator
physical regression"); the M9 near-collision and M6 FTLE fixtures that
reuse the geometry got comment fixes (their assertions are
outcome-robust). The NEW M11 golden pins the canonical truth via the
adaptive inspector: collision, tEnd ∈ (4.89, 4.92), dMin < 1e-4,
ΔE_max < 1e-7 — generated once by the tolerance sweep, then pinned.

### D11.2 — descriptor copies again → D10.1 exports
The doc (predating D10.1) carried three MORE divergent
makeDescriptor/zeroDescriptor copies — one explicitly leaving V0/virial
zero "to avoid importing a potential helper". All charts now use
`makeDescriptor` from `@/decode/pipeline.js`; canonicalise-terminal
paths emit a real descriptor from the state, same as M2/M10.

### D11.3 — exact-K momentum seeds need the reduced-mass factor
The doc's radial seed `p_ρ = [√(2K), 0]` yields kinetic energy K/μ_ρ,
not K (Jacobi K = |p_ρ|²/(2μ_ρ)) — silently mislabelling the K axis by
~5.4× at Burrau masses. As built: |p_ρ| = √(2 K μ_ρ), and unit tests pin
the decoded state's K to the requested value at 1e-12 (same exactness
discipline as M10's D10.4 test).

### D11.4 — ν → triangle single-sourced
M10's `burrau_euclid` chart inlined the same ν → (r, m) construction the
new `src/burrau/euclid.ts` provides. The chart now imports
`burrauTriangle` — one home for the canonical map (the import direction
chart_atlas → burrau/euclid.ts is acyclic; euclid.ts touches only math
types).

### D11.5 — mass_chart validate aligned with D10.5
The doc's Burrau mass chart repeated the `u + v ≥ 1 − ε` saturation
criterion that D10.5 already established is wrong for the bilinear
simplex map; it now flags raw-component < ε_m, matching M10's
mass_simplex.

### D11.6 — Stage 2b made honest: `burrauLzEParams`
The doc wired Stage 2b as the bare `lzEChart`, whose (α, β) DEFAULT to
π/4, π/2 — not the (3,4,5) shape the stage description promises. Added
`burrauLzEParams(ν)` (hyperspherical (α, β) of the ν-triangle plus its
natural masses, for `ChartView.chartParams`/`view.m`), with a handoff
test pinning the 3 : 4 : 5 side ratios through the lz_e decode at the
R̃ = 1 gauge.

### D11.7 — exit-command hygiene
`test/golden/burrau_family` matched only the 345 file, not the
persistence probe the acceptance text demands ("two goldens green") —
both files are now listed explicitly in Goal/Run-it/acceptance.

## M10 — Chart instantiations

Branch `feat/m10-charts`. Acceptance gate
(`npm test -- --run test/integration/chart_totality`) green; 7 unit +
2 integration suites, 24 tests, all green first run; full suite 281
passed / 1 skipped; typecheck + lint + build clean. Deliverable is
internal (tests only). The `principia-charts` skill was authored
just-in-time and carries the contract/flag/momentum conventions.

### D10.1 — one `makeDescriptor`, exported from M2, not three copies
The doc inlined `makeDescriptor`/terminal-descriptor helpers into lz_e,
shape_sphere, mass_simplex and burrau_euclid — and they had already
drifted (`qMass: Math.min(...m)` vs the canonical `m_min / M_total`;
zero-stub descriptors on canonicalise-terminal where M2 emits a real
descriptor from the state). As built: M2's private `makeDescriptor` and
`makeTerminal` are exported from `src/decode/pipeline.ts` (additive
change, bodies untouched) and every chart imports them. Same
one-artifact discipline as GPU struct layout.

### D10.2 — momentum construction deduplicated; rotational-seed footgun
The doc shipped the (L_z, K) momentum construction TWICE — a standalone
`momentum_construction.ts` returning `{v, usedSeed, degenerate}` and a
divergent inline copy in lz_e.ts returning a kind-tagged union — with
different seed lists. Kept ONE implementation
(`constructMomentaForLzK`, kind-tagged so ADR-0007 reasons 15/16 fall
out of the type). Two physics fixes while merging: (a) the inline
version's all-body rotational seed `[J(r0), J(r1), J(r2)]` is the
pure-rotation field, which the L_z projection annihilates to zero every
time — replaced with the standalone's partial-rotation seeds; (b) the
mix amplitude is clamped, `a = √(max(0, 2(K*−K_min)))`, because the
infeasibility gate admits K* up to 1e-15 BELOW K_min and a bare sqrt
returns NaN there.

### D10.3 — doc mutated readonly ConfigCanonical; frozen-config helper
The doc's lz_e built its frozen configuration by calling
`decodeConfigCanonical(0, 0, ...)` and assigning into the returned
`rhoTilde`/`lambdaTilde` — readonly `Vec2` tuples; it does not
typecheck. As built, a shared `frozen_configuration.ts` constructs
ρ̃ = [cos α, 0], λ̃ = [sin α cos β, sin α sin β] directly at the R̃ = 1
gauge (where I = 1, which the momentum construction relies on), used by
lz_e/lz_k, shape_sphere, and mass_simplex — one copy instead of three
inline repetitions.

### D10.4 — lz_e and lz_k honestly share one decode
The doc's lz_k wrapped lz_e with a "fakeView" that copied the view
unchanged — a no-op pretending to substitute the axis semantics. In
fact the doc's lz_e already parametrises by K* = Kmax·v^γ, which IS the
(L_z, K) map; with frozen geometry E = U(r) + K*, so the (L_z, E) chart
relative to U is numerically identical. As built: one exported
`decodeLzChart`, lz_k spreads lzEChart with its own id and
inverse-encode reason, and a unit test pins the state-identity. A new
invariant test also pins that the decoded state carries the requested
(L_z, K) exactly (to 1e-12) — the construction is closed-form, not
approximate.

### D10.5 — mass-simplex validate criterion didn't match the map
The doc flagged `u + v ≥ 1 − ε` as "beyond simplex interior buffer".
But `massFromSimplex` is the bilinear map m₁ = u, m₂ = (1−u)v,
m₀ = (1−u)(1−v) — total on [0,1]², and u+v ≥ 1 covers half the square
including comfortably interior masses like (0.16, 0.6, 0.24). As built,
validate flags `min(raw components) < ε_m` — the pixels where
`decodeMassSimplex`'s interior buffer actually engages. `inverseEncode`
was also upgraded from the doc's approximation to the exact inverse
(unbuffer, then u = m₁, v = m₂/(1−m₁)), pinned by a round-trip test at
1e-10. The corner test now sweeps all four corners per the exit text.

### D10.6 — totality test's mixed_axis catch was dead code; test strengthened
The doc's chart_totality test caught throws from `mixed_axis` — but the
mixed-axis FACTORY is exported, never registered, so no registered chart
can reach that catch. Removed the try/catch entirely (registered charts
must never throw) and strengthened the sweep: finiteness asserted on all
decoded r/p, all 1000 pixels accounted for, ≥ 6 charts registered, and
every chart must have a live (non-terminal) interior.

### D10.7 — tree/exit-command hygiene
The doc's file tree listed `compatibility.ts` (no listing anywhere;
`compatible()` lives in validation.ts) and
`gpu/shaders/chart_dispatch.wgsl` (no listing; the doc's own notes say
M10 ships no chart WGSL — the `wgsl` field is a reserved hook) — both
dropped. `lz_k.test.ts` was in the tree with no listing — authored
(id/flags + shared-decode identity). The exit command
`test/integration/charts` matched no file (the files are
`chart_totality`/`chart_lock_handoff`) — fixed in Goal and Run-it.

## M9 — Locked-pixel inspector (CPU f64)

Branch `feat/m9-inspector`. Acceptance gate
(`npm test -- --run test/golden/inspector`) green; 5 unit + 3 golden
tests; full suite 257 passed / 1 skipped; typecheck + lint clean.
Deliverable is internal (tests only). The `principia-inspector` skill was
authored just-in-time and carries the calibration + integrator-family
rules below.

### D9.1 — doc's h_min abort was unreachable (infinite-loop hazard)
The doc's `run.ts` checked `h <= hMin && r.rejected` AFTER
`if (!r.accepted) continue;` — dead code, and a step persistently
rejected at hMin would retry forever. As built, the abort lives in the
reject branch (`SIM_FAILED('h_min reached')`, outcome `failed`); the
shadow loop got the same guard. Also: the adaptive loop clamps the final
step to the horizon so bounded runs end at exactly T_horizon.

### D9.2 — doc's "smooth bounded" fixture was the free-fall collapse IC
Both match-integrator tests used an equal-mass equilateral REST start,
calling it a "figure-8 stand-in". That configuration is the classic
homothetic free-fall collapse (Lagrange central configuration at zero
velocity): it collapses, scatters, and ejects a body — outcome `escape`,
not `bounded`. Replaced with the genuine M1 figure-8 fixture
(figure8_reference.json), the same D6.1 lesson. Horizon-overshoot
semantics also pinned: fixed-step `run()` ends within one macro step
past T; the clamped adaptive side ends exactly at T.

### D9.3 — Kepler 1e-12 drift gate needed calibration, and the knob is hMax
At the doc's default tolerances the T=1000 Kepler drift is ~6.9e-12 —
and unchanged under tighter epsRel, because the step controller rides
hMax on a smooth orbit (the tolerance never binds). Truncation-dominated:
hMax=2e-3 passes 1e-12 (verified; roundoff floor not yet reached). The
golden pins the calibrated knobs explicitly. Same family as M1's Burrau
gate (D-M1) and D7.4: never pin uncalibrated precision.

### D9.4 — near-collision chase: 'collision' is success, not failure
With hMin=1e-12 the RK45 chase resolves the Burrau encounter below
r_coll=1e-4 and classifies COLLISION — precisely the "chases where the
GPU declared MAX_SUBSTEPS" behaviour the milestone celebrates; the doc's
accept-list just omitted it. Test accepts
{escape, bounded, collision} and rejects timeout/failed.

### D9.5 — strict-TS reconciliation in doc listings
TrajState is fully readonly → stepped states are constructed with their
new `t` (`s5.t = …` doesn't typecheck; `addScaled` takes `tNew`).
Unused: DOPRI5 c-nodes C2..C5 (autonomous RHS — kept as a comment),
`TerminalLabel` import in types.ts, `HoverStreamline.lastMoveAt`,
`RK45Opts` import in match_integrator. Overlay optional fields
(`chartUv`, `validationPanel`) use conditional spreads
(exactOptionalPropertyTypes); its tuple-array type needed
`(readonly [number, number])[]`.

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
