import { describe, it, expect } from 'vitest';
import { partitionBuffer } from '@/export/partition.js';

describe('partitionBuffer', () => {
  it('returns a single buffer when total fits', () => {
    const p = partitionBuffer(256, 256, 208, 1 << 30);
    expect(p).toHaveLength(1);
    expect(p[0]!.rowCount).toBe(256);
  });

  it('partitions when total exceeds the binding limit', () => {
    // 1024×1024 × 208 ≈ 218 MiB; cap at 128 MiB.
    const p = partitionBuffer(1024, 1024, 208, 128 * 1024 * 1024);
    expect(p.length).toBeGreaterThan(1);
    const totalRows = p.reduce((s, x) => s + x.rowCount, 0);
    expect(totalRows).toBe(1024);
  });

  it('every sub-buffer fits the cap and offsets tile the payload', () => {
    const cap = 128 * 1024 * 1024;
    const p = partitionBuffer(1024, 1024, 208, cap);
    let expectOffset = 0;
    for (const x of p) {
      expect(x.byteSize).toBeLessThanOrEqual(cap);
      expect(x.byteOffset).toBe(expectOffset);
      expectOffset += x.byteSize;
    }
    expect(expectOffset).toBe(1024 * 1024 * 208);
  });
});
