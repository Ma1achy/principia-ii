import { describe, it, expect } from 'vitest';
import { packEnsembleOffsets, ENSEMBLE_OFFSETS_SIZE } from '@/gpu/ensemble.js';
import { jitterOffsets } from '@/quadtree/ensemble_jitter.js';

describe('EnsembleOffsets packing (G7)', () => {
  it('produces a 256-byte buffer (16 vec4 lanes, the g0b5 slot)', () => {
    expect(packEnsembleOffsets([])).toBeInstanceOf(ArrayBuffer);
    expect(packEnsembleOffsets([]).byteLength).toBe(ENSEMBLE_OFFSETS_SIZE);
    expect(ENSEMBLE_OFFSETS_SIZE).toBe(256);
  });

  it('packs (du, dv) into each vec4.xy with zero zw', () => {
    const f = new Float32Array(packEnsembleOffsets([
      { du: 0.25, dv: -0.25 }, { du: -0.1, dv: 0.4 },
    ]));
    expect(f[0]).toBeCloseTo(0.25, 6);
    expect(f[1]).toBeCloseTo(-0.25, 6);
    expect(f[2]).toBe(0);
    expect(f[3]).toBe(0);
    expect(f[4]).toBeCloseTo(-0.1, 6);
    expect(f[5]).toBeCloseTo(0.4, 6);
    for (let i = 8; i < 64; i++) expect(f[i]).toBe(0);   // unused tail
  });

  it('an empty offset list packs as all-zero (= no jitter, E = 1 semantics)', () => {
    const f = new Float32Array(packEnsembleOffsets(jitterOffsets(0, 1)));
    for (const x of f) expect(x).toBe(0);
  });
});
