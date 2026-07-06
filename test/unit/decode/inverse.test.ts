import { describe, it, expect } from 'vitest';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';
import type { LatentZ } from '@/decode/types.js';

const knobs = {
  muMax: MU_MAX_DEFAULT,
  alphaMin: ALPHA_MIN_DEFAULT,
  qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT,
  deltaLambda: EPS_DEADBAND,
  RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

describe('latent encode/decode round-trip', () => {
  it('holds at 1000 random non-saturated points to better than 1e-9', () => {
    let rng = 12345;
    const next = () => {
      rng = (rng * 1664525 + 1013904223) & 0xffffffff;
      return ((rng >>> 0) / 0xffffffff - 0.5) * 2;       // uniform [-1, 1]
    };
    let mismatches = 0;
    for (let trial = 0; trial < 1000; trial++) {
      const z: LatentZ = [
        next(), next(),
        next()*0.5, next()*0.5, next()*0.5, next()*0.5,
        next(), next(),
      ];
      const r = decodeLatent(z, knobs);
      if (r.kind !== 'ok') continue;
      const back = inverseEncodeLatent(r.state, knobs);
      if (back.clamped) continue;       // skip clamping cases
      const r2 = decodeLatent(back.z, knobs);
      if (r2.kind !== 'ok') { mismatches++; continue; }
      // Compare physical state, not z (z can have multiple representations
      // when α is near α_min, etc).
      for (let i = 0; i < 3; i++) {
        if (Math.abs(r2.state.r[i]![0] - r.state.r[i]![0]) > 1e-9) mismatches++;
        if (Math.abs(r2.state.r[i]![1] - r.state.r[i]![1]) > 1e-9) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});
