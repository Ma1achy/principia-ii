import type { CapabilityProfile } from '@/gpu/capability.js';

/** Names of the GPU passes G10 times per frame. Stable keys for the rings. */
export type GpuPass = 'simulate' | 'reduce' | 'reduce_spreads' | 'render';

export const GPU_PASSES: readonly GpuPass[] = [
  'simulate', 'reduce', 'reduce_spreads', 'render',
];

/** A resolved per-pass GPU timing (milliseconds), keyed by pass. */
export type GpuPassTimings = Partial<Record<GpuPass, number>>;

/** Minimal device surface we need — keeps the helper mockable without WebGPU. */
export interface TimingDevice {
  createQuerySet(desc: { type: 'timestamp'; count: number; label?: string }): GPUQuerySet;
  createBuffer(desc: GPUBufferDescriptor): GPUBuffer;
}

/**
 * Owns ONE timestamp query set holding a (begin, end) pair per pass at
 * indices (2i, 2i+1), plus the resolve/readback buffers.
 * `timestampWrites(pass)` returns the descriptor you spread into
 * `beginComputePass({ timestampWrites })`; `resolve(encoder)` copies the raw
 * query results into the readback staging buffer; `read()` maps them back
 * as ms.
 *
 * One set, one resolve call: `resolveQuerySet`'s destination offset must be
 * 256-byte aligned, so per-pass sets with tightly-packed 16-byte resolve
 * slots are invalid — a single set resolves in one call at offset 0.
 *
 * Sampling is best-effort and drop-tolerant:
 * - Only passes actually *written* since the last resolve are reported —
 *   resolving blindly would attribute stale timestamps from an earlier
 *   frame to passes that never ran this cycle.
 * - While a read() is in flight the readback buffer is mapped, so resolve()
 *   refuses (returns false) rather than encode a copy into a mapped buffer.
 *   The frame's sample is simply dropped; over a rolling window that is noise.
 *
 * Pairs with G7: on device loss the query set and buffers are gone — discard
 * this instance and rebuild a fresh one on the recovered device.
 */
export class GpuTimer {
  private readonly set: GPUQuerySet;
  private readonly resolveBuf: GPUBuffer;
  private readonly readBuf: GPUBuffer;
  private readonly order: readonly GpuPass[];
  private written = new Set<GpuPass>();
  private captured = new Set<GpuPass>();
  private reading = false;
  /** 2 timestamps (begin/end) × 8 bytes (u64) per pass. */
  private static readonly STRIDE = 2 * 8;

  constructor(device: TimingDevice, passes: readonly GpuPass[] = GPU_PASSES) {
    this.order = passes;
    this.set = device.createQuerySet({
      type: 'timestamp', count: passes.length * 2, label: 'principia.timing',
    });
    const total = passes.length * GpuTimer.STRIDE;
    this.resolveBuf = device.createBuffer({
      size: total,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      label: 'principia.timing.resolve',
    });
    this.readBuf = device.createBuffer({
      size: total,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'principia.timing.read',
    });
  }

  /** Spread into `beginComputePass`/`beginRenderPass({ ...timestampWrites })`.
   *  Marks the pass as written so the next resolve/read reports it. */
  timestampWrites(pass: GpuPass): GPUComputePassTimestampWrites | undefined {
    const i = this.order.indexOf(pass);
    if (i < 0) return undefined;
    this.written.add(pass);
    return {
      querySet: this.set,
      beginningOfPassWriteIndex: 2 * i,
      endOfPassWriteIndex: 2 * i + 1,
    };
  }

  /**
   * Encode one resolve of the whole set into the readback path. Returns
   * false (encoding nothing) when a read() is still in flight or nothing
   * was written — the caller just skips this sample.
   */
  resolve(encoder: GPUCommandEncoder): boolean {
    if (this.reading || this.written.size === 0) return false;
    encoder.resolveQuerySet(this.set, 0, this.order.length * 2, this.resolveBuf, 0);
    encoder.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0,
      this.order.length * GpuTimer.STRIDE);
    this.captured = this.written;
    this.written = new Set();
    return true;
  }

  /**
   * Map the readback buffer and decode each captured pass's (end − begin)
   * into ms. Timestamps are u64 nanoseconds; read as BigInt to avoid f64
   * precision loss, then convert the delta to ms.
   */
  async read(): Promise<GpuPassTimings> {
    if (this.reading) return {};
    this.reading = true;
    try {
      await this.readBuf.mapAsync(GPUMapMode.READ);
      const view = new BigUint64Array(this.readBuf.getMappedRange());
      const out: GpuPassTimings = {};
      for (const [i, pass] of this.order.entries()) {
        if (!this.captured.has(pass)) continue;
        const begin = view[i * 2] ?? 0n;
        const end = view[i * 2 + 1] ?? 0n;
        const deltaNs = end > begin ? end - begin : 0n;
        out[pass] = Number(deltaNs) / 1e6;          // ns → ms
      }
      this.readBuf.unmap();
      this.captured = new Set();
      return out;
    } finally {
      this.reading = false;
    }
  }

  destroy(): void {
    this.set.destroy();
    this.resolveBuf.destroy();
    this.readBuf.destroy();
  }
}

/**
 * Build a GpuTimer only when the device was created with `timestamp-query`
 * (G9's CapabilityProfile.features, opted into by initGpu). Otherwise return
 * null and let the monitor fall back to CPU-only timing. Never throws on a
 * missing feature.
 */
export function makeGpuTimer(
  device: TimingDevice,
  profile: Pick<CapabilityProfile, 'features'>,
): GpuTimer | null {
  if (!profile.features.includes('timestamp-query')) return null;
  return new GpuTimer(device);
}
