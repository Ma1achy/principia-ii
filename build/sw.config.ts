/**
 * Precache policy for the offline service worker (G15, OPTIONAL feature).
 * Off by default — nothing registers the worker unless VITE_ENABLE_SW=1.
 *
 * The precache list is the app shell ONLY. The milestone doc wanted the
 * WGSL source paths precached too, but in production those files do not
 * exist: G1 inlines every shader into the `gpu` chunk via `?raw`, so
 * dist has no src/gpu/shaders/*.wgsl and cache.addAll of a 404 would
 * reject the whole install. Offline shader resolution comes for free —
 * the WGSL rides inside the hashed gpu chunk, which the runtime
 * cache-first strategy captures on first load.
 */

/** Cache name is version-stamped so a deploy invalidates stale precaches. */
export function cacheName(version: string): string {
  return `principia-shell-${version}`;
}

/**
 * App-shell precache list (base-prefixed). Just the HTML entry: hashed
 * JS/CSS names are only known post-build, so they are runtime-cached
 * (cache-first is safe — content-addressed URLs are immutable).
 */
export function precacheList(base: string): string[] {
  const b = base.endsWith('/') ? base : `${base}/`;
  return [b];
}

/** Runtime-cache strategy per request kind. */
export const RUNTIME_STRATEGY = {
  /** Hashed, immutable assets → cache-first (safe: content-addressed). */
  assets: 'cache-first',
  /** Navigations → network-first, falling back to the cached shell offline. */
  navigation: 'network-first',
} as const;
