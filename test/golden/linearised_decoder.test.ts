import { describe, it, expect } from 'vitest';
import { buildLinearised, applyLinearised } from '@/decode/linearised.js';
import { decodeLatent } from '@/decode/pipeline.js';
import type { TrajState } from '@/math/types.js';
import type { LatentZ } from '@/decode/types.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

/**
 * G6 golden: the linearised decoder at depth 30.
 *
 * The tile sits at global-UV centre (0.31, 0.57) — a generic, asymmetric
 * point of the M3 default latent slice (u → z0, v → z1, ±1 range here) —
 * with half-width 2⁻³¹ (depth 30). Everything below runs at f64; the
 * GPU-side f32 behaviour of the same arithmetic is covered by the
 * integration test.
 */
const CENTRE: readonly [number, number] = [0.31, 0.57];
const HALF = Math.pow(2, -31);

function decodeAtTileUV(uv: [number, number]): TrajState | null {
  const gu = CENTRE[0] + HALF * (2 * uv[0] - 1);
  const gv = CENTRE[1] + HALF * (2 * uv[1] - 1);
  const z: LatentZ = [2 * gu - 1, 2 * gv - 1, 0, 0, 0, 0, 0, 0];
  const out = decodeLatent(z, KNOBS);
  return out.kind === 'ok' ? out.state : null;
}

function phaseNorm(a: TrajState, b: TrajState): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    s += (a.r[i]![0] - b.r[i]![0]) ** 2 + (a.r[i]![1] - b.r[i]![1]) ** 2;
    s += (a.p[i]![0] - b.p[i]![0]) ** 2 + (a.p[i]![1] - b.p[i]![1]) ** 2;
    s += (a.m[i]! - b.m[i]!) ** 2;
  }
  return Math.sqrt(s);
}

describe('linearised decoder at deep zoom (depth 30)', () => {
  it('the full path hits the f32 floor: every sample offset rounds away', () => {
    // The motivating failure: at depth 30 the per-sample latent offsets
    // are ~2⁻³³ while the latent value is O(1) — far below one f32 ulp —
    // so the full nonlinear path's INPUT is already bitwise-constant
    // across the tile before any decode arithmetic runs.
    const zc = 2 * CENTRE[0] - 1;
    const tileSpan = 2 * (2 * HALF);          // full z-span of the tile
    expect(Math.fround(zc + tileSpan)).toBe(Math.fround(zc));
    expect(Math.fround(zc + tileSpan / 16)).toBe(Math.fround(zc));
  });

  it('produces distinct samples across a 16×16 tile', () => {
    const ref = buildLinearised(decodeAtTileUV);
    expect(ref).not.toBeNull();
    if (!ref) return;

    const seen = new Set<string>();
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        const ic = applyLinearised(ref, [(i + 0.5) / 16, (j + 0.5) / 16]);
        seen.add([
          ...ic.r.flatMap((v) => [v[0], v[1]]),
          ...ic.p.flatMap((v) => [v[0], v[1]]),
        ].join(','));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(240);   // exit-criterion gate
  });

  it('matches the full f64 decoder to 1e-13 in phase-space norm', () => {
    const ref = buildLinearised(decodeAtTileUV);
    expect(ref).not.toBeNull();
    if (!ref) return;

    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        const t: [number, number] = [i / 4, j / 4];
        const linear = applyLinearised(ref, t);
        const truth = decodeAtTileUV(t);
        expect(truth).not.toBeNull();
        if (!truth) continue;
        expect(phaseNorm(linear, truth),
               `at tile-local (${t[0]}, ${t[1]})`).toBeLessThan(1e-13);
      }
    }
  });

  it('the centre reference reproduces the full decode exactly', () => {
    const ref = buildLinearised(decodeAtTileUV);
    if (!ref) throw new Error('expected a reference');
    const centre = decodeAtTileUV([0.5, 0.5]);
    if (!centre) throw new Error('expected an ok centre decode');
    expect(phaseNorm(ref.x0, centre)).toBe(0);
    const applied = applyLinearised(ref, [0.5, 0.5]);
    expect(phaseNorm(applied, centre)).toBeLessThan(1e-15);
  });
});
