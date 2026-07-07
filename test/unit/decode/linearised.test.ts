import { describe, it, expect } from 'vitest';
import { buildLinearised, applyLinearised, FD_STEP_DEFAULT } from '@/decode/linearised.js';
import type { TrajState, Vec2 } from '@/math/types.js';

/** A decoder that's exactly affine in (u, v): linearisation is perfect
 *  and the test verifies the FD reconstruction end to end. */
function affineDecoder(uv: [number, number]): TrajState {
  return {
    m: [1 / 3 + 0.1 * uv[0], 1 / 3 - 0.05 * uv[1], 1 / 3], t: 0,
    r: [
      [uv[0], uv[1] * 0.5],
      [uv[0] * 2 - 1, uv[1]],
      [-uv[0], -uv[1]],
    ],
    p: [
      [uv[0] * 0.1, uv[1] * 0.1],
      [-uv[0] * 0.1, -uv[1] * 0.1],
      [0, 0],
    ],
  };
}

describe('linearised reference (G6)', () => {
  it('uses a tile-scale FD step by default (not a chart-scale one)', () => {
    // A 1e-6 step in TILE-LOCAL coordinates would probe a ~1e-15 physical
    // interval at depth 30 and drown the f64 difference quotient in
    // cancellation noise; the default samples inside the tile.
    expect(FD_STEP_DEFAULT).toBe(0.25);
  });

  it('reconstructs an affine decoder exactly', () => {
    const ref = buildLinearised(affineDecoder, [0.5, 0.5]);
    expect(ref).not.toBeNull();
    if (!ref) return;
    const probes: ReadonlyArray<Vec2> = [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.7]];
    for (const [u, v] of probes) {
      const linear = applyLinearised(ref, [u, v]);
      const truth = affineDecoder([u, v]);
      for (let i = 0; i < 3; i++) {
        expect(linear.r[i]![0]).toBeCloseTo(truth.r[i]![0], 9);
        expect(linear.r[i]![1]).toBeCloseTo(truth.r[i]![1], 9);
        expect(linear.p[i]![0]).toBeCloseTo(truth.p[i]![0], 9);
        expect(linear.m[i]).toBeCloseTo(truth.m[i]!, 9);
      }
    }
  });

  it('approximates a smooth nonlinear decoder to second-order accuracy', () => {
    const decoder = (uv: [number, number]): TrajState => ({
      m: [1 / 3, 1 / 3, 1 / 3], t: 0,
      r: [[Math.sin(Math.PI * uv[0]), Math.cos(Math.PI * uv[1])],
          [0, 0], [0, 0]],
      p: [[0, 0], [0, 0], [0, 0]],
    });
    const ref = buildLinearised(decoder, [0.5, 0.5]);
    expect(ref).not.toBeNull();
    if (!ref) return;
    const h = 1e-4;
    const linear = applyLinearised(ref, [0.5 + h, 0.5]);
    const truth = decoder([0.5 + h, 0.5]);
    expect(Math.abs(linear.r[0]![0] - truth.r[0]![0])).toBeLessThan(1e-7);
  });

  it('bails to null when forward and backward differences disagree (kink)', () => {
    // |u − 0.5| has slope −1 on one side of the centre and +1 on the
    // other — a mirror-deadband-style non-smooth point.
    const kinked = (uv: [number, number]): TrajState => ({
      m: [1 / 3, 1 / 3, 1 / 3], t: 0,
      r: [[Math.abs(uv[0] - 0.5), uv[1]], [0, 0], [0, 0]],
      p: [[0, 0], [0, 0], [0, 0]],
    });
    expect(buildLinearised(kinked, [0.5, 0.5])).toBeNull();
  });

  it('bails to null when the centre or a probe decodes terminal', () => {
    expect(buildLinearised(() => null, [0.5, 0.5])).toBeNull();
    const centreOnly = (uv: [number, number]): TrajState | null =>
      uv[0] === 0.5 && uv[1] === 0.5 ? affineDecoder(uv) : null;
    expect(buildLinearised(centreOnly, [0.5, 0.5])).toBeNull();
  });

  it('carries the centre descriptor (built by the one makeDescriptor)', () => {
    const ref = buildLinearised(affineDecoder, [0.5, 0.5]);
    expect(ref?.descriptor0.m).toEqual(affineDecoder([0.5, 0.5]).m);
    expect(ref?.descriptor0.qMass).toBeGreaterThan(0);
  });
});
