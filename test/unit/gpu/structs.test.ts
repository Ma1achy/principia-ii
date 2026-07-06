import { describe, it, expect } from 'vitest';
import {
  sizeOfSimResult, sizeOfICDescriptor, sizeOfTileReduction,
  packSimUniforms, packTileRequest,
} from '@/gpu/structs.js';

describe('struct sizes', () => {
  it('SimResult is 208 bytes at M = 8', () => {
    expect(sizeOfSimResult(8)).toBe(208);
  });
  it('SimResult is 336 bytes at M = 16', () => {
    expect(sizeOfSimResult(16)).toBe(336);
  });
  it('ICDescriptor is 64 bytes', () => {
    expect(sizeOfICDescriptor()).toBe(64);
  });
  it('TileReduction is 272 bytes at M = 8', () => {
    expect(sizeOfTileReduction(8)).toBe(272);
  });
});

describe('uniform packing', () => {
  it('SimUniforms round-trip preserves values to f32 precision', () => {
    const u = {
      m: [0.4, 0.3, 0.3] as const,
      M_total: 1, G: 1, dt_macro: 1e-3,
      N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 80,
      r_coll: 1e-4, R_esc: 10, k_esc: 8,
      eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
      quality_tier: 1, checkpoint_count: 8, samples_per_axis: 16,
      mu_max: 5, alpha_min: 0.05, q_max: 2,
    };
    const buf = packSimUniforms(u);
    expect(buf.byteLength).toBe(96);
    const f = new Float32Array(buf);
    const i = new Uint32Array(buf);
    expect(f[0]).toBeCloseTo(0.4, 6);
    expect(i[6]).toBe(64);            // N_max at u32[6]
    expect(i[12]).toBe(8);            // k_esc at u32[12]
    expect(f[19]).toBeCloseTo(5, 6);  // mu_max at f32[19]
    expect(f[20]).toBeCloseTo(0.05, 6);
    expect(f[21]).toBeCloseTo(2, 6);
  });

  it('TileRequest packs to 48 bytes with i32 header + f32 uv fields', () => {
    const buf = packTileRequest({
      z: 3, tx: -1, ty: 2, level: 4,
      uv_centre: [0.25, 0.75], uv_half: [0.125, 0.125], flags: 1,
    });
    expect(buf.byteLength).toBe(48);
    const i32 = new Int32Array(buf);
    const f32 = new Float32Array(buf);
    expect(i32[0]).toBe(3);
    expect(i32[1]).toBe(-1);
    expect(f32[4]).toBeCloseTo(0.25, 6);
    expect(f32[7]).toBeCloseTo(0.125, 6);
    expect(i32[8]).toBe(1);
  });
});
