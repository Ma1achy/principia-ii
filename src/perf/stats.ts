/**
 * Fixed-capacity rolling window of f64 samples with O(1) push and
 * O(k log k) percentile (k = current fill). Pure and synchronous — the
 * whole point is that PerfMonitor's math is unit-testable without a GPU.
 */
export class RollingWindow {
  private readonly buf: Float64Array;
  private head = 0;        // next write index
  private count = 0;       // number of valid samples (≤ capacity)
  private runningSum = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('RollingWindow capacity must be > 0');
    this.buf = new Float64Array(capacity);
  }

  /** Push one sample, overwriting the oldest when full. */
  push(x: number): void {
    if (this.count === this.capacity) {
      // Evict the value we are about to overwrite from the running sum.
      this.runningSum -= this.buf[this.head] ?? 0;
    } else {
      this.count++;
    }
    this.buf[this.head] = x;
    this.runningSum += x;
    this.head = (this.head + 1) % this.capacity;
  }

  get size(): number { return this.count; }

  /** Arithmetic mean of the current window; 0 when empty. */
  mean(): number {
    return this.count === 0 ? 0 : this.runningSum / this.count;
  }

  /** Snapshot the valid samples (oldest → newest) into a fresh array. */
  toArray(): number[] {
    const out: number[] = [];
    const start = this.count < this.capacity
      ? 0
      : this.head;                       // when full, head points at the oldest
    for (let i = 0; i < this.count; i++) {
      out.push(this.buf[(start + i) % this.capacity] ?? 0);
    }
    return out;
  }

  /**
   * Linear-interpolated percentile (p in [0,1]) over the current window.
   * Returns 0 when empty. p=0 → min, p=1 → max.
   */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = this.toArray().sort((a, b) => a - b);
    if (p <= 0) return sorted[0] ?? 0;
    if (p >= 1) return sorted[sorted.length - 1] ?? 0;
    const rank = p * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const frac = rank - lo;
    const a = sorted[lo] ?? 0;
    const b = sorted[hi] ?? 0;
    return a + (b - a) * frac;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.runningSum = 0;
    this.buf.fill(0);
  }
}

/** Convenience: p95 of a window. */
export function p95(w: RollingWindow): number {
  return w.percentile(0.95);
}
