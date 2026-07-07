import type { TileCacheKey } from './types.js';

/**
 * Stable, byte-conscious string serialisation of a cache key. Used as the
 * `Map` key in the cache. We deliberately serialise floats as fixed
 * decimals so that round-tripping through JSON does not introduce
 * precision drift in the key itself.
 *
 * The 16 components of (z0, q1, q2) dominate the length; even at full
 * precision the key is well under 1KB, which is fine for `Map<string,
 * CachedTile>`.
 */
export function serialiseCacheKey(k: TileCacheKey): string {
  const f = (xs: readonly number[]): string => xs.map(x => x.toFixed(15)).join(',');
  return [
    k.chartId, k.chartParams,
    f(k.z0), f(k.q1), f(k.q2), k.mag.toFixed(15),
    k.integrator,
    k.dtMacro.toFixed(15),
    k.nMax, k.THorizon.toFixed(8), k.checkpoints,
    k.muMax.toFixed(8), k.alphaMin.toFixed(8), k.qMax.toFixed(8),
    k.rColl.toFixed(15), k.REsc.toFixed(8), k.kEsc,
    k.enabledMetrics, k.qualityTier,
    k.samplesPerAxis, k.ensembleCount, k.payloadVersion,
  ].join('|');
}

/**
 * What changed between two keys. The renderer uses this to decide whether
 * a cache invalidation needs to bring down only the render cache or the
 * diagnostics cache as well (spec §6.5 invalidation matrix).
 */
export function classifyKeyChange(
  before: TileCacheKey, after: TileCacheKey,
): 'identical' | 'render-only' | 'diagnostics' {
  // A render-only change is impossible by construction: `TileCacheKey`
  // does not carry palette / overlay state, so any structural diff implies
  // a diagnostics-level invalidation. The render cache is keyed
  // separately (see M7).
  if (serialiseCacheKey(before) === serialiseCacheKey(after))
    return 'identical';
  return 'diagnostics';
}
