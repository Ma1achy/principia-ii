import { RollingWindow } from './stats.js';
import { GPU_PASSES, type GpuPass, type GpuPassTimings } from './gpu_timing.js';
// QualityTier's canonical home is G9's '@/gpu/capability.js'. M8's
// ViewState.qualityTier is the SAME union (identical members) — `recommend()`
// takes `view.qualityTier` directly; do not re-declare a parallel type.
import type { QualityTier } from '@/gpu/capability.js';

/** Per-frame sample handed to the monitor. */
export interface FrameTimingSample {
  cpuMs: number;
  /** Resolved per-pass GPU timings (ms); empty/absent when CPU-only. */
  gpu?: GpuPassTimings | undefined;
  jobsDispatched: number;
}

export type BudgetState = 'ok' | 'over' | 'sustained';

export interface PerfSnapshot {
  frames: number;
  cpuMeanMs: number;
  cpuP95Ms: number;
  /** Per-pass GPU p95 (ms); empty when timestamp-query is unavailable. */
  gpuP95Ms: GpuPassTimings;
  gpuTimingAvailable: boolean;
  budget: BudgetState;
  /** Fraction of the window's frames that exceeded the budget. */
  overFraction: number;
}

/** What the monitor recommends the scheduler do next frame. */
export interface PerfRecommendation {
  /** Multiply the current per-frame dispatch cap by this (≤ 1 backs off). */
  dispatchCapScale: number;
  /** Suggested next tier, or null to keep the current one. ADR 0003 order. */
  recommendTier: QualityTier | null;
  reason: string;
}

export interface PerfMonitorOpts {
  /** Rolling window length in frames. */
  windowFrames: number;
  /** Target frame budget in ms (G2's frameBudget is in jobs; this is wall-clock). */
  frameBudgetMs: number;
  /**
   * p95/budget ratio above which a single window counts as "over"; and the
   * overFraction above which "over" escalates to "sustained".
   */
  overRatio: number;          // e.g. 1.0  (p95 over budget)
  sustainedFraction: number;  // e.g. 0.5  (≥50% of frames over)
  /** Whether the device exposes timestamp-query (from G9 features). */
  gpuTimingAvailable: boolean;
}

const TIER_ORDER: readonly QualityTier[] = ['preview', 'balanced', 'research'];

/** Next-lower tier per ADR 0003, or null at the floor. */
export function lowerTier(t: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(t);
  return i > 0 ? TIER_ORDER[i - 1]! : null;
}

export class PerfMonitor {
  private readonly cpu: RollingWindow;
  private readonly wall: RollingWindow;        // per-frame effective wall time (ms)
  private readonly gpu = new Map<GpuPass, RollingWindow>();
  private readonly overFlags: RollingWindow;   // 1 = over budget that frame
  private frames = 0;

  constructor(private readonly opts: PerfMonitorOpts) {
    if (opts.windowFrames <= 0) throw new RangeError('windowFrames must be > 0');
    this.cpu = new RollingWindow(opts.windowFrames);
    this.wall = new RollingWindow(opts.windowFrames);
    this.overFlags = new RollingWindow(opts.windowFrames);
    for (const pass of GPU_PASSES) this.gpu.set(pass, new RollingWindow(opts.windowFrames));
  }

  /** Record one frame's timings. Pure bookkeeping — no GPU calls. */
  record(sample: FrameTimingSample): void {
    this.frames++;
    this.cpu.push(sample.cpuMs);
    // The "wall-clock" we budget against is the max of CPU planning and the
    // summed GPU passes when timestamps exist, else CPU time. The over flag and
    // the budget classifier both read this single wall metric so they agree.
    const wall = this.frameWallMs(sample);
    this.wall.push(wall);
    this.overFlags.push(wall > this.opts.frameBudgetMs ? 1 : 0);
    if (this.opts.gpuTimingAvailable && sample.gpu) {
      for (const pass of GPU_PASSES) {
        const v = sample.gpu[pass];
        if (typeof v === 'number') this.gpu.get(pass)!.push(v);
      }
    }
  }

  /** The frame's effective wall time used for budgeting. */
  private frameWallMs(sample: FrameTimingSample): number {
    if (this.opts.gpuTimingAvailable && sample.gpu) {
      // GPU passes run after CPU planning; the frame is bounded by the larger.
      const gpuTotal = GPU_PASSES.reduce((s, p) => s + (sample.gpu?.[p] ?? 0), 0);
      return Math.max(sample.cpuMs, gpuTotal);
    }
    return sample.cpuMs;
  }

  /**
   * Classify the current window's budget state. Uses the same summed wall
   * metric the over flag is derived from (max of CPU and summed GPU passes),
   * so the p95 ratio and the over fraction can never disagree.
   */
  budgetState(): BudgetState {
    if (this.wall.size === 0) return 'ok';
    const wallRatio = this.wall.percentile(0.95) / this.opts.frameBudgetMs;
    if (wallRatio <= this.opts.overRatio) return 'ok';
    return this.overFlags.mean() >= this.opts.sustainedFraction ? 'sustained' : 'over';
  }

  snapshot(): PerfSnapshot {
    const gpuP95Ms: GpuPassTimings = {};
    if (this.opts.gpuTimingAvailable) {
      for (const [pass, w] of this.gpu) {
        if (w.size > 0) gpuP95Ms[pass] = w.percentile(0.95);
      }
    }
    return {
      frames: this.frames,
      cpuMeanMs: this.cpu.mean(),
      cpuP95Ms: this.cpu.percentile(0.95),
      gpuP95Ms,
      gpuTimingAvailable: this.opts.gpuTimingAvailable,
      budget: this.budgetState(),
      overFraction: this.overFlags.mean(),
    };
  }

  /**
   * Feed back into the scheduler. `over` trims the dispatch cap (gentle
   * back-pressure that keeps the map responsive); `sustained` additionally
   * recommends dropping a tier (ADR 0003 order) so the next batch is cheaper.
   * Below a minimum sample count we stay neutral to avoid reacting to noise.
   */
  recommend(currentTier: QualityTier): PerfRecommendation {
    const neutral: PerfRecommendation = {
      dispatchCapScale: 1, recommendTier: null, reason: 'within budget',
    };
    if (this.cpu.size < Math.max(4, Math.floor(this.opts.windowFrames / 4))) {
      return { ...neutral, reason: 'insufficient samples' };
    }
    switch (this.budgetState()) {
      case 'ok':
        return neutral;
      case 'over':
        return {
          dispatchCapScale: 0.5,
          recommendTier: null,
          reason: `p95 over ${this.opts.frameBudgetMs}ms budget; halving dispatch cap`,
        };
      case 'sustained': {
        const next = lowerTier(currentTier);
        return {
          dispatchCapScale: 0.25,
          recommendTier: next,
          reason: next
            ? `sustained overrun (${(this.overFlags.mean() * 100).toFixed(0)}% of frames); ` +
              `recommend tier ${currentTier} → ${next}`
            : `sustained overrun at floor tier '${currentTier}'; holding, cap quartered`,
        };
      }
    }
  }

  reset(): void {
    this.frames = 0;
    this.cpu.reset();
    this.wall.reset();
    this.overFlags.reset();
    for (const w of this.gpu.values()) w.reset();
  }
}
