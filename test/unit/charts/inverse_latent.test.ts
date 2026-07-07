import { describe, it, expect } from 'vitest';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';
import { makeMixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Vec2, Vec8 } from '@/math/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1.5,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

function decodeOk(uv: Vec2, v: ChartView = view): TrajState {
  const out = latentSliceChart.decode(uv, v);
  if (out.kind !== 'ok') throw new Error(`expected ok decode at (${uv[0]}, ${uv[1]})`);
  return out.state;
}

describe('latent_slice inverseEncode', () => {
  it('round-trips an on-slice IC through the view', () => {
    const inv = latentSliceChart.inverseEncode(decodeOk([0.3, 0.7]), view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.3, 6);
    expect(inv.pixel?.t).toBeCloseTo(0.7, 6);
    expect(inv.z).toBeDefined();
  });

  it('without a view returns the latent z alone (pre-G5 behaviour)', () => {
    const inv = latentSliceChart.inverseEncode(decodeOk([0.3, 0.7]));
    expect(inv.z).toBeDefined();
    expect(inv.pixel).toBeUndefined();
  });

  it('marks off-slice ICs projected with a reason, still returning the nearest pixel', () => {
    // Decode against a view displaced along z₂ (a momentum coordinate the
    // base slice does not span): the IC lies 0.8 off the base plane.
    const shifted: ChartView = {
      ...view, z0: [0, 0, 0.8, 0, 0, 0, 0, 0] as Vec8,
    };
    const inv = latentSliceChart.inverseEncode(decodeOk([0.3, 0.7], shifted), view);
    expect(inv.kind).toBe('projected');
    expect(inv.clamped).toBe(true);
    expect(inv.reason).toMatch(/off this 2D latent slice/);
    expect(inv.pixel?.s).toBeCloseTo(0.3, 6);
    expect(inv.pixel?.t).toBeCloseTo(0.7, 6);
  });
});

describe('mixed_axis inverseEncode (factory, not registered)', () => {
  it('latent × latent round-trips through the per-axis ranges', () => {
    const chart = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 0, range: [-2, 2] },
      vAxis: { kind: 'latent', index: 1, range: [-2, 2] },
    });
    const out = chart.decode([0.25, 0.75], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const inv = chart.inverseEncode(out.state);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.25, 6);
    expect(inv.pixel?.t).toBeCloseTo(0.75, 6);
    expect(inv.z).toBeDefined();
  });

  it('non-latent axis pairings stay projected (unconstructible in M10)', () => {
    const chart = makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    });
    const inv = chart.inverseEncode(decodeOk([0.5, 0.5]));
    expect(inv.kind).toBe('projected');
    expect(inv.reason).toMatch(/factory args/);
  });
});
