import { describe, it, expect } from 'vitest';
import { forces, totalEnergy, angularMomentum, minPairSeparation } from '@/integrate/forces.js';

describe('forces', () => {
  it('Newton third law: total force vanishes', () => {
    const m: [number,number,number] = [0.3, 0.3, 0.4];
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0], [1,0], [0.5, Math.sqrt(3)/2]];
    const F = forces(m, r);
    const sum = [F[0][0]+F[1][0]+F[2][0], F[0][1]+F[1][1]+F[2][1]];
    expect(sum[0]).toBeCloseTo(0, 14);
    expect(sum[1]).toBeCloseTo(0, 14);
  });

  it('points along the line between attracting bodies', () => {
    const m: [number,number,number] = [1/3, 1/3, 1/3];
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0], [1,0], [10,10]];                  // body 2 is far away
    const F = forces(m, r);
    // F_0 points along +x (toward body 1, plus tiny pull toward 2)
    expect(F[0][0]).toBeGreaterThan(0);
    expect(Math.abs(F[0][1])).toBeLessThan(F[0][0]);
  });
});

describe('totalEnergy', () => {
  it('rest start: E = U (negative)', () => {
    const m: [number,number,number] = [0.3, 0.3, 0.4];
    const r: [[number,number],[number,number],[number,number]] = [[0,0],[1,0],[0,1]];
    const p: [[number,number],[number,number],[number,number]] = [[0,0],[0,0],[0,0]];
    const E = totalEnergy(m, r, p);
    expect(E).toBeLessThan(0);
  });
});

describe('angularMomentum', () => {
  it('vanishes at rest start', () => {
    const r: [[number,number],[number,number],[number,number]] = [[0,0],[1,0],[0,1]];
    const p: [[number,number],[number,number],[number,number]] = [[0,0],[0,0],[0,0]];
    expect(angularMomentum(r, p)).toBe(0);
  });
});

describe('minPairSeparation', () => {
  it('reports the closest pair', () => {
    const r: [[number,number],[number,number],[number,number]] =
      [[0,0],[10,0],[0.1,0]];
    const m = minPairSeparation(r);
    expect(m.pair).toBe(1);                 // (0, 2) in 0-indexed pair coding
    expect(m.d).toBeCloseTo(0.1, 12);
  });
});
