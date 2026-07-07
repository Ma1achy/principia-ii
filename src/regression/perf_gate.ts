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
 * GPU passes present in the baseline but absent from the observed snapshot are
 * ignored (timestamp-query may be unavailable on a runner — G9/G10 contract).
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
