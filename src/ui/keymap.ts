import type { ActionId } from './actions.js';

/** Normalised parts of a key chord. */
export interface Chord {
  key: string;       // lowercased KeyboardEvent.key, e.g. 'z', 'arrowleft', '?'
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** A rebindable map: canonical chord string → action. */
export type Keymap = ReadonlyMap<string, ActionId>;

/** Build the canonical, order-stable string for a chord. Modifier order is
 *  fixed (ctrl, alt, shift, meta) so any input order normalises identically. */
export function chordToString(c: Chord): string {
  const mods: string[] = [];
  if (c.ctrl) mods.push('ctrl');
  if (c.alt) mods.push('alt');
  if (c.shift) mods.push('shift');
  if (c.meta) mods.push('meta');
  return [...mods, c.key.toLowerCase()].join('+');
}

/** Parse a human chord string ('Ctrl+Shift+Z') into the canonical string. */
export function parseChord(spec: string): string {
  const parts = spec.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  const c: Chord = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') c.ctrl = true;
    else if (p === 'shift') c.shift = true;
    else if (p === 'alt' || p === 'option') c.alt = true;
    else if (p === 'meta' || p === 'cmd' || p === 'super') c.meta = true;
    else c.key = p;
  }
  if (!c.key) throw new Error(`chord "${spec}" has no base key`);
  return chordToString(c);
}

/** Read a chord string off a DOM-ish KeyboardEvent without importing the type. */
export interface KeyEventLike {
  key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
}
export function eventToChord(e: KeyEventLike): string {
  return chordToString({
    key: e.key.toLowerCase(),
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
  });
}

/** Default bindings. Compute-affecting actions get plain keys; undo/redo use
 *  the platform-conventional Ctrl/Cmd chords. */
export const DEFAULT_BINDINGS: ReadonlyArray<readonly [string, ActionId]> = [
  ['ctrl+z', 'undo'],
  ['ctrl+shift+z', 'redo'],
  ['ctrl+y', 'redo'],
  ['=', 'zoomIn'],
  ['-', 'zoomOut'],
  ['l', 'toggleLock'],
  ['shift+?', 'showHelp'],
  ['p', 'openPresets'],
  ['escape', 'unlock'],
];

export function buildKeymap(
  entries: ReadonlyArray<readonly [string, ActionId]> = DEFAULT_BINDINGS,
): Keymap {
  const m = new Map<string, ActionId>();
  for (const [spec, action] of entries) m.set(parseChord(spec), action);
  return m;
}

/** Pure lookup: chord string → action, or undefined. */
export function lookupChord(map: Keymap, chord: string): ActionId | undefined {
  return map.get(chord);
}

/**
 * Return a NEW map with `spec` bound to `action`. Throws if the chord is
 * already bound and `override` is false (prevents silently shadowing a
 * binding).
 */
export function rebind(
  map: Keymap, spec: string, action: ActionId, override = false,
): Keymap {
  const chord = parseChord(spec);
  if (map.has(chord) && !override) {
    throw new Error(`chord "${chord}" already bound to ${map.get(chord)}`);
  }
  const next = new Map(map);
  next.set(chord, action);
  return next;
}
