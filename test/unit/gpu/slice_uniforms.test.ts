import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  packSliceUniforms, SLICE_UNIFORMS_SIZE, DEFAULT_SLICE,
  type SliceUniformsValue,
} from '@/gpu/slice_uniforms.js';
import { sliceUniformsLayout } from '@/debug/struct_dump.js';
import type { Vec8 } from '@/math/types.js';

const slice: SliceUniformsValue = {
  z0: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  q1: [1, 2, 3, 4, 5, 6, 7, 8],
  q2: [-1, -2, -3, -4, -5, -6, -7, -8],
  mag: 2.5,
};

describe('SliceUniforms packing (chart-decode fix)', () => {
  it('produces a 112-byte buffer (= the g0b6 slot)', () => {
    expect(packSliceUniforms(slice).byteLength).toBe(112);
    expect(SLICE_UNIFORMS_SIZE).toBe(112);
  });

  it('packs z0 / q1 / q2 / mag into lanes 0..7 / 8..15 / 16..23 / 24', () => {
    const f = new Float32Array(packSliceUniforms(slice));
    for (let i = 0; i < 8; i++) {
      expect(f[i]).toBeCloseTo(slice.z0[i]!, 6);
      expect(f[8 + i]).toBeCloseTo(slice.q1[i]!, 6);
      expect(f[16 + i]).toBeCloseTo(slice.q2[i]!, 6);
    }
    expect(f[24]).toBeCloseTo(2.5, 6);
    for (let i = 25; i < 28; i++) expect(f[i]).toBe(0);   // mag_pad tail
  });

  it('matches the WGSL struct field-for-field (alignment pin)', () => {
    // Every member is a vec4<f32>, so WGSL offsets are index × 16. Pin the
    // field ORDER in simulate.wgsl against the layout table the packer is
    // written to — a swapped or inserted field silently decodes the wrong
    // slice on every pixel.
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/simulate.wgsl', import.meta.url),
      'utf8');
    const structBody = /struct SliceUniforms \{([\s\S]*?)\};/.exec(src)?.[1];
    expect(structBody).toBeDefined();
    const wgslFields = [...structBody!.matchAll(
      /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*vec4<f32>/g)].map((m) => m[1]);
    const layout = sliceUniformsLayout();
    expect(wgslFields).toEqual(layout.fields.map((x) => x.name));
    expect(layout.totalSize).toBe(SLICE_UNIFORMS_SIZE);
    for (const [i, field] of layout.fields.entries()) {
      expect(field.offset).toBe(i * 16);
    }
  });

  it('the shader applies the slice: pin the affine map expressions', () => {
    // The map z = z0 + mag((2u−1)q1 + (2v−1)q2) must actually be READ by
    // simulate.wgsl's default decode path — this is the regression that
    // motivated the fix (the M3 shader ignored the view's slice entirely).
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/simulate.wgsl', import.meta.url),
      'utf8');
    expect(src).toMatch(/\(uv\.x \* 2\.0 - 1\.0\) \* slice\.mag_pad\.x/);
    expect(src).toMatch(/slice\.z0a \+ su \* slice\.q1a \+ sv \* slice\.q2a/);
    expect(src).toMatch(/slice\.z0b \+ su \* slice\.q1b \+ sv \* slice\.q2b/);
    // The old hard-coded default slice must be gone.
    expect(src).not.toMatch(/\* 3\.0;\s*\/\/ ±3 latent range/);
  });

  it('DEFAULT_SLICE reproduces the M3 hard-coded mapping bit-for-bit', () => {
    // Old shader: z[0] = (uv.x·2−1)·3, z[1] = (uv.y·2−1)·3, rest 0.
    // New shader with DEFAULT_SLICE: su = (uv.x·2−1)·3 → z[0] = 0 + su·1,
    // z[1] = sv·1, others 0·su + 0·sv = 0. Multiplying by 1.0 and adding
    // 0.0 are exact in f32, so goldens must not move.
    const { z0, q1, q2, mag } = DEFAULT_SLICE;
    for (const [u, v] of [[0, 0], [0.25, 0.75], [0.5, 0.5], [1, 1]] as const) {
      const su = (2 * u - 1) * mag;
      const sv = (2 * v - 1) * mag;
      const z = z0.map((z0i, i) => z0i + su * q1[i]! + sv * q2[i]!) as unknown as Vec8;
      expect(z[0]).toBe(Math.fround((u * 2 - 1) * 3));
      expect(z[1]).toBe(Math.fround((v * 2 - 1) * 3));
      for (let i = 2; i < 8; i++) expect(z[i]).toBe(0);
    }
  });
});
