import { describe, it, expect } from 'vitest';
import '@/chart_atlas/index.js';     // registers all charts
import { allCharts } from '@/chart_atlas/registry.js';
import type { ChartView } from '@/chart_atlas/types.js';

describe('every registered chart is total on (u, v)', () => {
  it('1000 random pixels per chart land in ok or terminal', () => {
    let rng = 17;
    const next = () => {
      rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    expect(allCharts().length).toBeGreaterThanOrEqual(6);
    for (const chart of allCharts()) {
      const view: ChartView = {
        chartParams: { Kmax: 2, gammaK: 2, alpha: Math.PI / 4, beta: Math.PI / 2,
                       poleBuffer: 0.05 },
        z0: [0, 0, 0, 0, 0, 0, 0, 0],
        q1: [1, 0, 0, 0, 0, 0, 0, 0], q2: [0, 1, 0, 0, 0, 0, 0, 0],
        mag: 1, m: [1 / 3, 1 / 3, 1 / 3],
        alphaMin: 0.05, muMax: 5, qMax: 2,
        rColl: 1e-4, deltaLambda: 1e-12,
      };
      let ok = 0, term = 0;
      for (let trial = 0; trial < 1000; trial++) {
        const u = next(), v = next();
        // No try/catch: registered charts NEVER throw (the mixed-axis
        // factory is exported, not registered, so it isn't in this loop).
        const out = chart.decode([u, v], view);
        if (out.kind === 'ok') {
          ok++;
          for (const body of out.state.r) {
            expect(Number.isFinite(body[0]) && Number.isFinite(body[1])).toBe(true);
          }
          for (const body of out.state.p) {
            expect(Number.isFinite(body[0]) && Number.isFinite(body[1])).toBe(true);
          }
        } else {
          term++;
        }
      }
      expect(ok + term).toBe(1000);
      expect(ok).toBeGreaterThan(0);    // every chart has a live interior
    }
  });
});
