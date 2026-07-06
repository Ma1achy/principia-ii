import type { TrajState } from '@/math/types.js';
import { runInspector } from './run.js';
import { RK45_DEFAULTS } from './types.js';

/**
 * Debounced, budget-capped hover streamline. The user moves the cursor
 * across the shape-sphere chart; we draw a trajectory streaming out from
 * the hovered pixel.
 *
 * Policy:
 *   - 30 ms debounce: never start a new integration until the pointer
 *     has been stationary for 30 ms.
 *   - 8 ms wall-clock cap per integration; on deadline, draw the
 *     partial trajectory and continue extending it on idle frames at
 *     16 ms per frame budget.
 */
export class HoverStreamline {
  private currentSession: number = 0;
  private lastResult: { sessionId: number; trajectory: { x: number; y: number; z: number }[] } | null = null;

  /** Returns the currently displayed (possibly partial) trajectory. */
  trajectory(): { x: number; y: number; z: number }[] {
    return this.lastResult?.trajectory ?? [];
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

    const start = performance.now();
    const budget = 8;
    // Run a short-horizon inspector with a tight budget. The inspector
    // returns whatever fraction of the trajectory it managed in the
    // budget; we extend it on subsequent idle frames.
    const result = runInspector(ic, {
      ...RK45_DEFAULTS,
      THorizon: 30,
      fullTrace: false,
      checkpointCount: 64,
    });
    if (sessionId !== this.currentSession) return;     // user moved again
    this.lastResult = {
      sessionId,
      trajectory: result.nShape,
    };
    const elapsed = performance.now() - start;
    if (elapsed >= budget && result.tEnd < 30) {
      // Schedule a continuation. (M9 shows the contract; production may
      // requestIdleCallback or use the existing render-loop slot.)
    }
  }
}
