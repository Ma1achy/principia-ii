import { describe, it, expect } from 'vitest';
import {
  compareImages, DimensionMismatchError, type RasterImage,
} from '@/regression/image_diff.js';
import {
  validateManifest, GOLDEN_MANIFEST, RENDER_MODES, goldenFor,
} from '@/regression/golden_manifest.js';

/** Build a solid-colour raster. */
function solid(w: number, h: number, rgba: [number, number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width: w, height: h, data };
}

/** Clone then poke one pixel to a new colour. */
function withPixel(
  img: RasterImage, x: number, y: number, rgba: [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(img.data);
  const i = (y * img.width + x) * 4;
  data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  return { width: img.width, height: img.height, data };
}

describe('compareImages: identity & tolerance', () => {
  it('identical images → zero diff, passes', () => {
    const a = solid(8, 8, [10, 20, 30, 255]);
    const r = compareImages(a, solid(8, 8, [10, 20, 30, 255]), { tolerance: 0 });
    expect(r.diffRatio).toBe(0);
    expect(r.differingPixels).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('single big-delta pixel below tolerance → passes', () => {
    const a = solid(10, 10, [0, 0, 0, 255]);            // 100 px
    const b = withPixel(a, 5, 5, [255, 255, 255, 255]); // 1 differing → 0.01
    const r = compareImages(a, b, { tolerance: 0.02, ignoreAntialiasing: false });
    expect(r.differingPixels).toBe(1);
    expect(r.diffRatio).toBeCloseTo(0.01, 6);
    expect(r.passed).toBe(true);
  });

  it('single big-delta pixel above tolerance → fails', () => {
    const a = solid(10, 10, [0, 0, 0, 255]);
    const b = withPixel(a, 5, 5, [255, 255, 255, 255]);
    const r = compareImages(a, b, { tolerance: 0.005, ignoreAntialiasing: false });
    expect(r.passed).toBe(false);
  });

  it('sub-threshold per-channel noise is NOT counted', () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    const b = solid(4, 4, [104, 96, 100, 255]); // max |Δ|=4 ≤ default 8
    const r = compareImages(a, b, { tolerance: 0 });
    expect(r.differingPixels).toBe(0);
    expect(r.passed).toBe(true);
  });
});

describe('compareImages: metrics & channels', () => {
  it('luma metric ignores equal-luma colour swaps that channel flags', () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    // Shift R up / B down keeping luma close; channel sees Δ=40, luma small.
    const b = solid(4, 4, [140, 100, 60, 255]);
    const chan = compareImages(a, b, { tolerance: 0, metric: 'channel' });
    const luma = compareImages(a, b, { tolerance: 0, metric: 'luma' });
    expect(chan.differingPixels).toBeGreaterThan(luma.differingPixels);
  });

  it('compareAlpha:false ignores an alpha-only difference', () => {
    const a = solid(4, 4, [10, 10, 10, 255]);
    const b = solid(4, 4, [10, 10, 10, 0]);
    expect(compareImages(a, b, { tolerance: 0, compareAlpha: true }).differingPixels)
      .toBeGreaterThan(0);
    expect(compareImages(a, b, { tolerance: 0, compareAlpha: false }).differingPixels)
      .toBe(0);
  });

  it('produces a magenta diff mask exactly where pixels differ', () => {
    const a = solid(3, 1, [0, 0, 0, 255]);
    const b = withPixel(a, 1, 0, [255, 255, 255, 255]);
    const r = compareImages(a, b, { tolerance: 1, ignoreAntialiasing: false });
    const m = r.diffMask.data;
    expect([m[0], m[1], m[2], m[3]]).toEqual([0, 0, 0, 0]);         // px0 transparent
    expect([m[4], m[5], m[6], m[7]]).toEqual([255, 0, 255, 255]);   // px1 magenta
    expect([m[8], m[9], m[10], m[11]]).toEqual([0, 0, 0, 0]);       // px2 transparent
  });
});

describe('compareImages: antialiasing discount', () => {
  it('discounts an edge-shift pixel but counts a solid colour flip', () => {
    // A: left half black, right half white (a vertical edge at x=2).
    const w = 4, h = 1;
    const a: RasterImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let x = 0; x < w; x++) {
      const v = x < 2 ? 0 : 255;
      const i = x * 4;
      a.data[i] = v; a.data[i + 1] = v; a.data[i + 2] = v; a.data[i + 3] = 255;
    }
    // B: edge shifted by one pixel (x=1 now white) — pure AA jitter.
    const bShift = withPixel(a, 1, 0, [255, 255, 255, 255]);
    const aaOn = compareImages(a, bShift, { tolerance: 0, ignoreAntialiasing: true });
    expect(aaOn.differingPixels).toBe(0); // bracketed by a white neighbour → discounted

    // B': a lone pixel in the solid-black region flips white (NOT an edge).
    const bFlip = withPixel(solid(4, 1, [0, 0, 0, 255]), 0, 0, [255, 255, 255, 255]);
    const flip = compareImages(
      solid(4, 1, [0, 0, 0, 255]), bFlip, { tolerance: 0, ignoreAntialiasing: true });
    expect(flip.differingPixels).toBe(1);
  });
});

describe('compareImages: dimension mismatch', () => {
  it('throws DimensionMismatchError on size mismatch', () => {
    const a = solid(4, 4, [0, 0, 0, 255]);
    const b = solid(4, 5, [0, 0, 0, 255]);
    expect(() => compareImages(a, b, { tolerance: 1 })).toThrow(DimensionMismatchError);
  });

  it('empty image (0x0) compares clean', () => {
    const a: RasterImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const r = compareImages(a, a, { tolerance: 0 });
    expect(r.diffRatio).toBe(0);
    expect(r.passed).toBe(true);
  });
});

describe('golden manifest: coverage validator', () => {
  it('the committed manifest is valid (one golden per render mode)', () => {
    expect(validateManifest()).toEqual([]);
  });

  it('every render mode resolves to an entry', () => {
    for (const mode of RENDER_MODES) {
      expect(goldenFor(mode).id).toBe(mode);
    }
    expect(GOLDEN_MANIFEST).toHaveLength(RENDER_MODES.length);
  });

  it('flags a missing render mode', () => {
    const partial = GOLDEN_MANIFEST.filter(e => e.id !== 'energy');
    const probs = validateManifest(partial);
    expect(probs.some(p => p.kind === 'missing-mode' && /energy/.test(p.detail))).toBe(true);
  });

  it('flags a duplicate file path', () => {
    const dup = [
      ...GOLDEN_MANIFEST,
      { id: 'energy' as const, file: 'event_class.png', seed: 1, tolerance: 0.001 },
    ];
    const probs = validateManifest(dup);
    expect(probs.some(p => p.kind === 'duplicate-file')).toBe(true);
    expect(probs.some(p => p.kind === 'duplicate-id')).toBe(true);
  });

  it('flags an out-of-range tolerance', () => {
    const bad = GOLDEN_MANIFEST.map(e =>
      e.id === 'energy' ? { ...e, tolerance: 1.5 } : e);
    expect(validateManifest(bad).some(p => p.kind === 'bad-tolerance')).toBe(true);
  });
});
