import { describe, it, expect } from 'vitest';
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Vec2 } from '@/math/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

function decodeOk(uv: Vec2): TrajState {
  const out = burrauEuclidChart.decode(uv, view);
  if (out.kind !== 'ok') throw new Error(`expected ok decode at (${uv[0]}, ${uv[1]})`);
  return out.state;
}

describe('burrau_euclid inverseEncode', () => {
  it('recovers ν from the canonicalised triangle and round-trips v to 1e-9', () => {
    for (const v of [0.1, 0.5, 0.9]) {
      const inv = burrauEuclidChart.inverseEncode(decodeOk([0.37, v]), view);
      expect(inv.kind).toBe('exact');
      expect(inv.pixel?.s).toBe(0.5);          // u is display-only: 0.5 by convention
      expect(inv.pixel?.t).toBeCloseTo(v, 9);
    }
  });

  it('u is display-only: any u decodes to the same state', () => {
    const a = decodeOk([0.1, 0.6]);
    const b = decodeOk([0.9, 0.6]);
    for (let i = 0; i < 3; i++) {
      expect(b.r[i]![0]).toBe(a.r[i]![0]);
      expect(b.r[i]![1]).toBe(a.r[i]![1]);
      expect(b.m[i]).toBe(a.m[i]);
    }
  });

  it('projects ν outside [1/32, 31/32]', () => {
    // A 100:1 leg ratio from body 0 gives ν = −k + √(k² + 1) far outside
    // the chart's ν range, whichever leg convention holds.
    const ic: TrajState = {
      r: [[0, 0], [100, 0], [0, 1]],
      p: [[0, 0], [0, 0], [0, 0]],
      m: [1 / 3, 1 / 3, 1 / 3],
      t: 0,
    };
    const inv = burrauEuclidChart.inverseEncode(ic, view);
    expect(inv.kind).toBe('projected');
    expect(inv.clamped).toBe(true);
    expect(inv.pixel?.t === 0 || inv.pixel?.t === 1).toBe(true);
  });
});
