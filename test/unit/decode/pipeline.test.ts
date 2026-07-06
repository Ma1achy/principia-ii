import { describe, it, expect } from 'vitest';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const knobs = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('decodeLatent — totality', () => {
  it('emits a labelled output for 10000 random latents (no NaN, no throw)', () => {
    let rng = 99;
    const next = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff;
                         return (rng / 0x7fffffff - 0.5) * 4; };
    for (let trial = 0; trial < 10000; trial++) {
      const z = [next(), next(), next(), next(),
                 next(), next(), next(), next()] as any;
      const r = decodeLatent(z, knobs);
      expect(r.kind === 'ok' || r.kind === 'terminal').toBe(true);
      if (r.kind === 'ok') {
        for (let i = 0; i < 3; i++) {
          expect(Number.isFinite(r.state.r[i]![0])).toBe(true);
          expect(Number.isFinite(r.state.r[i]![1])).toBe(true);
          expect(Number.isFinite(r.state.p[i]![0])).toBe(true);
          expect(Number.isFinite(r.state.p[i]![1])).toBe(true);
        }
      }
    }
  });
});
