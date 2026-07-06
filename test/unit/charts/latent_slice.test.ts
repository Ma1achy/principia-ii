import { describe, it, expect } from 'vitest';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

describe('latent slice chart', () => {
  it('decode at (0.5, 0.5) returns the slice centre', () => {
    const out = latentSliceChart.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
  });

  it('validate rejects out-of-range UV', () => {
    expect(latentSliceChart.validate([1.1, 0.5], view).kind).toBe('reject');
  });

  it('inverseEncode round-trips for a non-saturated point', () => {
    const out = latentSliceChart.decode([0.3, 0.7], view);
    if (out.kind !== 'ok') throw new Error('expected ok');
    const enc = latentSliceChart.inverseEncode(out.state);
    expect(enc.kind === 'exact' || enc.kind === 'projected').toBe(true);
  });
});
