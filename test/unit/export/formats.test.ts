import { describe, it, expect } from 'vitest';
import {
  encodeBinary, decodeBinaryHeader, BINARY_MAGIC,
} from '@/export/formats/binary.js';
import { simResultsToCsv } from '@/export/formats/csv.js';
import { decodeSimResultsToJson } from '@/export/formats/json.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

describe('binary format header round-trip', () => {
  it('decodes the header it encoded', () => {
    const payload = new ArrayBuffer(208);
    const hash = new Uint8Array(32).map((_, i) => i);
    const ab = encodeBinary(1, 1, 8, hash, payload);
    const h = decodeBinaryHeader(ab);
    expect(h.magic).toBe(BINARY_MAGIC);
    expect(h.width).toBe(1);
    expect(h.height).toBe(1);
    expect(h.M).toBe(8);
    expect([...h.viewHash]).toEqual([...hash]);
  });

  it('magic bytes read "PCNP" in file order', () => {
    const ab = encodeBinary(1, 1, 8, new Uint8Array(32), new ArrayBuffer(208));
    const ascii = String.fromCharCode(...new Uint8Array(ab, 0, 4));
    expect(ascii).toBe('PCNP');
  });
});

describe('CSV', () => {
  it('escapes commas and quotes', () => {
    expect(simResultsToCsv([{ a: 'x,y', b: 'q"r' }], ['a', 'b']))
      .toContain('"x,y"');
  });
  it('writes NaN explicitly', () => {
    const csv = simResultsToCsv([{ a: NaN }], ['a']);
    expect(csv).toContain('NaN');
  });
});

describe('JSON decode reuses the M3 layout decoder', () => {
  it('reads back a synthetic SimResult written at the pinned offsets', () => {
    const M = 8;
    const stride = sizeOfSimResult(M);       // 208 at M=8
    const ab = new ArrayBuffer(stride);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    const base = M * 4;
    f32[base + 5] = 42.5;                    // t_end
    f32[base + 7] = 0.125;                   // ftle
    u32[base + 15] = 0x80;                   // sample_descriptor: FTLE_VALID
    const [r] = decodeSimResultsToJson(ab, 1, M);
    expect(r!.t_end).toBe(42.5);
    expect(r!.ftle).toBe(0.125);
    expect(r!.sample_descriptor).toBe(0x80);
  });
});
