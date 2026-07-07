# Build decisions ledger

A running log of decisions made while building the milestones autonomously —
anything where the code, the milestone doc, or a default had to be chosen or
corrected. Each entry: what was decided, why, and what it touched. Newest first.

The intent (per the build authorisation) is that every non-obvious choice is
flagged here so it can be reviewed rather than buried in a diff.

---

## R — Live quadtree depth refinement + DS.1 AT_F32_FLOOR wiring

Branch `feat/live-depth-refinement`. Closes deferred DS.1 (only the
depth-stress harness ever set AT_F32_FLOOR) and the long-term resolution
fix flagged in F.2: the live loop now allocates compute where the dynamics
are complex, which is the project's founding mandate.

### DR.1 — ingestReduction grew an optional RefineOpts (DS.1)
M5's `ingestReduction` left every tile at plain 'ready' — planFrame's
whole split path was dead in the live loop. It now (a) stamps
`AT_F32_FLOOR` CPU-side via `reachedF32Floor(z, samplesPerAxis)` (the GPU
kernel has no depth context — same rule the harness used), and (b)
promotes to 'readyRefinable' iff not at the floor and z < maxDepth. The
new `RefineOpts` arg is OPTIONAL: harness/older callers keep the exact M5
terminal state. JobLedger threads `{samplesPerAxis, maxDepth}` from the
dispatching ViewState. Two gpu_jobs pins updated to the new terminal
state deliberately.

### DR.2 — planFrame recurses through ready children (REFINE_LEVELS_MAX=2)
The old planFrame only evaluated the visible frontier, so refinement
could never pass one level. It now walks refinement chains: a refinable
tile that decideSplit approves evaluates its children — computed children
recurse, missing ones become candidates (with `parent` provenance). The
descent is capped at REFINE_LEVELS_MAX=2 below zBase: each level
quadruples worst-case tile count, and two levels already give 4× sample
density at fixed zoom (16 px/sample at the default tier). decideSplit's
floor/maxDepth/coherence guards are unchanged — they now simply bind.

### DR.3 — refined children draw ON TOP of their parent (progressive)
tickOnce's render plan appends ready descendants after the parent entry
(entries render in order), so each child pops in as it completes and a
partially-computed split shows no seams — the parent still covers the
gaps. All-or-nothing swapping was rejected: it holds finished children
hostage to the slowest sibling. New `FrameStats.refined` counts overlay
draws. TileCache default capacity 256→512 (a working set of
1+4+16 per visible tile above 256 would evict-thrash and recompute
forever); matches the dispatcher's RETAINED_TILE_CAP.

### DR.4 — every Playwright spec pins ?maxdepth=2; goldens stay unrefined
Refinement multiplies tile count ~×3–20 and SwiftShader pays seconds per
tile, so shell.spec and perf_capture.spec pin `&maxdepth=2` (= their boot
frontier depth ⇒ refinement off): the smoke keeps its historical ~16-tile
workload and the perf baseline stays comparable. visual_regression pins
it too — for a harder reason (DR.5) — so the committed goldens are the
UNREFINED frame, byte-identical to the pre-refinement set (restored from
webgpu-rewrite, not regenerated). bootConverged additionally waits for
full quiescence (jobsDispatched===0 AND jobsCompleted===0 AND
inflight===0), which is the correct wait either way. Refinement's live
verification is 12 unit tests + dev/out/refine_probe.mjs (headed A/B:
refined stat >0, refined frame differs from unrefined).

### DR.5 — refined frames are deterministic only up to reduce-order noise
First attempt regenerated goldens WITH refinement at quiescence; a second
boot then failed 4/7 with 14–21% diffs confined to corner-tile blocks.
Diagnosis: the final refinement SET is a fixed point of decideSplit over
per-tile coherence scores, and tiles near τ flip across boots because the
reduce pass's parallel float accumulation is not order-stable at the ulp
level on real hardware. The frame content per computed tile IS bit-stable
(proven by DF.6); only borderline split/keep decisions wander. So refined
frames cannot be goldens; if flicker-on-recompute ever matters in the
product, the fix is hysteresis around τ in decideSplit (deferred).
PROCESS GOTCHA (second occurrence, see G12's lint one): piping playwright
through `| tail` masks its exit code — the failing runs looked green in
the chained command. Verification runs now keep the full log and check
the summary line, not the pipe's exit.

## F — Fix: GPU chart decode ignored the view (latent slicing / charts dead)

Branch `fix/gpu-chart-decode`. User bug: "the latent slicing and charts
don't work" / "even upon zoom / pan the latent slicing or chart changes
don't update". Root cause: simulate.wgsl's non-linearised decode path
hard-coded the M3 bring-up mapping (`z[0]=(2u−1)·3, z[1]=(2v−1)·3, rest 0`)
and ignored the view's z0/q1/q2/mag AND chart identity entirely — every
recompute of every chart produced the same default slice. The CPU side
(store, cache keys, frame loop, retained-buffer keys) was verified correct.

### DF.1 — two decode inputs, both chart-agnostic (no chart branch in WGSL)
The architecture skill forbids the shader knowing which chart produced its
samples. Landed accordingly: (a) **SliceUniforms** (g0b6, 112B, 7 vec4
lanes: z0, q1, q2, mag) carries the affine `z = z0 + mag((2u−1)q1 +
(2v−1)q2)` map — pure uniform DATA, the exact CPU formula in
latent_slice.ts; (b) **UploadedIC[]** (g0b7, read-only storage, 64B/sample:
m+terminal, r, p) carries CPU-decoded per-sample ICs for charts that are
not affine in latent space (lz_e, lz_k, shape_sphere, mass_simplex,
burrau_euclid), selected by a new `TILE_REQ_DECODE_UPLOADED` flag (bit 1) —
the shader reads (m, r, p), the skill's literal contract. Charts declare
which path via a new optional `Chart.affineSlice(view)` (latent_slice and
mixed_axis latent×latent return a slice; the rest return null). Precedence
in the shader: DECODE_LINEAR (G6, unchanged) → DECODE_UPLOADED → slice.

### DF.2 — default-slice seeding keeps M3 harnesses and goldens bit-exact
`createTileBuffers` seeds the slice buffer with DEFAULT_SLICE (z0=0, q1=e0,
q2=e1, mag=3), which reproduces the old hard-coded mapping exactly (×1.0
and +0.0 are exact in f32), and `defaultViewState()` carries the same
slice — so every harness/test that never writes the buffer, and the
default view itself, are pixel-identical. Evidence: gpu:check reproduces
the D3.2 calibration numbers exactly (gpuDisagree 95, histDelta unchanged);
visual goldens unchanged.

### DF.3 — uploaded ICs are CPU-decoded at the shader's own sample points
`buildUploadedICs` iterates idx = z·N²+gy·N+gx with t=(g+0.5)/N+jitter/N
and uv = centre + half·(2t−1), reusing the same jitterOffsets table packed
into EnsembleOffsets, so the CPU decodes exactly the points the GPU would
have sampled (G7 ensembles included). Terminal decodes upload
terminal=1/2 (degenerate / collision_t0) and the shader's existing
write_terminal path classifies them — decode totality preserved on the
GPU. Cost: one N²·E chart decode per non-affine tile job (the price of
correctness; these charts previously rendered garbage).

### DF.4 — three-place discipline + pins
WGSL structs (simulate.wgsl) + packers (slice_uniforms.ts /
uploaded_ics.ts) + pin tests (field order vs struct_dump layouts, flag-bit
twins, DEFAULT_SLICE ≡ M3 mapping, sample-order maths) landed in one
commit. Frame layout grew b6 (uniform) + b7 (read-only-storage), both
compute-only; layouts.test.ts pins updated. New GPU-guarded integration
test chart_decode_gpu.test.ts A/Bs slice-change-must-move-pixels and
GPU-vs-CPU E_0 agreement for both paths.

### DF.6 — goldens are bit-exact under the fix; one transient failure chased
The FIRST full headed run on Metal failed event_class / ang_momentum /
escape_time (diffRatio up to 0.79, flat-background pixels shifted).
Chased properly: (1) baseline webgpu-rewrite passed all 7 → suspect the
fix; (2) BUT regenerating goldens on the fix branch produced PNGs
byte-identical to the committed ones (pngjs is deterministic, so
byte-identical = pixel-identical frames), and two consecutive verify runs
plus a full-suite re-run pass all 7 against the ORIGINAL goldens. So the
fix's default-view frames are bit-exact with the old shader, as the
DEFAULT_SLICE pin predicts, and the first run's failures were a transient
screenshot/compositor condition (it ran immediately after the SwiftShader
suite), not a compute change. Goldens unchanged in this PR.

### DF.5 — known gaps flagged, not fixed here
(a) `chartParams` (Kmax/gammaK/alpha/beta/poleBuffer) are not part of
TileCacheKey or the retained-buffer key — a chartParams-only change would
serve stale tiles. No UI mutates chartParams today; follow-up when M11's
per-chart controls land. (b) FrameCaptureV2 doesn't record uploaded-IC
buffers; replay re-derives them from the captured ViewState (CPU decode is
pure, so replay stays deterministic).

## G19 — Close-encounter regularization

Branch `feat/g19-regularization`. 746 passed / 8 skipped (+13: golden 3 +
unit 10, first run); typecheck + unpiped lint clean; figure-8 and both
existing Burrau goldens untouched (run.ts not modified). CPU-only.

### DG19.1 — LogH algorithmic regularization, not explicit KS/Levi-Civita
The sketch proposed LC pair coordinates (u²=r, ds=dt/r) with dominant-pair
selection and enter/exit hysteresis. Landed: Mikkola–Tanikawa /
Preto–Tremaine time-transformed leapfrog over the FULL system (drift
dt=δs/(T+B), kick dt=δs/W, B=−E constant) — same fictitious-time idea but
exact on the Kepler limit, no pair switching, and the symmetric 2nd-order
base map composes with the landed Yoshida weights to orders 4/6.
Evidence: drift 1.1e-11 through all Burrau encounters (gate 1e-7),
encounter depth r≈8.3e-5 crossed at O(1) steps.

### DG19.2 — separate runRegularized() entry, not a run.ts mode flag
Fictitious-time stepping doesn't fit RunParams (dtMacro/substeps are
physical-time concepts). runRegularized mirrors run()'s result contract
(RunResult/Diagnostics/TerminalLabel/trace) so consumers interchange;
figure-8 passes untouched BY CONSTRUCTION.

### DG19.3 — the "famous t≈60 escape" is Szebehely–Peters units
Project normalisation (unit hypotenuse, Σm=1) gives t_proj ≈ 0.3098·t_SP.
SP's closest approach t_SP≈15.83 → t≈4.905 = exactly the landed inspector
collision truth; the escape DETECTION (REsc=10, persistence 8) fires at
t≈24.57. Cross-integrator validation: with rColl=1e-4 on, the regularized
run classifies COLLISION pair (0,1) at t=4.9047 — matching the pinned
DOPRI5 truth to 4 digits from an independent scheme.

### DG19.4 — measured gates: drift 1.1e-11, convergence 0.007
h=2.5e-4 order-6 reference; h→h/2 escape-time shift 0.007 (gate 0.1);
h-sweep 5e-4→6.25e-5 monotone within 0.009. h=2e-3 is genuinely too
coarse — it ejects the WRONG body (the r≈8e-5 encounter demands the
resolution), which is the sharpest possible demonstration of why the
unregularized path could never have this golden.

### DG19.5 — checkpoint pins use graded tolerances
The r≈8e-5 encounter amplifies float-level differences ~1e4× and the flow
is chaotic after it, so the 8 pinned checkpoints grade 1e-7 → 1e-2 with
time. The pins are regression tripwires; the accuracy claim is carried by
the drift + convergence gates, which are platform-robust.

## G16 — Documentation & onboarding

Branch `feat/g16-docs`. 733 passed / 8 skipped (+18: docs completeness 18
[gate ≥18], first run); typecheck + unpiped lint clean; gpu:check smoke
green (docs-only change otherwise); `npm run docs:api` generates with 0
errors. New dev dep: typedoc ^0.28. Milestone doc folded back as-built.

### DG16.1 — docs index covers all 32 milestones, not the doc's 29
G17/G18/G19 postdate the G16 draft. checkMilestoneCoverage reads
milestones/README.md at check time, so the index links all 32 and a new
milestone fails the gate until linked — the self-enforcing rule working
as designed, just against reality.

### DG16.2 — the doc's render-mode table was fiction
It listed Outcome/vMF/Diffusion/FTLE/Coherence as "render modes". Landed
(M7): 23 COLOUR modes × 5 BRIGHTNESS modes × 3 combiners × 9 palettes ×
5 CVD. No FTLE or coherence colour mode exists; diffusion is a brightness
mode. The user guide documents the real grouped surface.

### DG16.3 — keyboard table corrected to landed bindings
Zoom-in is `=` (the doc claimed `+`/`=` — DEFAULT_BINDINGS has no `+`);
Escape's overlay-dismiss-then-unlock fallthrough (G13 boolean
OverlayHooks) is stated; the G18 `~` dev-HUD toggle included.

### DG16.4 — Broucke–Hénon, not Brouke–Hénon
The draft misspelled the name (3×); the physicist is Roger Broucke. The
glossary term + manifest use the correct spelling.

### DG16.5 — the link gate also covers the pre-existing docs pages
The checker walks every .md under docs/ except api/ — so the ledger,
test-and-ci-strategy, integrity-pass, and all ADR pages are now
link-gated too (scanned clean before landing). docs/api is generated,
gitignored, and excluded from the walk.

## G15 — Build, bundling, deploy & hosting

Branch `feat/g15-build-deploy`. 715 passed / 8 skipped (+30: build_config
30 [gate ≥18]); typecheck + unpiped lint clean; gpu:check + all four page
checks green; headless test:gpu floor green; full PW_REAL_GPU=1 headed run
10/10; `npm run build:web` emits hashed entry + gpu chunk + stable sw.js +
.gz/.br pairs; `vite preview` probes 200; the BUILT production bundle
booted headed on Metal (research tier, frontier converged, zero console
errors) via dev/out/g15_site_check.mjs. Milestone doc folded back as-built.

### DG15.1 — the site build gets its own outDir (`dist-web/`)
The landed `build` script is `tsc -p tsconfig.json` and `npm run
gpu:check` + the dev/out page checks import its `dist/` output. The doc's
`vite build` → `dist/` would have let Vite's emptyOutDir clobber the tsc
output. `SITE_OUT_DIR = 'dist-web'` (pinned by a test), deploy uploads it,
`.gitignore` covers it. The site build uses the already-landed `build:web`
script — the doc's `npm run build` in deploy.yml would have run tsc and
published nothing.

### DG15.2 — deploy.yml triggers on webgpu-rewrite, never main
The doc's workflow had `on: push: branches: [main]`. `main` is the
untouchable historical PoC (CLAUDE.md branch policy) and must never drive
a deploy; the trigger is the integration branch.

### DG15.3 — SW precache is the shell only; raw-WGSL precache would brick it
The doc precached `src/gpu/shaders/*.wgsl` "so an offline device still
resolves WGSL" — but G1 inlines every shader into the gpu chunk via ?raw;
production dist has NO such files, and cache.addAll of a single 404
rejects the whole install. precacheList(base) = [base]. Offline shader
resolution comes free: the WGSL rides inside the hashed gpu chunk, which
the runtime cache-first strategy captures on first load.

### DG15.4 — shader manifest = all 16 on-disk modules, two-directional sync
The doc listed 9 modules; src/gpu/shaders/ holds 16. The manifest lists
all 16 and the validator asserts BOTH directions: every entry exists on
disk AND readdirSync of the shader dir equals the manifest — a new .wgsl
file that isn't manifested fails the suite.

### DG15.5 — compression is ~30 lines of node:zlib, not vite-plugin-compression
The doc's optional plugin targets Vite 2/3; this repo is on Vite 8. A
`principia:compress` closeBundle plugin in vite.config.ts walks dist-web
and emits .gz/.br per COMPRESSION_POLICY. Zero new dependencies, no
compatibility bet, same policy source of truth.

### DG15.6 — strict-TS/landed-boot listing fixes
(a) `src/main.ts` doesn't exist — SW registration lives in dev/main.ts
(the G8 boot; src/ must stay tsc-clean of ?raw). (b) see DG15.8 — the
env channel is define identifiers, not import.meta.env. (c) src/sw.ts is
typed structurally — `/// <reference lib="webworker" />` is program-wide
and collides with the DOM lib. (d) define injects the constants as BARE
identifiers with typeof guards — the doc's `(self as …).__APP_VERSION__`
property access defeats define. (e) sw.ts is a second rollup input
emitted as stable root `sw.js` (SW_FILE) — the doc's
`new URL('./sw.ts', import.meta.url)` registration doesn't compile a
service worker in Vite, and a hashed SW URL could never be found across
deploys. (f) treeshake moduleSideEffects 'no-external', not the doc's
`false` — that would have dropped `import '@/ui/styles.css'` and shipped
an unstyled shell.

### DG15.9 — .gitignore was silently eating build/ AND the CI lockfile
The first G15 commit landed 8 files instead of 12: M0's boilerplate
.gitignore had a generic `build/` rule (matched the new build-policy
source dir at any level, including test/unit/build/) and ignored
package-lock.json — yet every landed workflow (ci.yml, acceptance.yml,
now deploy.yml) uses `npm ci` + setup-node `cache: 'npm'`, BOTH of which
hard-fail without a committed lockfile; no CI job could ever have run
green on GitHub. Removed both rules, committed the lockfile (verified
`npm ci --dry-run` clean). `dist/` stays ignored; the comment now marks
build/ as source.

### DG15.8 — bare `import.meta.env` is NEVER populated in the bundle
Caught live, not by any test: the first env.ts read import.meta.env
through a structural cast (`(import.meta as … ).env ?? {}`) because src/
compiles without vite/client ambient types. Type-clean, unit-green — and
silently broken in production: Vite only statically replaces
`import.meta.env.KEY` property-access expressions; the bare form survives
the build verbatim and is undefined at runtime, so every field fell back
to dev defaults and the flag-on build never registered the SW. Verified
by grepping the emitted bundle. Fix: vite.config `define` injects
__APP_VERSION__/__APP_BASE__/__APP_SW_ENABLED__/__APP_PROD__ as bare
identifiers (the same channel sw.ts already used); rawEnv() reads them
behind typeof guards. SW then proven live end-to-end on the built bundle:
activated at /principia-ii/sw.js, correct scope, version-stamped cache,
shell precached. (Probe gotcha en route: an orphaned `vite preview` from
a killed check kept port 5199 and served a stale build's SPA fallback for
sw.js — text/html MIME. `--strictPort` + lsof before trusting a probe.)

### DG15.7 — known flake: perf gate's gpu:reduce_spreads vs 0.02ms baseline
Seen once during G15 verification (observed 0.236ms vs baseline 0.02ms,
just over checkPerf's 0.2ms noise floor); passed twice immediately after
and the next full run was 10/10. Not G15's doing (no GPU code touched).
Remedy if it recurs: raise noiseFloorMs for sub-ms passes or re-baseline
on a dedicated runner (G14's own tighten-later note).

## Fix — overlay noise + comically low resolution (user report)

Branch `fix/overlay-noise-and-resolution`. User: the "needed more substeps"
red box permanently over the canvas is annoying (fine in a debug GUI), and
the resolution is comically low. 685 unit tests, typecheck + unpiped lint,
gpu:check + all four page checks, headless test:gpu, and the full
PW_REAL_GPU=1 headed run (10/10) all green.

### F.1 — TileFailure no longer notifies the shell overlay
`ErrorBoundary.capture` now skips `onUserError` + listeners for
`AppErrorKind.TileFailure`. On fractal regions MAX_SUBSTEPS fires on most
tiles, so the G12 error overlay was pinned over the canvas permanently.
Tile failures remain per-tile diagnostics: still logged to telemetry at
Warn, still rendered by the G18 dev HUD's errors tab. All other kinds
(Unsupported, DeviceLost, Decode, Generic) surface exactly as before.

### F.2 — the real resolution ceiling was N_STAGING, not the tier table
`simUniformsOf` clamps `samples_per_axis` to the dispatcher's staging
capacity: `Math.min(view.samplesPerAxis, N_STAGING)`. With N_STAGING=32,
every view was silently capped at 32×32 per tile regardless of tier.
Raised N_STAGING to 64 (staging + readback ≈ 27 MiB shared, allocated
once; N=64 proven through simulate+reduce by the depth-stress harness)
and the research tier's `samplesPerTileAxis` 32 → 64. Verified live at
true defaults: tier research, N=64, visibly finer fractal detail. The
long-term fix for arbitrary zoom remains live quadtree depth refinement
(M5 scheduler wiring — deferred backlog).

### F.3 — goldens regenerated: old ones had the error overlay baked in
After the fix, all 7 visual goldens failed at the identical
diffRatio≈0.0250 in every colour mode. Root-caused before regenerating:
the diff masks are blank except one bottom-left rectangle — the error
overlay box. Playwright element screenshots capture overlapping DOM, so
the G14 goldens (captured while the overlay was pinned) had HTML chrome
contaminating the canvas comparison; the GPU pixels are unchanged (the
spec pins ?n=16, and simulate/reduce/render_graph all bound their loops
on `uniforms.samples_per_axis`, not staging capacity). Regenerated via
the documented PW_UPDATE_GOLDENS flow; perf baseline untouched (dispatch
shape at n=16 unchanged — gate passed as-is).

## G14 — Real-GPU e2e & regression CI

Branch `feat/g14-regression-ci`. 685 passed / 8 skipped (+23: image_diff
15 [gate ≥12], perf_gate 8); typecheck + unpiped lint clean; gpu:check +
all four page checks green; 7 goldens + perf baseline captured on Metal
and re-verified on fresh boots (visual 7/7, perf gate green); full
PW_REAL_GPU=1 headed run 10/10; headless SwiftShader floor 2 passed /
8 self-skipped. New dev deps: pngjs, @types/pngjs, @axe-core/playwright.
Milestone doc folded back as-built.

### DG14.1 — RENDER_MODES = all seven landed colour modes
The doc's manifest claimed to mirror G12's colour-mode panel but omitted
min_pair_dist (6 of 7). Landed with all seven +
`satisfies readonly ColourMode[]` so the next drift is a type error.

### DG14.2 — doc's AA heuristic failed its own test
Its min(aToB,bToA) OR-logic + selfDist ≤ 3×threshold guard rejects a
hard black/white edge shift (selfDist=255) — the exact case its own
test demands be discounted. Landed: both-directions bracket — AA iff
some A-neighbour ≈ B's centre AND some B-neighbour ≈ A's centre. A
solid flip fails the first bracket and is always counted.

### DG14.3 — visual + perf specs gate on PW_REAL_GPU, not adapter
The doc gated on requestAdapter() — but SwiftShader IS an adapter, and
goldens/baseline are backend-specific: fractal-boundary pixels disagree
~37% between backends (M3 D3.2) and SwiftShader timing is ~100×
hardware. Adapter detection would have made the swiftshader smoke fail
every golden. The a11y spec runs on BOTH backends (DOM-only) and joins
the always-on floor.

### DG14.4 — presence check = the screenshot raster itself
The doc's in-page drawImage probe reads the CLEARED current texture
even HEADED (DG8.7 — reconfirmed live: all 7 specs skipped). Landed:
capture the compositor screenshot first, skip iff it is (near-)uniform.

### DG14.5 — one Playwright project at a time; workers: 1
The doc's two-simultaneous-projects layout under a single global args
switch would run every spec twice per invocation; it also dropped the
landed webServer block and used never-landed launch args. Landed: the
active project is selected by PW_REAL_GPU. workers: 1 is load-bearing —
parallel spec files contend for the one physical GPU and skewed the
perf gate (caught live: perf failed in the parallel full run, passed
alone). Perf spec ceiling 2× (dev-laptop convergence-window p95 jitters
±50% run-to-run); tighten on a dedicated runner.

### DG14.6 — env-gated fixture regeneration; real baseline numbers
PW_UPDATE_GOLDENS / PW_UPDATE_PERF write the fixtures from the spec
itself (the doc's --update-goldens flag was unspecified). The committed
baseline is measured (cpuP95 0.4ms, simulate 27.99ms), not the doc's
aspirational 14/9.5 — the landed loop's CPU cost is sub-ms and simulate
dominates the convergence window. The shell hooks the doc invented
(applyGolden/renderStable/warmAndRun/perfSnapshot) don't exist; specs
use the landed __principia surface (renderStore now exposed).

### DG14.7 — the axe gate found real violations before reaching CI
First run: four critical select-name violations (#chart/#quality/
#colourMode/#palette had bare <label> siblings; only G13's #cvd passed
via aria-label). Fixed with for= associations on every panel label.

---

## G13 — Accessibility & CVD UI

Branch `feat/g13-a11y-cvd`. 662 passed / 8 skipped (+32: a11y suite,
gate ≥15); typecheck + unpiped lint clean; gpu:check + all four page
checks green; shell spec extended with a live a11y probe — green
headless (SwiftShader) and headed (Metal). CVD before/after
screenshots (viridis vs deuteranopia simulation) sent to the user.
Milestone doc folded back as-built.

### DG13.1 — CVD select single-sourced, not added
The doc said `<select id="cvd">` is "added to the template"; G12 had
already shipped it with a local CVD_MODES table. Landed: the table is
deleted and the options build from G13's CVD_ORDER/cvdLabel — the same
source the Alt+C cycle uses — with the change handler routed through
setCvd + a live announcement. One source of truth for mode order and
labels.

### DG13.2 — Escape must not shadow G12's `escape → unlock`
The doc's commit/dismiss arms consumed Enter/Escape unconditionally,
which would have broken G12's landed `escape → unlock` binding.
Landed: OverlayHooks.confirm()/dismiss() return boolean (true iff an
overlay consumed the key); a dismiss with nothing open returns false
and the chord falls through to the keymap. ChartBrowserHandle grew
isOpen() so the shell's hook can tell. confirm() returns false today —
no confirmable overlay exists (lookup dialog still deferred, DG8.3).

### DG13.3 — one optional `pre` param, not a 7-param signature
The doc rewrote installKeybindings with seven positional params.
Landed: the G12 signature gains ONE optional
`pre?: (e: KeyboardEvent) => boolean` evaluated after the isEditable
guard and before keymap lookup; makeA11yPreHandler(deps) +
OverlayHooks/A11yHandlerDeps live in Keybindings.ts. Existing call
sites compile unchanged. RenderParamsStore.update returns void (landed
API, doc assumed it returned the next params) — announcements read
snapshot() after the update.

### DG13.4 — live region owned by mountUI, not Canvas
The doc mounted the status node inside mountCanvas and threaded
liveSay out of it. Landed: the shell markup carries a
`.a11y-status.a11y-visually-hidden` cell; mountUI creates the
LiveRegion and the single liveSay closure it threads into
mountControlPanel and the pre-handler. mountCanvas keeps its signature
and only applies canvasAria.

### DG13.5 — roving claims the vertical axis only
Range inputs natively adjust on ALL four arrow keys; the doc's roving
group would have fought the slider's own value adjustment, and a
window-level roving handler would never fire anyway (the keymap's
isEditable guard drops events from inputs). Landed: a panel-level
keydown handler — ArrowUp/ArrowDown move focus through the 9-slider
group (one Tab stop), ArrowLeft/ArrowRight keep native value
adjustment.

### DG13.6 — A11yKeyEvent rename
The doc's KeyEventLike collided with G12 keymap.ts's exported
KeyEventLike once both flowed through the ui barrel (TS2308).

---

## G18 — Debug HUD integration

Branch `feat/g18-debug-hud`. 630 passed / 8 skipped (+25: debug_hud 19
[gate ≥16], debug_hud_dom 6); typecheck + unpiped lint clean; gpu:check
+ all four page checks green; shell spec extended with a live `~` HUD
probe — green headless (SwiftShader, ~2.4 min) and headed on Metal
(~6 s). Milestone doc folded back as-built.

### DG18.1 — phantom `EnsembleConfig` → structural `{E, patternId}`
The doc imported `EnsembleConfig` from `@/gpu/ensemble.js`; no such
type exists (G7 carries E/patternId in the TileRequest). The capture
API (`captureSeeds`/`extendCapture`) takes the pair structurally —
no new type is declared, so nothing can drift from G7.

### DG18.2 — failure-bit contract line corrected to bits 8–10
The doc's contracts line said `TILE_STATUS_FAIL` is `1<<6..1<<8`; bits
6–7 are the schema-version field (DG11.1) and the landed bits are
8–10. Doc folded to the landed values; the HUD only consumes
`hasTileFailure`/`tileFlagDescriptor`, so no code was affected.

### DG18.3 — dev/main feeds: cache walk + promise-identity inspector
`tileFlags` iterates `app.loop.cache.entries()` and maps
`tileKey(id) → reduction.status_flags` (tiles without a landed
reduction are skipped). The inspector feed caches the resolved
`InspectorResult` keyed on the *identity* of `App.inspector()`'s
promise — one promise per lock, so the HUD's rAF poll never re-runs
the inspector and a re-lock invalidates automatically.

### DG18.4 — live capture button deferred; capture tab ships empty-state
G17's `captureFrame` needs the dispatched `SimUniforms`/`TileRequest`,
which `GpuDispatcher` doesn't expose. Rather than bolt a side channel
on, `dev/main.ts` omits the optional `capture` dep (the tab renders
"no captured frame"); `extendCapture`/`checkCaptureReplayable` are
fully pinned by the exit suite. Follow-up noted in the milestone doc.

### DG18.5 — shell spec pins the HUD read-only guarantee live
Added to `test/gpu/shell.spec.ts`: press `Shift+``, assert the drawer
shows live perf text and the errors tab, hide it again, and assert the
`ViewState` snapshot deep-equals its pre-toggle value — the read-only
contract enforced on a real device, not just in happy-dom.

### DG18.6 — DOM smoke uses happy-dom header, not jsdom skipIf
The doc's `skipIf(typeof document === 'undefined')` would silently
skip forever under the node default environment. Landed as
`// @vitest-environment happy-dom` (G12 shell_dom idiom): always runs.

---

## G12 — UI/UX shell (full)

Branch `feat/g12-ui-shell-full`. 605 passed / 8 skipped (+32: shell 25
[gate ≥15], shell_dom 7); typecheck + lint clean; gpu:check + all four
page checks green; e2e shell spec green headless (~2.2 min) and headed
on Metal (~6 s) with the full shell mounted — screenshot (render-only
controls + live G11 error overlay) sent to the user. Milestone doc
rewritten as-built.

### DG12.1 — gesture-gate history coalescing, not a store bypass
The draft added `panTransient` to InputHandlers — a second write path
around the Store whose updates the history funnel must somehow not see.
Landed: a `GestureGate` (begin at pointerdown, end at pointerup) owned
by the same mountUI code that owns the funnel: while suspended, view
updates replace history.present without pushing; at end the funnel
rewinds to the gesture anchor and pushes the final view ONCE. A long
drag = one undo entry; click-lock coalesces identically; no
Store/InputHandlers semantics change.

### DG12.2 — zoom keys are viewport zoom; uvHalfWidth is undoable
The draft wired '='/'-' to input.zoom — mag (slice recompute, cache
discard) — while the wheel and Zoom buttons do cache-preserving
viewport zoom (DG8.2). Landed: zoomIn/zoomOut dispatch zoomViewport
(0.5/2 about the window centre); mag stays an explicit panel control.
Also: the draft's isComputeChange omitted uvHalfWidth, so a centre
zoom (which changes only the half-width) would not have been undoable
— added alongside uvCentre.

### DG12.3 — ShellDeps slimmed; no double-packing of RenderParams
mountUI's deps are all optional (the G8-era 3-arg call keeps working in
tests/embeds); ledger + perf are read off app.loop instead of being
injected. RenderParamsStore does NOT pack — its onRebind hands the
params to the dispatcher's setRenderParams, which owns M7's 64-byte
packing (the draft packed in the store AND the dispatcher).

### DG12.4 — ErrorBoundary.addUserErrorListener (no private-hooks cast)
The draft's Chrome assigned into the boundary's private hooks field via
an unknown-cast. Landed: a public addUserErrorListener() multi-listener
API on ErrorBoundary (G11 constructor hook untouched); Chrome registers
as a secondary listener and unsubscribes on unmount. Warnings/errors
render via textContent, never innerHTML.

### DG12.5 — bind/bindInput generalised to Subscribable<V>
The draft cast RenderParamsStore `as any` into the Store-typed bind.
Landed: reactive.ts is generic over Subscribable<V> (subscribe +
update); both stores bind with no casts and zero call-site changes.
Also fixed here: a lint error (NoopSink unused param) masked since G11
by `| tail` swallowing eslint's exit code — verification pipelines now
run lint unpiped.

## G11 — Error handling & telemetry

Branch `feat/g11-error-telemetry`. 573 passed / 8 skipped (+30:
boundary 26 [gate ≥15], ledger_boundary 4); typecheck + lint clean;
gpu:check + all four page checks green (reduce.wgsl gained the failure
roll-up); shell e2e green — and the funnel fired FOR REAL during it: a
SwiftShader tile at T=20 carried MAX_SUBSTEPS and the boundary printed
the stack-free catalogue message. Milestone doc rewritten as-built.

### DG11.1 — the doc's failure bits collided with the schema version
The draft put TILE_STATUS_FAIL at bits 6–8, claiming "M5 owns 0–5" —
but bits 6–7 carry TILE_REDUCTION_SCHEMA_VERSION (D5.2), which
decodeTileReduction asserts and STRIPS: SIM_FAILED/MAX_SUBSTEPS would
have corrupted the version check and then been erased before any
consumer saw them. Landed at bits 8–10; the boundary suite pins
non-collision with both TILE_STATUS (0–5) and the version mask (6–7).

### DG11.2 — failure-bit producers grounded in landed signals
The draft asked the reduce shader to OR bits from per-sample "detail
bits" that don't exist. Landed producers use what reduce.wgsl already
gathers: SIM_FAILED = any sample with a suspect E/Lz drift bit
(descriptor bits 5/6 — NOT broad class 3, which is an expected
terminal); MAX_SUBSTEPS = any class-4 sample (in landed simulate.wgsl
the substep stall is the only class-4 producer; horizon completion is
BOUNDED). TIMEOUT (1<<10) is reserved but producer-less — the kernel
has no wall clock — and documented as such; it needs a producer before
it can ever be set. No struct change, no schema bump.

### DG11.3 — tile failures surface from the SUCCESS path
A dispatch can succeed and still carry failure bits — data, not an
exception. Landed: JobLedger's completion handler calls
boundary.capture(undefined, {tileKey, statusFlags}) after ingest when
hasTileFailure(); the classifier checks the hint first so an undefined
throwable still yields TileFailure. The boundary rides as an OPTIONAL
4th JobLedger param (no-op default; G2 3-arg construction unchanged),
threaded via FrameLoopOpts.boundary/AppOpts.boundary; dev/main.ts
wires the real one (InMemorySink(500) exposed at
__principia.telemetry, onUserError → console.warn until G18's HUD).

## G10 — Performance budgeting & profiling

Branch `feat/g10-perf-monitor`. 543 passed / 8 skipped (+30: stats 8,
perf_monitor 17 [gate ≥15], frame_loop_perf 5; probe self-skips in Node);
typecheck + lint clean; gpu:check + all four page checks green; shell
spec green headless (SwiftShader advertises timestamp-query, so the
timing path runs live in CI) and headed on Metal. Milestone doc
rewritten as-built.

### DG10.1 — the draft's GpuTimer resolve layout was invalid WebGPU
`resolveQuerySet`'s destination offset must be 256-byte aligned; the
draft used one query set per pass resolved into tightly-packed 16-byte
slots (offsets 16/32/48). Every submission carrying the resolve
validated as an error and was silently dropped — caught live by the
shell spec via the uncapturederror listener ("Invalid CommandBuffer
from CommandEncoder 'perf-resolve'"). Landed: ONE query set with a
(begin,end) pair per pass at indices (2i, 2i+1) and a single resolve at
offset 0 — no padding needed. Also added (not in the draft): only
passes actually written since the last resolve are reported (blind
resolves attribute stale timestamps to passes that never ran), and
resolve() refuses while a read() has the buffer mapped (drop-tolerant
sampling).

### DG10.2 — the doc never opted the device into timestamp-query
A GPUQuerySet cannot be created unless `timestamp-query` was requested
at requestDevice time; the draft built timers against a device that
could never have the feature. Landed: initGpu requests it iff the live
adapter advertises it (never `required` — a post-TDR fallback adapter
may lack it), and the dispatcher gates the timer on `device.features`,
not the detection-time profile (the profile may describe a different
adapter than the one initGpu got).

### DG10.3 — back-pressure scales frameBudget, not maxInFlight
The draft's frame-loop patch clamped planFrame's `maxInFlight` — but in
the landed scheduler that field is an INPUT count ("jobs already
running": budget = frameBudget − maxInFlight), so scaling it down would
have RAISED the dispatch budget under pressure. Landed: the perf cap
scales the `frameBudget` argument (the actual dispatches-per-frame
knob), floors at 1, and snaps back to the configured ceiling the moment
the window is under budget.

### DG10.4 — takeGpuTimings is an optional GpuDispatcher member
The draft had the loop reach into dispatcher internals for "pendingGpu".
Landed: `takeGpuTimings?()` on the GpuDispatcher interface — optional so
G2's mocked dispatchers and CPU-only devices need no stub; the loop
calls it with `?.` and records one-frame-late timings (async readback;
invisible to a 120-frame rolling window).

### DG10.5 — hot-path BufferPool patches rejected against the tree
The draft shipped M1/M5/M6 pooling patches "consolidating G8's sketch"
— but G8 already rejected pooling by measurement (DG8.4), and the
patch targets don't exist: kdk.ts has zero Float64Array allocations
(flat-tuple since M1), src/quadtree/reduce_host.ts is a phantom file
(reduction finalises on the GPU in reduce.wgsl), and metricsTick is the
CPU twin, not a production path. Nothing pooled; G8's perf_baseline
stays the regression gate.

## G8 — UI shell, CI, performance baselines

Branch `feat/g8-ui-ci-perf`. 513 passed / 7 skipped (+11: viewport_nav,
ui_smoke, ci_acceptance, perf_baseline); typecheck + lint clean; real-GPU
battery green (gpu:check all gates, g17/m5/m7/depth-stress page checks);
Playwright shell spec passes headless (SwiftShader, ~2.5 min) **and headed
on Metal (~5 s)** — the first interactive slippy-map. Milestone doc
rewritten as-built.

### DG8.1 — the draft had no dispatcher; the render plan was undrawable
The doc hand-waved `makeRealDispatcher` and left M7's render graph
painting one tile across the whole target, so G2's ancestor-stretch
entries (the blank-screen defence) could not be drawn at all. Landed:
(a) a `TileWindow` uniform (32 B: screen rect + tile-UV window) at
`@group(3) @binding(1)` plus a 6-vertex quad / interpolated-UV rewrite
of `render_graph.wgsl` (WGSL + packer + pin test in one commit); (b)
`src/app/dispatcher.ts` — one shared staging `TileBuffers` set, jobs
serialized on a promise chain, results `copyBufferToBuffer`'d into
per-tile retained buffers (LRU 512) keyed
`chart|z0|q1|q2|mag|tileKey`; render is a single pass with a pool of
per-entry window-slot bind groups (all writeBuffers before submit).
G6 linearisation (with kinked→full-decode fallback) and G7 ensembles
are wired through the same path.

### DG8.2 — wheel zoom is viewport navigation, not slice magnification
The draft wired the mouse wheel to `mag` — a full slice recompute per
scroll notch, which discards the cache and isn't "zoom" in the slippy-
map sense. Landed `src/app/viewport_nav.ts`: pan/zoom on
`(uvCentre, uvHalfWidth)` keeping the world point under the pointer
fixed, half-width clamped to [2⁻²⁸, 0.5]. `mag` stays available as the
explicit Slice ± control in the panel.

### DG8.3 — LookupDialog/LegendOverlay/bindings deferred to G12
The draft's file tree included them but G8's exit only needs the
gesture loop. G12 (full UI shell) owns them; shipping stubs now would
be fake surface.

### DG8.4 — perf pooling patches rejected by measurement
The draft prescribed `src/perf/pooled_buffers.ts` + patches to M1
KDK / M9 DOPRI5 / M5 reduce / M6 metricsTick, promising ~3× — written
against an allocation profile that never landed (M1 was flat-tuple
monomorphic from day one). Measured: KDK macro step 0.75–0.82 µs vs
the 50 µs budget; inspector to t=2 13.5 ms vs 250 ms. Landed: the
regression-baseline test only; no perf module. (Also fixed while
folding back: the baseline called `runInspector` with a nonexistent
`tEnd` option — the field is `THorizon`; vitest passed because excess
options are ignored at runtime, tsc caught it.)

### DG8.5 — CI jobs run whole test trees, not the draft's phantom paths
The draft's yaml referenced per-suite paths that don't exist in the
landed tree. Landed `ci.yml` (unit / integration_no_gpu / golden on
push+PR to webgpu-rewrite, Node 22 — GPU integration suites self-skip
without an adapter) and `acceptance.yml` (`spec_section_7` un-gated +
nightly; `webgpu_swiftshader_smoke` gated on the `needs-gpu` label or
schedule, running `test:gpu` + `gpu:check`).

### DG8.6 — headless rAF starvation needs a heartbeat
Headless Chromium throttles rAF to ~zero until something presents,
but the first present needs a tick — the frame loop sat at frame 4
after 60 s. Landed in `dev/main.ts`: schedule races rAF against a
250 ms setTimeout with a fire-once guard; stray timeouts after stop()
are no-ops.

### DG8.7 — pixel probes are best-effort; presentation proof is headed
Headless Chromium never composites the WebGPU canvas (the known
glitch every dev harness paints around), and even headed, `drawImage`
from a WebGPU canvas can read the cleared current texture instead of
the presented frame. The shell spec's first version passed on a blank
canvas (PNG-byte-diversity gate — too weak); the landed spec asserts
convergence via `lastStats` (visible>0 ∧ cacheHits==visible), binds
in-page pixel assertions only when the 2D copy actually sees pixels,
and takes compositor screenshots as the human proof. Automated pixel
truth stays pinned offscreen by the M7 render check. A data-URI
favicon was added to index.html because headed Chromium's
/favicon.ico 404 tripped the zero-console-errors gate.

### DG8.8 — URL knobs ?thorizon=&n= for CI horizons
SwiftShader is ~100× slower than hardware; the spec-true horizon
(T=80 ⇒ 80k macro steps/sample) is a minutes-long first paint there.
The dev/CI entry accepts `?thorizon=20&n=16`; production defaults
stay spec-true. Headed on Metal the full e2e runs in ~5 s.

## G2 — Frame loop and orchestration

Branch `feat/g2-frame-loop`. 502 passed / 7 skipped (22 new across
store/input/gpu_jobs/app_frame_loop); typecheck + lint clean. CPU-only
milestone (mocked GpuDispatcher — the production dispatcher wiring is
G8/G12), so no gpu:check delta, same as G5.

### DG2.1 — the draft passed ViewState where M4/M5 take QuadtreeView
`visibleTiles`, `planFrame`, and `computePriority` all take M4's
`QuadtreeView` (cacheKey + UV window + zBase/zMax + viewport pixels);
the draft called them with M8's `ViewState` directly, which does not
even carry a tile depth. Landed `src/app/view_bridge.ts`:
`toQuadtreeView(v, viewport)` derives zBase via the camera's zoomLevel
formula from the viewport's UV width (cap = v.maxDepth) and the cache
key via viewStateToCacheKey; Viewport (800×600 @ tilePix 256 default)
is a FrameLoop option.

### DG2.2 — JobLedger must claim the cache entry BEFORE the GPU job
The draft's ledger never touched the cache on dispatch. But M5's
ingestReduction returns early when `cache.get(id, key)` misses —
every completion would have been dropped on the floor — and planFrame
only skips tiles whose lifecycle is queued/computing, so the same tile
would be re-proposed every frame. Landed: dispatch() inserts the entry
as 'computing' (or transitions an existing 'unseen'/'readyRefinable'
entry) before calling the dispatcher; completion runs ingestReduction
('computing' → 'ready', reduction attached).

### DG2.3 — cancelled/failed jobs leaked the in-flight slot forever
The draft's completion handler did `if (job.cancelled) return;` BEFORE
deleting the in-flight map entry, and cancelOffscreen never deleted it
either — each cancelled tile permanently ate a maxInFlight slot and
left its cache entry 'computing' (which eviction refuses to touch).
Landed: the handler always deletes the ledger entry; discarded and
failed tiles transition back to 'unseen' so they can recompute.

### DG2.4 — offscreen cancellation would have killed split children
The draft cancelled every in-flight job whose tile key was not in the
visible set — but planFrame's split jobs target CHILDREN one level
below the visible frontier, so every child the scheduler just
requested would be cancelled the same frame. Landed: a job survives if
its tile is visible or a DESCENDANT of a visible tile
(`contains(visibleTile, jobTile)`).

### DG2.5 — the draft's start() was a no-op on first call
`start() { if (!this.stopped) return; ... }` with `stopped = false`
initial state returns immediately on the very first call — the loop
could literally never start. Landed: a `running` flag with the obvious
semantics. Also trimmed dead draft API (FrameDeps.rafId/randomJitter,
render_dispatch.ts's identity function), and input handlers read the
snapshot + setView only on ok (the draft's side-effecting
store.update closures notified subscribers even on rejected ops).
One behavioural note pinned in tests: with default knobs, decode
totality (αMin/qMax clamps) makes `lookup` rejection unreachable —
near-collisions come back clamped-ok; the rejection surface exists for
M10's chart-specific validators.

## G9 — WebGPU capability detection & graceful degradation

Branch `feat/g9-capability`. 480 passed / 7 skipped (16 in the gate
suite vs ≥ 12 required); typecheck + lint clean; gpu:check ok with
gpuDisagree = 95 unchanged and all four page checks green — the
recovery gate now exercises the reworked initGpu end-to-end through
DeviceRecovery's default acquire.

### DG9.1 — requestDevice rejects; the doc's null check was unreachable
The doc classified `'no-device'` via `if (!device)` after
`requestDevice`, but per the WebGPU spec requestDevice never resolves
null — it REJECTS (OOM, invalid requiredLimits, lost adapter). Landed:
`.catch(() => null)` around the request so the rejection is what maps
to the typed `UnsupportedError('no-device')`, making all three
UnsupportedReason values genuinely reachable. Also landed structurally
typed detection (`GpuLike` instead of `any`), `GpuContext.limits`
retyped from the ad-hoc 4-key record to the `DeviceLimits` interface
(no external consumers existed — verified by grep), and two extra
typed-refusal tests that run in plain Node (Node ≥ 21 ships a global
`navigator` without `gpu`, so no-webgpu classification needs no mock).

---

## G7 — Device-loss recovery, ensemble dispatch, spread second pass

Branch `feat/g7-device-loss`. 464 passed / 6 skipped; typecheck + lint
clean. Real-GPU proof: gpu:check ok with three new G7 gates — spreads
(spread_t_end = 11.1, spread_n = 2.61, real checkpoint means on the
mixed M3 tile), ensemble (E = 4 stratified: count 4, agreement 0.745,
HAS_ENSEMBLE bit, sample_count = N²·4), recovery (forced destroy →
fresh device in ~13 ms, cache reduction intact, post-loss class
histogram exactly matches pre-loss) — plus g17/m5/m7/depth-stress page
checks green. One gpu_check harness bug fixed along the way: the
post-recovery render target must use the FRESH context's format (a
canvas-less initGpu returns rgba8unorm; a mismatch silently drops the
whole submission).

### DG7.1 — ensemble offsets at g0b5, not the doc's g0b3
The doc bound `EnsembleOffsets` at group(0) binding(3), which G4 had
already assigned to `ChartUniforms` (and b4 went to G6's
`LinearisedRef`). Landed at binding 5, compute-only, 256 B (16 × vec4
(du, dv, 0, 0)), zero-filled default = no jitter. The frame bind group
table is now b0 SimUniforms / b1 TileRequest / b2 DebugUniform /
b3 ChartUniforms / b4 LinearisedRef / b5 EnsembleOffsets.

### DG7.2 — spread pass: one entry inside reduce.wgsl, not 6 pipelines in a new file
The doc specified `reduce_spreads.wgsl` with six per-scalar entry
points and a dedicated pipeline builder. A separate file would need a
FIFTH hand-kept copy of the shared structs (the M5 four-copy problem,
worse), and six single-workgroup dispatches re-read the same N²·E
samples six times. Landed: a single `reduce_spreads` entry INSIDE
`reduce.wgsl`, same `pipelineReduce` layout, one sweep accumulating all
five scalar spreads + the angular max, dispatched as a second pass in
the same command encoder as the main reduce (pass ordering makes the
means visible; no CPU round-trip). Also the doc bound `results` as
`var<storage, read>`, violating the G3 rule that the shader's access
mode must match the shared perTile layout's `'storage'` type —
read_write as landed.

### DG7.3 — E and patternId live in TileRequest spare lanes
Per-tile scoping: `ensemble_e` at i32[9], `sample_pattern_id` at
i32[10] of the existing 48 B TileRequest — not new SimUniforms fields.
The TS fields are optional and pack as 0, so all pre-G7 callers and
frame captures stay valid; the three WGSL TileRequest copies gained the
two u32 lanes in the same commit (struct-as-one-artifact rule).

### DG7.4 — DeviceRecovery hardened beyond the doc's sketch
The doc's listing reattached a listener but had no defence against the
OLD device's `lost` promise resolving after recovery (it fires once
per device, possibly late): landed handler checks
`currentCtx.device !== device` and ignores stale events. Also landed:
injectable `acquire` (unit tests drive fake contexts with controllable
lost promises; production defaults to initGpu), `dispose()`, and
optional onRecovering/onRecovered hooks (the doc required UI hooks that
don't exist until G8).

### DG7.5 — public cache.entries() + CachedTile.reduction
The doc's recovery walked `(cache as any).map.values()` and relied on a
`reduction` field CachedTile didn't have. Landed: a real
`*entries(): IterableIterator<CachedTile>` on TileCache and an optional
`reduction?: TileReduction | null` on CachedTile (type-only import — no
runtime cycle). Recovery nulls simBuffer/icBuffer (never destroy()
through a lost device), resets lifecycle to 'unseen', keeps reduction —
the ancestor-fallback baseline the whole feature exists to preserve.

### DG7.6 — checkpoint means landed in the main reduce (doc prerequisite gap)
The doc's `spread_n` reads `mean_n_checkpoints[m]`, but M5's reduce
still zeroed those lanes ("M6 fills this"). Landed real means in the
main pass: per-lane vec4 accumulators tree-reduced through a
`array<array<vec4<f32>, 8>, 64>` workgroup array (~8 KB, within the
16 KB floor), written as raw vector averages; the spread pass
renormalises the mean direction and skips means shorter than 1e-6.

### DG7.7 — SwiftShader does not re-zero loop-local `var`s (agreement > 1)
First gpu:check run measured ensemble agreement 1.822 — impossible for
a mean of per-pixel majority fractions. Root cause: `var hist:
array<u32, 5>;` declared inside the per-pixel loop relies on WGSL
zero-init-on-scope-entry, which SwiftShader does not honour on loop
re-entry, so votes accumulated across each lane's strided pixels
(~2.5× inflation, exactly as accumulation predicts). Fix: explicit
initialisers on all loop-local and accumulator vars in reduce.wgsl
(`var hist = array<u32, 5>(0u, ...)`, explicit ckpt_sum zero loop).
Post-fix agreement: 0.745 on the fractal tile. Filed as a portability
rule: never rely on implicit zero-init inside WGSL loops.

### DG7.8 — depth-stress "uniform settles early" expectation was a zero-spread artifact
With real spreads feeding compositeCoherence, the depth-stress
harness's uniform chase (min-impurity child) no longer stops at
keep('coherent') around z = 13 — that stop only happened because the
spread terms were constant zero (S ≈ 0.35·impurity). The measured
descent shows the min-impurity child of the M3 slice is honestly
incoherent: impurity 0.11-0.22 through z = 12 (impurity-forced splits —
spreads irrelevant), then genuine trajectory spread (S 1.6-3.1 vs
τ ≈ 0.46) until the f32 floor, where all samples decode identically
and S collapses to 0.033 ≪ τ = 0.5. The check now asserts the robust
facts — stop ∈ {coherent, f32_floor}, final S ≤ τ, final impurity
≤ 0.10 — instead of pinning depth ordering that the fake zeros
produced. Product behaviour is correct; deeper-than-floor honesty is
exactly what AT_F32_FLOOR + the G6 linearised path exist to handle.

---

## G6 — Linearised decoder for deep zoom

Branch `feat/g6-linearised-decoder`. Acceptance gate
(`npm test -- --run test/golden/linearised_decoder`) green; 450 passed
/ 3 skipped; typecheck + lint + build clean. Real-GPU proof: gpu:check
ok with gpuDisagree = 95 unchanged (flag=0 path behaviour-identical)
AND a new G6 A/B gate — a flag-selected decode_linear dispatch agrees
with the CPU f64 twin at max |ΔE₀| = 4.1e-8 (gate 1e-2) — plus
g17/m5/m7/depth-stress page checks all passing.

### DG6.1 — the doc's apply/build pair had a factor-2 convention bug
The doc built J as ∂D/∂(tile uv) (central differences over uv offsets)
but applied it with δ = 2t − 1, which spans ±1 — HALF-TILE units. Its
own affine round-trip test fails against its own listing (corners land
2× too far from the centre). Landed convention: J is stored in δ-units
(J_uv / 2 — the spec's chart-space J_D·h at tile scale), and both
applyLinearised and the WGSL decode_linear use x = x0 + J·(2t − 1)
verbatim. The affine corner test now pins the convention end to end.

### DG6.2 — FD step 0.25 tile-local, not the doc's 1e-6 (+ Richardson)
The doc's fdStep = 1e-6 reads as a chart-scale habit, but buildLinearised
differentiates a TILE-LOCAL closure: at depth 30 a 1e-6 tile-local step
probes a ~1e-15-wide physical interval and the f64 quotient on O(1)
decode outputs is ~10% cancellation noise — the golden's 1e-13 gate
fails by ~5 orders. Landed: FD_STEP_DEFAULT = 0.25 (probes inside the
tile, where smoothness is guaranteed by the tile being tiny) with
Richardson extrapolation (4·C(h/2) − C(h))/3 for O(h⁴) truncation.

### DG6.3 — smoothness check: two scales, with a rounding-noise floor
The doc's notes call for a forward-vs-backward-difference bail but the
listing omitted it, and a single-scale comparison cannot distinguish a
smooth extremum (J ≈ 0, fwd ≈ −bwd) from a genuine kink — it rejected
the doc's own smooth sin/cos test decoder. Landed: asymmetry measured
at h and h/2; smooth asymmetry (h·|D''|) halves, kink asymmetry is
scale-constant → flag when the half-step asymmetry retains > 0.75 of
the full-step one. The floor is 1e-12·max(1, lane scale)/h — scaled to
f64 rounding on the LANE VALUES, not the Jacobian, because at deep zoom
the true differences approach rounding noise and a derivative-scaled
floor false-positives every deep tile (found by the depth-30 golden).

### DG6.4 — doc's packer contradicted its own WGSL struct
The doc's packLinearisedUniforms padded each r_i/p_i to its own vec4
(r1 at f[4]) while its WGSL LinearisedRef packed pairs tightly (r0r1 =
r0.x, r0.y, r1.x, r1.y → r1 at f[2]); the struct also summed to 224 B
against the packer's 256. Same defect class as DG4.1. Landed: the tight
16-vec4 256 B layout with two reserved lanes, pinned three ways — packer
lane test, WGSL field-order pin against struct_dump's new
linearisedRefLayout(), and the real-GPU A/B in gpu_check (a lane swap
produces O(1) E₀ garbage there).

### DG6.5 — totality, guards, and homes beyond the doc
(a) decode_linear takes r_coll and applies decode_full's no-holes guard
(doc set terminal = 0 unconditionally; every pixel gets a label on this
path too). (b) descriptorFromState null-stub replaced by the one
makeDescriptor (D10.1). (c) The packer lives at src/gpu/
linearised_uniforms.ts beside chart_uniforms.ts — GPU byte layout is a
gpu/ concern (doc had it in src/decode/). (d) TILE_REQUEST_FLAGS in
structs.ts is a new REQUEST-flag namespace, deliberately separate from
quadtree TILE_STATUS (whose own DECODE_LINEAR bit is the tile REPORTING
its decode mode); the WGSL twin constant is source-pinned. (e)
dispatchLayer0 throws on flag-without-reference — a zero LinearisedRef
decodes every sample to the origin with zero masses, silently. (f) The
LinearisedRef binding is g0b4 compute-only; buffers stay zero-filled
when unused, so every pre-G6 dispatch is bit-identical (gpuDisagree 95).

---

## G5 — Closed-form chart inverses

Branch `feat/g5-inverses`. Acceptance gate
(`npm test -- --run test/golden/chart_inverse`) green; 432 passed
/ 1 skipped; typecheck + lint clean. CPU-only milestone — no GPU
surface touched, so no gpu:check delta to prove.

### DG5.1 — golden redesigned around state equivalence, not pixel equality
The doc's golden asserted `inverseEncode` recovers the original pixel to
1e-3 on ≥70% of samples. That fails structurally for three charts:
latent_slice had no pixel at all pre-G5 (z only), burrau_euclid's u axis
is display-only, and shape_sphere folds u ↔ 1−u onto the same state. As
built (per the ratified "assert robust facts, don't pin gauge" pattern):
the golden pins `decode(inverseEncode(state).pixel)` ≡ the original
canonical state componentwise (m 1e-9, r/p 1e-6) — redundancy-proof
because both decodes canonicalise — and additionally pins exact pixel
recovery for the no-redundancy charts. Vacuity guards (>50 ok, >30 exact
per chart) replace the 70% ratio.

### DG5.2 — the shape-sphere redundancy is on the u/θ axis, NOT φ/v
The doc's hemisphere-fold caveat said the inverse picks a canonical
`v ∈ [0, 0.5]` (φ ∈ [0, π]) representative. Deriving the realised Hopf
vector algebraically gives n = (sinθ cosφ, sinθ sinφ, |cosθ|): the
β-fold collapses θ ↔ π−θ (u ↔ 1−u), while n₁/n₂ distinguish every
φ ∈ [0, 2π) — so v is faithful and u carries the fold. Canonical states
have n₃ ≥ 0 (mirror rule λ̃_y ≥ 0), so the inverse returns the u ≤ 0.5
representative. Pinned by tests: u and 1−u decode to identical states,
and v ≈ 0.95 round-trips exactly. The landed FLAGS_SPHERE comment's
φ-redundancy claim was the same error, inherited by the doc.

### DG5.3 — mass-simplex inverse: doc's Newton cubic targets a map that never landed
The doc derived Newton iteration on `m₁v³ − m₂v + m₂ = 0`, inverting the
parameterisation `m₁ = u(1 − uv)`. The landed M10 forward map is the
bilinear `m₁ = u, m₂ = (1−u)v`, whose closed-form inverse
(`u = raw₁, v = raw₂/(1 − raw₁)` after unbuffering) already existed and
is exact. Kept M10's inverse untouched; the doc section was rewritten.

### DG5.4 — I computed from the IC, not assumed 1; K read directly
The doc's lz inverse hardcoded `I = 1` (true only at the decode side's
R̃ = 1 gauge) and routed K through `E − U(r)`. As built: I = Σmᵢ|rᵢ|²
and K = Σ|pᵢ|²/2mᵢ from the actual IC — a foreign IC arriving via an M8
chart switch has arbitrary I, and `L_max = √(2IK)` with the real I is
what makes a rigid rotor of any size land exactly on the feasibility rim
(Cauchy–Schwarz equality; the rim-projection branch is unreachable for
genuine states and guards float error with a 1e-9 tolerance).

### DG5.5 — inverseEncode gained an optional view parameter
The doc's inverses hardcoded chart knobs (Kmax = 2, poleBuffer = 0.05)
with a note that "production reads chartParams". Landed as
`inverseEncode(ic, view?)`: the optional view carries chartParams and
the latent slice frame; every chart falls back to its decode defaults
when absent, so M8's existing lookup/lock/preserve call sites compile
and behave unchanged. Also beyond the doc: latent_slice's inverse now
projects z − z0 onto the slice axes to produce a real pixel when a view
is supplied (off-plane residual > 1e-6 → projected with reason),
and lz_k inherits the shared inverse via its object spread (one
function object, identity-pinned by test) rather than duplicating it.

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
