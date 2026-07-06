import { describe, it, expect } from 'vitest';
import { applyCvd } from '@/render/cvd.js';

describe('CVD matrices', () => {
  it('none is identity', () => {
    expect(applyCvd([0.3, 0.6, 0.9], 'none')).toEqual([0.3, 0.6, 0.9]);
  });

  it('protan compresses the red channel', () => {
    const out = applyCvd([1, 0, 0], 'protan');
    expect(out[0]).toBeCloseTo(0.567, 3);
    expect(out[1]).toBeCloseTo(0.558, 3);
  });

  it('achrom produces a grey of the luminance', () => {
    const out = applyCvd([1, 0, 0], 'achrom');
    expect(out[0]).toBeCloseTo(0.299, 3);
    expect(out[1]).toBeCloseTo(0.299, 3);
    expect(out[2]).toBeCloseTo(0.299, 3);
  });
});
