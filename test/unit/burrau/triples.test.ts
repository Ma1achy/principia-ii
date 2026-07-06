import { describe, it, expect } from 'vitest';
import { primitiveTriples, nearestPrimitiveTriple } from '@/burrau/triples.js';

describe('primitive triples', () => {
  it('first four primitive triples up to m = 5', () => {
    const triples = [...primitiveTriples(5)].map((t) => ({ a: t.a, b: t.b, c: t.c }));
    expect(triples).toContainEqual({ a: 3, b: 4, c: 5 });
    expect(triples).toContainEqual({ a: 5, b: 12, c: 13 });
    expect(triples).toContainEqual({ a: 15, b: 8, c: 17 });
    expect(triples).toContainEqual({ a: 7, b: 24, c: 25 });
  });

  it('rejects non-primitive (m - n even)', () => {
    const triples = [...primitiveTriples(4)];
    // (m, n) = (3, 1) has m - n = 2 (even) → not in list.
    const has31 = triples.some((t) => t.m === 3 && t.n === 1);
    expect(has31).toBe(false);
  });

  it('nearestPrimitiveTriple finds (3, 4, 5) closest to ν = 0.51 within a coarse bound', () => {
    // With the default maxM=32 a finer fraction (e.g. 16/31 ≈ 0.516) is
    // strictly closer to 0.51 than 1/2, so constrain the search to the
    // coarse landmark range the assertion describes.
    const t = nearestPrimitiveTriple(0.51, 3);
    expect(t.m).toBe(2); expect(t.n).toBe(1);
  });
});
