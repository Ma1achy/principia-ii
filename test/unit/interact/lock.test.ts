import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { lockAffine, unlock, physicalToLatent } from '@/interact/lock.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

describe('lockAffine', () => {
  it('centre pixel preserves the slice centre', () => {
    const v0 = defaultViewState();
    const v1 = lockAffine(v0, { s: 0.5, t: 0.5 });
    expect(v1.z0).toEqual(v0.z0);
    expect(v1.locked).toBe(true);
    expect(v1.lockedPhysical).toBeDefined();
  });

  it('off-centre pixel applies the affine offset', () => {
    let v = defaultViewState();
    v = { ...v, mag: 2 };
    const v1 = lockAffine(v, { s: 1.0, t: 0.5 });
    // s=1 → +1 along q1 → +mag along z[0].
    expect(v1.z0[0]).toBeCloseTo(2, 12);
    expect(v1.z0[1]).toBeCloseTo(0, 12);
  });

  it('unlock clears the physical pin', () => {
    const v = lockAffine(defaultViewState(), { s: 0.3, t: 0.7 });
    const u = unlock(v);
    expect(u.locked).toBe(false);
    expect(u.lockedPhysical).toBeUndefined();
  });
});

describe('physicalToLatent round-trip', () => {
  it('decodes back to within 1e-9 in the affine-chart case', () => {
    // Pick a non-trivial latent point well away from saturation.
    const z = [0.3, -0.5, 0.1, -0.1, 0.0, 0.05, 0.2, -0.2] as any;
    const dec = decodeLatent(z, KNOBS);
    if (dec.kind !== 'ok') throw new Error('expected ok');
    const back = physicalToLatent(dec.state.m, dec.state.r, dec.state.p);
    expect(back.clamped).toBe(false);
    const decBack = decodeLatent(back.z, KNOBS);
    if (decBack.kind !== 'ok') throw new Error('expected ok back');
    for (let i = 0; i < 3; i++) {
      expect(decBack.state.r[i]![0]).toBeCloseTo(dec.state.r[i]![0], 9);
      expect(decBack.state.r[i]![1]).toBeCloseTo(dec.state.r[i]![1], 9);
    }
  });
});
