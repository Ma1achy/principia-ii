import { describe, it, expect } from 'vitest';
import { lookup } from '@/interact/lookup.js';
import { defaultViewState } from '@/interact/view_state.js';

/**
 * NB on assertions: the latent chart is scale- and frame-gauged
 * (hyperradius R̃ = 1, canonical COM frame with ρ along +x). The decoded
 * `lockedPhysical` therefore preserves the request's mass tuple, distance
 * RATIOS, and angles — not its absolute positions or scale. Assert the
 * invariant facts (M1's don't-pin-the-gauge ruling).
 */
describe('lookup', () => {
  it('latent input round-trips', () => {
    const z = [0.4, 0.0, 0, 0, 0, 0, 0.1, -0.1] as any;
    const r = lookup({ kind: 'latent', z }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.view.z0).toEqual(z);
      expect(r.view.locked).toBe(true);
    }
  });

  it('Pythagorean (m, n) = (2, 1) gives the (3, 4, 5) Burrau IC', () => {
    const r = lookup({ kind: 'pythag', m: 2, n: 1 }, defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const ic = r.view.lockedPhysical!;
      // Burrau (3,4,5) re-indexed: m = (5/12, 4/12, 3/12). Masses survive
      // the latent round trip exactly (softmax logits).
      expect(ic.m[0]).toBeCloseTo(5/12, 6);
      expect(ic.m[1]).toBeCloseTo(4/12, 6);
      expect(ic.m[2]).toBeCloseTo(3/12, 6);
      // The requested triangle has sides d01 : d02 : d12 = 3/5 : 4/5 : 1
      // with the right angle at body 0. Positions come back COM-projected
      // and hyperradius-normalised, so assert ratios and the right angle.
      const d = (i: number, j: number) =>
        Math.hypot(ic.r[j]![0] - ic.r[i]![0], ic.r[j]![1] - ic.r[i]![1]);
      expect(d(0, 2) / d(0, 1)).toBeCloseTo(4/3, 6);
      expect(d(1, 2) / d(0, 1)).toBeCloseTo(5/3, 6);
      const dot = (ic.r[1]![0] - ic.r[0]![0]) * (ic.r[2]![0] - ic.r[0]![0])
                + (ic.r[1]![1] - ic.r[0]![1]) * (ic.r[2]![1] - ic.r[0]![1]);
      expect(Math.abs(dot) / (d(0, 1) * d(0, 2))).toBeLessThan(1e-6);
    }
  });

  it('explicit triple (5, 12, 13) gives matching mass ratios', () => {
    const r = lookup({ kind: 'pythag_triple', a: 5, b: 12, c: 13 },
                     defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const total = 5 + 12 + 13;
      expect(r.view.lockedPhysical!.m[0]).toBeCloseTo(13/total, 6);
      expect(r.view.lockedPhysical!.m[1]).toBeCloseTo(12/total, 6);
      expect(r.view.lockedPhysical!.m[2]).toBeCloseTo(5 /total, 6);
    }
  });

  it('mass-only input lands at the equilateral default', () => {
    const r = lookup({ kind: 'mass', m: [0.5, 0.3, 0.2] },
                     defaultViewState());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const ic = r.view.lockedPhysical!;
      // Triangle shape is preserved (scale is not): all sides equal.
      const d01 = Math.hypot(ic.r[1]![0]-ic.r[0]![0], ic.r[1]![1]-ic.r[0]![1]);
      const d02 = Math.hypot(ic.r[2]![0]-ic.r[0]![0], ic.r[2]![1]-ic.r[0]![1]);
      const d12 = Math.hypot(ic.r[2]![0]-ic.r[1]![0], ic.r[2]![1]-ic.r[1]![1]);
      expect(d02 / d01).toBeCloseTo(1, 6);
      expect(d12 / d01).toBeCloseTo(1, 6);
    }
  });

  it('handles a saturated latent without throwing (totality)', () => {
    // Push z_μ1 wildly out of range; decode is total, so this either
    // succeeds with a clamped mass or rejects with a terminal label —
    // never throws.
    const z = [0, 0, 0, 0, 0, 0, 100, 0] as any;
    const r = lookup({ kind: 'latent', z }, defaultViewState());
    expect(r.kind === 'ok' || r.kind === 'rejected').toBe(true);
  });
});
