import { describe, it, expect } from 'vitest';
import {
  srgbToLinear, linearToSrgb,
  linearRgbToOklab, oklabToLinearRgb,
  oklabToOklch, oklchToOklab,
} from '@/render/oklab.js';
import type { Vec3 } from '@/math/types.js';

describe('sRGB transfer round-trip', () => {
  it('linearToSrgb ∘ srgbToLinear ≈ id', () => {
    for (const c of [0, 0.04, 0.1, 0.5, 0.9, 1.0]) {
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 9);
    }
  });
});

describe('OKLAB round-trip', () => {
  it('oklab ∘ rgb ≈ id within 1e-6 ΔE', () => {
    for (const c of [
      [0.5, 0.5, 0.5], [0.7, 0.2, 0.1], [0.1, 0.5, 0.9],
    ] as Vec3[]) {
      const lab = linearRgbToOklab(c);
      const back = oklabToLinearRgb(lab);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(c[i]!, 6);
    }
  });

  it('white has L ≈ 1 and no chroma', () => {
    const lab = linearRgbToOklab([1, 1, 1]);
    expect(lab[0]).toBeCloseTo(1, 3);
    expect(lab[1]).toBeCloseTo(0, 3);
    expect(lab[2]).toBeCloseTo(0, 3);
  });
});

describe('OKLCH round-trip', () => {
  it('lab ∘ lch ≈ id', () => {
    const lab = [0.7, 0.05, -0.04] as Vec3;
    const back = oklchToOklab(oklabToOklch(lab));
    expect(back[0]).toBeCloseTo(lab[0], 12);
    expect(back[1]).toBeCloseTo(lab[1], 12);
    expect(back[2]).toBeCloseTo(lab[2], 12);
  });
});
