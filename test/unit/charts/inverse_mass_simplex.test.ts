import { describe, it, expect } from 'vitest';
import { massSimplexChart } from '@/chart_atlas/charts/mass_simplex.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Vec2 } from '@/math/types.js';

const view: ChartView = {
  chartParams: { alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1,
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

function decodeOk(uv: Vec2): TrajState {
  const out = massSimplexChart.decode(uv, view);
  if (out.kind !== 'ok') throw new Error(`expected ok decode at (${uv[0]}, ${uv[1]})`);
  return out.state;
}

describe('mass_simplex inverseEncode', () => {
  it('round-trips interior simplex points exactly (bilinear map, M10 inverse)', () => {
    const pixels: ReadonlyArray<Vec2> = [[0.4, 0.6], [0.5, 0.5], [0.2, 0.3], [0.8, 0.7]];
    for (const [u, v] of pixels) {
      const inv = massSimplexChart.inverseEncode(decodeOk([u, v]), view);
      expect(inv.kind).toBe('exact');
      expect(inv.pixel?.s).toBeCloseTo(u, 10);
      expect(inv.pixel?.t).toBeCloseTo(v, 10);
    }
  });

  it('reads only the masses — geometry does not perturb the pixel', () => {
    const st = decodeOk([0.4, 0.6]);
    const skewed: TrajState = {
      ...st,
      r: [[2, 1], [-1, 0.5], [-0.4, -0.9]],
    };
    const inv = massSimplexChart.inverseEncode(skewed, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.4, 10);
    expect(inv.pixel?.t).toBeCloseTo(0.6, 10);
  });

  it('marks masses outside the interior buffer as projected', () => {
    // m₀ below ε_m = 1e-4 puts the raw component negative after
    // unbuffering — the M10 inverse clamps and reports projected.
    const ic: TrajState = {
      r: [[1, 0], [-0.5, 0.8], [-0.5, -0.8]],
      p: [[0, 0], [0, 0], [0, 0]],
      m: [1e-6, 0.6, 0.399999],
      t: 0,
    };
    const inv = massSimplexChart.inverseEncode(ic, view);
    expect(inv.kind).toBe('projected');
    expect(inv.pixel).toBeDefined();
  });
});
