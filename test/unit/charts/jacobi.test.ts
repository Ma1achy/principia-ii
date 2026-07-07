import { describe, it, expect } from 'vitest';
import { jacobiPositionChart, jacobiMomentumChart } from '@/chart_atlas/charts/jacobi.js';
import { particlePositionsToJacobi, particleMomentaToJacobi } from '@/decode/jacobi_particle.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  m: [1 / 3, 1 / 3, 1 / 3],
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('jacobi_position chart', () => {
  it('u/v sweep the inner/outer separations exactly (defaults [0.05,2] × [0.05,3])', () => {
    const out = jacobiPositionChart.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { rho, lambda } = particlePositionsToJacobi(out.state.r, out.state.m);
    expect(Math.hypot(rho[0], rho[1])).toBeCloseTo((0.05 + 2) / 2, 9);
    expect(Math.hypot(lambda[0], lambda[1])).toBeCloseTo((0.05 + 3) / 2, 9);
  });

  it('inverse is exact (frozen gauge = canonical gauge)', () => {
    const out = jacobiPositionChart.decode([0.3, 0.7], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const inv = jacobiPositionChart.inverseEncode(out.state, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.3, 9);
    expect(inv.pixel?.t).toBeCloseTo(0.7, 9);
  });

  it('decode is total across the UV square', () => {
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const out = jacobiPositionChart.decode([i / 4, j / 4], view);
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});

describe('jacobi_momentum chart', () => {
  it('u/v sweep signed p_ρ/p_λ components along the frozen directions', () => {
    const out = jacobiMomentumChart.decode([0.75, 0.25], view);   // +1, −1 at pMax 2
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { pRho, pLambda } = particleMomentaToJacobi(out.state.p, out.state.m);
    // Default direction angles are π/2: components live on the y lanes.
    expect(pRho[1]).toBeCloseTo(1, 9);
    expect(pRho[0]).toBeCloseTo(0, 9);
    expect(pLambda[1]).toBeCloseTo(-1, 9);
  });

  it('inverse is exact for states decoded by this chart', () => {
    const out = jacobiMomentumChart.decode([0.6, 0.4], view);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const inv = jacobiMomentumChart.inverseEncode(out.state, view);
    expect(inv.kind).toBe('exact');
    expect(inv.pixel?.s).toBeCloseTo(0.6, 9);
    expect(inv.pixel?.t).toBeCloseTo(0.4, 9);
  });

  it('states outside the chart plane project (perpendicular residual)', () => {
    const out = jacobiMomentumChart.decode([0.6, 0.4], view);
    if (out.kind !== 'ok') return;
    // Kick p_λ (= p2) off the frozen y-direction, COM-preserving via p0.
    // (A p0-only kick would be invisible: particleMomentaToJacobi reads only
    // p1/p2, assuming the COM-frame constraint Σp = 0.)
    const p = out.state.p.map((pi) => [...pi] as [number, number]) as
      [[number, number], [number, number], [number, number]];
    p[2][0] += 0.5;
    p[0][0] -= 0.5;
    const inv = jacobiMomentumChart.inverseEncode({ ...out.state, p }, view);
    expect(inv.kind).toBe('projected');
  });
});
