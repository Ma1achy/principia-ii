import type { TrajState, Triple, Vec2, Vec3 } from '@/math/types.js';
import type { ICDescriptor } from './types.js';
import { makeDescriptor } from './pipeline.js';

/**
 * Linearised decoder reference (G6, spec §6.5). At deep zoom the full
 * nonlinear decode chain (sigmoid → softmax → trig → canonicalise) loses
 * significant digits at f32 faster than the tile narrows; past depth ~20
 * adjacent samples decode to bitwise-identical ICs. The fix: evaluate the
 * full decoder at f64 on the CPU at the tile centre (`x0`), plus its
 * Jacobian in half-tile δ-units, and let the GPU reconstruct per-sample
 * ICs as x(t) = x0 + J · (2t − 1).
 */
export interface LinearisedReference {
  /** Reference IC at the tile centre, computed at f64. */
  x0: TrajState;
  /** Descriptor of the centre IC (per-tile descriptors are centre-point
   *  anyway); built by the one makeDescriptor (D10.1). */
  descriptor0: ICDescriptor;
  /**
   * Jacobian at the centre in δ-units, where δ = 2t − 1 ∈ [−1, 1] is the
   * half-tile offset coordinate: x(t) = x0 + J · (2t − 1) reaches the
   * tile edges at δ = ±1. (J_δ = ∂D/∂(tile uv) / 2 — the spec's
   * J_chart · h at the tile scale.) Both applyLinearised and the WGSL
   * decode_linear consume this convention.
   *
   *   J_r[i][k][a] = ∂r_i_k / ∂δ_a   (i ∈ 0..2, k ∈ 0..1, a ∈ {u, v})
   *   J_p[i][k][a] = ∂p_i_k / ∂δ_a
   *   J_m[i][a]    = ∂m_i / ∂δ_a
   */
  J_r: number[][][];          // [3][2][2]
  J_p: number[][][];          // [3][2][2]
  J_m: number[][];            // [3][2]
}

/**
 * Central-difference step in TILE-LOCAL (u, v) units. Deliberately large:
 * at depth 30 the tile spans ~1e-9 of the chart, so a chart-scale step
 * like 1e-6 tile-local would probe a 1e-15-wide physical interval and the
 * f64 difference quotient would be ~10% noise (catastrophic cancellation
 * on O(1) decode outputs). Sampling at centre ± 0.25 — inside the tile,
 * where the decode is smooth precisely because the tile is tiny — keeps
 * the quotient noise ~1e-9 relative while the O(h²) truncation term is
 * bounded by the tile-scale curvature, which vanishes with depth.
 */
export const FD_STEP_DEFAULT = 0.25;

/**
 * Two-scale smoothness discriminator. The forward/backward asymmetry
 * |fwd − bwd| of a SMOOTH decode is h·|D''| + O(h³) — it halves when the
 * step halves — while a kink (mirror deadband, feasibility projection,
 * sigmoid saturation edge) keeps a constant O(|slope jump|) asymmetry at
 * every scale. A tile is non-smooth when the half-step asymmetry retains
 * more than this fraction of the full-step asymmetry.
 */
const SMOOTHNESS_DECAY_TOL = 0.75;

/** Flatten the 15 state lanes (6 r, 6 p, 3 m) for difference bookkeeping. */
function lanes(s: TrajState): number[] {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) out.push(s.r[i]![0]!, s.r[i]![1]!);
  for (let i = 0; i < 3; i++) out.push(s.p[i]![0]!, s.p[i]![1]!);
  out.push(s.m[0], s.m[1], s.m[2]);
  return out;
}

/**
 * Build the linearised reference at f64. `centreUV` is in tile-local
 * coordinates ((0,0) bottom-left, (1,1) top-right of the tile);
 * `decodeAtUV` maps tile-local uv to a decoded state, or null for
 * terminal pixels. Nine decoder evaluations per tile: centre plus
 * ±fdStep and ±fdStep/2 per axis (Richardson-extrapolated central
 * differences, truncation O(h⁴), plus the two-scale smoothness check) —
 * amortised over N² GPU samples.
 *
 * Returns null when the centre or an FD probe decodes terminal, or when
 * the two-scale check detects a non-smooth point inside the probe
 * interval. Callers fall back to the full nonlinear path; the decode
 * stays total either way.
 */
export function buildLinearised(
  decodeAtUV: (uv: [number, number]) => TrajState | null,
  centreUV: [number, number] = [0.5, 0.5],
  fdStep: number = FD_STEP_DEFAULT,
): LinearisedReference | null {
  const x0 = decodeAtUV(centreUV);
  if (!x0) return null;
  const c = lanes(x0);

  const J_r: number[][][] = [[[0,0],[0,0]],[[0,0],[0,0]],[[0,0],[0,0]]];
  const J_p: number[][][] = [[[0,0],[0,0]],[[0,0],[0,0]],[[0,0],[0,0]]];
  const J_m: number[][]   = [[0,0],[0,0],[0,0]];

  const probe = (axis: 0 | 1, off: number): TrajState | null => {
    const uv: [number, number] = [centreUV[0], centreUV[1]];
    uv[axis] += off;
    return decodeAtUV(uv);
  };

  for (const axis of [0, 1] as const) {
    const h = fdStep;
    const xUp1 = probe(axis, +h),     xDn1 = probe(axis, -h);
    const xUp2 = probe(axis, +h / 2), xDn2 = probe(axis, -h / 2);
    if (!xUp1 || !xDn1 || !xUp2 || !xDn2) return null;
    const lUp1 = lanes(xUp1), lDn1 = lanes(xDn1);
    const lUp2 = lanes(xUp2), lDn2 = lanes(xDn2);

    // Two-scale smoothness check on the forward/backward asymmetry.
    // The noise floor scales with f64 rounding on the LANE VALUES divided
    // by the step — at deep zoom the true differences shrink towards the
    // rounding noise, and an asymmetry indistinguishable from that noise
    // must not read as a kink (it neither decays nor matters).
    let laneScale = 1;
    for (let l = 0; l < 15; l++) laneScale = Math.max(laneScale, Math.abs(c[l]!));
    const noiseFloor = 1e-12 * laneScale / h;
    const asym1: number[] = [], asym2: number[] = [];
    for (let l = 0; l < 15; l++) {
      const f1 = (lUp1[l]! - c[l]!) / h,       b1 = (c[l]! - lDn1[l]!) / h;
      const f2 = (lUp2[l]! - c[l]!) / (h / 2), b2 = (c[l]! - lDn2[l]!) / (h / 2);
      asym1.push(Math.abs(f1 - b1));
      asym2.push(Math.abs(f2 - b2));
    }
    for (let l = 0; l < 15; l++) {
      if (asym1[l]! > noiseFloor &&
          asym2[l]! > SMOOTHNESS_DECAY_TOL * asym1[l]!) {
        return null;          // non-smooth inside the probe — full decode
      }
    }

    // Richardson-extrapolated central difference in tile-uv units, then
    // halved into δ-units (δ = 2t − 1 spans the tile at ±1).
    for (let l = 0; l < 15; l++) {
      const c1 = (lUp1[l]! - lDn1[l]!) / (2 * h);
      const c2 = (lUp2[l]! - lDn2[l]!) / h;
      const dUv = (4 * c2 - c1) / 3;
      const dDelta = dUv / 2;
      if (l < 6)       J_r[l >> 1]![l & 1]![axis] = dDelta;
      else if (l < 12) { const q = l - 6; J_p[q >> 1]![q & 1]![axis] = dDelta; }
      else             J_m[l - 12]![axis] = dDelta;
    }
  }

  return { x0, descriptor0: makeDescriptor(x0), J_r, J_p, J_m };
}

/**
 * Apply the linearised approximation at tile-local t ∈ [0, 1]². This is
 * the CPU twin of `decode_linear` in decode_linear.wgsl — the GPU runs
 * the identical arithmetic at f32.
 */
export function applyLinearised(
  ref: LinearisedReference, t: [number, number],
): TrajState {
  const du = 2 * t[0] - 1;
  const dv = 2 * t[1] - 1;
  const r: Triple<Vec2> = [
    [ref.x0.r[0][0] + ref.J_r[0]![0]![0]! * du + ref.J_r[0]![0]![1]! * dv,
     ref.x0.r[0][1] + ref.J_r[0]![1]![0]! * du + ref.J_r[0]![1]![1]! * dv],
    [ref.x0.r[1][0] + ref.J_r[1]![0]![0]! * du + ref.J_r[1]![0]![1]! * dv,
     ref.x0.r[1][1] + ref.J_r[1]![1]![0]! * du + ref.J_r[1]![1]![1]! * dv],
    [ref.x0.r[2][0] + ref.J_r[2]![0]![0]! * du + ref.J_r[2]![0]![1]! * dv,
     ref.x0.r[2][1] + ref.J_r[2]![1]![0]! * du + ref.J_r[2]![1]![1]! * dv],
  ];
  const p: Triple<Vec2> = [
    [ref.x0.p[0][0] + ref.J_p[0]![0]![0]! * du + ref.J_p[0]![0]![1]! * dv,
     ref.x0.p[0][1] + ref.J_p[0]![1]![0]! * du + ref.J_p[0]![1]![1]! * dv],
    [ref.x0.p[1][0] + ref.J_p[1]![0]![0]! * du + ref.J_p[1]![0]![1]! * dv,
     ref.x0.p[1][1] + ref.J_p[1]![1]![0]! * du + ref.J_p[1]![1]![1]! * dv],
    [ref.x0.p[2][0] + ref.J_p[2]![0]![0]! * du + ref.J_p[2]![0]![1]! * dv,
     ref.x0.p[2][1] + ref.J_p[2]![1]![0]! * du + ref.J_p[2]![1]![1]! * dv],
  ];
  const m: Vec3 = [
    ref.x0.m[0] + ref.J_m[0]![0]! * du + ref.J_m[0]![1]! * dv,
    ref.x0.m[1] + ref.J_m[1]![0]! * du + ref.J_m[1]![1]! * dv,
    ref.x0.m[2] + ref.J_m[2]![0]! * du + ref.J_m[2]![1]! * dv,
  ];
  return { r, p, m, t: 0 };
}
