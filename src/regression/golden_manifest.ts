/**
 * Golden-image manifest: one entry per render (colour) mode. Render modes are
 * RENDER-ONLY (spec §7 A4) — switching them must never change the compute
 * payload — so a golden per mode is exactly the right granularity: the same
 * deterministic SimResult, recoloured.
 *
 * Goldens are BACKEND-SPECIFIC: fractal basin boundaries put ~37% of pixels
 * in backend disagreement between SwiftShader and hardware (M3's D3.2
 * calibration), so the committed goldens are captured on the reference
 * real-GPU runner and the visual spec only runs under the real-GPU project.
 */
import type { ColourMode } from '@/render/types.js';

/** Mirrors G12 mountRenderControls COLOUR_MODES exactly (all seven). */
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
   * Deterministic view knobs used to render this golden (the ?thorizon=&n=
   * URL params the spec applies verbatim so the frame is reproducible).
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
