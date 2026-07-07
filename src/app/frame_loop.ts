import type { FrameDeps, FrameStats, GpuDispatcher,
              RenderPlan, RenderPlanEntry } from './types.js';
import type { Store } from './store.js';
import { JobLedger } from './gpu_jobs.js';
import { toQuadtreeView, DEFAULT_VIEWPORT, type Viewport } from './view_bridge.js';
import { TileCache } from '@/quadtree/cache.js';
import { visibleTiles } from '@/quadtree/visible.js';
import { subrect } from '@/quadtree/tile.js';
import { planFrame } from '@/quadtree/scheduler.js';
import { PerfMonitor, type PerfRecommendation } from '@/perf/perf_monitor.js';
import type { ErrorBoundary } from '@/error/boundary.js';

export interface FrameLoopOpts {
  frameBudget:     number;    // max compute jobs per frame (tile-jobs, not ms)
  maxInFlight:     number;
  ftleEnabled:     boolean;
  ensembleEnabled: boolean;
  viewport?:       Viewport;
  cacheCapacity?:  number;
  // --- G10 additions (all optional; defaults keep G2 callers unchanged) ---
  frameBudgetMs?:  number;    // wall-clock budget per frame (default 16)
  perfWindow?:     number;    // rolling window length in frames (default 120)
  /** From ctx.capability.features.includes('timestamp-query'). */
  gpuTimingAvailable?: boolean;
  /** G11: failure funnel handed to the JobLedger (classify + telemetry
   *  + user surface). Omitted ⇒ the ledger's silent no-op default. */
  boundary?: Pick<ErrorBoundary, 'capture'>;
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
  /** G10: rolling perf stats + budget feedback. The UI reads
   *  perf.snapshot()/lastRecommendation; the loop applies the dispatch-cap
   *  scale itself and NEVER mutates the tier (advisory only). */
  readonly perf: PerfMonitor;
  /** Stats of the most recent tick (null before the first). Read-only
   *  telemetry for HUDs and headless checks. */
  lastStats: FrameStats | null = null;
  /** The most recent recommend() output (null before enough samples). */
  lastRecommendation: PerfRecommendation | null = null;
  private frameNum = 0;
  private running = false;
  private rafId = 0;
  private viewport: Viewport;
  /** Perf-scaled dispatches-per-frame cap; recovers to opts.frameBudget
   *  once the window is back under budget. */
  private dispatchCap: number;

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
    }, opts.boundary);
    this.perf = new PerfMonitor({
      windowFrames:  opts.perfWindow ?? 120,
      frameBudgetMs: opts.frameBudgetMs ?? 16,
      overRatio: 1.0,
      sustainedFraction: 0.5,
      gpuTimingAvailable: opts.gpuTimingAvailable ?? false,
    });
    this.dispatchCap = opts.frameBudget;
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

    // Schedule new compute jobs (highest priority first). The perf-driven
    // dispatchCap backs off the dispatches-per-frame knob (planFrame's
    // frameBudget — its maxInFlight input is "jobs already running").
    const jobs = planFrame(this.cache, qview, {
      frameBudget:     Math.min(this.dispatchCap, this.opts.frameBudget),
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

    // G10: record this frame + apply back-pressure. GPU timings are the
    // PREVIOUS frame's resolved timestamps (async readback — one-frame
    // latency is invisible to a rolling window).
    const gpu = this.dispatcher.takeGpuTimings?.();
    this.perf.record({ cpuMs: stats.cpuMs, gpu, jobsDispatched: stats.jobsDispatched });
    const rec = this.perf.recommend(view.qualityTier);
    this.lastRecommendation = rec;
    this.dispatchCap = rec.dispatchCapScale >= 1
      ? this.opts.frameBudget    // recovered: climb straight back to the ceiling
      : Math.max(1, Math.round(this.dispatchCap * rec.dispatchCapScale));
    if (gpu) {
      stats.gpuPassMs = gpu;
      stats.gpuMs = Object.values(gpu).reduce((s, x) => s + (x ?? 0), 0);
    }
    stats.overBudget = this.perf.budgetState() !== 'ok';
    this.lastStats = stats;
    return stats;
  }

  private tick(): void {
    if (!this.running) return;
    this.tickOnce();
    this.rafId = this.deps.schedule(() => this.tick());
  }
}
