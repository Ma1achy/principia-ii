import { describe, it, expect } from 'vitest';
import {
  euclidSides, normalisedSides, acuteAngle, nuFromAcuteAngle,
  burrauTriangle, recoverNuFromTriangle,
} from '@/burrau/euclid.js';

describe('Euclid parametrisation', () => {
  it('(m, n) = (2, 1) gives (3, 4, 5)', () => {
    const { a, b, c } = euclidSides(2, 1);
    expect(a).toBe(3); expect(b).toBe(4); expect(c).toBe(5);
  });

  it('a² + b² = c² for any (m, n)', () => {
    for (const [m, n] of [[2, 1], [3, 2], [4, 1], [5, 2], [7, 4]] as const) {
      const { a, b, c } = euclidSides(m, n);
      expect(a * a + b * b).toBe(c * c);
    }
  });

  it('normalisedSides depends only on ν', () => {
    const a = normalisedSides(0.4);
    const b = normalisedSides(0.4);
    expect(a).toEqual(b);
  });

  it('acuteAngle round-trips with nuFromAcuteAngle', () => {
    for (const nu of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const theta = acuteAngle(nu);
      expect(nuFromAcuteAngle(theta)).toBeCloseTo(nu, 12);
    }
  });

  it('burrauTriangle reproduces the canonical (3, 4, 5) reference', () => {
    // Spec eq. burrau_positions: mass b/Σ on the a/c leg, mass a/Σ on
    // the b/c leg — each mass opposite its own side.
    const { r, m } = burrauTriangle(0.5);
    expect(r[0]).toEqual([0, 0]);
    expect(r[1]).toEqual([0.6, 0]);     // a/c = 3/5, holds mass 4/12
    expect(r[2]).toEqual([0, 0.8]);     // b/c = 4/5, holds mass 3/12
    expect(m[0]).toBeCloseTo(5 / 12, 12);
    expect(m[1]).toBeCloseTo(4 / 12, 12);
    expect(m[2]).toBeCloseTo(3 / 12, 12);
  });

  it('the first four primitive triples produce distinct geometries', () => {
    // ν = 1/2, 2/3, 1/4, 3/4 → distinct leg ratios.
    const nus = [1 / 2, 2 / 3, 1 / 4, 3 / 4];
    const legs = nus.map((nu) => {
      const { r } = burrauTriangle(nu);
      return r[1][0] / r[2][1];         // (a/c)/(b/c) = a/b
    });
    const unique = new Set(legs.map((x) => x.toFixed(12)));
    expect(unique.size).toBe(4);
  });

  it('recoverNuFromTriangle recovers ν from a (3,4,5) triangle', () => {
    const { r } = burrauTriangle(0.5);
    expect(recoverNuFromTriangle(r)).toBeCloseTo(0.5, 6);
  });
});
