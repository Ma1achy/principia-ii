import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { kdkMacroStep } from '@/integrate/kdk.js';
import { metricsTick, makeMetrics, DEFAULT_BRANCH_CUTS } from '@/metrics/observe_extended.js';
import { wordToString } from '@/metrics/free_group.js';
import type { TrajState } from '@/math/types.js';

/**
 * The figure-8 orbit (Chenciner–Montgomery) is a periodic equal-mass
 * three-body solution; its homotopy class on the punctured shape sphere is
 * the commutator [a, b] = abAB. After k periods the recorded word must be a
 * power of that base (up to cyclic rotation and orientation).
 *
 * IC: the M1 golden's rescaled fixture (figure8_reference.json) — the
 * textbook CM velocities/period are only valid at m = 1 each; at Σm = 1 the
 * velocities scale by 1/√3 and the period by √3 (≈ 10.9568). Using the
 * unscaled values here would integrate a non-periodic orbit and the word
 * would never close.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(
  readFileSync(path.join(here, 'figure8_reference.json'), 'utf-8'),
) as { ic: { m: number[]; r: number[][]; p: number[][] } };

function figure8IC(): TrajState {
  const [m0, m1, m2] = REF.ic.m as [number, number, number];
  const r = REF.ic.r as [[number, number], [number, number], [number, number]];
  const p = REF.ic.p as [[number, number], [number, number], [number, number]];
  return { m: [m0, m1, m2], r, p, t: 0 };
}

const PERIOD = 6.32591398 * Math.sqrt(3);   // ≈ 10.9568 in Σm = 1 units

describe('figure-8 orbit free-group word', () => {
  it('reduces to a power of abAB after several periods', () => {
    const acc = makeMetrics();
    let s = figure8IC();
    const dt = 1e-3;
    const T = PERIOD * 4;

    // We integrate ourselves so we can call metricsTick once per macro step.
    // In production, metricsTick is wired into the integrator's macro loop;
    // the test mirrors that by stepping kdkMacroStep directly.
    while (s.t < T) {
      const r = kdkMacroStep(s, dt, { rSub: 0.05, gammaSub: 1.5, NMax: 64 });
      s = r.state;
      metricsTick(acc, s, false, DEFAULT_BRANCH_CUTS);
    }
    const w = wordToString(acc.word);
    const base = 'abAB';
    expect(w.length).toBeGreaterThan(0);
    expect(w.length % base.length).toBe(0);
    // A periodic word can start at any cyclic position, in either
    // orientation (the traversal direction depends on velocity sign
    // conventions): rotations of abAB and of its inverse baBA.
    const rotations = [
      'abAB', 'bABa', 'ABab', 'BabA',
      'baBA', 'aBAb', 'BAba', 'AbaB',
    ];
    const period = rotations.find((r) => w.startsWith(r));
    expect(period, `word was ${w}`).toBeDefined();
    // Every 4-symbol block repeats the same base.
    for (let i = 0; i < w.length; i += 4) {
      expect(w.slice(i, i + 4)).toBe(period);
    }
  }, 120_000);
});
