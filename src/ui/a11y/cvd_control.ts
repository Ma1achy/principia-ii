import type { CvdMode, RenderParams } from '@/render/types.js';

/** Cycle order for the toggle (matches M7's CVD_INDEX / cvd.wgsl switch). */
export const CVD_ORDER: readonly CvdMode[] = [
  'none', 'protan', 'deutan', 'tritan', 'achrom',
] as const;

/** Short, user-facing labels for the toggle and the live announcement. */
export const CVD_LABELS: Readonly<Record<CvdMode, string>> = {
  none:   'Off',
  protan: 'Protanopia',
  deutan: 'Deuteranopia',
  tritan: 'Tritanopia',
  achrom: 'Achromatopsia',
};

export function cvdLabel(mode: CvdMode): string {
  return CVD_LABELS[mode];
}

/** Render-only action set. Deliberately tiny: this only ever moves cvdMode. */
export type CvdAction =
  | { type: 'set'; mode: CvdMode }
  | { type: 'cycle'; dir: 1 | -1 };

/**
 * Pure reducer. Returns a NEW RenderParams with only `cvdMode` changed; every
 * other field is copied by reference-preserving spread. Total: an unknown mode
 * in a 'set' action is ignored (params returned unchanged) rather than throwing,
 * so a stale UI event can never crash the render path.
 */
export function reduceCvd(params: RenderParams, action: CvdAction): RenderParams {
  switch (action.type) {
    case 'set': {
      if (!CVD_ORDER.includes(action.mode)) return params;
      if (action.mode === params.cvdMode) return params;
      return { ...params, cvdMode: action.mode };
    }
    case 'cycle': {
      const i = CVD_ORDER.indexOf(params.cvdMode);
      const base = i < 0 ? 0 : i;
      const n = CVD_ORDER.length;
      const next = CVD_ORDER[(((base + action.dir) % n) + n) % n]!;
      return next === params.cvdMode ? params : { ...params, cvdMode: next };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Convenience wrappers the ControlPanel calls directly. */
export function setCvd(params: RenderParams, mode: CvdMode): RenderParams {
  return reduceCvd(params, { type: 'set', mode });
}
export function cycleCvd(params: RenderParams, dir: 1 | -1 = 1): RenderParams {
  return reduceCvd(params, { type: 'cycle', dir });
}

/**
 * Render-only assertion helper, exported so the shell (and the test) can prove
 * the contract: a CVD edit must NOT change the ViewState-derived cache key.
 * `keyOf` is injected (M8's viewStateToCacheKey) to avoid an import cycle.
 */
export function isRenderOnly<V, K>(
  before: V, after: V, keyOf: (v: V) => K,
): boolean {
  // Same ViewState reference ⇒ same key; this is the structural guarantee that
  // a CVD edit (which touches only RenderParams) leaves the cache untouched.
  return before === after &&
    JSON.stringify(keyOf(before)) === JSON.stringify(keyOf(after));
}
