import { describe, it, expect } from 'vitest';
import { lzEChart, inverseLzChart } from '@/chart_atlas/charts/lz_e.js';
import type { ChartView } from '@/chart_atlas/types.js';
import type { TrajState, Triple, Vec2 } from '@/math/types.js';

const view: ChartView = {
  chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2 },
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 3,
  m: [1 / 3, 1 / 3, 1 / 3],
  alphaMin: 0.05, muMax: 5, qMax: 2, rColl: 1e-4, deltaLambda: 1e-12,
};

function decodeOk(uv: Vec2): TrajState {
  const out = lzEChart.decode(uv, view);
  if (out.kind !== 'ok') throw new Error(`expected ok decode at (${uv[0]}, ${uv[1]})`);
  return out.state;
}

function scaleP(st: TrajState, k: number): TrajState {
  const p: Triple<Vec2> = [
    [st.p[0][0] * k, st.p[0][1] * k],
    [st.p[1][0] * k, st.p[1][1] * k],
    [st.p[2][0] * k, st.p[2][1] * k],
  ];
  return { ...st, p };
}

function rotate(st: TrajState, ang: number): TrajState {
  const c = Math.cos(ang), s = Math.sin(ang);
  const rot = (v: Vec2): Vec2 => [c * v[0] - s * v[1], s * v[0] + c * v[1]];
  return {
    ...st,
    r: [rot(st.r[0]), rot(st.r[1]), rot(st.r[2])],
    p: [rot(st.p[0]), rot(st.p[1]), rot(st.p[2])],
  };
}

describe('lz_e inverseEncode (shared invariant-chart inverse)', () => {
  it('rest start decodes at (0.5, 0) and inverts back to the parabola apex', () => {
    const inv = lzEChart.inverseEncode(decodeOk([0.5, 0]), view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBe(0.5);
    expect(inv.pixel?.t).toBe(0);
  });

  it('round-trips interior pixels to 1e-9', () => {
    const pixels: ReadonlyArray<Vec2> = [[0.7, 0.8], [0.3, 0.5], [0.55, 0.25]];
    for (const [u, v] of pixels) {
      const inv = lzEChart.inverseEncode(decodeOk([u, v]), view);
      expect(inv.kind).toBe('exact');
      expect(inv.pixel?.s).toBeCloseTo(u, 9);
      expect(inv.pixel?.t).toBeCloseTo(v, 9);
    }
  });

  it('falls back to the decode defaults when no view is supplied', () => {
    const st = decodeOk([0.7, 0.8]);
    const bare = inverseLzChart(st);
    const withView = inverseLzChart(st, view);
    expect(bare.kind).toBe('exact');
    expect(bare.pixel?.s).toBeCloseTo(withView.pixel!.s, 12);
    expect(bare.pixel?.t).toBeCloseTo(withView.pixel!.t, 12);
  });

  it('is invariant under in-plane rotation of the IC (Lz, K, I all preserved)', () => {
    const st = decodeOk([0.7, 0.8]);
    const inv = lzEChart.inverseEncode(rotate(st, 37 * Math.PI / 180), view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.7, 9);
    expect(inv.pixel?.t).toBeCloseTo(0.8, 9);
  });

  it('a rigidly rotating equal-mass triangle sits on the feasibility rim (u = 1)', () => {
    // p_i = m_i ω × r_i with ω = 1 saturates Cauchy–Schwarz: |Lz| = √(2IK).
    // Vertices at unit distance from the COM with m = 1/3: I = 1, K = 1/2,
    // Lz = 1 = Lmax exactly (up to rounding, absorbed by the 1e-9 guard).
    const h = Math.sqrt(3) / 2;
    const ic: TrajState = {
      r: [[1, 0], [-0.5, h], [-0.5, -h]],
      p: [[0, 1 / 3], [-h / 3, -1 / 6], [h / 3, -1 / 6]],
      m: [1 / 3, 1 / 3, 1 / 3],
      t: 0,
    };
    const inv = inverseLzChart(ic, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(1, 6);
    expect(inv.pixel?.t).toBeCloseTo(Math.sqrt(0.5 / 2), 9);   // v = (K/Kmax)^(1/2)
  });

  it('projects K above Kmax onto the top edge', () => {
    // Scaling p by 20 scales K by 400: 1.28 · 400 ≫ Kmax = 2.
    const inv = lzEChart.inverseEncode(scaleP(decodeOk([0.7, 0.8]), 20), view);
    expect(inv.kind).toBe('projected');
    expect(inv.clamped).toBe(true);
    expect(inv.pixel?.t).toBe(1);
    expect(inv.reason).toMatch(/Kmax/);
  });

  it('maps an all-at-rest IC to the apex regardless of geometry', () => {
    const ic: TrajState = {
      r: [[2, 0], [-1, 1.5], [-1, -1.5]],
      p: [[0, 0], [0, 0], [0, 0]],
      m: [0.5, 0.3, 0.2],
      t: 0,
    };
    const inv = inverseLzChart(ic, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBe(0.5);
    expect(inv.pixel?.t).toBe(0);
  });
});
