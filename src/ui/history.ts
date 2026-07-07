import type { ViewState } from '@/interact/view_state.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';

/**
 * Immutable undo/redo history. `past` is oldest→newest of states BEFORE the
 * present; `present` is the live view; `future` is redo targets (newest→oldest
 * of states we undid past). A bounded ring: `cap` limits `past` length.
 */
export interface History {
  readonly past: readonly ViewState[];
  readonly present: ViewState;
  readonly future: readonly ViewState[];
  readonly cap: number;
}

export function initHistory(present: ViewState, cap = 50): History {
  if (cap < 1) throw new RangeError('history cap must be >= 1');
  return { past: [], present, future: [], cap };
}

/**
 * True iff `next` differs from `prev` in a way that affects what is computed,
 * simulated, or inspected — i.e. it deserves an undo entry. Keyed on the M8
 * cache signature (the authority on tile contents) plus lock / tilt / the
 * viewport window, which change the inspector / projection / what's on screen
 * even when not in the key. Render-only RenderParams are NOT a ViewState
 * field, so they can never make this true.
 */
export function isComputeChange(prev: ViewState, next: ViewState): boolean {
  if (prev === next) return false;
  const a = viewStateToCacheKey(prev);
  const b = viewStateToCacheKey(next);
  if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  // Lock + orientation + viewport window affect inspection/projection/
  // navigation but are not all in the key. (uvHalfWidth included: a
  // centre-zoom changes only the half-width and must still be undoable.)
  return (
    prev.locked !== next.locked ||
    prev.tilt1 !== next.tilt1 || prev.tilt2 !== next.tilt2 ||
    prev.tilt1Target !== next.tilt1Target ||
    prev.tilt2Target !== next.tilt2Target ||
    prev.uvCentre[0] !== next.uvCentre[0] ||
    prev.uvCentre[1] !== next.uvCentre[1] ||
    prev.uvHalfWidth[0] !== next.uvHalfWidth[0] ||
    prev.uvHalfWidth[1] !== next.uvHalfWidth[1]
  );
}

/**
 * Commit a new present. If it is not a compute-change, the present is replaced
 * WITHOUT pushing a history entry (so render-only / no-op edits never grow the
 * ring) and the redo future is preserved. If it IS a compute-change, the old
 * present is pushed onto `past` (evicting the oldest beyond `cap`) and the
 * redo future is cleared (a new edit forks the timeline).
 */
export function pushHistory(h: History, next: ViewState): History {
  if (!isComputeChange(h.present, next)) {
    return { ...h, present: next };
  }
  const past = [...h.past, h.present];
  while (past.length > h.cap) past.shift();
  return { past, present: next, future: [], cap: h.cap };
}

export function canUndo(h: History): boolean { return h.past.length > 0; }
export function canRedo(h: History): boolean { return h.future.length > 0; }

/** Move present back one step; the undone present becomes the newest redo. */
export function undo(h: History): History {
  if (!canUndo(h)) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1]!;
  return { past, present, future: [h.present, ...h.future], cap: h.cap };
}

/** Re-apply the newest redo target. */
export function redo(h: History): History {
  if (!canRedo(h)) return h;
  const present = h.future[0]!;
  const future = h.future.slice(1);
  return { past: [...h.past, h.present], present, future, cap: h.cap };
}
