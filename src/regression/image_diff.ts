/**
 * Pure, deterministic image comparison for visual-regression goldens.
 *
 * The Playwright specs render a frame and snapshot it; THIS module decides
 * pass/fail. Keeping the decision pure is what lets the exit suite run with no
 * GPU/browser/display — the comparator only ever sees raw RGBA bytes.
 */

/** Minimal raster: identical field layout to the DOM ImageData. */
export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, row-major, length === width*height*4. */
  data: Uint8ClampedArray;
}

export type DiffMetric = 'channel' | 'luma';

export interface CompareOptions {
  /**
   * Max diffRatio (differing px / total px) still considered a pass.
   * e.g. 0.001 = up to 0.1% of pixels may differ.
   */
  tolerance: number;
  /**
   * Per-pixel colour distance (0..255 scale) at/below which two pixels are
   * "the same". Absorbs dithering and 8-bit rounding. Default 8.
   */
  pixelThreshold?: number;
  /** 'channel' = max abs per-channel delta; 'luma' = Rec.601 luma delta. */
  metric?: DiffMetric;
  /**
   * Discount pixels that look like antialiasing: a differing pixel whose
   * 4-neighbourhood in BOTH images contains a value bracketing it is treated
   * as AA jitter and not counted. Default true.
   */
  ignoreAntialiasing?: boolean;
  /** Treat alpha as a compared channel (default true; false ignores alpha). */
  compareAlpha?: boolean;
}

export interface CompareResult {
  /** differingPixels / totalPixels. */
  diffRatio: number;
  /** Count of pixels that exceeded the threshold (post-AA discount). */
  differingPixels: number;
  totalPixels: number;
  /** diffRatio <= tolerance. */
  passed: boolean;
  /**
   * RGBA mask: differing pixels painted opaque magenta, others transparent.
   * Same dimensions as the inputs; for artifact upload / human triage.
   */
  diffMask: RasterImage;
}

export class DimensionMismatchError extends Error {
  constructor(
    public readonly a: { width: number; height: number },
    public readonly b: { width: number; height: number },
  ) {
    super(
      `image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
    this.name = 'DimensionMismatchError';
  }
}

const REC601 = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

/** Per-pixel distance on the chosen metric (0..255). Pure. */
function pixelDistance(
  a: Uint8ClampedArray, b: Uint8ClampedArray, i: number,
  metric: DiffMetric, compareAlpha: boolean,
): number {
  const dr = Math.abs(a[i]! - b[i]!);
  const dg = Math.abs(a[i + 1]! - b[i + 1]!);
  const db = Math.abs(a[i + 2]! - b[i + 2]!);
  const da = compareAlpha ? Math.abs(a[i + 3]! - b[i + 3]!) : 0;
  if (metric === 'luma') {
    return Math.max(
      Math.abs(REC601(a[i]!, a[i + 1]!, a[i + 2]!) -
               REC601(b[i]!, b[i + 1]!, b[i + 2]!)),
      da,
    );
  }
  return Math.max(dr, dg, db, da);
}

/** Distance between src.data[ia..] and dst.data[ib..]. */
function pixelDistanceCross(
  src: Uint8ClampedArray, dst: Uint8ClampedArray, ia: number, ib: number,
  metric: DiffMetric, compareAlpha: boolean,
): number {
  const dr = Math.abs(src[ia]! - dst[ib]!);
  const dg = Math.abs(src[ia + 1]! - dst[ib + 1]!);
  const db = Math.abs(src[ia + 2]! - dst[ib + 2]!);
  const da = compareAlpha ? Math.abs(src[ia + 3]! - dst[ib + 3]!) : 0;
  if (metric === 'luma') {
    return Math.max(
      Math.abs(REC601(src[ia]!, src[ia + 1]!, src[ia + 2]!) -
               REC601(dst[ib]!, dst[ib + 1]!, dst[ib + 2]!)),
      da,
    );
  }
  return Math.max(dr, dg, db, da);
}

/**
 * Antialias heuristic: a differing pixel is treated as edge jitter iff BOTH
 * values already exist in the other image's immediate neighbourhood — i.e.
 * some neighbour in A matches B's centre value AND some neighbour in B
 * matches A's centre value, which is exactly what a sub-pixel edge shift
 * produces. A solid colour flip fails the first bracket (the new colour has
 * no support anywhere in A's neighbourhood) and is always counted.
 */
function looksLikeAntialiasing(
  a: RasterImage, b: RasterImage, x: number, y: number,
  metric: DiffMetric, compareAlpha: boolean, threshold: number,
): boolean {
  const idx = (xx: number, yy: number): number => (yy * a.width + xx) * 4;
  const here = idx(x, y);
  const neigh: [number, number][] = [
    [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
  ];
  let bValueInA = false;   // some A-neighbour ≈ B's centre value
  let aValueInB = false;   // some B-neighbour ≈ A's centre value
  for (const [nx, ny] of neigh) {
    if (nx < 0 || ny < 0 || nx >= a.width || ny >= a.height) continue;
    const ni = idx(nx, ny);
    if (pixelDistanceCross(a.data, b.data, ni, here, metric, compareAlpha) <= threshold) {
      bValueInA = true;
    }
    if (pixelDistanceCross(b.data, a.data, ni, here, metric, compareAlpha) <= threshold) {
      aValueInB = true;
    }
    if (bValueInA && aValueInB) return true;
  }
  return false;
}

/**
 * Compare two equal-dimension RGBA rasters. Throws DimensionMismatchError if
 * sizes differ (a size change is never a "tolerable" diff — it is a bug).
 */
export function compareImages(
  a: RasterImage, b: RasterImage, opts: CompareOptions,
): CompareResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new DimensionMismatchError(a, b);
  }
  const metric = opts.metric ?? 'channel';
  const threshold = opts.pixelThreshold ?? 8;
  const compareAlpha = opts.compareAlpha ?? true;
  const ignoreAA = opts.ignoreAntialiasing ?? true;

  const totalPixels = a.width * a.height;
  const mask = new Uint8ClampedArray(totalPixels * 4); // zero-filled = transparent
  let differingPixels = 0;

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const dist = pixelDistance(a.data, b.data, i, metric, compareAlpha);
      if (dist <= threshold) continue;
      if (ignoreAA &&
          looksLikeAntialiasing(a, b, x, y, metric, compareAlpha, threshold)) {
        continue;
      }
      differingPixels++;
      mask[i] = 255;       // R
      mask[i + 1] = 0;     // G
      mask[i + 2] = 255;   // B (magenta)
      mask[i + 3] = 255;   // A (opaque)
    }
  }

  const diffRatio = totalPixels === 0 ? 0 : differingPixels / totalPixels;
  return {
    diffRatio,
    differingPixels,
    totalPixels,
    passed: diffRatio <= opts.tolerance,
    diffMask: { width: a.width, height: a.height, data: mask },
  };
}
