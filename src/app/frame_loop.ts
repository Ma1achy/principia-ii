import type { FrameDeps, FrameStats, GpuDispatcher,
              RenderPlan, RenderPlanEntry } from './types.js';
import type { Store } from './store.js';
import { JobLedger } from './gpu_jobs.js';
import { toQuadtreeView, DEFAULT_VIEWPORT, type Viewport } from './view_bridge.js';
import { TileCache } from '@/quadtree/cache.js';
import { visibleTiles } from '@/quadtree/visible.js';
import { subrect } from '@/quadtree/tile.js';
import { planFrame } from '@/quadtree/scheduler.js';

export interface FrameLoopOpts {
  frameBudget:     number;    // max compute jobs per frame (tile-jobs, not ms)
  maxInFlight:     number;
  ftleEnabled:     boolean;
  ensembleEnabled: boolean;
  viewport?:       Viewport;
  cacheCapacity?:  number;
}

/**
 * The per-frame body: read view → plan render (self or stretched
 * ancestor, so the screen never blanks) → schedule compute via M5's
 * planFrame → logically cancel offscreen work → render.
 *
 * A class, not a function: the loop holds long-lived state (cache,
 * in-flight ledger, rAF id) across many invocations, and tests call
 * tickOnce() deterministically without driving the rAF schedule.
 */
export class FrameLoop {
  readonly cache: TileCache;
  readonly ledger: JobLedger;
  /** Stats of the most recent tick (null before the first). Read-only
   *  telemetry for HUDs and headless checks. */
  lastStats: FrameStats | null = null;
  private frameNum = 0;
  private running = false;
  private rafId = 0;
  private viewport: Viewport;

  constructor(
    private store:      Store,
    private dispatcher: GpuDispatcher,
    private deps:       FrameDeps,
    private opts:       FrameLoopOpts,
  ) {
    this.viewport = opts.viewport ?? DEFAULT_VIEWPORT;
    this.cache = new TileCache(opts.cacheCapacity ?? 256);
    this.ledger = new JobLedger(dispatcher, this.cache, {
      maxInFlight:     opts.maxInFlight,
      ftleEnabled:     opts.ftleEnabled,
      ensembleEnabled: opts.ensembleEnabled,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.deps.cancel(this.rafId);
  }

  /** One frame. Public for testing / single-step harnesses. */
  tickOnce(): FrameStats {
    const t0 = this.deps.now();
    this.frameNum++;
    const view = this.store.snapshot();
    const completedBefore = this.ledger.completedCount;
    const stats: FrameStats = {
      frame: this.frameNum, visible: 0,
      cacheHits: 0, ancestorFalls: 0,
      jobsDispatched: 0, jobsCompleted: 0,
      cpuMs: 0,
    };

    const qview = toQuadtreeView(view, this.viewport);
    const visible = visibleTiles(qview);
    stats.visible = visible.length;

    // Render plan: each visible tile draws itself when ready, else the
    // nearest cached ancestor stretched over its footprint.
    const entries: RenderPlanEntry[] = [];
    for (const tile of visible) {
      const cached = this.cache.get(tile, qview.cacheKey);
      if (cached?.lifecycle === 'ready' || cached?.lifecycle === 'readyRefinable') {
        entries.push({ tile, source: 'self' });
        stats.cacheHits++;
        continue;
      }
      const fb = this.cache.walkAncestors(tile, qview.cacheKey);
      if (fb) {
        entries.push({
          tile, source: 'ancestor',
          ancestor: fb.ancestor,
          subrect: subrect(fb.ancestor, tile),
        });
        stats.ancestorFalls++;
      }
    }
    const plan: RenderPlan = { view, entries };

    // Schedule new compute jobs (highest priority first).
    const jobs = planFrame(this.cache, qview, {
      frameBudget:     this.opts.frameBudget,
      maxInFlight:     this.ledger.inflightCount,
      ftleEnabled:     this.opts.ftleEnabled,
      ensembleEnabled: this.opts.ensembleEnabled,
    });
    for (const job of jobs) {
      if (this.ledger.dispatch(job.id, view)) stats.jobsDispatched++;
    }
    this.ledger.cancelOffscreen(visible);

    this.dispatcher.render(plan);

    stats.jobsCompleted = this.ledger.completedCount - completedBefore;
    stats.cpuMs = this.deps.now() - t0;
    this.lastStats = stats;
    return stats;
  }

  private tick(): void {
    if (!this.running) return;
    this.tickOnce();
    this.rafId = this.deps.schedule(() => this.tick());
  }
}
