import { describe, it, expect } from 'vitest';
import {
  runRegularized, bindingEnergy, stateEnergy,
} from '@/integrate/regularize.js';
import { totalEnergy } from '@/integrate/forces.js';
import type { TrajState } from '@/math/types.js';

/**
 * G19 unit suite for the LogH (algorithmic regularization) integrator.
 * The precision claims live in the golden (test/golden/burrau_regularized);
 * this file pins the map's mechanics: binding energy, Kepler-limit energy
 * behaviour, terminals, composition orders, and the checkpoint trace.
 */

/** A near-Kepler system: a tight binary + a negligible spectator far away.
 *  Apoapsis start, eccentricity e, unit total binary mass, G = 1. */
function eccentricBinary(e: number): TrajState {
  const ra = 1;                       // apoapsis separation
  const a = ra / (1 + e);
  const vRel = Math.sqrt(2 / ra - 1 / a);  // vis-viva, GM = 1
  const mu = 0.25;                    // reduced mass of the 0.5/0.5 pair
  const p = mu * vRel;
  return {
    m: [0.5, 0.5, 1e-9],
    r: [[-0.5, 0], [0.5, 0], [1e3, 0]],
    p: [[0, -p], [0, p], [0, 0]],
    t: 0,
  };
}

const QUIET = { rColl: 0, REsc: 1e5, kEsc: 8 };

describe('bindingEnergy / stateEnergy', () => {
  it('B = -E for a bound system', () => {
    const s = eccentricBinary(0.9);
    const E = totalEnergy(s.m, s.r, s.p);
    expect(E).toBeLessThan(0);
    expect(bindingEnergy(s)).toBeCloseTo(-E, 12);
    expect(stateEnergy(s)).toBeCloseTo(E, 12);
  });
});

describe('Kepler limit', () => {
  it('holds energy to ~machine precision through e=0.9 periapses', () => {
    const s0 = eccentricBinary(0.9);
    // ~10 orbital periods (T = 2π a^{3/2}, a ≈ 0.526 → T ≈ 2.4).
    const res = runRegularized(s0, { hFict: 1e-3, THorizon: 24, ...QUIET });
    expect(res.terminal.kind).toBe('BOUNDED');
    expect(res.diagnostics.energyDrift).toBeLessThan(1e-11);
    expect(res.diagnostics.lzDrift).toBeLessThan(1e-11);
    // The periapsis was actually visited: r_min ≈ a(1-e) ≈ 0.0526.
    expect(res.diagnostics.rMin).toBeLessThan(0.06);
  });

  it('survives a near-collisional e=0.999 binary that would saturate substeps', () => {
    const s0 = eccentricBinary(0.999);
    const res = runRegularized(s0, { hFict: 5e-4, THorizon: 10, ...QUIET });
    expect(res.terminal.kind).toBe('BOUNDED');
    // Periapsis ≈ 5e-4 — deep inside the default r_sub regime.
    expect(res.diagnostics.rMin).toBeLessThan(1e-3);
    expect(res.diagnostics.energyDrift).toBeLessThan(1e-8);
  });
});

describe('composition orders', () => {
  it.each([2, 4, 6] as const)('order %d completes bound with finite drift', (order) => {
    const s0 = eccentricBinary(0.9);
    const res = runRegularized(s0, { hFict: 1e-3, THorizon: 5, order, ...QUIET });
    expect(res.terminal.kind).toBe('BOUNDED');
    expect(Number.isFinite(res.diagnostics.energyDrift)).toBe(true);
    expect(res.diagnostics.energyDrift).toBeLessThan(1e-4);
  });
});

describe('terminals', () => {
  it('BOUNDED at the horizon', () => {
    const res = runRegularized(eccentricBinary(0.5),
      { hFict: 1e-3, THorizon: 1, ...QUIET });
    expect(res.terminal.kind).toBe('BOUNDED');
    if (res.terminal.kind === 'BOUNDED') expect(res.terminal.T).toBe(1);
  });

  it('TIMEOUT when the step budget is exhausted before the horizon', () => {
    const res = runRegularized(eccentricBinary(0.5),
      { hFict: 1e-6, THorizon: 100, maxSteps: 10, ...QUIET });
    expect(res.terminal.kind).toBe('TIMEOUT');
  });

  it('COLLISION still fires when rColl > 0', () => {
    // Head-on rest start of the pair — a genuine collision course.
    const s0: TrajState = {
      m: [0.5, 0.5, 1e-9],
      r: [[-0.5, 0], [0.5, 0], [1e3, 0]],
      p: [[0, 0], [0, 0], [0, 0]],
      t: 0,
    };
    const res = runRegularized(s0,
      { hFict: 1e-3, THorizon: 10, rColl: 1e-3, REsc: 1e5, kEsc: 8 });
    expect(res.terminal.kind).toBe('COLLISION');
    if (res.terminal.kind === 'COLLISION') expect(res.terminal.pair).toBe(0);
  });
});

describe('checkpoint trace', () => {
  it('records the initial state plus one state per crossed checkpoint', () => {
    const res = runRegularized(eccentricBinary(0.5),
      { hFict: 1e-3, THorizon: 4, ...QUIET }, { checkpoints: 4 });
    expect(res.trace).toBeDefined();
    // s0 + 4 crossings (the last may coincide with the horizon step).
    expect(res.trace!.length).toBeGreaterThanOrEqual(4);
    expect(res.trace![0]!.t).toBe(0);
    // Strictly increasing times.
    for (let i = 1; i < res.trace!.length; i++) {
      expect(res.trace![i]!.t).toBeGreaterThan(res.trace![i - 1]!.t);
    }
  });
});
