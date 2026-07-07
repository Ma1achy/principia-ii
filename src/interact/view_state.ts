import type { Vec2, Vec8 } from '@/math/types.js';
import type { TileCacheKey } from '@/quadtree/types.js';

export type IntegratorId = 'kdk' | 'yoshida4' | 'yoshida6' | 'rk4';
export type QualityTier  = 'preview' | 'balanced' | 'research';

/**
 * The single source of truth for the renderer, scheduler, exporter, and
 * URL-sharing system. Everything else in M8+ either reads or writes
 * `ViewState`.
 */
export interface ViewState {
  /** Active chart. M10 registers the concrete charts; M8 is chart-agnostic. */
  chartType:    string;
  chartParams:  Record<string, unknown>;

  /** 8D centre of the current slice. */
  z0:           Vec8;

  /** Slice basis. For affine charts q1, q2 are authoritative and
   *  hAxis/vAxis are derived. For mixed-axis / invariant charts, hAxis
   *  and vAxis are authoritative; q1, q2 are derived from the chart
   *  factory and stored only for serialisation completeness. */
  hAxis:        number;
  vAxis:        number;
  q1:           Vec8;
  q2:           Vec8;
  mag:          number;          // half-width of the slice in latent space

  /** Orientation. */
  rotation:     number;
  tilt1:        number;          // [-π/2, +π/2]
  tilt2:        number;
  tilt1Target:  number;          // 0..7
  tilt2Target:  number;

  /** Viewport (UV space). */
  zoom:         number;          // log-scale; pure UI quantity
  uvCentre:     Vec2;
  uvHalfWidth:  Vec2;

  /** Integration. */
  integrator:   IntegratorId;
  THorizon:     number;
  dtMacro:      number;
  NMax:         number;
  checkpoints:  number;

  /** Quality. */
  qualityTier:  QualityTier;
  samplesPerAxis: number;
  maxDepth:     number;
  ensembleCount: number;

  /** Lock state. */
  locked:       boolean;
  // `| undefined` is explicit so `lockedPhysical: undefined` is a legal
  // assignment under exactOptionalPropertyTypes (lockAffine/unlock clear it).
  lockedPhysical?: {                                // present iff locked
    m: readonly [number, number, number];
    r: readonly [Vec2, Vec2, Vec2];
    p: readonly [Vec2, Vec2, Vec2];
  } | undefined;

  /** Reproducibility metadata. */
  principiaVersion: string;
  timestamp:        string;
}

/** Default starting state, equivalent to "open the app". */
export function defaultViewState(): ViewState {
  return {
    chartType: 'latent_slice',
    chartParams: {},
    z0: [0, 0, 0, 0, 0, 0, 0, 0],
    hAxis: 0, vAxis: 1,
    q1: [1, 0, 0, 0, 0, 0, 0, 0],
    q2: [0, 1, 0, 0, 0, 0, 0, 0],
    mag: 3,
    rotation: 0,
    tilt1: 0, tilt2: 0,
    tilt1Target: 2, tilt2Target: 3,
    zoom: 0, uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
    integrator: 'yoshida4', THorizon: 80, dtMacro: 1e-3,
    NMax: 64, checkpoints: 8,
    qualityTier: 'balanced', samplesPerAxis: 16,
    maxDepth: 10, ensembleCount: 0,
    locked: false,
    principiaVersion: '0.1.0',
    timestamp: new Date().toISOString(),
  };
}

/** Canonical (sorted-key, deterministic) serialisation for chartParams.
 *  Object key order must not affect the cache key. */
export function stableChartParams(params: Record<string, unknown>): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, val]) => [k, sort(val)]));
    }
    return x;
  };
  return JSON.stringify(sort(params));
}

/** Derive the Layer-1 cache key from a `ViewState`. Anything that affects
 *  the contents of a tile's `simBuffer` must appear in here. */
export function viewStateToCacheKey(v: ViewState): TileCacheKey {
  return {
    chartId:     v.chartType,
    chartParams: stableChartParams(v.chartParams),
    z0:          v.z0,
    q1:          v.q1,
    q2:          v.q2,
    mag:         v.mag,
    integrator:  v.integrator,
    dtMacro:     v.dtMacro,
    nMax:        v.NMax,
    THorizon:    v.THorizon,
    checkpoints: v.checkpoints,
    // Decode/event knobs: constants today (math/constants defaults used by
    // both decode paths); they join ViewState if they become controls.
    muMax:       5,
    alphaMin:    0.05,
    qMax:        2,
    rColl:       1e-4,
    REsc:        10,
    kEsc:        8,
    enabledMetrics: 0,
    qualityTier: v.qualityTier,
    samplesPerAxis: v.samplesPerAxis,
    ensembleCount:  v.ensembleCount,
    payloadVersion: 1,
  };
}
