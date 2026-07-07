import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  packUploadedICs, buildUploadedICs, sizeOfUploadedICs, UPLOADED_IC_SIZE,
  type UploadedICSample,
} from '@/gpu/uploaded_ics.js';
import { uploadedIcLayout } from '@/debug/struct_dump.js';
import { TILE_REQUEST_FLAGS } from '@/gpu/structs.js';

const sample = (tag: number): UploadedICSample => ({
  terminal: 0,
  m: [0.5, 0.3, 0.2],
  r: [[tag, 1], [2, 3], [4, 5]],
  p: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
});

describe('UploadedIC packing (chart-decode fix)', () => {
  it('strides 64 bytes per sample', () => {
    expect(UPLOADED_IC_SIZE).toBe(64);
    expect(packUploadedICs([sample(0), sample(1)]).byteLength).toBe(128);
    expect(sizeOfUploadedICs(16)).toBe(64 * 256);
    expect(sizeOfUploadedICs(16, 4)).toBe(64 * 256 * 4);
  });

  it('packs (m, terminal) then r0r1, r2p0, p1p2 — the ICOut lane order', () => {
    const s: UploadedICSample = { ...sample(9), terminal: 2 };
    const f = new Float32Array(packUploadedICs([sample(7), s]));
    // Second sample starts at lane 16.
    expect(f[16]).toBeCloseTo(0.5, 6);     // m1
    expect(f[18]).toBeCloseTo(0.2, 6);     // m3
    expect(f[19]).toBe(2);                 // terminal
    expect(f[20]).toBe(9);                 // r0.x
    expect(f[23]).toBe(3);                 // r1.y
    expect(f[24]).toBe(4);                 // r2.x
    expect(f[26]).toBeCloseTo(0.1, 6);     // p0.x
    expect(f[28]).toBeCloseTo(0.3, 6);     // p1.x
    expect(f[31]).toBeCloseTo(0.6, 6);     // p2.y
  });

  it('matches the WGSL struct field-for-field (alignment pin)', () => {
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/simulate.wgsl', import.meta.url),
      'utf8');
    const structBody = /struct UploadedIC \{([\s\S]*?)\};/.exec(src)?.[1];
    expect(structBody).toBeDefined();
    const wgslFields = [...structBody!.matchAll(
      /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*vec4<f32>/g)].map((m) => m[1]);
    const layout = uploadedIcLayout();
    expect(wgslFields).toEqual(layout.fields.map((x) => x.name));
    expect(layout.totalSize).toBe(UPLOADED_IC_SIZE);
  });

  it('pins the DECODE_UPLOADED flag bit against its WGSL twin', () => {
    const src = readFileSync(
      new URL('../../../src/gpu/shaders/simulate.wgsl', import.meta.url),
      'utf8');
    const m = /const TILE_REQ_DECODE_UPLOADED\s*:\s*u32\s*=\s*(\d+)u;/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(TILE_REQUEST_FLAGS.DECODE_UPLOADED);
    expect(TILE_REQUEST_FLAGS.DECODE_UPLOADED)
      .not.toBe(TILE_REQUEST_FLAGS.DECODE_LINEAR);
  });

  it('buildUploadedICs samples in shader order at shader sample points', () => {
    // idx = z·N² + gy·N + gx; t = (g + 0.5)/N + off/N;
    // uv = centre + half·(2t − 1) — pinned against simulate.wgsl's maths.
    const calls: [number, number][] = [];
    const N = 4;
    const out = buildUploadedICs(
      (u, v) => { calls.push([u, v]); return sample(calls.length); },
      { uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5] },
      N,
      [{ du: 0, dv: 0 }, { du: 0.25, dv: -0.25 }],
    );
    expect(out).toHaveLength(N * N * 2);
    // Copy 0, gx=0, gy=0: t = 0.125 → uv = 0.5 + 0.5·(−0.75) = 0.125.
    expect(calls[0]![0]).toBeCloseTo(0.125, 12);
    expect(calls[0]![1]).toBeCloseTo(0.125, 12);
    // Copy 0, gx=3, gy=0 (idx 3): t = 0.875 → uv = 0.875.
    expect(calls[3]![0]).toBeCloseTo(0.875, 12);
    expect(calls[3]![1]).toBeCloseTo(0.125, 12);
    // Copy 0, gy=1, gx=0 (idx N): v advances by 1/N·2·half = 0.25.
    expect(calls[N]![1]).toBeCloseTo(0.375, 12);
    // Copy 1, gx=0, gy=0 (idx N²): jitter du=0.25 px → u += 0.25/N·2·half.
    expect(calls[N * N]![0]).toBeCloseTo(0.125 + 0.25 / N, 12);
    expect(calls[N * N]![1]).toBeCloseTo(0.125 - 0.25 / N, 12);
  });

  it('an empty offsets table still decodes one unjittered copy', () => {
    const out = buildUploadedICs(
      () => sample(0), { uv_centre: [0.5, 0.5], uv_half: [0.5, 0.5] }, 2, []);
    expect(out).toHaveLength(4);
  });
});
