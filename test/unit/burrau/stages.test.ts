import { describe, it, expect } from 'vitest';
import { burrauStages, burrauLzEParams } from '@/burrau/stages.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';

describe('Burrau stages', () => {
  it('Stage 1a/1b reuse the Euclid display chart', () => {
    expect(burrauStages['1a'].chart.id).toBe('burrau_euclid');
    expect(burrauStages['1b'].chart.id).toBe('burrau_euclid');
  });

  it('Stage 2a is a mass-simplex chart for ν₀ = 1/2', () => {
    expect(burrauStages['2a'].kind).toBe('mass_simplex');
    expect(burrauStages['2a'].flags.requires_per_pixel_mass).toBe(true);
  });

  it('Stage 2b is the (L_z, E) chart', () => {
    expect(burrauStages['2b'].id).toBe('lz_e');
  });

  it('Stage 3 is a θ × δm strip with mass-varying flag', () => {
    expect(burrauStages['3'].flags.requires_per_pixel_mass).toBe(true);
  });

  it('burrauLzEParams hands the (3,4,5) SHAPE to the (L_z, E) chart', () => {
    // The lz decode realises the shape at the R̃ = 1 gauge, so absolute
    // lengths rescale — the side RATIOS 3 : 4 : 5 are the invariant.
    const params = burrauLzEParams(0.5);
    const view: ChartView = {
      chartParams: { Kmax: 2, gammaK: 2, alpha: params.alpha, beta: params.beta },
      z0: [0, 0, 0, 0, 0, 0, 0, 0],
      q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
      mag: 1, m: params.m,
      alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
    };
    const out = lzEChart.decode([0.5, 0], view);   // rest start, Lz = K = 0
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { r, m } = out.state;
    expect(m[0]).toBeCloseTo(5 / 12, 12);
    expect(m[1]).toBeCloseTo(4 / 12, 12);
    expect(m[2]).toBeCloseTo(3 / 12, 12);
    const d01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);
    const d02 = Math.hypot(r[2][0] - r[0][0], r[2][1] - r[0][1]);
    const d12 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
    expect(d02 / d01).toBeCloseTo(4 / 3, 10);
    expect(d12 / d01).toBeCloseTo(5 / 3, 10);
  });
});
