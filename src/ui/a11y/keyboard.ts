/** The logical focus stops, in document order (G12 shell layout). */
export type FocusStop =
  | 'chart' | 'sliders' | 'tilt' | 'cvd' | 'quality' | 'canvas' | 'inspector';

/** Canonical focus order for Tab traversal. */
export const FOCUS_ORDER: readonly FocusStop[] = [
  'chart', 'sliders', 'tilt', 'cvd', 'quality', 'canvas', 'inspector',
] as const;

/** Stable list (filtered to the stops actually present in the DOM). */
export function focusOrder(present: readonly FocusStop[]): FocusStop[] {
  const set = new Set(present);
  return FOCUS_ORDER.filter(s => set.has(s));
}

/**
 * Roving tabindex for a group of `count` items with one active index: the
 * active item is 0 (in the tab sequence), all others are -1 (reachable only via
 * arrow keys). Returns the tabindex per item. Pure.
 */
export function rovingTabindex(count: number, active: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i === active ? 0 : -1);
  return out;
}

/**
 * Advance the active index within a roving group. `wrap` cycles past the ends;
 * otherwise the index clamps. Pure; empty groups stay at 0.
 */
export function advanceRoving(
  active: number, count: number, dir: 1 | -1, wrap = true,
): number {
  if (count <= 0) return 0;
  const next = active + dir;
  if (wrap) return ((next % count) + count) % count;
  return Math.max(0, Math.min(count - 1, next));
}

/* ---- Shortcut catalogue + key resolution ------------------------------ */

/** Typed actions the shell handles. `none` = let the event pass through. */
export type KeyAction =
  | { kind: 'none' }
  | { kind: 'cvd-cycle'; dir: 1 | -1 }
  | { kind: 'toggle-contrast' }
  | { kind: 'font-scale'; dir: 1 | -1 }
  | { kind: 'commit' }        // Enter: confirm the active overlay
  | { kind: 'dismiss' }       // Escape: cancel the active overlay
  | { kind: 'roving'; dir: 1 | -1 };

export interface Shortcut {
  /** KeyboardEvent.key value (case-sensitive for letters as documented). */
  key: string;
  /** Required modifiers; absent ⇒ must be false. */
  alt?: boolean;
  shift?: boolean;
  /** Human-readable, for describeShortcuts() and the help panel. */
  describe: string;
  action: KeyAction;
}

/**
 * G13 shortcuts, merged INTO G12's keymap (G12 owns zoom/lock/pan; G13 adds
 * accessibility bindings + the Enter/Escape semantics for overlays).
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'c', alt: true, describe: 'Cycle colour-vision simulation',          action: { kind: 'cvd-cycle', dir: 1 } },
  { key: 'C', alt: true, shift: true, describe: 'Cycle colour-vision simulation (reverse)', action: { kind: 'cvd-cycle', dir: -1 } },
  { key: 'h', alt: true, describe: 'Toggle high-contrast theme',              action: { kind: 'toggle-contrast' } },
  { key: '=', alt: true, describe: 'Increase font size',                      action: { kind: 'font-scale', dir: 1 } },
  { key: '-', alt: true, describe: 'Decrease font size',                      action: { kind: 'font-scale', dir: -1 } },
  { key: 'Enter',  describe: 'Confirm the active overlay',                    action: { kind: 'commit' } },
  { key: 'Escape', describe: 'Dismiss the active overlay',                    action: { kind: 'dismiss' } },
  { key: 'ArrowDown', describe: 'Next slider in the group',                   action: { kind: 'roving', dir: 1 } },
  { key: 'ArrowUp',   describe: 'Previous slider in the group',               action: { kind: 'roving', dir: -1 } },
] as const;

/** The subset of a KeyboardEvent resolveKey needs (DOM-free for testing).
 *  Named A11yKeyEvent — G12's keymap.ts already exports a KeyEventLike and
 *  both flow through the ui barrel. */
export interface A11yKeyEvent {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Resolve a key event to an action. First exact match wins; modifiers must
 * match exactly (an unspecified modifier must be false). Returns `none` when
 * nothing matches so the caller leaves the event alone. Pure.
 */
export function resolveKey(ev: A11yKeyEvent): KeyAction {
  for (const s of SHORTCUTS) {
    if (s.key !== ev.key) continue;
    if (!!s.alt !== !!ev.altKey) continue;
    if (!!s.shift !== !!ev.shiftKey) continue;
    return s.action;
  }
  return { kind: 'none' };
}

/** Render the documented shortcut list (help panel + tests). Pure. */
export function describeShortcuts(): { combo: string; describe: string }[] {
  return SHORTCUTS.map(s => {
    const mods = [s.alt ? 'Alt' : '', s.shift ? 'Shift' : ''].filter(Boolean);
    return { combo: [...mods, s.key].join('+'), describe: s.describe };
  });
}
