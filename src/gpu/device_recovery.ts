import type { GpuContext } from './init.js';
import { initGpu } from './init.js';
import type { TileCache } from '@/quadtree/cache.js';

/**
 * Device-loss recovery (G7, spec §7.6). WebGPU devices vanish on TDR,
 * driver crash, or explicit destroy(); the recovery contract is that the
 * CPU-side TileReduction records SURVIVE the loss — the user keeps the
 * last-known render (ancestor fallback from cached reductions) while
 * tiles repopulate on the fresh device.
 */
export interface DeviceRecoveryHooks {
  /** Rebuild pipelines against the fresh device (layouts are re-memoised
   *  per device by buildLayouts, so builders just re-run). */
  rebuildPipelines: (ctx: GpuContext) => Promise<void>;
  /** Reallocate per-tile GPU buffers on the fresh device. */
  reallocateBuffers: (ctx: GpuContext) => void;
  /** UI notifications. */
  onRecovering?: () => void;
  onRecovered?: () => void;
}

export class DeviceRecovery {
  private recovering = false;
  private disposed = false;
  private currentCtx: GpuContext;

  constructor(
    initial: GpuContext,
    private readonly cache: TileCache,
    private readonly hooks: DeviceRecoveryHooks,
    /** Injectable device acquisition (tests supply a fake). */
    private readonly acquire: () => Promise<GpuContext> = () => initGpu(),
  ) {
    this.currentCtx = initial;
    this.attachLossListener();
  }

  isRecovering(): boolean { return this.recovering; }

  ctx(): GpuContext { return this.currentCtx; }

  /** Stop reacting to device loss (app shutdown). */
  dispose(): void { this.disposed = true; }

  /** Run a full recovery (also invoked by the loss listener). */
  async recover(): Promise<void> {
    if (this.recovering || this.disposed) return;
    this.recovering = true;
    this.hooks.onRecovering?.();
    try {
      const fresh = await this.acquire();
      await this.hooks.rebuildPipelines(fresh);
      this.hooks.reallocateBuffers(fresh);
      this.markCachedTilesForRecompute();
      this.currentCtx = fresh;
      // device.lost resolves once per device — the FRESH device needs its
      // own listener or a second loss goes unobserved.
      this.attachLossListener();
    } finally {
      this.recovering = false;
      this.hooks.onRecovered?.();
    }
  }

  private attachLossListener(): void {
    const device = this.currentCtx.device;
    void device.lost.then((info) => {
      if (this.disposed) return;
      // Only react if this is still the active device (a stale listener
      // from a pre-recovery device must not re-trigger).
      if (this.currentCtx.device !== device) return;
      console.warn(`GPU device lost (${info.reason}): ${info.message}`);
      void this.recover();
    });
  }

  /**
   * Reset every cache entry to `unseen` with its GPU buffers nulled (they
   * died with the device — never destroy() through a lost device). The
   * entry itself, and critically its `reduction`, SURVIVE: the scheduler
   * renders from the last-known reductions until tiles recompute.
   */
  private markCachedTilesForRecompute(): void {
    for (const entry of this.cache.entries()) {
      entry.simBuffer = null;
      entry.icBuffer = null;
      entry.lifecycle = 'unseen';
    }
  }
}
