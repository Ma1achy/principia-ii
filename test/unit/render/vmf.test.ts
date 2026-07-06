import { describe, it, expect } from 'vitest';
import { vmfBlend, HUE_OKLAB, HUE_OKABE_ITO } from '@/render/vmf.js';
import { linearRgbToOklab } from '@/render/oklab.js';

describe('vmfBlend', () => {
  it('returns the +x pole hue at n = (1, 0, 0)', () => {
    const rgb = vmfBlend([1, 0, 0], HUE_OKLAB,
                         { kappa: 8, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    const angle = Math.atan2(lab[2], lab[1]);
    expect(angle).toBeCloseTo(HUE_OKLAB[0]!, 1);   // ~ 0 rad
  });

  it('opposite poles cancel toward neutral on the equator', () => {
    // n = (0, 1, 0) sits equidistant from the four poles in the xz-plane;
    // with a soft κ the hue contributions largely cancel.
    const rgb = vmfBlend([0, 1, 0], HUE_OKLAB,
                         { kappa: 0.5, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(0.1); // low chroma
  });

  it('high κ produces near-pure pole colours', () => {
    const rgb = vmfBlend([0.99, 0.1, 0], HUE_OKLAB,
                         { kappa: 16, chroma: 0.15, lightness: 0.7 });
    const lab = linearRgbToOklab(rgb);
    expect(Math.hypot(lab[1], lab[2])).toBeGreaterThan(0.12);
  });

  it('the two hue schemes are genuinely different colourings', () => {
    // Modes 21 (OKLAB hues) and 22 (Okabe–Ito) must not collapse into one.
    const a = vmfBlend([1, 0, 0], HUE_OKLAB,
                       { kappa: 8, chroma: 0.15, lightness: 0.7 });
    const b = vmfBlend([1, 0, 0], HUE_OKABE_ITO,
                       { kappa: 8, chroma: 0.15, lightness: 0.7 });
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist).toBeGreaterThan(0.05);
  });
});
