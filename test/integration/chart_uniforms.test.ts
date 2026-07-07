import { describe, it, expect } from 'vitest';
import { packChartUniforms } from '@/gpu/chart_uniforms.js';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { lzKChart } from '@/chart_atlas/charts/lz_k.js';
import { shapeSphereChart } from '@/chart_atlas/charts/shape_sphere.js';
import { massSimplexChart } from '@/chart_atlas/charts/mass_simplex.js';
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import { allCharts } from '@/chart_atlas/registry.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { Vec8 } from '@/math/types.js';

const baseView: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0] as Vec8,
  q1: [1, 0, 0, 0, 0, 0, 0, 0] as Vec8,
  q2: [0, 1, 0, 0, 0, 0, 0, 0] as Vec8,
  mag: 1,
  alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('chart-uniform handoff per chart', () => {
  it('every registered chart supplies chartUniforms', () => {
    for (const chart of allCharts()) {
      const u = chart.chartUniforms(baseView);
      expect(u.mu_max, chart.id).toBeGreaterThan(0);   // no silent-zero collapse
      expect(packChartUniforms(u).byteLength).toBe(64);
    }
  });

  it('latent slice supplies the defaults', () => {
    const u = latentSliceChart.chartUniforms(baseView);
    expect(u.mu_max).toBe(5);
    expect(u.alpha_min).toBe(0.05);
  });

  it('(Lz, E) supplies Kmax / gammaK / α / β from chartParams', () => {
    const view: ChartView = { ...baseView,
      chartParams: { Kmax: 4, gammaK: 1.5, alpha: 0.6, beta: 1.2 },
    };
    const u = lzEChart.chartUniforms(view);
    expect(u.Kmax).toBe(4);
    expect(u.gamma_K).toBe(1.5);
    expect(u.alpha_freeze).toBeCloseTo(0.6, 6);
    expect(u.beta_freeze).toBeCloseTo(1.2, 6);
  });

  it('(Lz, K) inherits the shared decode knobs from lz_e', () => {
    const view: ChartView = { ...baseView, chartParams: { Kmax: 3 } };
    expect(lzKChart.chartUniforms(view).Kmax).toBe(3);
  });

  it('shape-sphere overrides only pole_buffer', () => {
    const view: ChartView = { ...baseView,
      chartParams: { poleBuffer: 0.10 },
    };
    const u = shapeSphereChart.chartUniforms(view);
    expect(u.pole_buffer).toBe(0.10);
    expect(u.alpha_min).toBe(0.05);             // default preserved
  });

  it('mass simplex forwards the frozen-shape angles', () => {
    const view: ChartView = { ...baseView,
      chartParams: { alpha: 0.9, beta: 2.0 },
    };
    const u = massSimplexChart.chartUniforms(view);
    expect(u.alpha_freeze).toBeCloseTo(0.9, 6);
    expect(u.beta_freeze).toBeCloseTo(2.0, 6);
  });

  it('burrau euclid forwards ν', () => {
    const view: ChartView = { ...baseView, chartParams: { nu: 0.25 } };
    expect(burrauEuclidChart.chartUniforms(view).nu_burrau).toBe(0.25);
  });

  it('switching charts changes only the chart buffer payload', () => {
    const a = packChartUniforms(latentSliceChart.chartUniforms(baseView));
    const b = packChartUniforms(lzEChart.chartUniforms({ ...baseView,
      chartParams: { Kmax: 4 } }));
    // Buffers differ in the Kmax slot; the shared defaults are identical.
    const af = new Float32Array(a);
    const bf = new Float32Array(b);
    expect(af[4]).not.toBe(bf[4]);              // Kmax lane
    expect(af[0]).toBe(bf[0]);                  // mu_max default matches
    expect(af[1]).toBe(bf[1]);                  // alpha_min default matches
  });
});
