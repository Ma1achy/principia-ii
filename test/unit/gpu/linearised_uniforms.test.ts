import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  packLinearisedUniforms, LINEARISED_UNIFORMS_SIZE,
} from '@/gpu/linearised_uniforms.js';
import { TILE_REQUEST_FLAGS } from '@/gpu/structs.js';
import { linearisedRefLayout } from '@/debug/struct_dump.js';
import type { LinearisedReference } from '@/decode/linearised.js';

const ref: LinearisedReference = {
  x0: {
    m: [1 / 3, 1 / 3, 1 / 3], t: 0,
    r: [[1, 2], [3, 4], [5, 6]],
    p: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
  },
  descriptor0: {
    m: [1 / 3, 1 / 3, 1 / 3], qMass: 1 / 3,
    rho1Mag: 1, rho2Mag: 1, rhoRatio: 1, rhoAngle: 0,
    K0: 0, V0: -1, virial: 0, rMinPair0: 1,
  },
  J_r: [[[0.1, 0.2], [0.3, 0.4]], [[0.5, 0.6], [0.7, 0.8]], [[0.9, 1.0], [1.1, 1.2]]],
  J_p: [[[0.01, 0.02], [0.03, 0.04]], [[0.05, 0.06], [0.07, 0.08]], [[0.09, 0.10], [0.11, 0.12]]],
  J_m: [[0.001, 0.002], [0.003, 0.004], [0.005, 0.006]],
};

describe('LinearisedRef packing (G6)', () => {
  it('produces a 256-byte buffer (= the g0b4 slot)', () => {
    expect(packLinearisedUniforms(ref, 0.5, 0.5).byteLength).toBe(256);
    expect(LINEARISED_UNIFORMS_SIZE).toBe(256);
  });

  it('packs x0 tightly: r0/r1 share the first vec4, p0/p1 the third', () => {
    const f = new Float32Array(packLinearisedUniforms(ref, 0.5, 0.25));
    expect([f[0], f[1], f[2], f[3]]).toEqual([1, 2, 3, 4]);   // r0r1
    expect([f[4], f[5]]).toEqual([5, 6]);                      // r2_pad
    expect(f[8]).toBeCloseTo(0.1, 6);                          // p0p1
    expect(f[11]).toBeCloseTo(0.4, 6);
    expect(f[12]).toBeCloseTo(0.5, 6);                         // p2_pad
    expect(f[16]).toBeCloseTo(1 / 3, 6);                       // m_h.x
    expect(f[19]).toBeCloseTo(0.5, 6);                         // half_u
    expect(f[20]).toBeCloseTo(0.25, 6);                        // half_v
  });

  it('packs the Jacobians per body as (dx/du, dx/dv, dy/du, dy/dv)', () => {
    const f = new Float32Array(packLinearisedUniforms(ref, 0.5, 0.5));
    expect(f[24]).toBeCloseTo(0.1, 6);    // Jr_b0: dr0x/du
    expect(f[25]).toBeCloseTo(0.2, 6);    //        dr0x/dv
    expect(f[26]).toBeCloseTo(0.3, 6);    //        dr0y/du
    expect(f[27]).toBeCloseTo(0.4, 6);    //        dr0y/dv
    expect(f[32]).toBeCloseTo(0.9, 6);    // Jr_b2
    expect(f[36]).toBeCloseTo(0.01, 6);   // Jp_b0
    expect(f[47]).toBeCloseTo(0.12, 6);   // Jp_b2.w
    expect(f[48]).toBeCloseTo(0.001, 6);  // Jm_01: dm0/du
    expect(f[53]).toBeCloseTo(0.006, 6);  // Jm_2:  dm2/dv
    for (let i = 54; i < 64; i++) expect(f[i]).toBe(0);  // reserved tail
  });

  it('matches the WGSL struct field-for-field (alignment pin)', () => {
    // Every member is a vec4<f32>, so WGSL offsets are index × 16. Pin the
    // field ORDER in decode_linear.wgsl against the layout table the packer
    // is written to — a swapped or inserted field breaks this before it
    // silently corrupts a decode.
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/decode_linear.wgsl', import.meta.url),
      'utf8');
    const structBody = /struct LinearisedRef \{([\s\S]*?)\};/.exec(src)?.[1];
    expect(structBody).toBeDefined();
    const wgslFields = [...structBody!.matchAll(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*vec4<f32>/gm)].map((m) => m[1]);
    const layout = linearisedRefLayout();
    expect(wgslFields).toEqual(layout.fields.map((x) => x.name));
    expect(layout.totalSize).toBe(LINEARISED_UNIFORMS_SIZE);
    for (const [i, field] of layout.fields.entries()) {
      expect(field.offset).toBe(i * 16);
    }
  });

  it('pins the DECODE_LINEAR flag bit against its WGSL twin', () => {
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/decode_linear.wgsl', import.meta.url),
      'utf8');
    const m = /const TILE_REQ_DECODE_LINEAR\s*:\s*u32\s*=\s*(\d+)u;/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(TILE_REQUEST_FLAGS.DECODE_LINEAR);
  });
});
