import type { TrajState } from '@/math/types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { InspectorResult } from '@/inspector/types.js';

/** Per-frame timing/scheduling hooks. Callers fill these from real
 *  hardware (performance.now / requestAnimationFrame); tests fill them
 *  from synthetic stubs so ticks are deterministic. */
export interface FrameDeps {
  now:      () => number;
  schedule: (cb: () => void) => number;   // requestAnimationFrame
  cancel:   (id: number) => void;         // cancelAnimationFrame
}

/** Pluggable GPU dispatcher. The real impl wires through M3/M5/M7. */
export interface GpuDispatcher {
  /** Submit a tile compute + reduction job. Returns a promise that
   *  resolves with the tile's TileReduction. The same promise resolves
   *  even if the tile scrolls offscreen — the caller drops the result
   *  (WebGPU dispatches cannot be aborted; cancellation is logical). */
  dispatchTile(tileId: TileID, view: ViewState): Promise<TileReduction>;

  /** Notify that queued/in-flight work for these tiles is no longer
   *  wanted (their results will be discarded on completion). */
  cancel(tileIds: readonly TileID[]): void;

  /** Render the frontier into the canvas. */
  render(plan: RenderPlan): void;

  /** Run one IC through the inspector pipeline at f64. */
  inspect(view: ViewState, ic: TrajState): Promise<InspectorResult>;
}

export interface RenderPlanEntry {
  tile:      TileID;
  source:    'self' | 'ancestor';
  ancestor?: TileID;             // when source = 'ancestor'
  /** Sub-rect within the ancestor texture, [u0, v0, u1, v1]. */
  subrect?:  [number, number, number, number];
}

export interface RenderPlan {
  view:    ViewState;
  entries: RenderPlanEntry[];
}

export interface FrameStats {
  frame:           number;
  visible:         number;
  cacheHits:       number;
  ancestorFalls:   number;
  jobsDispatched:  number;
  jobsCompleted:   number;
  cpuMs:           number;
}
