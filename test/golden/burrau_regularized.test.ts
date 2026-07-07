import { describe, it, expect } from 'vitest';
import { runRegularized } from '@/integrate/regularize.js';
import { burrauTriangle } from '@/burrau/euclid.js';
import type { TrajState } from '@/math/types.js';

/**
 * G19 precision golden: the canonical (3, 4, 5) Burrau rest start,
 * integrated THROUGH its close encounters with LogH regularization — the
 * golden M1 originally wanted and empirically could not have on the
 * non-regularized substep path (blow-up or MAX_SUBSTEPS at every dt).
 *
 * Reference config: order-6 LogH, hFict = 2.5e-4, rColl = 0 (integrate
 * through the sub-1e-4 encounters). Generated once on the reference
 * machine (fixture policy), convergence-verified in-run below.
 *
 * Physics cross-checks (project units: unit hypotenuse, Σm = 1, G = 1;
 * lengths are Szebehely–Peters' /5, masses /12, times ×√(12/125)⁻¹…
 * i.e. t_project ≈ 0.3098 · t_SP):
 *  - The deep pair-(0,1) encounter: SP's famous closest approach
 *    (t_SP ≈ 15.83) lands at t ≈ 4.905 — with rColl = 1e-4 the run
 *    classifies COLLISION there, matching the pinned f64 DOPRI5
 *    inspector truth (test/golden/burrau_family_345) to 4 digits.
 *  - The final escape: the LIGHTEST body (index 2, mass 3/12) escapes,
 *    Szebehely & Peters' classical result.
 */

const REFERENCE = {
  hFict: 2.5e-4,
  REsc: 10,
  kEsc: 8,
  order: 6,
} as const;

/** Pinned by the 2026-07 reference run (see file header). */
const ESCAPE_T = 24.571746811280217;
const RMIN = 8.282384e-5;

/** Pinned checkpoint positions (t ≈ 3k, k = 1..8; THorizon 24, rColl 0).
 *  Tolerances grade with time: the t ≈ 4.9 encounter at r ≈ 8e-5
 *  amplifies float-level differences by ~1e4, and the flow is chaotic
 *  after it — the pins are regression tripwires, the accuracy claim is
 *  the drift + convergence gates. */
const CHECKPOINTS: ReadonlyArray<{ t: number; r: TrajState['r']; tol: number }> = [
  { t: 3.000220012678594, tol: 1e-7, r: [
    [-0.19049890430012606, 0.05556512967076884],
    [0.3781106414688383, 0.04325055187829904],
    [-0.1866493481249077, -0.1502759519556801]] },
  { t: 6.000319624476709, tol: 1e-5, r: [
    [0.11062363967541629, -0.11096104280496222],
    [0.33644233348996444, 0.0903392090091981],
    [-0.6329625107789797, 0.06448279266267287]] },
  { t: 9.000189569110717, tol: 1e-5, r: [
    [-0.17121782019881698, -0.053333327475418794],
    [0.2847125838338925, -0.08864792502851238],
    [-0.09425374478049489, 0.20708611249704784]] },
  { t: 12.000312498596525, tol: 1e-4, r: [
    [0.11463315328748111, 0.18207277743474612],
    [-0.12553692358120125, -0.6134219729875935],
    [-0.023672690704200194, 0.5144413349255478]] },
  { t: 15.00009732931319, tol: 1e-4, r: [
    [0.020095511483098814, 0.29082035095210174],
    [-0.33569444979111734, 0.049812669185577044],
    [0.4141000805829918, -0.5511174771676055]] },
  { t: 18.00001022510649, tol: 1e-3, r: [
    [0.06458088893325012, 0.27302879294681287],
    [-0.2934191669549569, 0.03175396334804741],
    [0.2835907410511923, -0.4973866060420846]] },
  { t: 21.00011449063962, tol: 1e-2, r: [
    [0.46541758908933467, -1.0851701099292548],
    [0.2690107517311549, -1.1208668035779594],
    [-1.1343769841237643, 3.3031059213193705]] },
  { t: 24.000097746294458, tol: 1e-2, r: [
    [0.8312184157411657, -2.1453072080098057],
    [0.620464534502743, -2.1978088944526255],
    [-2.212650072238934, 6.505923872619844]] },
];

function burrauRest(): TrajState {
  const { r, m } = burrauTriangle(0.5);
  return { r, m, p: [[0, 0], [0, 0], [0, 0]], t: 0 };
}

describe('Burrau 3-4-5 canonical: regularized precision golden (G19)', () => {
  it('escapes the lightest body with drift < 1e-7 and a converged escape time', () => {
    const res = runRegularized(burrauRest(),
      { ...REFERENCE, THorizon: 60, rColl: 0 });

    // 1. The classical outcome: ESCAPE of the lightest body (index 2).
    expect(res.terminal.kind).toBe('ESCAPE');
    if (res.terminal.kind !== 'ESCAPE') return;
    expect(res.terminal.body).toBe(2);

    // 2. The precision gate M1 wanted: relative energy drift < 1e-7.
    //    (Measured ≈ 1.1e-11 — four orders inside the gate.)
    expect(res.diagnostics.energyDrift).toBeLessThan(1e-7);
    expect(res.diagnostics.lzDrift).toBeLessThan(1e-6);

    // 3. Escape-time regression pin (loose: cross-platform float noise is
    //    amplified ~1e4 by the r ≈ 8e-5 encounter).
    expect(Math.abs(res.terminal.t - ESCAPE_T)).toBeLessThan(1e-2);

    // 4. The encounter depth is real and stable: the run dives an order
    //    of magnitude below the default collision threshold and survives.
    expect(res.diagnostics.rMin).toBeGreaterThan(RMIN * 0.9);
    expect(res.diagnostics.rMin).toBeLessThan(RMIN * 1.1);

    // 5. Convergence: a 2× step refinement moves the detected escape time
    //    by < 0.1 (measured 0.007 for h → h/2 at the reference h).
    const fine = runRegularized(burrauRest(),
      { ...REFERENCE, hFict: REFERENCE.hFict / 2, THorizon: 60, rColl: 0 });
    expect(fine.terminal.kind).toBe('ESCAPE');
    if (fine.terminal.kind !== 'ESCAPE') return;
    expect(fine.terminal.body).toBe(2);
    expect(Math.abs(fine.terminal.t - res.terminal.t)).toBeLessThan(0.1);
  }, 120000);

  it('pins the checkpoint positions of the reference run', () => {
    const res = runRegularized(burrauRest(),
      { ...REFERENCE, THorizon: 24, rColl: 0 }, { checkpoints: 8 });
    expect(res.terminal.kind).toBe('BOUNDED');
    expect(res.trace).toBeDefined();
    // trace[0] is s0; crossings follow.
    const crossings = res.trace!.slice(1);
    expect(crossings.length).toBe(CHECKPOINTS.length);
    for (let k = 0; k < CHECKPOINTS.length; k++) {
      const want = CHECKPOINTS[k]!;
      const got = crossings[k]!;
      expect(Math.abs(got.t - want.t)).toBeLessThan(1e-9);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(got.r[i]![0] - want.r[i]![0]),
          `checkpoint ${k} body ${i} x`).toBeLessThan(want.tol);
        expect(Math.abs(got.r[i]![1] - want.r[i]![1]),
          `checkpoint ${k} body ${i} y`).toBeLessThan(want.tol);
      }
    }
  }, 120000);

  it('reproduces the inspector collision truth at project thresholds', () => {
    // With rColl = 1e-4 ON, the regularized run must classify the deep
    // pair-(0,1) encounter as the SAME converged COLLISION the f64
    // adaptive inspector pinned (t ≈ 4.905, test/golden/burrau_family_345)
    // — two independent integrators agreeing on the classification.
    const res = runRegularized(burrauRest(),
      { ...REFERENCE, THorizon: 60, rColl: 1e-4 });
    expect(res.terminal.kind).toBe('COLLISION');
    if (res.terminal.kind !== 'COLLISION') return;
    expect(res.terminal.pair).toBe(0);
    expect(Math.abs(res.terminal.t - 4.9047)).toBeLessThan(5e-3);
  }, 120000);
});
