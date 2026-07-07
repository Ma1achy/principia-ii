/** The four hosted views; 'capture' is G18's own frame-capture/replay panel. */
export type DevTab = 'perf' | 'errors' | 'validation' | 'capture';

export const DEV_TABS: readonly DevTab[] = ['perf', 'errors', 'validation', 'capture'];

export interface DevOverlayState {
  visible: boolean;
  tab: DevTab;
}

export type DevOverlayAction =
  | { type: 'toggle' }
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'selectTab'; tab: DevTab };

/** Default-hidden, perf tab pre-selected. */
export function initDevOverlay(): DevOverlayState {
  return { visible: false, tab: 'perf' };
}

/** Pure reducer. Selecting a tab also reveals the overlay (so a binding
 *  for a specific tab both shows it and switches to it). */
export function devOverlayReducer(
  s: DevOverlayState, a: DevOverlayAction,
): DevOverlayState {
  switch (a.type) {
    case 'toggle': return { ...s, visible: !s.visible };
    case 'show':   return { ...s, visible: true };
    case 'hide':   return { ...s, visible: false };
    case 'selectTab': return { visible: true, tab: a.tab };
    default: { const _x: never = a; return _x; }
  }
}
