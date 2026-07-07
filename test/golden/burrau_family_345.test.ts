import { describe, it, expect } from 'vitest';
import { burrauTriangle } from '@/burrau/euclid.js';
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import { runInspector } from '@/inspector/run.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';
import type { ChartView } from '@/chart_atlas/types.js';

/**
 * Stage 1a golden: the canonical (3, 4, 5) Burrau IC through the chart
 * pipeline (ν → decode → integrate).
 *
 * The physical reference is the f64 adaptive inspector, NOT the
 * fixed-substep symplectic path: the canonical trajectory dips below
 * r_coll = 1e-4 at t ≈ 4.905, which the adaptive integrator resolves as
 * a converged, tolerance-robust COLLISION (identical classification and
 * time across epsRel 1e-9..1e-11 and hMax 1e-2/2e-3, ΔE down to 4.6e-9),
 * while the non-regularized symplectic blows up (drift ~1e+4).
 * Szebehely & Peters' famous escape of the lightest body lives BELOW
 * that threshold — landed as G19's LogH regularized path
 * (test/golden/burrau_regularized: same encounter → COLLISION t ≈ 4.9047
 * with rColl on; with rColl off the run continues to the classical
 * lightest-body escape at t ≈ 24.57 project units). At project
 * thresholds COLLISION(t≈4.905) remains the truth pinned here.
 */
describe('Stage 1a: canonical (3, 4, 5) Burrau golden via the chart pipeline', () => {
  it('the chart pipeline reproduces the spec-canonical IC exactly', () => {
    // ν = 1/2 sits at v = 0.5 of the Euclid chart's ν ∈ [1/32, 31/32].
    const view: ChartView = {
      chartParams: {},
      z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
      mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
      rColl: 1e-4, deltaLambda: 1e-12,
    };
    const out = burrauEuclidChart.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { r, m, p } = out.state;
    // Masses exact: (5, 4, 3) / 12.
    expect(m[0]).toBeCloseTo(5 / 12, 12);
    expect(m[1]).toBeCloseTo(4 / 12, 12);
    expect(m[2]).toBeCloseTo(3 / 12, 12);
    // Rest start.
    for (let i = 0; i < 3; i++) {
      expect(p[i]![0]).toBe(0);
      expect(p[i]![1]).toBe(0);
    }
    // Side lengths survive canonicalisation (COM shift + rotation are
    // isometries): legs 0.6 and 0.8, hypotenuse 1.
    const d01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);
    const d02 = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);
    const d12 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
    expect(d01).toBeCloseTo(0.6, 12);
    expect(d02).toBeCloseTo(0.8, 12);
    expect(d12).toBeCloseTo(1.0, 12);
  });

  it('f64 reference classification: converged sub-r_coll encounter at t ≈ 4.905', () => {
    const { r, m } = burrauTriangle(0.5);
    const res = runInspector(
      { r, m, p: [[0, 0], [0, 0], [0, 0]], t: 0 },
      { ...RK45_DEFAULTS, THorizon: 80, hMin: 1e-13,
        epsRel: 1e-11, epsAbs: 1e-13, fullTrace: false },
    );
    expect(res.outcome).toBe('collision');
    expect(res.tEnd).toBeGreaterThan(4.89);
    expect(res.tEnd).toBeLessThan(4.92);
    expect(res.dMin).toBeLessThan(1e-4);
    // The integration itself is clean — the collision label is physics
    // (at project thresholds), not numerical failure.
    expect(res.deltaEMax).toBeLessThan(1e-7);
  }, 120_000);

  it('the first four primitive triples produce distinct decoded geometries', () => {
    const view: ChartView = {
      chartParams: {},
      z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
      mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
      rColl: 1e-4, deltaLambda: 1e-12,
    };
    // ν values of (3,4,5), (5,12,13), (15,8,17), (7,24,25).
    const nus = [1 / 2, 2 / 3, 1 / 4, 3 / 4];
    const ratios = nus.map((nu) => {
      const v = (nu - 1 / 32) / (30 / 32);
      const out = burrauEuclidChart.decode([0.5, v], view);
      expect(out.kind).toBe('ok');
      if (out.kind !== 'ok') return NaN;
      const { r } = out.state;
      const d01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);
      const d02 = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);
      return d01 / d02;
    });
    const unique = new Set(ratios.map((x) => x.toFixed(10)));
    expect(unique.size).toBe(4);
  });
});
