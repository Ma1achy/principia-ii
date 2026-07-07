import type { JobLedger } from '@/app/gpu_jobs.js';
import type { PerfMonitor } from '@/perf/perf_monitor.js';

/** Pure: produce the label + busy flag from the two signals. Unit-testable. */
export function progressLabel(inflight: number, overBudget: boolean): {
  busy: boolean; label: string;
} {
  if (inflight === 0) return { busy: false, label: '' };
  const base = `Computing ${inflight} tile${inflight === 1 ? '' : 's'}…`;
  return { busy: true, label: overBudget ? `${base} (reducing quality)` : base };
}

/**
 * Progress chrome driven by the G2 JobLedger in-flight count and
 * (optionally) the G10 PerfMonitor budget state. Poll-based by necessity —
 * the loop exposes inflightCount but no "job landed" event — sampling on
 * rAF. Cosmetic only: headless rAF throttling just freezes the label.
 */
export function mountLoadingIndicator(
  root: HTMLElement, ledger: JobLedger, perf?: PerfMonitor,
): () => void {
  root.innerHTML = '<div class="loader" hidden>'
    + '<span class="spinner"></span><span class="loader-text"></span></div>';
  const box = root.querySelector<HTMLDivElement>('.loader')!;
  const text = root.querySelector<HTMLSpanElement>('.loader-text')!;

  let raf = 0;
  const tick = (): void => {
    const over = perf ? perf.snapshot().budget !== 'ok' : false;
    const { busy, label } = progressLabel(ledger.inflightCount, over);
    box.hidden = !busy;
    text.textContent = label;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
