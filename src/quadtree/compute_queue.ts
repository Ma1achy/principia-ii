import type { TileID } from './types.js';

/**
 * FIFO of pending tile compute requests. M5 replaces this with a priority
 * queue. Implementing FIFO as a circular buffer here keeps the
 * data-structure swap below local in M5.
 */
export class FifoComputeQueue {
  private items: TileID[] = [];
  private inflight = new Set<string>();

  push(id: TileID): void {
    const k = `${id.z}/${id.tx}/${id.ty}`;
    if (this.inflight.has(k)) return;
    if (this.items.some(t => t.z === id.z && t.tx === id.tx && t.ty === id.ty)) return;
    this.items.push(id);
  }

  pop(): TileID | undefined {
    const id = this.items.shift();
    if (id) this.inflight.add(`${id.z}/${id.tx}/${id.ty}`);
    return id;
  }

  done(id: TileID): void {
    this.inflight.delete(`${id.z}/${id.tx}/${id.ty}`);
  }

  has(id: TileID): boolean {
    const k = `${id.z}/${id.tx}/${id.ty}`;
    return this.inflight.has(k)
        || this.items.some(t => `${t.z}/${t.tx}/${t.ty}` === k);
  }

  /** Drop every queued (but not yet in flight) request. Used when the
   *  cache key changes wholesale (chart switch). */
  flush(): void { this.items = []; }

  get size(): number { return this.items.length + this.inflight.size; }
  get queued(): number { return this.items.length; }
  get running(): number { return this.inflight.size; }
}
