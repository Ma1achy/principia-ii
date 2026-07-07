import type { App } from '@/app/app.js';
import { eventToChord, lookupChord, type Keymap } from './keymap.js';
import { dispatch, type ActionHooks } from './actions.js';

/** Structural event-target type so tests can pass a stub window. */
interface KeyTargetLike {
  addEventListener(type: string, cb: (e: KeyboardEvent) => void): void;
  removeEventListener(type: string, cb: (e: KeyboardEvent) => void): void;
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * The thin DOM bridge: keydown → chord → keymap → action dispatch.
 * Keystrokes are ignored while the user is typing in an editable element
 * so the preset-name field and sliders are not hijacked. All logic lives
 * in keymap.ts / actions.ts; this file is just the listener.
 */
export function installKeybindings(
  target: KeyTargetLike, app: App, map: Keymap, hooks: ActionHooks,
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    const action = lookupChord(map, eventToChord(e));
    if (!action) return;
    e.preventDefault();
    dispatch(app, action, hooks);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
