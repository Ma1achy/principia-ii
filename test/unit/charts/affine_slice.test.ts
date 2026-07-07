import { describe, it, expect } from 'vitest';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import { makeMixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
import { getChart } from '@/chart_atlas/index.js';
import type { ChartView } from '@/chart_atlas/types.js';
import {
  ALPHA_MIN_DEFAULT, MU_MAX_DEFAULT, Q_MAX_DEFAULT,
  R_COLL_DEFAULT, EPS_DEADBAND,
} from '@/math/constants.js';
import type { Vec8 } from '@/math/types.js';

const view = (over: Partial<ChartView> = {}): ChartView => ({
  chartParams: {},
  z0: [0.3, -0.2, 0.1, 0, 0.5, 0, -0.4, 0.2],
  q1: [0, 0, 1, 0, 0, 0, 0, 0],
  q2: [0, 0, 0, 0, 1, 0, 0, 0],
  mag: 1.5,
  alphaMin: ALPHA_MIN_DEFAULT, muMax: MU_MAX_DEFAULT, qMax: Q_MAX_DEFAULT,
  rColl: R_COLL_DEFAULT, deltaLambda: EPS_DEADBAND,
  ...over,
});

describe('Chart.affineSlice (the GPU slice contract)', () => {
  it('latent_slice hands back exactly the view slice', () => {
    const v = view();
    expect(latentSliceChart.affineSlice!(v))
      .toEqual({ z0: v.z0, q1: v.q1, q2: v.q2, mag: v.mag });
  });

  it("latent_slice: decoding through the returned slice IS the chart's decode", () => {
    // The whole point: a GPU applying z = z0 + mag((2u−1)q1 + (2v−1)q2)
    // then the latent decoder must land on the same IC the CPU chart
    // produces. Route the slice back through latent_slice.decode itself
    // (public API only) and compare states.
    const v = view();
    const s = latentSliceChart.affineSlice!(v)!;
    const sliceView = view({ z0: s.z0, q1: s.q1, q2: s.q2, mag: s.mag });
    for (const [u, w] of [[0.2, 0.7], [0.5, 0.5], [0.9, 0.1]] as const) {
      const a = latentSliceChart.decode([u, w], v);
      const b = latentSliceChart.decode([u, w], sliceView);
      expect(b).toEqual(a);
    }
  });

  it('mixed_axis (latent × latent) derives midpoint + half-range axes at mag 1', () => {
    const chart = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 3, range: [-2, 4] },
      vAxis: { kind: 'latent', index: 6, range: [0, 1] },
    });
    const v = view();
    const s = chart.affineSlice!(v)!;
    expect(s.mag).toBe(1);
    expect(s.z0[3]).toBe(1);          // (−2 + 4) / 2
    expect(s.z0[6]).toBe(0.5);
    expect(s.z0[0]).toBe(v.z0[0]);    // other lanes frozen at the view's z0
    expect(s.q1[3]).toBe(3);          // (4 − (−2)) / 2
    expect(s.q2[6]).toBe(0.5);
    expect(s.q1.filter((x) => x !== 0)).toHaveLength(1);
    expect(s.q2.filter((x) => x !== 0)).toHaveLength(1);
  });

  it("mixed_axis: the slice reproduces the chart's own decode", () => {
    const chart = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 2, range: [-1, 3] },
      vAxis: { kind: 'latent', index: 5, range: [-0.5, 0.5] },
    });
    const v = view();
    const s = chart.affineSlice!(v)!;
    const sliceView = view({
      z0: s.z0 as Vec8, q1: s.q1 as Vec8, q2: s.q2 as Vec8, mag: s.mag,
    });
    for (const [u, w] of [[0, 0], [0.25, 0.75], [1, 1]] as const) {
      const a = chart.decode([u, w], v);
      const b = latentSliceChart.decode([u, w], sliceView);
      expect(b).toEqual(a);
    }
  });

  it('non-affine charts opt out (they take the uploaded-IC path)', () => {
    for (const id of ['lz_e', 'lz_k', 'shape_sphere', 'mass_simplex', 'burrau_euclid'] as const) {
      const chart = getChart(id);
      expect(chart.affineSlice?.(view()) ?? null,
        `${id} must not claim an affine latent slice`).toBeNull();
    }
  });
});
