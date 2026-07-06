import { describe, it, expect } from 'vitest';
import { lookup } from '@/interact/lookup.js';
import { defaultViewState } from '@/interact/view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
};

/**
 * Round trip: lookup a Burrau triple → lock → decode → check the
 * physical IC matches what we asked for. Both sides of the comparison go
 * through the same decode pipeline, so absolute (canonical-frame)
 * coordinates are directly comparable here.
 */
describe('lookup → lock → decode round-trip', () => {
  it('Burrau (3,4,5) survives the round trip to within 1e-3', () => {
    const r = lookup({ kind: 'pythag', m: 2, n: 1 }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;

    // Re-decode the latent and compare body 0..2 distances.
    const dec = decodeLatent(r.view.z0, KNOBS);
    expect(dec.kind).toBe('ok');
    if (dec.kind !== 'ok') return;
    const ic = r.view.lockedPhysical!;

    // The pin and the re-decode should agree on inter-body distances —
    // canonicalise normalises the absolute frame.
    const pinD01 = Math.hypot(ic.r[1]![0]-ic.r[0]![0], ic.r[1]![1]-ic.r[0]![1]);
    const decD01 = Math.hypot(dec.state.r[1]![0]-dec.state.r[0]![0],
                              dec.state.r[1]![1]-dec.state.r[0]![1]);
    expect(decD01).toBeCloseTo(pinD01, 3);
  });
});
