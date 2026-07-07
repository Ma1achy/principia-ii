import type { App } from '@/app/app.js';
import type { History } from './history.js';
import { undo as undoHist, redo as redoHist } from './history.js';
import { zoomViewport } from '@/app/viewport_nav.js';

/** Closed set of shell actions. Compute-affecting only — render-only modes
 *  are handled by the RenderParams store, never here. */
export type ActionId =
  | 'undo' | 'redo'
  | 'zoomIn' | 'zoomOut'
  | 'toggleLock' | 'unlock'
  | 'openPresets' | 'showHelp';

/** Side-effect hooks the dispatcher needs that are not on `App`. */
export interface ActionHooks {
  /** Current history; the dispatcher reads + replaces it for undo/redo. */
  getHistory: () => History;
  setHistory: (h: History) => void;
  openPresets?: () => void;
  showHelp?: () => void;
}

/**
 * Apply an action. Pure-ish: the only effects are the (injected) Store
 * updates and history get/set, which makes the routing table testable with
 * stubs. zoomIn/zoomOut are VIEWPORT zoom about the window centre — the
 * cache-preserving navigation the wheel and Zoom buttons use — not `mag`
 * (slice recompute), which stays an explicit panel control. Returns true if
 * the action was handled.
 */
export function dispatch(app: App, id: ActionId, hooks: ActionHooks): boolean {
  switch (id) {
    case 'undo': {
      const h = undoHist(hooks.getHistory());
      hooks.setHistory(h);
      app.store.setView(h.present);
      return true;
    }
    case 'redo': {
      const h = redoHist(hooks.getHistory());
      hooks.setHistory(h);
      app.store.setView(h.present);
      return true;
    }
    case 'zoomIn':  app.store.update(v => zoomViewport(v, 0.5));  return true;
    case 'zoomOut': app.store.update(v => zoomViewport(v, 2));    return true;
    case 'toggleLock':
      if (app.store.snapshot().locked) app.input.unlock();
      else {
        const v = app.store.snapshot();
        app.input.lock({ s: v.uvCentre[0], t: v.uvCentre[1] });
      }
      return true;
    case 'unlock':  app.input.unlock(); return true;
    case 'openPresets': hooks.openPresets?.(); return true;
    case 'showHelp':    hooks.showHelp?.();    return true;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
