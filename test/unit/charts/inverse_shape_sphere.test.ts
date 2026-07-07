import { describe, it, expect } from 'vitest';
import { shapeSphereChart } from '@/chart_atlas/charts/shape_sphere.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Vec2 } from '@/math/types.js';

const view: ChartView = {
  chartParams: { poleBuffer: 0.05 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

function decodeOk(uv: Vec2): TrajState {
  const out = shapeSphereChart.decode(uv, view);
  if (out.kind !== 'ok') throw new Error(`expected ok decode at (${uv[0]}, ${uv[1]})`);
  return out.state;
}

describe('shape_sphere inverseEncode', () => {
  it('round-trips northern-hemisphere pixels (u < 0.5) exactly', () => {
    const pixels: ReadonlyArray<Vec2> = [[0.3, 0.3], [0.15, 0.8], [0.45, 0.55], [0.3, 0.95]];
    for (const [u, v] of pixels) {
      const inv = shapeSphereChart.inverseEncode(decodeOk([u, v]), view);
      expect(inv.kind).toBe('exact');
      expect(inv.pixel?.s).toBeCloseTo(u, 6);
      expect(inv.pixel?.t).toBeCloseTo(v, 6);
    }
  });

  it('folds u > 0.5 onto the canonical u ≤ 0.5 representative', () => {
    // The β-fold in the realisation map sends θ ↔ π−θ (u ↔ 1−u) to the
    // SAME state, so the u axis carries the redundancy — the inverse
    // returns the canonical representative.
    const inv = shapeSphereChart.inverseEncode(decodeOk([0.7, 0.3]), view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.3, 6);
    expect(inv.pixel?.t).toBeCloseTo(0.3, 6);
  });

  it('u and 1−u decode to the same canonical state (the fold is exact)', () => {
    const a = decodeOk([0.3, 0.3]);
    const b = decodeOk([0.7, 0.3]);
    for (let i = 0; i < 3; i++) {
      expect(b.r[i]![0]).toBeCloseTo(a.r[i]![0], 9);
      expect(b.r[i]![1]).toBeCloseTo(a.r[i]![1], 9);
    }
  });

  it('projects a pole configuration into the buffer', () => {
    // The equal-mass equilateral (Lagrange) configuration is the shape-
    // sphere pole: n = (0, 0, ±1), θ ∈ {0, π} — inside any pole buffer.
    const h = Math.sqrt(3) / 2;
    const ic: TrajState = {
      r: [[1, 0], [-0.5, h], [-0.5, -h]],
      p: [[0, 0], [0, 0], [0, 0]],
      m: [1 / 3, 1 / 3, 1 / 3],
      t: 0,
    };
    const inv = shapeSphereChart.inverseEncode(ic, view);
    expect(inv.kind).toBe('projected');
    expect(inv.clamped).toBe(true);
    expect(inv.reason).toMatch(/pole buffer/);
    expect(inv.pixel?.s === 0 || inv.pixel?.s === 1).toBe(true);
  });

  it('falls back to the default pole buffer without a view', () => {
    const st = decodeOk([0.3, 0.3]);
    const inv = shapeSphereChart.inverseEncode(st);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.3, 6);
  });
});
