# G14 — Real-GPU e2e & regression CI

## Goal

G8 stood up CI and runs the §7 acceptance job CPU-only and un-gated (push / PR /
nightly schedule), with only the `webgpu_integration` job behind the `needs-gpu`
PR label running swiftshader. But G8 never asserted anything *visual*, *perf*, or
*accessible* — a render-mode that silently inverts, a frame budget that
regresses 3×, or an unlabelled control all sail through. G14 closes those gaps
without inflating the per-PR cost: it keeps swiftshader as the always-on
fallback (so every labelled PR still gets a headless WebGPU smoke), adds a
**real** headless-Chrome WebGPU Playwright project that runs only on a nightly
schedule / opt-in `real-gpu` label, and bolts on three regression gates — a
**golden-PNG visual-regression harness** (one golden per render mode,
deterministic seed, tolerance-based pixel diff), a **perf-regression gate** that
compares a captured G10 `PerfSnapshot` against a committed baseline, and an
**axe-core a11y scan** over the G12/G13 shell. The §7 acceptance job is already
CPU-only and un-gated in G8; G14 leaves it as-is and does not gate it on GPU
hardware.

The keystone is a **pure** image comparator (`compareImages(a, b, tol) →
{ diffRatio, passed, … }`): every browser spec produces a PNG, but the
*decision* of pass/fail is a deterministic, GPU-free function, so the exit
criterion is a unit suite that never touches a display.

**Exit criterion (single executable test).**

```bash
npm test -- --run test/unit/regression/image_diff
```

passes with at least **12 green tests** (15 as-built, + 8 in the perf-gate
suite) covering: identical images → zero diff;
single-pixel delta below/above tolerance; per-channel vs luma comparison;
alpha handling; the antialias-aware threshold; dimension-mismatch rejection;
diff-mask production; and the golden-manifest validator (every declared render
mode has exactly one golden entry, all paths unique). No GPU, browser, or
display required — the comparator and manifest validator are pure.

**Deliverable:** internal/CI — a pure image comparator plus golden-PNG visual-regression, perf-regression, and axe-core a11y gates wired into CI (real headless-Chrome WebGPU on a nightly/opt-in schedule); the comparator and golden-manifest validator are pinned by `test/unit/regression/image_diff`.

## File tree

```
principia/
  src/
    regression/
      image_diff.ts          # NEW: pure RGBA comparator + diff mask (the exit subject)
      golden_manifest.ts     # NEW: GoldenEntry registry + validateManifest (per render mode)
      perf_gate.ts           # NEW: pure PerfSnapshot-vs-baseline regression classifier
      index.ts               # NEW: barrel
    ui/
      ControlPanel.ts        # MODIFIED: label `for=` associations (axe select-name fix)
  dev/
    main.ts                  # MODIFIED: __principia.renderStore exposed for the visual spec
  test/
    unit/
      regression/
        image_diff.test.ts   # NEW: comparator + manifest validator (EXIT suite, ≥12 tests)
        perf_gate.test.ts     # NEW: perf-regression classifier (pure)
    gpu/
      visual_regression.spec.ts   # NEW: Playwright — render each mode, diff vs golden (skips w/o GPU)
      perf_capture.spec.ts        # NEW: Playwright — capture PerfSnapshot, feed perf_gate (skips)
      a11y_shell.spec.ts          # NEW: Playwright — axe-core scan of G12/G13 shell (skips)
    fixtures/
      golden/                     # NEW: committed golden PNGs (one per render mode)
      perf/
        baseline.json             # NEW: committed PerfSnapshot baseline (perf gate input)
  playwright.config.ts            # MODIFIED (G8): add real-webgpu project alongside swiftshader
  .github/
    workflows/
      acceptance.yml              # MODIFIED (G8): add nightly real-gpu job; §7 already CPU-only & un-gated
```

## Depends on / pairs with

- **G8** (`playwright.config.ts` ~line 506 with `--enable-unsafe-webgpu` /
  `--use-vulkan=swiftshader`, one `chromium` project; `acceptance.yml` ~line 463
  where the `spec_section_7` job is CPU-only & un-gated and only
  `webgpu_integration` is gated on `needs-gpu`) — G14 **extends** both: it does
  not rewrite them. The swiftshader project and the existing jobs stay; G14 adds
  a sibling real-WebGPU Playwright project and a nightly real-GPU workflow job.
- **M12** (`runAllAcceptance`, `acceptanceTests`, §7 A1–A6 in
  `test/integration/acceptance/*`) — that suite is CPU-only and G8 already runs
  its CI job un-gated (push / PR / nightly); G14 leaves that as-is and does not
  gate it on GPU.
- **M3** (the `if (!('gpu' in navigator))` skip pattern, ~line 189) — every G14
  Playwright spec uses the same guard so it skips cleanly without a real adapter.
- **G9** (`detectCapabilities`) — the browser specs call it first and skip the
  real-GPU project if `supported:false`, so a CI runner that falls back to
  swiftshader (or has no adapter) does not fail the visual gate spuriously.
- **G10** (`PerfMonitor`, `PerfSnapshot`, `frameBudgetMs`) — `perf_capture.spec`
  drives the frame loop, calls `monitor.snapshot()`, and `perf_gate.ts` compares
  that snapshot to `baseline.json`.
- **G12 / G13** (`mountUI`, `mountChrome`; `buildAria`/`applyAria`) — the axe-core
  spec scans the mounted shell; G13's ARIA work is what makes the scan pass.
- Contracts: the perf gate reads G10's `PerfSnapshot` (its p95 timings + budget
  state); the golden manifest's render-mode set mirrors G12's `colourMode`
  options and is **render-only** (changing it must never change a cache key —
  spec §7 A4).

## `src/regression/image_diff.ts`

The exit subject. A pure RGBA comparator: no canvas, no `Image`, no DOM — it
operates on `{ width, height, data: Uint8ClampedArray }` (the shape of
`ImageData`, which the Playwright specs produce via `canvas.toDataURL` →
decode, but which tests build by hand). Two pixels "differ" when their distance
exceeds a per-channel/luma threshold; the verdict is `diffRatio =
differingPixels / totalPixels` against a caller tolerance. An antialias-aware
mode discounts pixels whose neighbours bracket the candidate value, so
sub-pixel sampling jitter on a real GPU does not trip the gate.

```ts
/**
 * Pure, deterministic image comparison for visual-regression goldens.
 *
 * The Playwright specs render a frame and snapshot it; THIS module decides
 * pass/fail. Keeping the decision pure is what lets the exit suite run with no
 * GPU/browser/display — the comparator only ever sees raw RGBA bytes.
 */

/** Minimal raster: identical field layout to the DOM ImageData. */
export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, row-major, length === width*height*4. */
  data: Uint8ClampedArray;
}

export type DiffMetric = 'channel' | 'luma';

export interface CompareOptions {
  /**
   * Max diffRatio (differing px / total px) still considered a pass.
   * e.g. 0.001 = up to 0.1% of pixels may differ.
   */
  tolerance: number;
  /**
   * Per-pixel colour distance (0..255 scale) at/below which two pixels are
   * "the same". Absorbs dithering and 8-bit rounding. Default 8.
   */
  pixelThreshold?: number;
  /** 'channel' = max abs per-channel delta; 'luma' = Rec.601 luma delta. */
  metric?: DiffMetric;
  /**
   * Discount pixels that look like antialiasing: a differing pixel whose
   * 4-neighbourhood in BOTH images contains a value bracketing it is treated
   * as AA jitter and not counted. Default true.
   */
  ignoreAntialiasing?: boolean;
  /** Treat alpha as a compared channel (default true; false ignores alpha). */
  compareAlpha?: boolean;
}

export interface CompareResult {
  /** differingPixels / totalPixels. */
  diffRatio: number;
  /** Count of pixels that exceeded the threshold (post-AA discount). */
  differingPixels: number;
  totalPixels: number;
  /** diffRatio <= tolerance. */
  passed: boolean;
  /**
   * RGBA mask: differing pixels painted opaque magenta, others transparent.
   * Same dimensions as the inputs; for artifact upload / human triage.
   */
  diffMask: RasterImage;
}

export class DimensionMismatchError extends Error {
  constructor(
    public readonly a: { width: number; height: number },
    public readonly b: { width: number; height: number },
  ) {
    super(
      `image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
    this.name = 'DimensionMismatchError';
  }
}

const REC601 = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

/** Per-pixel distance on the chosen metric (0..255). Pure. */
function pixelDistance(
  a: Uint8ClampedArray, b: Uint8ClampedArray, i: number,
  metric: DiffMetric, compareAlpha: boolean,
): number {
  const dr = Math.abs(a[i]! - b[i]!);
  const dg = Math.abs(a[i + 1]! - b[i + 1]!);
  const db = Math.abs(a[i + 2]! - b[i + 2]!);
  const da = compareAlpha ? Math.abs(a[i + 3]! - b[i + 3]!) : 0;
  if (metric === 'luma') {
    return Math.max(
      Math.abs(REC601(a[i]!, a[i + 1]!, a[i + 2]!) -
               REC601(b[i]!, b[i + 1]!, b[i + 2]!)),
      da,
    );
  }
  return Math.max(dr, dg, db, da);
}

/**
 * Antialias heuristic (as-built — the draft's min(aToB,bToA) OR-logic plus a
 * selfDist ≤ 3×threshold guard failed its own edge-shift test on a hard
 * black/white edge): a differing pixel is treated as edge jitter iff BOTH
 * values already exist in the other image's immediate neighbourhood — some
 * neighbour in A matches B's centre value AND some neighbour in B matches
 * A's centre value, which is exactly what a sub-pixel edge shift produces.
 * A solid colour flip fails the first bracket (the new colour has no support
 * anywhere in A's neighbourhood) and is always counted.
 */
function looksLikeAntialiasing(
  a: RasterImage, b: RasterImage, x: number, y: number,
  metric: DiffMetric, compareAlpha: boolean, threshold: number,
): boolean {
  const idx = (xx: number, yy: number): number => (yy * a.width + xx) * 4;
  const here = idx(x, y);
  const neigh: [number, number][] = [
    [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
  ];
  let bValueInA = false;   // some A-neighbour ≈ B's centre value
  let aValueInB = false;   // some B-neighbour ≈ A's centre value
  for (const [nx, ny] of neigh) {
    if (nx < 0 || ny < 0 || nx >= a.width || ny >= a.height) continue;
    const ni = idx(nx, ny);
    if (pixelDistanceCross(a.data, b.data, ni, here, metric, compareAlpha) <= threshold) {
      bValueInA = true;
    }
    if (pixelDistanceCross(b.data, a.data, ni, here, metric, compareAlpha) <= threshold) {
      aValueInB = true;
    }
    if (bValueInA && aValueInB) return true;
  }
  return false;
}

/** Distance between A.data[ia..] and B.data[ib..]. */
function pixelDistanceCross(
  src: Uint8ClampedArray, dst: Uint8ClampedArray, ia: number, ib: number,
  metric: DiffMetric, compareAlpha: boolean,
): number {
  const dr = Math.abs(src[ia]! - dst[ib]!);
  const dg = Math.abs(src[ia + 1]! - dst[ib + 1]!);
  const db = Math.abs(src[ia + 2]! - dst[ib + 2]!);
  const da = compareAlpha ? Math.abs(src[ia + 3]! - dst[ib + 3]!) : 0;
  if (metric === 'luma') {
    return Math.max(
      Math.abs(REC601(src[ia]!, src[ia + 1]!, src[ia + 2]!) -
               REC601(dst[ib]!, dst[ib + 1]!, dst[ib + 2]!)),
      da,
    );
  }
  return Math.max(dr, dg, db, da);
}

/**
 * Compare two equal-dimension RGBA rasters. Throws DimensionMismatchError if
 * sizes differ (a size change is never a "tolerable" diff — it is a bug).
 */
export function compareImages(
  a: RasterImage, b: RasterImage, opts: CompareOptions,
): CompareResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new DimensionMismatchError(a, b);
  }
  const metric = opts.metric ?? 'channel';
  const threshold = opts.pixelThreshold ?? 8;
  const compareAlpha = opts.compareAlpha ?? true;
  const ignoreAA = opts.ignoreAntialiasing ?? true;

  const totalPixels = a.width * a.height;
  const mask = new Uint8ClampedArray(totalPixels * 4); // zero-filled = transparent
  let differingPixels = 0;

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const dist = pixelDistance(a.data, b.data, i, metric, compareAlpha);
      if (dist <= threshold) continue;
      if (ignoreAA &&
          looksLikeAntialiasing(a, b, x, y, metric, compareAlpha, threshold)) {
        continue;
      }
      differingPixels++;
      mask[i] = 255;       // R
      mask[i + 1] = 0;     // G
      mask[i + 2] = 255;   // B (magenta)
      mask[i + 3] = 255;   // A (opaque)
    }
  }

  const diffRatio = totalPixels === 0 ? 0 : differingPixels / totalPixels;
  return {
    diffRatio,
    differingPixels,
    totalPixels,
    passed: diffRatio <= opts.tolerance,
    diffMask: { width: a.width, height: a.height, data: mask },
  };
}
```

## `src/regression/golden_manifest.ts`

One golden per **render mode** (G12's `colourMode` set). The manifest is the
single source of truth the Playwright spec iterates and the unit validator
checks. `validateManifest` is pure — it asserts coverage (every declared mode
has exactly one golden, no duplicate ids, no duplicate file paths) so a new
render mode cannot be added without a golden, and a typo cannot point two modes
at one PNG.

```ts
/**
 * Golden-image manifest: one entry per render (colour) mode. Render modes are
 * RENDER-ONLY (spec §7 A4) — switching them must never change the compute
 * payload — so a golden per mode is exactly the right granularity: the same
 * deterministic SimResult, recoloured.
 */

/** Mirrors G12 mountRenderControls COLOUR_MODES exactly — all SEVEN (the
 *  draft omitted min_pair_dist while claiming to mirror the panel). The
 *  `satisfies readonly ColourMode[]` pin makes the next drift a type error. */
export const RENDER_MODES = [
  'event_class',
  'energy',
  'ang_momentum',
  'escape_time',
  'min_pair_dist',
  'shape_sphere_vmf',
  'stability_x_hue',
] as const satisfies readonly ColourMode[];

export type RenderMode = (typeof RENDER_MODES)[number];

export interface GoldenEntry {
  /** Stable id == render mode. */
  id: RenderMode;
  /** Path (relative to test/fixtures/golden) of the committed PNG. */
  file: string;
  /**
   * Deterministic seed/view used to render this golden. The Playwright spec
   * applies it verbatim so the captured frame is reproducible.
   */
  seed: number;
  /** Per-mode diff tolerance (some palettes dither more than others). */
  tolerance: number;
}

/**
 * The committed manifest. Every render mode appears exactly once. Tolerances
 * are deliberately tight; bump only with a justification in review.
 */
export const GOLDEN_MANIFEST: readonly GoldenEntry[] = [
  { id: 'event_class',      file: 'event_class.png',      seed: 1, tolerance: 0.001 },
  { id: 'energy',           file: 'energy.png',           seed: 1, tolerance: 0.002 },
  { id: 'ang_momentum',     file: 'ang_momentum.png',     seed: 1, tolerance: 0.002 },
  { id: 'escape_time',      file: 'escape_time.png',      seed: 1, tolerance: 0.002 },
  { id: 'min_pair_dist',    file: 'min_pair_dist.png',    seed: 1, tolerance: 0.002 },
  { id: 'shape_sphere_vmf', file: 'shape_sphere_vmf.png', seed: 1, tolerance: 0.003 },
  { id: 'stability_x_hue',  file: 'stability_x_hue.png',  seed: 1, tolerance: 0.003 },
];

export interface ManifestProblem {
  kind: 'missing-mode' | 'extra-id' | 'duplicate-id' | 'duplicate-file' | 'bad-tolerance';
  detail: string;
}

/**
 * Pure validator. Returns the list of problems (empty == valid):
 *  - every RENDER_MODES entry has exactly one manifest entry (coverage);
 *  - no manifest id is unknown or duplicated;
 *  - no two entries share a file path;
 *  - every tolerance is in (0, 1).
 */
export function validateManifest(
  manifest: readonly GoldenEntry[] = GOLDEN_MANIFEST,
): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const ids = manifest.map(e => e.id);
  const seenId = new Set<string>();
  const seenFile = new Set<string>();

  for (const e of manifest) {
    if (!RENDER_MODES.includes(e.id)) {
      problems.push({ kind: 'extra-id', detail: `unknown render mode '${e.id}'` });
    }
    if (seenId.has(e.id)) {
      problems.push({ kind: 'duplicate-id', detail: `render mode '${e.id}' appears twice` });
    }
    seenId.add(e.id);
    if (seenFile.has(e.file)) {
      problems.push({ kind: 'duplicate-file', detail: `file '${e.file}' used by two entries` });
    }
    seenFile.add(e.file);
    if (!(e.tolerance > 0 && e.tolerance < 1)) {
      problems.push({ kind: 'bad-tolerance', detail: `'${e.id}' tolerance ${e.tolerance} not in (0,1)` });
    }
  }

  for (const mode of RENDER_MODES) {
    if (!ids.includes(mode)) {
      problems.push({ kind: 'missing-mode', detail: `no golden for render mode '${mode}'` });
    }
  }
  return problems;
}

/** Convenience: lookup an entry, throwing if absent (specs want a hard fail). */
export function goldenFor(mode: RenderMode): GoldenEntry {
  const e = GOLDEN_MANIFEST.find(x => x.id === mode);
  if (!e) throw new Error(`no golden entry for render mode '${mode}'`);
  return e;
}
```

## `src/regression/perf_gate.ts`

A pure regression classifier over G10's `PerfSnapshot`. It compares a captured
snapshot to a committed baseline and fails if any tracked metric regresses by
more than an allowed factor (default +25%) — or if the captured `budget` state
worsens. It does **not** measure anything itself (that is the Playwright spec's
job via G10's `PerfMonitor`); it only judges, so it is fully unit-testable.

```ts
import type { PerfSnapshot } from '@/perf/perf_monitor.js';

/** The committed baseline shape (a subset of PerfSnapshot we gate on). */
export interface PerfBaseline {
  cpuP95Ms: number;
  /** Per-pass GPU p95 (ms); keys match G10 GpuPassTimings. */
  gpuP95Ms: Record<string, number>;
  /** Worst budget state tolerated in the baseline run. */
  budget: PerfSnapshot['budget'];
}

export interface PerfGateOptions {
  /** Allowed fractional regression before failing. 0.25 = +25%. */
  allowedRegression?: number;
  /** Absolute floor (ms) below which deltas are noise, not regressions. */
  noiseFloorMs?: number;
}

export interface PerfRegression {
  metric: string;        // 'cpuP95Ms' | `gpu:${pass}` | 'budget'
  baseline: number | string;
  observed: number | string;
  factor?: number;       // observed/baseline for numeric metrics
}

export interface PerfGateResult {
  passed: boolean;
  regressions: PerfRegression[];
}

const BUDGET_RANK: Record<PerfSnapshot['budget'], number> = {
  ok: 0, over: 1, sustained: 2,
};

/**
 * Pure perf-regression gate. Compares `observed` to `baseline`:
 *  - each numeric metric fails if observed > baseline*(1+allowedRegression)
 *    AND the absolute delta exceeds noiseFloorMs;
 *  - `budget` fails if the observed state is strictly worse than the baseline's.
 * GPU passes present in observed but not baseline are ignored (timestamp-query
 * may be unavailable on a given runner — G9/G10 contract).
 */
export function checkPerf(
  observed: PerfSnapshot,
  baseline: PerfBaseline,
  opts: PerfGateOptions = {},
): PerfGateResult {
  const allowed = opts.allowedRegression ?? 0.25;
  const noise = opts.noiseFloorMs ?? 0.2;
  const regressions: PerfRegression[] = [];

  const judgeNumeric = (
    metric: string, base: number, obs: number,
  ): void => {
    const ceiling = base * (1 + allowed);
    if (obs > ceiling && obs - base > noise) {
      regressions.push({ metric, baseline: base, observed: obs, factor: obs / base });
    }
  };

  judgeNumeric('cpuP95Ms', baseline.cpuP95Ms, observed.cpuP95Ms);

  for (const [pass, base] of Object.entries(baseline.gpuP95Ms)) {
    const obs = observed.gpuP95Ms[pass as keyof typeof observed.gpuP95Ms];
    if (typeof obs === 'number') judgeNumeric(`gpu:${pass}`, base, obs);
  }

  if (BUDGET_RANK[observed.budget] > BUDGET_RANK[baseline.budget]) {
    regressions.push({
      metric: 'budget',
      baseline: baseline.budget,
      observed: observed.budget,
    });
  }

  return { passed: regressions.length === 0, regressions };
}
```

## `playwright.config.ts` (modified — additions to G8)

**As-built.** ONE project is active at a time, selected by `PW_REAL_GPU=1`
(the draft's two-simultaneous-projects layout would have run every spec twice
under a single global args switch — misleading and 2× the wall clock). The
landed G8 launch args (`--enable-unsafe-swiftshader`; there is no
`--use-vulkan=swiftshader` in the landed config) and the **`webServer` block
the draft dropped** are kept. `workers: 1` is load-bearing: every spec
contends for the same physical GPU, and parallel workers skew the perf gate's
timings and starve the compositor.

```ts
import { defineConfig } from '@playwright/test';

const REAL_GPU = process.env['PW_REAL_GPU'] === '1';

const SWIFTSHADER_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
];
// Real GPU: drop the swiftshader override so Chromium picks the hardware adapter.
const REAL_GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--no-sandbox',
];

export default defineConfig({
  testDir: './test/gpu',
  timeout: 300_000,
  fullyParallel: false,
  // ONE worker: every spec contends for the same physical GPU — parallel
  // workers skew the perf gate's timings and starve the compositor.
  workers: 1,
  use: {
    headless: true,
    launchOptions: {
      args: REAL_GPU ? REAL_GPU_ARGS : SWIFTSHADER_ARGS,
    },
  },
  projects: [
    REAL_GPU
      ? { name: 'chromium-real-webgpu' }
      : { name: 'chromium-swiftshader' },
  ],
  webServer: {
    command: 'npx vite dev --port 5197 --strictPort',
    port: 5197,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

## `.github/workflows/acceptance.yml` (modified — patches to G8)

One real change — and less than the draft assumed: the landed G8 workflow
**already** has `spec_section_7` (CPU-only, un-gated) and
`webgpu_swiftshader_smoke` (label/nightly-gated; there was never a
`webgpu_integration` job to split). G14 adds ONE job. The smoke job now also
carries the axe a11y gate for free (it runs `npm run test:gpu`, and the a11y
spec is backend-independent; the visual/perf specs self-skip there).

```yaml
  real_gpu_regression:
    # G14: nightly schedule OR an explicit `real-gpu` PR label — NOT
    # needs-gpu. Visual goldens + the perf baseline bind only on the
    # real-GPU reference runner; on a GPU-less hosted runner the visual
    # and perf specs self-skip (blank-compositor / PW_REAL_GPU guards)
    # and the job still enforces the pure regression gates.
    # Swap runs-on to a self-hosted GPU runner to arm the pixel/perf gates.
    if: >-
      github.event_name == 'schedule' ||
      (github.event_name == 'pull_request' &&
       contains(github.event.pull_request.labels.*.name, 'real-gpu'))
    runs-on: ubuntu-latest
    env:
      PW_REAL_GPU: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      # The pure gates run everywhere — they are the regression floor.
      - run: npm test -- --run test/unit/regression
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --project=chromium-real-webgpu
      - name: Upload diff artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: visual-diffs
          path: test/fixtures/golden/*.diff.png
          if-no-files-found: ignore
```

> Nothing in G8's `ci.yml` (unit / integration / golden) changes. The diff
> masks (`*.diff.png`) are gitignored and only surface as CI artifacts.

## `test/fixtures/perf/baseline.json`

The committed perf baseline the gate compares against. Captured once on the
reference runner (G10 `PerfMonitor.snapshot()` after a warm window), reviewed,
and bumped deliberately. CPU p95 mirrors G8's frame budget table (Balanced
< 16 ms); GPU pass p95s are present only when timestamp-query was available.

As-built (captured on the Metal reference machine via `PW_UPDATE_PERF=1`; the
draft's 14 ms/9.5 ms figures were aspirational — the landed loop's CPU cost is
sub-millisecond and `simulate` dominates during convergence):

```json
{
  "cpuP95Ms": 0.4,
  "gpuP95Ms": {
    "simulate": 27.99,
    "reduce": 0.02,
    "reduce_spreads": 0.02,
    "render": 0.42
  },
  "budget": "ok"
}
```

## Tests

### `test/unit/regression/image_diff.test.ts` (EXIT suite)

```ts
import { describe, it, expect } from 'vitest';
import {
  compareImages, DimensionMismatchError, type RasterImage,
} from '@/regression/image_diff.js';
import {
  validateManifest, GOLDEN_MANIFEST, RENDER_MODES, goldenFor,
} from '@/regression/golden_manifest.js';

/** Build a solid-colour raster. */
function solid(w: number, h: number, rgba: [number, number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width: w, height: h, data };
}

/** Clone then poke one pixel to a new colour. */
function withPixel(
  img: RasterImage, x: number, y: number, rgba: [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(img.data);
  const i = (y * img.width + x) * 4;
  data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  return { width: img.width, height: img.height, data };
}

describe('compareImages: identity & tolerance', () => {
  it('identical images → zero diff, passes', () => {
    const a = solid(8, 8, [10, 20, 30, 255]);
    const r = compareImages(a, solid(8, 8, [10, 20, 30, 255]), { tolerance: 0 });
    expect(r.diffRatio).toBe(0);
    expect(r.differingPixels).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('single big-delta pixel below tolerance → passes', () => {
    const a = solid(10, 10, [0, 0, 0, 255]);            // 100 px
    const b = withPixel(a, 5, 5, [255, 255, 255, 255]); // 1 differing → 0.01
    const r = compareImages(a, b, { tolerance: 0.02, ignoreAntialiasing: false });
    expect(r.differingPixels).toBe(1);
    expect(r.diffRatio).toBeCloseTo(0.01, 6);
    expect(r.passed).toBe(true);
  });

  it('single big-delta pixel above tolerance → fails', () => {
    const a = solid(10, 10, [0, 0, 0, 255]);
    const b = withPixel(a, 5, 5, [255, 255, 255, 255]);
    const r = compareImages(a, b, { tolerance: 0.005, ignoreAntialiasing: false });
    expect(r.passed).toBe(false);
  });

  it('sub-threshold per-channel noise is NOT counted', () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    const b = solid(4, 4, [104, 96, 100, 255]); // max |Δ|=4 ≤ default 8
    const r = compareImages(a, b, { tolerance: 0 });
    expect(r.differingPixels).toBe(0);
    expect(r.passed).toBe(true);
  });
});

describe('compareImages: metrics & channels', () => {
  it('luma metric ignores equal-luma colour swaps that channel flags', () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    // Shift R up / B down keeping luma close; channel sees Δ=40, luma sees ~ small.
    const b = solid(4, 4, [140, 100, 60, 255]);
    const chan = compareImages(a, b, { tolerance: 0, metric: 'channel' });
    const luma = compareImages(a, b, { tolerance: 0, metric: 'luma' });
    expect(chan.differingPixels).toBeGreaterThan(luma.differingPixels);
  });

  it('compareAlpha:false ignores an alpha-only difference', () => {
    const a = solid(4, 4, [10, 10, 10, 255]);
    const b = solid(4, 4, [10, 10, 10, 0]);
    expect(compareImages(a, b, { tolerance: 0, compareAlpha: true }).differingPixels)
      .toBeGreaterThan(0);
    expect(compareImages(a, b, { tolerance: 0, compareAlpha: false }).differingPixels)
      .toBe(0);
  });

  it('produces a magenta diff mask exactly where pixels differ', () => {
    const a = solid(3, 1, [0, 0, 0, 255]);
    const b = withPixel(a, 1, 0, [255, 255, 255, 255]);
    const r = compareImages(a, b, { tolerance: 1, ignoreAntialiasing: false });
    const m = r.diffMask.data;
    expect([m[0], m[1], m[2], m[3]]).toEqual([0, 0, 0, 0]);         // px0 transparent
    expect([m[4], m[5], m[6], m[7]]).toEqual([255, 0, 255, 255]);   // px1 magenta
    expect([m[8], m[9], m[10], m[11]]).toEqual([0, 0, 0, 0]);       // px2 transparent
  });
});

describe('compareImages: antialiasing discount', () => {
  it('discounts an edge-shift pixel but counts a solid colour flip', () => {
    // A: left half black, right half white (a vertical edge at x=2).
    const w = 4, h = 1;
    const a: RasterImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let x = 0; x < w; x++) {
      const v = x < 2 ? 0 : 255;
      const i = x * 4;
      a.data[i] = v; a.data[i + 1] = v; a.data[i + 2] = v; a.data[i + 3] = 255;
    }
    // B: edge shifted by one pixel (x=1 now white) — pure AA jitter.
    const bShift = withPixel(a, 1, 0, [255, 255, 255, 255]);
    const aaOn = compareImages(a, bShift, { tolerance: 0, ignoreAntialiasing: true });
    expect(aaOn.differingPixels).toBe(0); // bracketed by a white neighbour → discounted

    // B': a lone pixel in the solid-black region flips white (NOT an edge).
    const bFlip = withPixel(solid(4, 1, [0, 0, 0, 255]), 0, 0, [255, 255, 255, 255]);
    const flip = compareImages(
      solid(4, 1, [0, 0, 0, 255]), bFlip, { tolerance: 0, ignoreAntialiasing: true });
    expect(flip.differingPixels).toBe(1);
  });
});

describe('compareImages: dimension mismatch', () => {
  it('throws DimensionMismatchError on size mismatch', () => {
    const a = solid(4, 4, [0, 0, 0, 255]);
    const b = solid(4, 5, [0, 0, 0, 255]);
    expect(() => compareImages(a, b, { tolerance: 1 })).toThrow(DimensionMismatchError);
  });

  it('empty image (0x0) compares clean', () => {
    const a: RasterImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const r = compareImages(a, a, { tolerance: 0 });
    expect(r.diffRatio).toBe(0);
    expect(r.passed).toBe(true);
  });
});

describe('golden manifest: coverage validator', () => {
  it('the committed manifest is valid (one golden per render mode)', () => {
    expect(validateManifest()).toEqual([]);
  });

  it('every render mode resolves to an entry', () => {
    for (const mode of RENDER_MODES) {
      expect(goldenFor(mode).id).toBe(mode);
    }
    expect(GOLDEN_MANIFEST).toHaveLength(RENDER_MODES.length);
  });

  it('flags a missing render mode', () => {
    const partial = GOLDEN_MANIFEST.filter(e => e.id !== 'energy');
    const probs = validateManifest(partial);
    expect(probs.some(p => p.kind === 'missing-mode' && /energy/.test(p.detail))).toBe(true);
  });

  it('flags a duplicate file path', () => {
    const dup = [
      ...GOLDEN_MANIFEST,
      { id: 'energy' as const, file: 'event_class.png', seed: 1, tolerance: 0.001 },
    ];
    const probs = validateManifest(dup);
    expect(probs.some(p => p.kind === 'duplicate-file')).toBe(true);
    expect(probs.some(p => p.kind === 'duplicate-id')).toBe(true);
  });

  it('flags an out-of-range tolerance', () => {
    const bad = GOLDEN_MANIFEST.map(e =>
      e.id === 'energy' ? { ...e, tolerance: 1.5 } : e);
    expect(validateManifest(bad).some(p => p.kind === 'bad-tolerance')).toBe(true);
  });
});
```

### `test/unit/regression/perf_gate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { checkPerf, type PerfBaseline } from '@/regression/perf_gate.js';
import type { PerfSnapshot } from '@/perf/perf_monitor.js';

const baseline: PerfBaseline = {
  cpuP95Ms: 14,
  gpuP95Ms: { simulate: 9.5, reduce: 0.8 },
  budget: 'ok',
};

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  frames: 600,
  cpuMeanMs: 12,
  cpuP95Ms: 14,
  gpuP95Ms: { simulate: 9.5, reduce: 0.8 },
  gpuTimingAvailable: true,
  budget: 'ok',
  overFraction: 0,
  ...over,
});

describe('checkPerf: regression classifier', () => {
  it('a matching snapshot passes', () => {
    expect(checkPerf(snap(), baseline).passed).toBe(true);
  });

  it('within +25% (default) is tolerated', () => {
    const r = checkPerf(snap({ cpuP95Ms: 17 }), baseline); // 17/14 = 1.21
    expect(r.passed).toBe(true);
  });

  it('a >25% CPU regression fails and is reported', () => {
    const r = checkPerf(snap({ cpuP95Ms: 20 }), baseline); // 20/14 = 1.43
    expect(r.passed).toBe(false);
    expect(r.regressions[0]!.metric).toBe('cpuP95Ms');
    expect(r.regressions[0]!.factor!).toBeGreaterThan(1.25);
  });

  it('a per-pass GPU regression is caught with the gpu: prefix', () => {
    const r = checkPerf(snap({ gpuP95Ms: { simulate: 13, reduce: 0.8 } }), baseline);
    expect(r.passed).toBe(false);
    expect(r.regressions.some(x => x.metric === 'gpu:simulate')).toBe(true);
  });

  it('a worsened budget state fails even if timings match', () => {
    const r = checkPerf(snap({ budget: 'over' }), baseline);
    expect(r.passed).toBe(false);
    expect(r.regressions.some(x => x.metric === 'budget')).toBe(true);
  });

  it('an improved budget state passes', () => {
    const r = checkPerf(snap({ budget: 'ok' }), { ...baseline, budget: 'over' });
    expect(r.passed).toBe(true);
  });

  it('tiny deltas under the noise floor are not regressions', () => {
    const r = checkPerf(snap({ cpuP95Ms: 14.1 }), { ...baseline, cpuP95Ms: 0.3 },
      { noiseFloorMs: 0.2, allowedRegression: 0 });
    // 14.1 vs 0.3 is a huge factor, but flip it: small absolute on a small base.
    expect(r.passed).toBe(false); // sanity: this IS a real regression
    const tiny = checkPerf(snap({ cpuP95Ms: 0.35 }), { ...baseline, cpuP95Ms: 0.3 },
      { noiseFloorMs: 0.2, allowedRegression: 0 });
    expect(tiny.passed).toBe(true); // Δ=0.05 < noise floor
  });

  it('a GPU pass missing from the observed snapshot is ignored', () => {
    const r = checkPerf(snap({ gpuP95Ms: { reduce: 0.8 } }), baseline); // no `simulate`
    expect(r.passed).toBe(true);
  });
});
```

### Playwright specs (as-built)

**Gating changed from the draft.** Adapter detection is NOT the right gate for
the visual and perf specs: SwiftShader *is* an adapter, and fractal-boundary
pixels put ~37% of samples in backend disagreement (M3 D3.2) while SwiftShader
frame timings are ~100× hardware — the goldens and the baseline are
**backend-specific**, so those two specs run only under `PW_REAL_GPU=1` (the
real-GPU project) and additionally skip when the compositor screenshot is
blank (DG8.7: an in-page `drawImage` probe reads the CLEARED current texture
even headed, so the only honest presence check is the screenshot raster
itself). The a11y spec runs on BOTH backends — the DOM is identical under
SwiftShader, so it joins the always-on floor.

**Shell hooks changed from the draft.** There is no
`applyGolden`/`renderStable`/`warmAndRun`/`perfSnapshot` on `__principia`.
The specs use the landed surface: `__principia.renderStore.update(...)` for
the render-only mode flip (dev/main.ts now exposes `renderStore`),
`__principia.app.loop.lastStats` convergence polling (the G8 pattern), and
`__principia.app.loop.perf.snapshot()` for the perf capture. Deterministic
"seed" = the `?thorizon=20&n=16` URL knobs + a fixed 1400×1000 viewport.

**Fixture regeneration is env-gated in the specs** (the draft's
`--update-goldens` flag was unspecified):

```bash
PW_REAL_GPU=1 PW_UPDATE_GOLDENS=1 npx playwright test --headed test/gpu/visual_regression.spec.ts
PW_REAL_GPU=1 PW_UPDATE_PERF=1    npx playwright test --headed test/gpu/perf_capture.spec.ts
```

See the three spec files for the full as-built listings
(`test/gpu/{visual_regression,perf_capture,a11y_shell}.spec.ts`); the load-
bearing shapes:

```ts
// visual_regression.spec.ts — per manifest entry:
test.skip(!REAL_GPU, 'goldens are backend-specific — real-GPU project only');
await bootConverged(page);                       // goto + __principia + lastStats poll
await page.evaluate((mode) => {                  // RENDER-ONLY flip (group-3 rebind)
  __principia.renderStore.update(p => ({ ...p, colourMode: mode }));
}, entry.id);
const shot = toRaster(await page.locator('canvas').screenshot());
test.skip(!hasPixels(shot), 'compositor never presented (DG8.7)');
// PW_UPDATE_GOLDENS=1 → write golden; else compareImages(...) and write a
// .diff.png mask on failure (gitignored; uploaded as a CI artifact).

// perf_capture.spec.ts:
test.skip(!REAL_GPU, 'baseline is runner-specific — real-GPU project only');
// converge, settle 3s, then:
const snapshot = await page.evaluate(() => __principia.app.loop.perf.snapshot());
// 2× ceiling: dev-laptop convergence-window GPU p95 jitters ±50% run-to-run;
// tighten toward the +25% default on a dedicated self-hosted runner.
const result = checkPerf(snapshot, baseline, { allowedRegression: 1.0 });

// a11y_shell.spec.ts — BOTH backends (always-on floor):
const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'))
  .toEqual([]);
```

The first axe run failed for real: G12's four selects (`#chart`, `#quality`,
`#colourMode`, `#palette`) had bare `<label>` siblings with no `for=`
association (`select-name`, critical) — only G13's `#cvd` passed via its
`aria-label`. Fixed by associating every panel label (`for=` on chart,
quality, colour mode, palette, cvd, all eight z-sliders, tilt). The gate paid
for itself before it ever reached CI.

## Run it

```bash
# EXIT — pure comparator + manifest validator, no GPU/browser/display:
npm test -- --run test/unit/regression/image_diff

# Both pure gates (comparator + perf classifier):
npm test -- --run test/unit/regression

# Real-browser regression specs (real GPU; visual/perf bind, all 10 run):
PW_REAL_GPU=1 npx playwright test --headed

# Always-on swiftshader floor (shell smoke + axe; visual/perf self-skip):
npm run test:gpu

# Regenerate fixtures on the reference runner:
PW_REAL_GPU=1 PW_UPDATE_GOLDENS=1 npx playwright test --headed test/gpu/visual_regression.spec.ts
PW_REAL_GPU=1 PW_UPDATE_PERF=1    npx playwright test --headed test/gpu/perf_capture.spec.ts
```

## Acceptance check

`test/unit/regression/image_diff.test.ts` passes with ≥12 green tests (**15
as-built**, + 8 perf-gate): identical → zero diff; sub/over-tolerance
single-pixel deltas; channel-vs-luma divergence; alpha opt-out; AA discount
(edge shift ignored, solid flip counted); `DimensionMismatchError`; magenta
diff-mask placement; and `validateManifest()` returning `[]` for the committed
manifest while flagging a missing mode, a duplicate file, and a bad tolerance.
The perf gate suite proves `checkPerf` tolerates +25% / noise-floor deltas but
fails real regressions and budget worsening. `playwright.config.ts` selects
`chromium-real-webgpu` (PW_REAL_GPU=1) or `chromium-swiftshader` (default) —
one at a time; `acceptance.yml` adds the nightly/`real-gpu`-label
`real_gpu_regression` job (§7 stays CPU-only and un-gated).

Live proof on the reference (Metal) runner: 7 committed goldens regenerate
and re-verify 7/7 on fresh boots; the perf gate passes against the committed
baseline; the axe scan found four REAL critical `select-name` violations on
first run (fixed with `for=` label associations) and now passes on both
backends; the full `PW_REAL_GPU=1` run is 10/10 green and the headless
SwiftShader floor is 2 passed / 8 self-skipped.

## Notes for the implementer

- **The verdict is pure on purpose.** The browser produces pixels and timings;
  `compareImages` / `checkPerf` decide. That split is what keeps the exit
  criterion (and the per-PR regression floor) GPU-free and deterministic — never
  push pass/fail logic into a `.spec.ts`. The specs only *gather* and *delegate*.
- **Swiftshader stays the floor, real GPU is the ceiling.** Do not delete G8's
  swiftshader project — it is the always-on smoke that catches "WebGPU init
  threw" on every labelled PR. The real-GPU project is nightly/opt-in because
  hardware runners are scarce and noisier; its specs self-skip (M3 guard + G9
  `detectCapabilities`) so a runner that silently falls back to swiftshader
  degrades to a no-op, not a red build.
- **Goldens are render-only (spec §7 A4).** One golden per `colourMode` is
  correct precisely because switching colour mode must not change the compute
  payload — the same deterministic `SimResult` is recoloured. If a render-mode
  PR has to regenerate a golden, that is expected; if it also changes a cache
  key, A4 is broken and the §7 job should already be red. Regenerate goldens via
  a dedicated `--update-goldens` run on the reference runner, review the PNG diff
  in the PR, and bump `tolerance` only with a written reason.
- **The perf baseline is committed, not measured in the gate.** `baseline.json`
  is captured once on the reference runner from `PerfMonitor.snapshot()` after a
  warm window, then reviewed like code. The gate's `+25%` default and
  `noiseFloorMs` absorb runner jitter; tighten them once you have a stable
  self-hosted GPU runner. GPU passes absent from a snapshot (no timestamp-query
  per G9/G10) are ignored, not failed.
- **AA discount is conservative.** It only forgives a differing pixel that a
  neighbour brackets within threshold — an edge that shifted by sub-pixel
  sampling. A solid colour flip in a flat region is always counted. If real-GPU
  jitter still trips a mode, prefer `metric: 'luma'` or a slightly looser
  per-mode `tolerance` over disabling the AA discount globally.
- **§7 acceptance is CPU-only — and G8 already keeps it off the GPU gate.** G8's
  `spec_section_7` job already runs un-gated on push / PR / nightly; M12's A1–A6
  run entirely on the frozen corpus with no adapter. G14 does not touch that job.
  Reserve `needs-gpu` for the swiftshader smoke and `real-gpu` for the nightly
  regression job — never gate the CPU-only §7 suite on either.
- **a11y is a contract with G13.** The axe scan asserts the ARIA work in G13
  (`buildAria`/`applyAria`, roving tabindex, live-region announce) actually
  reaches the DOM. If the scan flags a control, fix the markup in G12's mount
  functions or G13's `aria.ts` — never add an axe rule exclusion to make it
  green.
