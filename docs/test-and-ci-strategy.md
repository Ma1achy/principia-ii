# Test & CI/CD strategy

> **Living document.** This is the cohesive view of how Principia tests itself
> and what runs in CI — the per-milestone acceptance checks remain the
> authoritative definition of done, and this document explains how those checks
> compose into layers and pipelines. It is expected to drift as milestones land;
> keep it honest against the actual `package.json`, `vitest.config.ts`,
> `.github/workflows/*`, and `playwright.config.ts`. When a milestone changes a
> layer or a gate, update the relevant section here in the same PR.

Cross-references: the [`principia-testing`](../.claude/skills/principia-testing/SKILL.md)
skill (tolerances, golden discipline, alignment pins, acceptance-as-done),
[G8](../milestones/G8_ui_ci_perf.md) (the first CI configuration), and
[G14](../milestones/G14_e2e_regression_ci.md) (real-GPU e2e + regression gates).

---

## 1. The test pyramid

Principia's correctness guarantees live in the tests, not the prose — the golden
tests are what stop a "harmless" integrator tweak from silently shifting every
trajectory, and the alignment pins are what stop a struct edit from corrupting
every pixel (see `principia-testing`). The suite stratifies into four layers,
widest and cheapest at the base.

```
                  ┌───────────────────────────┐
                  │  e2e  (test/gpu/*.spec.ts) │   real browser, Playwright
                  │  visual · perf · a11y      │   nightly / opt-in
                  ├───────────────────────────┤
                  │  golden (test/golden/*)    │   pinned references
                  │  Burrau · decode landmarks │   CPU, deterministic
                  ├───────────────────────────┤
                  │  integration               │   cross-module, CPU-only
                  │  (test/integration/*)      │   + §7 acceptance gate
                  ├───────────────────────────┤
                  │  unit  (test/unit/*)       │   per-module, pure
                  │  math · integrate · decode │   fastest, most numerous
                  └───────────────────────────┘
```

The runner is **Vitest** throughout (`npm test`); it globs `test/**/*.test.ts`
and wires the `@/` alias to `src/`, so every layer imports application code as
`@/integrate/run.js` (note the `.js` extension — this is an ESM project). A
single suite runs with the passthrough `--`:

```bash
npm test -- --run test/unit/math
npm test -- --run test/golden/burrau
```

Playwright e2e is a separate runner (`npx playwright test`, or the `npm run
test:gpu` script — note this script is **not** in M0's `package.json`; G8 adds
it) because it drives a real browser; the pure *decision* logic those specs depend
on lives in `test/unit/regression/` so the regression floor stays in Vitest.

### Layer 1 — Unit (`test/unit/*`)

Pure, per-module tests that mirror the source tree. They own the math and
numerics primitives that every later layer leans on, so they are written
**early**: M0 lands 30+ green math tests before any physics exists, because M1
and M2 build directly on them.

| Owns | Representative paths |
|---|---|
| Scalar / vector / softmax / rotation algebra | `test/unit/math/{scalar,vec,softmax,rotate}.test.ts` |
| Symplectic integrator internals (forces, KDK, Yoshida, events) | `test/unit/integrate/{forces,kdk,yoshida,events}.test.ts` |
| Decoder pieces (mass, canonicalise, inverse) | `test/unit/decode/{mass,canonicalise,inverse}.test.ts` |
| Pure regression verdicts (image diff, perf gate, golden manifest) | `test/unit/regression/{image_diff,perf_gate}.test.ts` |

Float assertions use explicit, visible tolerances — never `toBe`/`toEqual` on a
computed float; integer outcomes (terminal kind, escaping body, pair codes) are
exact and compared directly.

### Layer 2 — Integration (`test/integration/*`)

Cross-module behaviour, **CPU-only** by construction. This is where the
quadtree, interaction, chart, and reproducibility paths are exercised end to end
without a GPU, and where two special sub-trees live:

- **The CPU-only integration suites** that any runner (and CI without a GPU)
  executes, as flat suites under `test/integration/`: `test/integration/quadtree`
  (quadtree walk), `test/integration/interact` (interaction dispatch),
  `test/integration/charts` (chart switching), and
  `test/integration/sweep_reproducibility`. These are the "always runs anywhere"
  tier — G8's `integration_no_gpu` job runs them via these flat paths.
- **`test/integration/acceptance/`** — the spec **§7** acceptance gate
  (`a1..a6.test.ts` plus an `a_all` aggregator). Each is a single §7 invariant
  (A1–A6) run entirely on the frozen corpus with no adapter, surfaced via the
  acceptance harness (`runAllAcceptance`). G8's `ci_acceptance.test.ts` wraps the
  whole set under a 30-second budget. **The §7 acceptance suite is CPU-only and
  must never be gated on GPU hardware** (G8 ran it un-gated; G14 explicitly
  leaves it that way).

The CPU **perf baseline** also lives here (`test/integration/perf_baseline.test.ts`):
it pins the KDK macro step under 50 µs (f64, Node) and the reduction pass under
its per-tile budget. It is CPU-only — distinct from G14's real-GPU perf gate.

### Layer 3 — Golden (`test/golden/*`)

Pinned high-precision references whose whole purpose is to make a regression show
up as a reviewable diff. The two anchors:

- **Burrau trajectory** — `test/golden/burrau.test.ts` against
  `test/golden/burrau_345_reference.json`. Asserts energy drift below `1e-7`,
  terminal label `ESCAPE` for body 1, and all checkpoints within the fixture's
  stated `tolerance_position` (`0.02`).
- **Decode landmarks** — `test/golden/decode_landmarks.test.ts`. Pins known IC
  points through the decoder so any change to a chart, decoder, or canonicaliser
  that moves a landmark is caught. When you add or modify a chart, add or update
  its landmark.

Golden tests are deterministic — keep `Math.random` out of trajectory and decode
paths; ensemble jitter uses a seeded generator so runs reproduce.

### Layer 4 — e2e (`test/gpu/*.spec.ts`, Playwright)

Real-browser specs that own everything the CPU layers structurally cannot see: a
render mode that silently inverts, a frame budget that regresses, an unlabelled
control. Three specs (G14):

| Spec | Owns |
|---|---|
| `test/gpu/visual_regression.spec.ts` | one golden PNG per render mode, deterministic seed, tolerance-based pixel diff |
| `test/gpu/perf_capture.spec.ts` | captures a G10 `PerfSnapshot`, feeds the perf gate vs `test/fixtures/perf/baseline.json` |
| `test/gpu/a11y_shell.spec.ts` | axe-core scan of the G12/G13 shell for serious/critical violations |

The **verdict is pure on purpose**: each spec only *gathers* (render a frame,
snapshot it; drive ~600 frames, read the snapshot) and *delegates* to a pure
function — `compareImages` / `checkPerf` / `validateManifest` in
`src/regression/`, unit-tested under `test/unit/regression/`. That split is what
lets the regression floor run with no GPU, browser, or display.

---

## 2. The GPU boundary

The single most important axis in this strategy is *what needs a GPU to run*.
Per-PR cost stays low by keeping the load-bearing layers CPU-only and pushing
real-hardware work to a nightly/opt-in tier. Three rings:

### Ring A — CPU-only, runs everywhere (no GPU ever)

The entire unit layer, the CPU integration suites (the flat
`test/integration/{quadtree,interact,charts,sweep_reproducibility}` paths),
the **§7 acceptance** suite (`test/integration/acceptance/`), the **CPU perf
baseline**, and the golden trajectory/landmark/regression suites. These are the
regression floor: a fresh clone runs `npm install && npm test` green on any
machine, and CI runs them on stock `ubuntu-latest` with no GPU and no browser.

### Ring B — Swiftshader, always-on per labelled PR (G8)

A headless-Chrome WebGPU smoke under Vulkan **swiftshader** (the
`--use-vulkan=swiftshader` launch args in `playwright.config.ts`). It runs the
Playwright specs against a software adapter so "WebGPU init threw" is caught on
every PR that touches GPU code — but only when the PR carries the **`needs-gpu`**
label, because swiftshader is slow and finicky (G8's `webgpu_integration`, G14's
`webgpu_swiftshader_smoke`). Local devs run the same specs against their own
Chrome without Playwright.

### Ring C — Real GPU, nightly + opt-in (G14)

A second Playwright project (`chromium-real-webgpu`, selected by `PW_REAL_GPU=1`)
that drops the swiftshader override so Chrome picks the hardware adapter. It runs
the **visual + perf + axe** regression specs and executes only on the nightly
`schedule:` or an explicit **`real-gpu`** PR label — *not* `needs-gpu`. Hardware
runners are scarce and noisier, so this is the ceiling, not the floor.

### Self-skip, never false-fail

Every browser spec guards on the **M3 pattern** (`if (!('gpu' in navigator))` /
`requestAdapter()` returns null → `test.skip`) *and* **G9's**
`detectCapabilities` (`supported:false` → skip the real-GPU project). A runner
that has no adapter — or silently falls back to swiftshader when real GPU was
requested — degrades to a clean no-op, not a red build. The M3 integration test
applies the same guard for its own GPU path.

| Ring | Backend | When | Gate | Specs |
|---|---|---|---|---|
| A | none (CPU) | every push / PR / nightly | un-gated | unit, integration (flat CPU suites + §7 acceptance), golden, CPU perf baseline |
| B | swiftshader | per PR | `needs-gpu` label | `test/gpu/*.spec.ts` smoke |
| C | real GPU | nightly + opt-in | `real-gpu` label or schedule | visual / perf / a11y |

---

## 3. Fixture policy

Quoting `principia-testing`, two rules are easy to get wrong and silently defeat
the whole golden safety net:

> **Generate the reference once** with a high-precision run and commit it as
> JSON; the test re-runs the pipeline and asserts agreement to within the
> fixture's stated tolerance; any later change beyond tolerance fails as a
> reviewable diff.

- **Generate-once-and-pin.** The Burrau reference is produced by Yoshida 6 at
  `dt = 1e-4` and committed as `test/golden/burrau_345_reference.json`. The
  fixture carries its own tolerances as named fields (`tolerance_position`,
  `energy_drift_max`) so a reader sees the reason for each bound.

- **Regenerate placeholders on first landing.** A fixture committed before its
  feature exists carries *illustrative* numbers. When you first implement the
  feature, run the high-precision integrator, capture the **actual** values, and
  commit those. Never hand-edit a reference to make a failing test pass — that is
  exactly the regression the golden test is meant to catch. The same discipline
  applies to G14's golden PNGs (regenerate via a dedicated `--update-goldens` run
  on the reference runner, review the PNG diff in the PR) and to
  `test/fixtures/perf/baseline.json` (captured once from `PerfMonitor.snapshot()`
  after a warm window, then reviewed like code).

- **The golden config is not the production config.** Golden tests pin the
  *reference truth* using the reference integrator and settings —
  **Yoshida-6, `N_max = 256`** — even though the GPU pipeline runs KDK at
  `N_max = 64` in the Preview tier. The golden test is not measuring the
  production speed/accuracy trade-off; keep the two straight.

- **Struct-alignment pins.** Every GPU struct crossing the CPU/GPU boundary has
  its byte size asserted in a `layer0_struct_alignment` pin test. When a struct
  field changes, the WGSL struct, the `structs.ts` packer, and the pin test all
  change in the **same commit** (see `principia-gpu`). Never weaken the pin to
  pass an edit; fix the layout.

---

## 4. The CI matrix

CI is assembled milestone by milestone. The configuration *files* are born in
M0; the *workflows* arrive in G8 and are extended (never rewritten) by G14.

Every workflow's `push:` and `pull_request:` triggers target the integration
branch **`webgpu-rewrite`**, never `main` (`main` is the untouchable historical
proof-of-concept — see the branch policy in `CLAUDE.md`). Concretely, each
workflow declares `branches: [webgpu-rewrite]` (the G8/G14 fix that wires this
into the actual `.github/workflows/*` is being applied separately).

**M0 — config foundation.** `package.json` exposes `lint` / `typecheck` / `test`
/ `build`; `tsconfig.json` pins strict ES2022 ESM with the `@/` alias;
`vitest.config.ts` globs `test/**/*.test.ts`, sets the `@` alias, and uses the v8
coverage provider. The M0 gate is simply that a fresh clone runs
`npm install && npm test` green with `typecheck` and `lint` clean.

**G8 — first workflows.** `.github/workflows/ci.yml` defines the CPU pipeline as
a fan-out: `unit` (lint → typecheck → `test/unit`) is the root; `integration_no_gpu`
and `golden` each `needs: unit`. `.github/workflows/acceptance.yml` adds the
`spec_section_7` job (CPU-only, un-gated, also on a nightly `schedule:`) and the
swiftshader `webgpu_integration` job gated on `needs-gpu`. `playwright.config.ts`
and `vite.config.ts` arrive here too.

**G14 — regression gates.** Extends `playwright.config.ts` with the
`chromium-real-webgpu` project (keeping `chromium-swiftshader` always-on) and
splits the GPU job in `acceptance.yml`: the swiftshader smoke
(`webgpu_swiftshader_smoke`) stays `needs-gpu`-gated, and a new
`real_gpu_regression` job runs the visual/perf/a11y specs on the nightly schedule
or `real-gpu` label. The `ci.yml` (unit / integration / golden) and the
CPU-only `spec_section_7` job are untouched.

### Per-PR vs nightly

| Stage | Trigger | GPU | Gate |
|---|---|---|---|
| `ci.yml: unit` (lint → typecheck → `test/unit`) | push / PR | none | always |
| `ci.yml: integration_no_gpu` (`needs: unit`) | push / PR | none | always |
| `ci.yml: golden` (`needs: unit`) | push / PR | none | always |
| `acceptance.yml: spec_section_7` (§7 A1–A6) | push / PR / nightly | none | **un-gated** |
| `acceptance.yml: webgpu_swiftshader_smoke` | PR | swiftshader | `needs-gpu` label |
| `acceptance.yml: real_gpu_regression` (visual + perf + a11y) | **nightly** / opt-in | real GPU | `real-gpu` label or `schedule` |

The pure regression suite (`test/unit/regression`) runs in Ring A on every PR
*and* is re-run first inside `real_gpu_regression` as the deterministic floor,
so the nightly job never reports a verdict-logic failure as a hardware flake.
On failure, the real-GPU job uploads `*.diff.png` magenta-mask artifacts for
human triage.

---

## 5. Gaps & recommendations

The matrix above is solid through v1, but several coverage gaps are known. In
rough priority / timing order:

1. **Property / fuzz testing for decoder totality — adopt next, alongside M2.**
   The decode pipeline is *total*: every UV pixel must end in exactly one
   terminal label (`DEGENERATE(reason)`, `COLLISION_T0`, …), never throwing. The
   current landmark tests pin specific points; they do not prove the invariant
   *for arbitrary input*. Add a `fast-check` property suite under
   `test/unit/decode/totality.test.ts` asserting "every randomly-sampled latent
   vector gets a label and the decoder never throws," with a fixed seed for
   reproducibility. This directly defends a project non-negotiable and is the
   single highest-value gap.

2. **Coverage thresholds — adopt soon, low effort.** The v8 provider is already
   wired in `vitest.config.ts` but no threshold is enforced. Add
   `coverage.thresholds` (start at a realistic floor — e.g. 80% lines on
   `src/math`, `src/integrate`, `src/decode` — rather than a blanket number) so
   coverage can only ratchet up. Make it a soft report first, then gate once the
   numbers stabilise.

3. **Flake / retry policy — adopt with Ring C maturity.** Vitest CPU suites are
   deterministic and must **not** retry (a flaky pure test is a real bug). The
   real-GPU Playwright project, however, runs on noisy shared hardware; allow a
   bounded `retries: 1` *only* on `chromium-real-webgpu`, never on the
   swiftshader smoke or any Vitest layer. Pair with the existing `+25%` /
   `noiseFloorMs` slack in the perf gate; tighten both once a stable self-hosted
   GPU runner exists.

4. **Bundle-size gate — adopt around G15 (build/deploy).** G8 explicitly ships no
   bundle-size budget. Once `npm run build` produces the production bundle, add a
   size check (e.g. a `size-limit` step in `ci.yml`) on the main JS/WGSL chunks
   so a dependency creep or an accidental large asset import fails the PR. Tie
   the budget to the hosting milestone where bundle size first matters.

5. **Cross-browser e2e — defer past v1.** The real-GPU project is
   Chromium-only, which is correct for v1 (WebGPU maturity, headless support). A
   Firefox/Safari WebGPU matrix is worth a *nightly* lane once those engines'
   WebGPU ships stably, but it is not a per-PR concern and should not block v1.

**Not recommended:** retries on any CPU/Vitest layer, axe rule exclusions to
force a11y green (fix the markup in G12/G13 instead), or hand-edited golden
numbers — each silently disables a guard the project depends on.
