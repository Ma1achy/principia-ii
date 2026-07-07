import type { CapturedFrame } from '@/debug/frame_capture.js';   // G17 base record
import { captureFrame } from '@/debug/frame_capture.js';
import type { ViewState } from '@/interact/view_state.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';
import { serialiseCacheKey } from '@/quadtree/cache_key.js';
import { jitterOffsets } from '@/quadtree/ensemble_jitter.js';
import type { LastDispatch } from '@/app/dispatcher.js';

/** Resolved sub-pixel jitter seed (one per ensemble copy). */
export interface SeedOffset { du: number; dv: number }

/** The ensemble seeding needed to replay a frame's sub-pixel jitter (G7).
 *  The input is structural ({E, patternId}) — there is no EnsembleConfig
 *  type in @/gpu/ensemble.js; G7 carries E/patternId in the TileRequest. */
export interface EnsembleSeeds {
  E: number;
  patternId: 0 | 1 | 2;
  offsets: SeedOffset[];
}

/**
 * G18's widened capture: G17's base frame record plus everything needed to
 * reconstruct the *inputs* — the full ViewState (M8) and the ensemble
 * seeds (G7). `cacheKey` is captured alongside so a replay can assert it
 * lands on the same tile signature without re-deriving it.
 */
export interface FrameCaptureV2 extends CapturedFrame {
  view: ViewState;
  cacheKey: string;   // serialiseCacheKey(viewStateToCacheKey(view))
  seeds: EnsembleSeeds;
}

/** Snapshot the ensemble seeds for a (patternId, E) pair (G7 jitter). */
export function captureSeeds(cfg: { E: number; patternId: 0 | 1 | 2 }): EnsembleSeeds {
  const offsets = jitterOffsets(cfg.patternId, Math.max(1, cfg.E))
    .map(o => ({ du: o.du, dv: o.dv }));
  return { E: cfg.E, patternId: cfg.patternId, offsets };
}

/**
 * Widen a G17 base capture with the current ViewState + ensemble seeds.
 * Pure — pass it the base record (from G17's captureFrame), the live view,
 * and the ensemble config; it never reads the GPU or the DOM.
 */
export function extendCapture(
  base: CapturedFrame, view: ViewState, cfg: { E: number; patternId: 0 | 1 | 2 },
): FrameCaptureV2 {
  return {
    ...base,
    view,
    cacheKey: serialiseCacheKey(viewStateToCacheKey(view)),
    seeds: captureSeeds(cfg),
  };
}

/**
 * Build a live FrameCaptureV2 from the dispatcher's last dispatch and the
 * current view (the G18 capture button's one-call glue). Pure: G17's
 * captureFrame over the dispatch inputs, widened with the view + the seeds
 * regenerated from the tile's own (patternId, E). Returns null when nothing
 * has been dispatched yet.
 */
export function liveCaptureFrom(
  d: LastDispatch | null, view: ViewState, label = 'live',
): FrameCaptureV2 | null {
  if (!d) return null;
  return extendCapture(
    captureFrame(d.N, d.M, d.uniforms, d.tile, d.chart, label),
    view,
    // G7 carries E/patternId in the TileRequest's spare lanes; a request
    // without them is a plain E=1 dispatch.
    {
      E: d.tile.ensemble_e ?? 1,
      patternId: (d.tile.sample_pattern_id ?? 0) as 0 | 1 | 2,
    },
  );
}

/**
 * Verify a V2 capture is internally consistent for replay: its cacheKey
 * matches its view, and its seed table matches its declared (patternId, E).
 * Returns the list of mismatches (empty ⇒ replayable). The jitter is
 * REGENERATED from (patternId, E) and compared exactly — if either the key
 * or the seeds differ, the capture is stale and won't replay
 * deterministically.
 */
export function checkCaptureReplayable(cap: FrameCaptureV2): string[] {
  const problems: string[] = [];
  if (serialiseCacheKey(viewStateToCacheKey(cap.view)) !== cap.cacheKey) {
    problems.push('cacheKey does not match captured ViewState');
  }
  const expected = jitterOffsets(cap.seeds.patternId, Math.max(1, cap.seeds.E));
  if (expected.length !== cap.seeds.offsets.length) {
    problems.push('seed count does not match (patternId, E)');
  } else {
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i]!;
      const got = cap.seeds.offsets[i]!;
      if (e.du !== got.du || e.dv !== got.dv) {
        problems.push(`seed ${i} differs from regenerated jitter`);
        break;
      }
    }
  }
  return problems;
}
