import type { Vec2, Vec3, Vec8, Triple } from '@/math/types.js';
import type { ViewState } from './view_state.js';
import { decodeLatent } from '@/decode/pipeline.js';
import { inverseEncodeLatent } from '@/decode/inverse.js';
import { setAllSliders } from './sliders.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND, EPS_DECODE,
} from '@/math/constants.js';

const KNOBS = {
  muMax: MU_MAX_DEFAULT, alphaMin: ALPHA_MIN_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND, RTilde: 1,
  epsMu: EPS_DECODE, epsZ: EPS_DECODE,
};

export type LookupInput =
  | { kind: 'latent';  z: Vec8 }
  | { kind: 'mass';    m: Vec3 }
  | { kind: 'pythag';  m: number; n: number }
  | { kind: 'pythag_triple'; a: number; b: number; c: number }
  | { kind: 'physical'; m: Vec3; r: Triple<Vec2>; p: Triple<Vec2> };

export type LookupResult =
  | { kind: 'ok'; view: ViewState; clamped: boolean; reason?: string }
  | { kind: 'rejected'; reason: string };

/**
 * Convert any lookup input into a physical IC, then inverse-encode into
 * latent space, then write through the active view.
 *
 * Defaults for unspecified inputs:
 *   - mass-only input → balanced equilateral triangle at the implied
 *     masses, rest start.
 *   - pythag → Burrau IC (mass = opposite-side / sum, classical 1-indexed).
 *   - pythag_triple → same, with explicit (a, b, c).
 *
 * NB the latent chart is scale- and frame-gauged (hyperradius R̃ = 1,
 * canonical COM frame): the returned `lockedPhysical` preserves the mass
 * tuple, distance ratios, and angles of the request — not its absolute
 * positions or scale.
 */
export function lookup(input: LookupInput, v: ViewState): LookupResult {
  switch (input.kind) {
    case 'latent': {
      const dec = decodeLatent(input.z, KNOBS);
      if (dec.kind === 'terminal') {
        return { kind: 'rejected', reason: `terminal at decode: ${dec.terminal.kind}` };
      }
      return { kind: 'ok',
               view: { ...setAllSliders(v, input.z),
                       locked: true, lockedPhysical: { m: dec.state.m,
                                                        r: dec.state.r,
                                                        p: dec.state.p } },
               clamped: false };
    }

    case 'mass': {
      // Default geometry: a balanced equilateral, rest start.
      const r: Triple<Vec2> = [
        [ 1.0,            0.0],
        [-0.5,  Math.sqrt(3)/2],
        [-0.5, -Math.sqrt(3)/2],
      ];
      return lookupFromPhysical({ m: input.m, r, p: [[0,0],[0,0],[0,0]] }, v);
    }

    case 'pythag': {
      const a = input.m * input.m - input.n * input.n;
      const b = 2 * input.m * input.n;
      const c = input.m * input.m + input.n * input.n;
      return lookupFromPythag(a, b, c, v);
    }

    case 'pythag_triple':
      return lookupFromPythag(input.a, input.b, input.c, v);

    case 'physical':
      return lookupFromPhysical(input, v);
  }
}

function lookupFromPythag(
  a: number, b: number, c: number, v: ViewState,
): LookupResult {
  // Burrau classical (1-indexed): body 1 at right angle (mass=c/Σ),
  // body 2 at (a/c, 0) (mass=b/Σ), body 3 at (0, b/c) (mass=a/Σ). We
  // re-index to 0-indexed: body 1→0, body 2→1, body 3→2.
  const total = a + b + c;
  const m: Vec3 = [c/total, b/total, a/total];
  const r: Triple<Vec2> = [[0,0], [a/c, 0], [0, b/c]];
  return lookupFromPhysical({ m, r, p: [[0,0],[0,0],[0,0]] }, v);
}

function lookupFromPhysical(
  s: { m: Vec3; r: Triple<Vec2>; p: Triple<Vec2> },
  v: ViewState,
): LookupResult {
  const enc = inverseEncodeLatent({ m: s.m, r: s.r, p: s.p, t: 0 }, KNOBS);

  // Decode again to verify and surface any clamping.
  const dec = decodeLatent(enc.z, KNOBS);
  if (dec.kind === 'terminal') {
    return { kind: 'rejected',
             reason: `inverse encode hit a terminal label: ${dec.terminal.kind}` };
  }
  return {
    kind: 'ok',
    view: { ...setAllSliders(v, enc.z),
            locked: true,
            lockedPhysical: { m: dec.state.m, r: dec.state.r, p: dec.state.p } },
    clamped: enc.clamped,
    // Conditional spread: `reason: undefined` is illegal under
    // exactOptionalPropertyTypes.
    ...(enc.clamped ? { reason: 'lookup_clamped' } : {}),
  };
}
