import type { GpuPass } from '@/perf/gpu_timing.js';
import { GPU_PASSES } from '@/perf/gpu_timing.js';
import type {
  PerfSnapshot, PerfRecommendation, BudgetState,
} from '@/perf/perf_monitor.js';
import type { QualityTier } from '@/gpu/capability.js';

/** Colour bucket for the budget chip — drives a CSS class, not a literal colour. */
export type BudgetBucket = 'ok' | 'warn' | 'bad';

export interface GpuPassRow {
  pass: GpuPass;
  p95Ms: number;
}

export interface PerfHudVM {
  frames: number;
  cpuMeanMs: number;
  cpuP95Ms: number;
  budget: BudgetState;
  bucket: BudgetBucket;
  /** Per-pass GPU p95 rows; empty when timestamp-query is unavailable. */
  gpuRows: GpuPassRow[];
  gpuTimingAvailable: boolean;
  overPercent: number;          // overFraction × 100, rounded
  /** Read-only scheduler hint from PerfMonitor.recommend(); the HUD shows
   *  it, it does NOT apply it (G10's FrameLoop owns the dispatch cap). */
  recommendation: {
    capScalePercent: number;    // dispatchCapScale × 100, rounded
    recommendTier: QualityTier | null;
    reason: string;
  };
}

/** Map the three-state budget classifier onto a colour bucket. */
export function budgetBucket(state: BudgetState): BudgetBucket {
  switch (state) {
    case 'ok': return 'ok';
    case 'over': return 'warn';
    case 'sustained': return 'bad';
    default: { const _x: never = state; return _x; }
  }
}

/**
 * Build the perf-HUD view-model. Pure: hand it a snapshot and the (already
 * computed) recommendation and it returns flat rows the DOM renders verbatim.
 */
export function perfHudVM(
  snap: PerfSnapshot, rec: PerfRecommendation,
): PerfHudVM {
  const gpuRows: GpuPassRow[] = [];
  if (snap.gpuTimingAvailable) {
    for (const pass of GPU_PASSES) {
      const v = snap.gpuP95Ms[pass];
      if (typeof v === 'number') gpuRows.push({ pass, p95Ms: v });
    }
  }
  return {
    frames: snap.frames,
    cpuMeanMs: snap.cpuMeanMs,
    cpuP95Ms: snap.cpuP95Ms,
    budget: snap.budget,
    bucket: budgetBucket(snap.budget),
    gpuRows,
    gpuTimingAvailable: snap.gpuTimingAvailable,
    overPercent: Math.round(snap.overFraction * 100),
    recommendation: {
      capScalePercent: Math.round(rec.dispatchCapScale * 100),
      recommendTier: rec.recommendTier,
      reason: rec.reason,
    },
  };
}
