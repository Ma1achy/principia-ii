import { describe, it, expect } from 'vitest';
import { makeMixedAxisChart, mixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
import type { ChartView } from '@/chart_atlas/types.js';

const view: ChartView = {
  chartParams: {},
  z0: [0, 0, 0, 0, 0, 0, 0, 0],
  q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
  mag: 1, alphaMin: 0.05, muMax: 5, qMax: 2,
  rColl: 1e-4, deltaLambda: 1e-12,
};

describe('mixed-axis factory', () => {
  it('latent × latent works', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 6, range: [-1, 1] },
      vAxis: { kind: 'latent', index: 7, range: [-1, 1] },
    });
    const out = c.decode([0.5, 0.5], view);
    expect(out.kind).toBe('ok');
  });

  it('latent axes actually move the decoded point', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 6, range: [-1, 1] },
      vAxis: { kind: 'latent', index: 7, range: [-1, 1] },
    });
    const a = c.decode([0.1, 0.5], view);
    const b = c.decode([0.9, 0.5], view);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    // z6/z7 are mass logits: different u ⇒ different masses.
    expect(a.state.m[0]).not.toBeCloseTo(b.state.m[0], 6);
  });

  it('redundant pairings throw at CONSTRUCTION, never per pixel', () => {
    // Two axes sweeping the same derived quantity is one axis twice.
    expect(() => makeMixedAxisChart({
      hAxis: { kind: 'lz', range: [-1, 1] },
      vAxis: { kind: 'lz', range: [-2, 2] },
    })).toThrow(/not constructible/);
    expect(() => makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
      vAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
    })).toThrow(/not constructible/);
  });

  it('mass-axis charts construct and set requires_per_pixel_mass', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    });
    expect(c.flags.requires_per_pixel_mass).toBe(true);
    // Mass varies per pixel ⇒ never an affine slice (upload path).
    expect(c.affineSlice?.(view)).toBeNull();
  });

  it('decode is total across the UV square for EVERY axis kind', () => {
    const pairs: Parameters<typeof makeMixedAxisChart>[0][] = [
      { hAxis: { kind: 'latent', index: 0, range: [-4, 4] },
        vAxis: { kind: 'latent', index: 6, range: [-6, 6] } },
      { hAxis: { kind: 'mass', parameter: 'm1', range: [0.05, 0.95] },
        vAxis: { kind: 'mass', parameter: 'm2', range: [0.05, 0.95] } },
      { hAxis: { kind: 'lz', range: [-2, 2] },
        vAxis: { kind: 'energy', range: [-2, 2] } },
      { hAxis: { kind: 'shape_alpha', range: [0.1, 1.4] },
        vAxis: { kind: 'shape_beta', range: [0.1, 3.0] } },
      { hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
        vAxis: { kind: 'lz', range: [-1, 1] } },
    ];
    for (const p of pairs) {
      const c = makeMixedAxisChart(p);
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          const out = c.decode([i / 4, j / 4], view);   // must not throw
          expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
        }
      }
    }
  });

  it('a mass axis actually sets the swept mass component', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.2, 0.6] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    });
    const out = c.decode([0.5, 0.5], view);            // m1 target = 0.4
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.state.m[0]).toBeCloseTo(0.4, 9);
    expect(out.state.m[0] + out.state.m[1] + out.state.m[2]).toBeCloseTo(1, 12);
  });

  it('lz × energy hits the invariant targets exactly', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'lz', range: [-1, 1] },
      vAxis: { kind: 'energy', range: [-1, 1] },
    });
    const out = c.decode([0.75, 0.75], view);          // Lz = 0.5, E = 0.5
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const { m, r, p } = out.state;
    let Lz = 0, K = 0;
    for (let i = 0; i < 3; i++) {
      Lz += r[i]![0] * p[i]![1] - r[i]![1] * p[i]![0];
      K += (p[i]![0] ** 2 + p[i]![1] ** 2) / (2 * m[i]!);
    }
    let U = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const dx = r[j]![0] - r[i]![0], dy = r[j]![1] - r[i]![1];
        U -= (m[i]! * m[j]!) / Math.hypot(dx, dy);
      }
    }
    expect(Lz).toBeCloseTo(0.5, 6);
    expect(K + U).toBeCloseTo(0.5, 6);
  });

  it('infeasible energy labels the pixel (code 15), never throws', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'lz', range: [2, 2.0001] },        // K_min = Lz²/2 = 2
      vAxis: { kind: 'energy', range: [-100, -99] },    // E ≪ U + K_min
    });
    const out = c.decode([0.5, 0.5], view);
    expect(out.kind).toBe('terminal');
  });

  it('shape axes move the geometry monotonically', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'shape_alpha', range: [0.2, 1.3] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    });
    const a = c.decode([0.1, 0.5], view);
    const b = c.decode([0.9, 0.5], view);
    expect(a.kind).toBe('ok'); expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;
    // α controls |ρ̃| = cos α: larger α ⇒ tighter inner pair.
    expect(b.descriptor.rho1Mag).toBeLessThan(a.descriptor.rho1Mag);
  });

  it('the REGISTERED chart reads its axes from chartParams (custom charts)', () => {
    const custom = {
      ...view,
      chartParams: {
        hAxis: { kind: 'mass', parameter: 'm1', range: [0.3, 0.3001] },
        vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
      },
    };
    const out = mixedAxisChart.decode([0.5, 0.5], custom);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.state.m[0]).toBeCloseTo(0.30005, 6);
    // Malformed params fall back to the default latent pair, still total.
    const bad = { ...view, chartParams: { hAxis: { kind: 'nope' } } };
    const fallback = mixedAxisChart.decode([0.5, 0.5], bad);
    expect(fallback.kind === 'ok' || fallback.kind === 'terminal').toBe(true);
  });
});
