import { describe, it, expect } from 'vitest';
import '@/chart_atlas/index.js';
import { allCharts } from '@/chart_atlas/registry.js';
import { makeMixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
import type { Chart, ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Vec8 } from '@/math/types.js';

/**
 * G5 golden: decode ∘ inverseEncode ∘ decode is a state identity.
 *
 * Pixel equality is NOT the invariant here — several charts carry declared
 * redundancy (shape_sphere folds u ↔ 1−u, burrau_euclid's u is display-
 * only), so the robust fact to pin is state equivalence: re-decoding the
 * inverse's pixel must reproduce the original canonical state. Both decode
 * outputs are canonicalised, so they are directly comparable component-
 * wise. Where a chart has no declared redundancy we additionally pin exact
 * pixel recovery.
 */

const Z0: Vec8 = [0, 0, 0, 0, 0, 0, 0, 0];
const Q1: Vec8 = [1, 0, 0, 0, 0, 0, 0, 0];
const Q2: Vec8 = [0, 1, 0, 0, 0, 0, 0, 0];

const base = {
  z0: Z0, q1: Q1, q2: Q2, mag: 1.5,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

const VIEW_FOR: Record<string, ChartView> = {
  latent_slice: { ...base, chartParams: {} },
  lz_e: {
    ...base, m: [1 / 3, 1 / 3, 1 / 3],
    chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  },
  lz_k: {
    ...base, m: [1 / 3, 1 / 3, 1 / 3],
    chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  },
  shape_sphere: {
    ...base, m: [1 / 3, 1 / 3, 1 / 3],
    chartParams: { poleBuffer: 0.05 },
  },
  mass_simplex: {
    ...base, chartParams: { alpha: Math.PI / 4, beta: Math.PI / 2 },
  },
  burrau_euclid: { ...base, chartParams: {} },
  mixed_axis: { ...base, chartParams: {} },
  jacobi_position: { ...base, m: [1 / 3, 1 / 3, 1 / 3], chartParams: {} },
  jacobi_momentum: { ...base, m: [1 / 3, 1 / 3, 1 / 3], chartParams: {} },
};

/** Charts with no declared pixel redundancy: the inverse must also recover
 *  the original pixel, not just an equivalent one. */
const NO_REDUNDANCY = new Set([
  'latent_slice', 'lz_e', 'lz_k', 'mass_simplex', 'mixed_axis',
  'jacobi_position', 'jacobi_momentum',
]);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function expectStatesClose(a: TrajState, b: TrajState, label: string): void {
  for (let i = 0; i < 3; i++) {
    expect(b.m[i], `${label}: m[${i}]`).toBeCloseTo(a.m[i]!, 9);
    for (const k of [0, 1] as const) {
      expect(b.r[i]![k], `${label}: r[${i}][${k}]`).toBeCloseTo(a.r[i]![k], 6);
      expect(b.p[i]![k], `${label}: p[${i}][${k}]`).toBeCloseTo(a.p[i]![k], 6);
    }
  }
}

const charts: readonly Chart[] = [
  ...allCharts(),
  makeMixedAxisChart({
    hAxis: { kind: 'latent', index: 0, range: [-2, 2] },
    vAxis: { kind: 'latent', index: 1, range: [-2, 2] },
  }),
];

describe('G5 golden: chart inverses are state-consistent with decode', () => {
  for (const chart of charts) {
    it(`${chart.id}: decode(inverseEncode(state).pixel) reproduces the state`, () => {
      const view = VIEW_FOR[chart.id];
      if (!view) throw new Error(`no view fixture for chart ${chart.id}`);

      const rng = lcg(17);
      let okCount = 0, exactCount = 0;
      for (let n = 0; n < 100; n++) {
        const u = rng(), v = rng();
        const out = chart.decode([u, v], view);
        if (out.kind !== 'ok') continue;   // decode totality is pinned elsewhere
        okCount++;

        const label = `${chart.id} @ (${u.toFixed(6)}, ${v.toFixed(6)})`;
        const inv = chart.inverseEncode(out.state, view);
        expect(inv.kind === 'exact' || inv.kind === 'projected', `${label}: kind`).toBe(true);
        if (!inv.pixel) throw new Error(`${label}: inverse returned no pixel`);
        expect(inv.pixel.s, `${label}: s in range`).toBeGreaterThanOrEqual(0);
        expect(inv.pixel.s, `${label}: s in range`).toBeLessThanOrEqual(1);
        expect(inv.pixel.t, `${label}: t in range`).toBeGreaterThanOrEqual(0);
        expect(inv.pixel.t, `${label}: t in range`).toBeLessThanOrEqual(1);

        if (inv.kind !== 'exact') continue;  // projected pixels are lossy by contract
        exactCount++;

        if (NO_REDUNDANCY.has(chart.id)) {
          expect(inv.pixel.s, `${label}: exact s`).toBeCloseTo(u, 6);
          expect(inv.pixel.t, `${label}: exact t`).toBeCloseTo(v, 6);
        }

        const again = chart.decode([inv.pixel.s, inv.pixel.t], view);
        expect(again.kind, `${label}: re-decode kind`).toBe('ok');
        if (again.kind !== 'ok') continue;
        expectStatesClose(out.state, again.state, label);
      }

      // The sweep must exercise the exact path substantially — a chart
      // that answers 'projected' everywhere would pass vacuously.
      expect(okCount).toBeGreaterThan(50);
      expect(exactCount).toBeGreaterThan(30);
    });
  }
});
