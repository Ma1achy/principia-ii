import { describe, it, expect } from 'vitest';
import {
  captureFrame, serializeFrame, deserializeFrame, packedInputs, FRAME_CAPTURE_VERSION,
} from '@/debug/frame_capture.js';
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';

const uniforms: SimUniforms = {
  m: [1 / 3, 1 / 3, 1 / 3], M_total: 1, G: 1,
  dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5, T_horizon: 50,
  r_coll: 1e-4, R_esc: 10, k_esc: 8, eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: 8, samples_per_axis: 16,
  mu_max: 5, alpha_min: 0.05, q_max: 2,
};
const tile: TileRequest = {
  z: 0, tx: 0, ty: 0, level: 0, uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5], flags: 0,
};

const bytesEqual = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

describe('frame capture round-trip', () => {
  it('serialise → deserialise yields byte-identical packed inputs (determinism)', () => {
    const f0 = captureFrame(16, 8, uniforms, tile, 'note');
    const f1 = deserializeFrame(serializeFrame(f0));
    const p0 = packedInputs(f0), p1 = packedInputs(f1);
    expect(bytesEqual(p0.uniforms, p1.uniforms)).toBe(true);
    expect(bytesEqual(p0.tile, p1.tile)).toBe(true);
    expect(f1.label).toBe('note');
  });

  it('rejects a version mismatch', () => {
    const bad = serializeFrame(captureFrame(16, 8, uniforms, tile)).replace(
      `"version": ${FRAME_CAPTURE_VERSION}`, '"version": 999');
    expect(() => deserializeFrame(bad)).toThrow(/version/);
  });

  it('rejects a capture missing required fields', () => {
    expect(() => deserializeFrame(JSON.stringify({ version: FRAME_CAPTURE_VERSION })))
      .toThrow(/required/);
  });
});
