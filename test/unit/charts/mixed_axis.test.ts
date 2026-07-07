import { describe, it, expect } from 'vitest';
import { makeMixedAxisChart } from '@/chart_atlas/charts/mixed_axis.js';
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

  it('unconstructible axis kinds throw at CONSTRUCTION, never per pixel', () => {
    // Decode totality: the factory rejects unsupported pairings up front,
    // so no registered mixed-axis chart can ever throw from decode().
    // (Stage 4 makes mass/lz/energy/shape constructible and restores the
    // requires_per_pixel_mass flag assertion for mass axes.)
    expect(() => makeMixedAxisChart({
      hAxis: { kind: 'mass', parameter: 'm1', range: [0.1, 0.9] },
      vAxis: { kind: 'latent', index: 0, range: [-1, 1] },
    })).toThrow(/not constructible/);
  });

  it('decode on a constructed chart is total across the whole UV square', () => {
    const c = makeMixedAxisChart({
      hAxis: { kind: 'latent', index: 0, range: [-4, 4] },
      vAxis: { kind: 'latent', index: 6, range: [-6, 6] },
    });
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const out = c.decode([i / 4, j / 4], view);   // must not throw
        expect(out.kind === 'ok' || out.kind === 'terminal').toBe(true);
      }
    }
  });
});
