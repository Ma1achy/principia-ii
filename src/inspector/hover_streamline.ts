import type { TrajState } from '@/math/types.js';
import { runInspector } from './run.js';
import { RK45_DEFAULTS } from './types.js';

/**
 * Debounced, budget-capped hover streamline. The user moves the cursor
 * across the shape-sphere chart; we integrate a short CPU f64 trajectory
 * from the hovered pixel and hand its shape-sphere path to the caller.
 *
 * Policy:
 *   - 30 ms debounce: never start a new integration until the pointer
 *     has been stationary for 30 ms.
 *   - `budgetMs` wall-clock cap per integration (enforced inside
 *     runInspector): on deadline the partial trajectory is delivered.
 *   - Sessions are monotonic; a stale integration never overwrites a
 *     newer hover's result.
 */
export class HoverStreamline {
  private currentSession = 0;
  private lastResult: {
    sessionId: number;
    trajectory: { x: number; y: number; z: number }[];
  } | null = null;

  constructor(
    /** Called with the (possibly partial) trajectory of the latest session. */
    private readonly onResult?: (traj: { x: number; y: number; z: number }[]) => void,
    private readonly budgetMs = 24,
    private readonly horizon = 30,
  ) {}

  /** Returns the currently displayed (possibly partial) trajectory. */
  trajectory(): { x: number; y: number; z: number }[] {
    return this.lastResult?.trajectory ?? [];
  }

  /** Cancel any pending session and clear the result (pointer left). */
  clear(): void {
    this.currentSession++;
    this.lastResult = null;
    this.onResult?.([]);
  }

  /** Called by the UI on each pointer move. Decoded IC is supplied by
   *  the chart's hover-decode hook. */
  onMove(decodeIc: () => TrajState | null): void {
    this.currentSession++;
    const sessionId = this.currentSession;
    setTimeout(() => this.maybeRun(sessionId, decodeIc), 30);
  }

  private maybeRun(sessionId: number, decodeIc: () => TrajState | null): void {
    if (sessionId !== this.currentSession) return;     // superseded
    const ic = decodeIc();
    if (!ic) return;

    // Budget-capped short-horizon run on the main thread. The budget is
    // enforced INSIDE the integrator loop (RK45Opts.budgetMs), so a stiff
    // region cannot jank the frame — it just yields a shorter streamline.
    const result = runInspector(ic, {
      ...RK45_DEFAULTS,
      THorizon: this.horizon,
      fullTrace: false,
      budgetMs: this.budgetMs,
    });
    if (sessionId !== this.currentSession) return;     // user moved again
    this.lastResult = { sessionId, trajectory: result.nShape };
    this.onResult?.(result.nShape);
  }
}
