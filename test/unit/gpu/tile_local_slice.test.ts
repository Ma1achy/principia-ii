import { describe, it, expect } from 'vitest';
import { tileLocalSlice, DEFAULT_SLICE, type SliceUniformsValue } from '@/gpu/slice_uniforms.js';
import type { Vec8 } from '@/math/types.js';

const f = Math.fround;   // emulate the GPU's f32 arithmetic

/** Global latent map at f64 (the CPU reference). */
function zGlobal(s: SliceUniformsValue, u: number, v: number, lane: number): number {
  const su = (2 * u - 1) * s.mag;
  const sv = (2 * v - 1) * s.mag;
  return s.z0[lane]! + su * s.q1[lane]! + sv * s.q2[lane]!;
}

/** The OLD shader path in f32: rebuild the global uv, then the latent. */
function zOldF32(
  s: SliceUniformsValue, cU: number, hU: number, t: number, lane: number,
): number {
  const uv = f(f(cU) + f(f(hU) * f(2 * t - 1)));
  const su = f(f(uv * 2 - 1) * f(s.mag));
  return f(f(s.z0[lane]!) + f(su * f(s.q1[lane]!)));
}

/** The NEW shader path in f32: f64 fold, then pure tile-local arithmetic. */
function zNewF32(
  folded: SliceUniformsValue, t: number, lane: number,
): number {
  const d = f(2 * t - 1);
  return f(f(folded.z0[lane]!) + f(d * f(folded.q1[lane]!)));
}

function tileCentreHalfAt(depth: number, frac: number): [number, number] {
  const n = 2 ** depth;
  const tx = Math.min(Math.floor(frac * n), n - 1);
  const span = 1 / n;
  return [(tx + 0.5) * span, span / 2];
}

describe('tileLocalSlice — deep-zoom precision (Stage 6)', () => {
  it('the fold is exact: composed map ≡ global map at f64', () => {
    const slice: SliceUniformsValue = {
      z0: [0.3, -1.2, 0.05, 0, 0.7, 0, -0.4, 0.9] as Vec8,
      q1: [0.6, 0.2, 0, 0, 0.5, 0, 0.1, 0] as Vec8,
      q2: [0, 0.4, 0.9, 0, 0, 0.2, 0, 0.3] as Vec8,
      mag: 2.5,
    };
    for (const depth of [0, 3, 10, 25]) {
      const [cU, hU] = tileCentreHalfAt(depth, 0.37);
      const [cV, hV] = tileCentreHalfAt(depth, 0.61);
      const folded = tileLocalSlice(slice, [cU, cV], [hU, hV]);
      for (const [tx, ty] of [[0.03125, 0.03125], [0.5, 0.5], [0.96875, 0.21875]] as const) {
        const u = cU + hU * (2 * tx - 1);
        const v = cV + hV * (2 * ty - 1);
        for (let lane = 0; lane < 8; lane++) {
          const zRef = zGlobal(slice, u, v, lane);
          const dx = 2 * tx - 1, dy = 2 * ty - 1;
          const zTile = folded.z0[lane]! + dx * folded.q1[lane]! + dy * folded.q2[lane]!;
          expect(zTile).toBeCloseTo(zRef, 12);
        }
      }
    }
  });

  it('at depth 25 near the slice centre the old f32 path collapses the WHOLE tile; the new one resolves every sample', () => {
    // The old reconstruction was worst exactly at uv ≈ 0.5 — the DEFAULT
    // view centre: (2·uv − 1) catastrophically cancels, so a deep tile's
    // sub-ulp centre offset rounds away and every sample decodes the SAME
    // z. The folded map keeps the tiny centre offset at f64 and hands the
    // GPU values near zero, where f32 has abundant relative resolution.
    const s = DEFAULT_SLICE;                       // z0=0, q1=e0, mag=3
    const depth = 25;
    const [cU, hU] = tileCentreHalfAt(depth, 0.5); // tile just right of centre
    const N = 16;
    const tA = (7 + 0.5) / N;                      // adjacent samples
    const tB = (8 + 0.5) / N;

    // OLD: fround(0.5 + 2⁻²⁶) = 0.5 → su = 0 for EVERY sample in the tile.
    const oldA = zOldF32(s, cU, hU, tA, 0);
    const oldB = zOldF32(s, cU, hU, tB, 0);
    expect(oldA).toBe(oldB);                       // the bug this stage fixes
    expect(oldA).toBe(0);                          // …and it's not even centred right

    // NEW: the folded tile-local map keeps neighbours distinct…
    const folded = tileLocalSlice(s, [cU, 0.5], [hU, 0.5]);
    const newA = zNewF32(folded, tA, 0);
    const newB = zNewF32(folded, tB, 0);
    expect(newA).not.toBe(newB);
    // …and each lands within f32 rounding of the f64 truth.
    const refA = zGlobal(s, cU + hU * (2 * tA - 1), 0.5, 0);
    expect(Math.abs(newA - refA)).toBeLessThan(1e-10 + 2 ** -20 * Math.abs(refA));
  });

  it('the residual floor is ulp(|z_tile|) — the spec\'s AT_F32_FLOOR, not a coordinate bug', () => {
    // Away from the slice centre (|z| ≈ 0.8) the OUTPUT z itself quantises
    // once the tile's latent span drops below ulp(|z|) — at mag 3 that is
    // depth ≈ 23. The coordinate map is now f32-optimal (one final
    // rounding); past this depth the linearised decoder / AT_F32_FLOOR
    // guard own the problem, exactly as §tile_local_precision says.
    const s = DEFAULT_SLICE;
    const N = 16;
    const [cU22, hU22] = tileCentreHalfAt(22, 0.37);
    const f22 = tileLocalSlice(s, [cU22, 0.5], [hU22, 0.5]);
    expect(zNewF32(f22, (7.5) / N, 0)).not.toBe(zNewF32(f22, (8.5) / N, 0));
    const [cU25, hU25] = tileCentreHalfAt(25, 0.37);
    const f25 = tileLocalSlice(s, [cU25, 0.5], [hU25, 0.5]);
    expect(zNewF32(f25, (7.5) / N, 0)).toBe(zNewF32(f25, (8.5) / N, 0));
  });

  it('depth-0 fold of the default slice reproduces the M3 whole-domain map', () => {
    const folded = tileLocalSlice(DEFAULT_SLICE, [0.5, 0.5], [0.5, 0.5]);
    // At t=(0,0) → d=(-1,-1): z[0] = -mag, z[1] = -mag.
    expect(folded.z0[0]! - folded.q1[0]! - folded.q2[0]!).toBeCloseTo(-3, 12);
    expect(folded.z0[1]! - folded.q1[1]! - folded.q2[1]!).toBeCloseTo(-3, 12);
    // Centre: z = z0.
    expect(folded.z0[0]).toBeCloseTo(0, 12);
  });
});
