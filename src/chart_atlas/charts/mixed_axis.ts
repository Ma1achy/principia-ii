import type { Chart, ChartView } from '../types.js';
import type { ChartDecodeOut } from '../types.js';
import { FLAGS_DEFAULT, FLAGS_MASS_VARYING } from '../flags.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { latentSliceChart } from './latent_slice.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import { constructMomentaForLzK } from '../momentum_construction.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import { decodeMassSoftmax } from '@/decode/mass.js';
import { decodeFreeJacobiMomenta } from '@/decode/momentum_free.js';
import { jacobiToParticleMomenta } from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor, makeTerminal } from '@/decode/pipeline.js';
import { DegenerateReason } from '@/decode/types.js';
import { totalEnergy } from '@/integrate/forces.js';
import { sigmoid } from '@/math/scalar.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import type { Triple, Vec2, Vec8 } from '@/math/types.js';

export type AxisSpec =
  | { kind: 'latent';   index: number; range: [number, number] }
  | { kind: 'mass';     parameter: 'm1' | 'm2'; range: [number, number] }
  | { kind: 'lz';       range: [number, number] }
  | { kind: 'energy';   range: [number, number] }
  | { kind: 'shape_alpha'; range: [number, number] }
  | { kind: 'shape_beta';  range: [number, number] };

export const AXIS_KINDS = [
  'latent', 'mass', 'lz', 'energy', 'shape_alpha', 'shape_beta',
] as const;

/** Every axis kind is constructible (Stage 4). Pairing rules below reject
 *  only redundant pairs (two axes sweeping the same derived quantity). */
export const CONSTRUCTIBLE_AXIS_KINDS: readonly AxisSpec['kind'][] = AXIS_KINDS;

const LATENT_KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

/** Default view: the latent z0 × z1 slice, matching the latent chart. */
export const DEFAULT_AXES: { hAxis: AxisSpec; vAxis: AxisSpec } = {
  hAxis: { kind: 'latent', index: 0, range: [-3, 3] },
  vAxis: { kind: 'latent', index: 1, range: [-3, 3] },
};

/** Why a pairing is rejected, or null when it is fine. Two axes must not
 *  sweep the same derived quantity — that is one axis twice, not a chart. */
export function pairingError(h: AxisSpec, v: AxisSpec): string | null {
  if (h.kind !== 'latent' && h.kind === v.kind) {
    if (h.kind === 'mass') {
      const hm = h as Extract<AxisSpec, { kind: 'mass' }>;
      const vm = v as Extract<AxisSpec, { kind: 'mass' }>;
      return hm.parameter === vm.parameter
        ? `both axes sweep mass ${hm.parameter}` : null;   // m1 × m2 is fine
    }
    return `both axes sweep ${h.kind}`;
  }
  return null;
}

function isAxisSpec(x: unknown): x is AxisSpec {
  if (x === null || typeof x !== 'object') return false;
  const a = x as { kind?: unknown; range?: unknown; index?: unknown; parameter?: unknown };
  if (!AXIS_KINDS.includes(a.kind as AxisSpec['kind'])) return false;
  if (!Array.isArray(a.range) || a.range.length !== 2
      || typeof a.range[0] !== 'number' || typeof a.range[1] !== 'number'
      || a.range[0] === a.range[1]) return false;
  if (a.kind === 'latent'
      && (typeof a.index !== 'number' || a.index < 0 || a.index > 7)) return false;
  if (a.kind === 'mass' && a.parameter !== 'm1' && a.parameter !== 'm2') return false;
  return true;
}

/** Axis specs for a view: `chartParams.hAxis/vAxis` when valid, else the
 *  default latent pair. The GUI writes only valid specs; a malformed or
 *  redundant pair (e.g. mid-edit state) falls back rather than blanking
 *  the view — decode itself stays total either way. */
export function axesOf(view?: ChartView): { hAxis: AxisSpec; vAxis: AxisSpec } {
  const h = view?.chartParams['hAxis'];
  const v = view?.chartParams['vAxis'];
  if (isAxisSpec(h) && isAxisSpec(v) && pairingError(h, v) === null) {
    return { hAxis: h, vAxis: v };
  }
  return DEFAULT_AXES;
}

const lerp = (range: [number, number], t: number): number =>
  range[0] + (range[1] - range[0]) * t;

/**
 * Decode one pixel for an arbitrary axis pair. Composition follows the
 * latent pipeline's ordering — masses, then geometry, then momenta — with
 * each stage overridden by the axis that sweeps it and otherwise frozen at
 * the view's z0 (the spec's mixed-axis contract: two coordinates vary, the
 * remaining six freeze). Total: failures label the pixel, never throw.
 */
function composeDecode(
  hAxis: AxisSpec, vAxis: AxisSpec,
  [u, v]: readonly [number, number], view: ChartView,
): ChartDecodeOut {
  // Pure latent × latent delegates to the latent slice (affine fast path).
  if (hAxis.kind === 'latent' && vAxis.kind === 'latent') {
    const z0 = [...view.z0] as number[];
    z0[hAxis.index] = lerp(hAxis.range, u);
    z0[vAxis.index] = lerp(vAxis.range, v);
    return latentSliceChart.decode([0.5, 0.5], { ...view, z0: z0 as unknown as Vec8 });
  }

  const axes: [AxisSpec, number][] = [[hAxis, u], [vAxis, v]];
  const value = (kind: AxisSpec['kind'], param?: 'm1' | 'm2'): number | null => {
    for (const [a, t] of axes) {
      if (a.kind !== kind) continue;
      if (kind === 'mass' && (a as Extract<AxisSpec, { kind: 'mass' }>).parameter !== param) continue;
      return lerp(a.range, t);
    }
    return null;
  };

  // Latent overrides (a latent axis paired with a derived one still writes
  // its lane before the frozen decode below reads z).
  const z = [...view.z0] as number[];
  for (const [a, t] of axes) {
    if (a.kind === 'latent') z[a.index] = lerp(a.range, t);
  }

  // 1. Masses: z-lane softmax baseline, overridden by mass axes. One mass
  //    axis rescales the other two to fill the remainder (preserving their
  //    baseline ratio); two mass axes determine m3 = 1 − m1 − m2.
  let m = decodeMassSoftmax(z[6]!, z[7]!, view.muMax);
  const m1t = value('mass', 'm1');
  const m2t = value('mass', 'm2');
  const EPS_M = 1e-6;
  if (m1t !== null && m2t !== null) {
    const m3 = 1 - m1t - m2t;
    if (m1t < EPS_M || m2t < EPS_M || m3 < EPS_M) {
      return terminalOut(DegenerateReason.MASS_SATURATION, [
        Math.max(m1t, EPS_M), Math.max(m2t, EPS_M), Math.max(m3, EPS_M)]);
    }
    m = [m1t, m2t, m3];
  } else if (m1t !== null || m2t !== null) {
    const idx = m1t !== null ? 0 : 1;
    const target = (m1t ?? m2t)!;
    if (target < EPS_M || target > 1 - 2 * EPS_M) {
      return terminalOut(DegenerateReason.MASS_SATURATION, m);
    }
    const oa = (idx + 1) % 3, ob = (idx + 2) % 3;
    const rest = m[oa]! + m[ob]!;
    const wa = rest > EPS_M ? m[oa]! / rest : 0.5;
    const next: [number, number, number] = [0, 0, 0];
    next[idx] = target;
    next[oa] = (1 - target) * wa;
    next[ob] = (1 - target) * (1 - wa);
    m = next;
  }
  if (m[0] + m[1] < 1e-10) {
    return terminalOut(DegenerateReason.M01_TINY, m);
  }

  // 2. Geometry: α/β from shape axes, else frozen from the z lanes using
  //    the latent pipeline's own maps (configuration.ts).
  const alphaSpan = Math.PI / 2 - 2 * view.alphaMin;
  let alpha = view.alphaMin + alphaSpan * sigmoid(z[0]!);
  let beta = Math.PI * sigmoid(z[1]!);
  const aT = value('shape_alpha');
  const bT = value('shape_beta');
  if (aT !== null) alpha = Math.min(Math.max(aT, view.alphaMin), Math.PI / 2 - view.alphaMin);
  if (bT !== null) beta = Math.min(Math.max(bT, 0), Math.PI);
  const r: Triple<Vec2> = realiseFrozenConfig(alpha, beta, m);

  // 3. Momenta: an lz/energy axis engages the deterministic (Lz, K)
  //    construction (the LE/LK charts' machinery; I = 1 at the frozen
  //    geometry); otherwise the z momentum lanes decode as usual.
  const lzT = value('lz');
  const eT = value('energy');
  let p: Triple<Vec2>;
  if (lzT !== null || eT !== null) {
    const Lz = lzT ?? numberParam(view, 'LzFrozen', 0);
    // An energy axis targets total E: K = E − U(r) at the frozen geometry.
    const U = totalEnergy(m, r, [[0, 0], [0, 0], [0, 0]]);
    const K = eT !== null ? eT - U : numberParam(view, 'KFrozen', 1);
    if (K < 0) return terminalOut(DegenerateReason.INFEASIBLE_ENERGY, m);
    const mc = constructMomentaForLzK(m, r, Lz, K, 1);
    if (mc.kind === 'infeasible') {
      return terminalOut(DegenerateReason.INFEASIBLE_ENERGY, m);
    }
    if (mc.kind === 'seeds_exhausted') {
      return terminalOut(DegenerateReason.MOMENTUM_SEEDS_EXHAUSTED, m);
    }
    p = [
      [m[0]! * mc.v[0][0], m[0]! * mc.v[0][1]],
      [m[1]! * mc.v[1][0], m[1]! * mc.v[1][1]],
      [m[2]! * mc.v[2][0], m[2]! * mc.v[2][1]],
    ];
  } else {
    const jm = decodeFreeJacobiMomenta([z[2]!, z[3]!, z[4]!, z[5]!], view.qMax);
    p = jacobiToParticleMomenta(jm, m);
  }

  // 4. Shared tail: canonicalise + the one descriptor constructor.
  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: view.deltaLambda, rColl: view.rColl });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

function terminalOut(
  reason: DegenerateReason, m: readonly [number, number, number],
): ChartDecodeOut {
  return makeTerminal(
    { kind: 'DEGENERATE', reason }, m as [number, number, number]);
}

function numberParam(view: ChartView, key: string, dflt: number): number {
  const x = view.chartParams[key];
  return typeof x === 'number' && Number.isFinite(x) ? x : dflt;
}

/** Build the shared method set for a given axis-spec source. The source
 *  must tolerate an absent view (inverseEncode's optional param): the
 *  factory's closure source ignores it; the registered source falls back
 *  to the default axes. */
function makeMethods(
  axesFor: (view?: ChartView) => { hAxis: AxisSpec; vAxis: AxisSpec },
): Pick<Chart, 'chartUniforms' | 'affineSlice' | 'decode' | 'inverseEncode' | 'validate'> {
  return {
    chartUniforms() {
      return CHART_UNIFORMS_DEFAULTS;
    },
    affineSlice(view) {
      // Only latent × latent is affine in z; every other pairing routes
      // through the CPU-decoded upload path (per-pixel masses/momenta).
      const { hAxis, vAxis } = axesFor(view);
      if (hAxis.kind !== 'latent' || vAxis.kind !== 'latent') return null;
      type Mut8 = [number, number, number, number, number, number, number, number];
      const zero8 = (): Mut8 => [0, 0, 0, 0, 0, 0, 0, 0];
      const z0 = [...view.z0] as Mut8;
      const q1 = zero8();
      const q2 = zero8();
      const [hLo, hHi] = hAxis.range;
      const [vLo, vHi] = vAxis.range;
      z0[hAxis.index] = (hLo + hHi) / 2;
      z0[vAxis.index] = (vLo + vHi) / 2;
      q1[hAxis.index] = (hHi - hLo) / 2;
      q2[vAxis.index] = (vHi - vLo) / 2;
      return { z0: z0 as Vec8, q1: q1 as Vec8, q2: q2 as Vec8, mag: 1 };
    },
    decode(uv, view) {
      const { hAxis, vAxis } = axesFor(view);
      return composeDecode(hAxis, vAxis, uv, view);
    },
    inverseEncode(ic, view) {
      const { hAxis, vAxis } = axesFor(view);
      if (hAxis.kind === 'latent' && vAxis.kind === 'latent') {
        const enc = inverseEncodeLatent(ic, LATENT_KNOBS);
        const clampU = (x: number): number => Math.min(1, Math.max(0, x));
        const [hLo, hHi] = hAxis.range;
        const [vLo, vHi] = vAxis.range;
        const s = clampU((enc.z[hAxis.index]! - hLo) / (hHi - hLo));
        const t = clampU((enc.z[vAxis.index]! - vLo) / (vHi - vLo));
        return { kind: enc.clamped ? 'projected' : 'exact',
                 pixel: { s, t }, z: enc.z, clamped: enc.clamped };
      }
      return { kind: 'projected',
               reason: 'mixed_axis inverse for derived axes lands in Stage 5' };
    },
    validate([u, v]) {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        return { kind: 'reject', reason: 'uv out of range' };
      }
      return { kind: 'pass' };
    },
  };
}

/**
 * The registered mixed-axis chart: ONE instance whose axis specs are DATA,
 * read per call from `view.chartParams.hAxis/vAxis` (already part of the
 * tile cache key and the retained-buffer key, so axis edits invalidate).
 * This is the spec's custom-chart mechanism: any two coordinates as axes,
 * the remaining six frozen.
 */
export const mixedAxisChart: Chart = {
  id: 'mixed_axis',
  kind: 'mixed',
  // Static flags cover the widest case (axes are per-view data): mass axes
  // vary mass per pixel. The flag is advisory today — the live mechanism is
  // affineSlice returning null, which routes through per-pixel upload.
  flags: FLAGS_MASS_VARYING,
  ...makeMethods(axesOf),
};

/**
 * Programmatic factory (tests / embedding): axis specs fixed at
 * construction. Redundant pairings throw HERE — never per pixel — so any
 * constructed chart's decode is total.
 */
export function makeMixedAxisChart(opts: {
  hAxis: AxisSpec; vAxis: AxisSpec;
}): Chart {
  if (!isAxisSpec(opts.hAxis) || !isAxisSpec(opts.vAxis)) {
    throw new Error('mixed_axis: malformed axis spec is not constructible');
  }
  const err = pairingError(opts.hAxis, opts.vAxis);
  if (err !== null) {
    throw new Error(`mixed_axis: ${err} — pairing is not constructible`);
  }
  const hasMass = opts.hAxis.kind === 'mass' || opts.vAxis.kind === 'mass';
  return {
    id: 'mixed_axis',
    kind: 'mixed',
    flags: hasMass ? FLAGS_MASS_VARYING : FLAGS_DEFAULT,
    ...makeMethods(() => opts),
  };
}
