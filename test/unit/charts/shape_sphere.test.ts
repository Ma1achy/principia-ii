import { describe, it, expect } from 'vitest';
import { shapeSphereChart } from '@/chart_atlas/charts/shape_sphere.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: { poleBuffer: 0.05 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('shape sphere chart', () => {
  it('declares hemisphere redundancy', () => {
    expect(shapeSphereChart.flags.has_redundant_hemisphere).toBe(true);
  });

  it('decode succeeds at a non-pole point', () => {
    const out = shapeSphereChart.decode([0.5, 0.25], view);
    expect(out.kind).toBe('ok');
  });

  it('decodes at every (u, v) in a 9×9 grid without throwing', () => {
    for (let j = 1; j < 9; j++) {
      for (let i = 1; i < 9; i++) {
        const out = shapeSphereChart.decode([i / 9, j / 9], view);
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});
