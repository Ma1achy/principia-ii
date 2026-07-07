import type { App } from '@/app/app.js';
import { eventToChord, lookupChord, type Keymap } from './keymap.js';
import { dispatch, type ActionHooks } from './actions.js';
import { resolveKey, type KeyAction } from './a11y/keyboard.js';
import { cycleCvd } from './a11y/cvd_control.js';
import { stepFontScale, type ThemeState } from './a11y/theme.js';
import type { Announcement } from './a11y/live_region.js';
import type { RenderParamsStore } from './render_params.js';

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
 *
 * G13: an optional `pre` handler runs BEFORE the keymap lookup and
 * short-circuits when it returns true — the a11y shortcuts take precedence,
 * and a `false` return explicitly hands the chord back to G12's keymap
 * (that is how Escape falls through to `unlock` when no overlay is open).
 */
export function installKeybindings(
  target: KeyTargetLike, app: App, map: Keymap, hooks: ActionHooks,
  pre?: (e: KeyboardEvent) => boolean,
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    if (pre?.(e)) return;
    const action = lookupChord(map, eventToChord(e));
    if (!action) return;
    e.preventDefault();
    dispatch(app, action, hooks);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

/** Overlay confirm/dismiss hooks (G13). Each returns true iff it consumed
 *  the key — a dismiss with no overlay open returns false so Escape falls
 *  through to G12's `unlock` binding. */
export interface OverlayHooks {
  confirm(): boolean;
  dismiss(): boolean;
}

export interface A11yHandlerDeps {
  /** G12's render-only channel — the CVD cycle rebinds group 3, nothing else. */
  render: RenderParamsStore;
  /** Announcement closure (wraps LiveRegion.say; threaded from the shell). */
  say: (a: Announcement) => void;
  /** Mutable theme state owned by the shell. */
  theme: ThemeState;
  /** Theme DOM sink (class toggles on :root), threaded from the shell. */
  applyTheme: (t: ThemeState) => void;
  overlay?: OverlayHooks;
}

/**
 * The G13 pre-handler factory: resolves a11y shortcuts (Alt+C CVD cycle,
 * Alt+H contrast, Alt+= / Alt+- font scale, Enter/Escape overlay hooks)
 * ahead of the G12 keymap. Returns true when it consumed the event.
 */
export function makeA11yPreHandler(
  deps: A11yHandlerDeps,
): (e: KeyboardEvent) => boolean {
  return (ev: KeyboardEvent): boolean => {
    const action: KeyAction = resolveKey(ev);
    switch (action.kind) {
      case 'cvd-cycle': {
        // RENDER-ONLY: render.update mutates only RenderParams (group-3 rebind).
        deps.render.update(p => cycleCvd(p, action.dir));
        deps.say({ kind: 'cvd', mode: deps.render.snapshot().cvdMode });
        ev.preventDefault(); return true;
      }
      case 'toggle-contrast': {
        deps.theme.highContrast = !deps.theme.highContrast;
        deps.applyTheme(deps.theme);
        deps.say({ kind: 'contrast', on: deps.theme.highContrast });
        ev.preventDefault(); return true;
      }
      case 'font-scale': {
        deps.theme.fontScale = stepFontScale(deps.theme.fontScale, action.dir);
        deps.applyTheme(deps.theme);
        deps.say({ kind: 'font', scale: deps.theme.fontScale });
        ev.preventDefault(); return true;
      }
      case 'commit': {
        if (deps.overlay?.confirm()) { ev.preventDefault(); return true; }
        return false;
      }
      case 'dismiss': {
        // Only consume Escape when an overlay was actually open; otherwise
        // G12's keymap keeps its `escape → unlock` binding.
        if (deps.overlay?.dismiss()) { ev.preventDefault(); return true; }
        return false;
      }
      case 'roving': return false;   // handled by the focused slider group
      case 'none':   return false;   // let G12's keymap handle the chord
      default: { const _x: never = action; return _x; }
    }
  };
}
