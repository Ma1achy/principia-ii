import type { TileID, TileCacheKey } from '@/quadtree/types.js';
import type { ViewState } from '@/interact/view_state.js';
import type { GpuDispatcher } from './types.js';
import { tileKey, contains } from '@/quadtree/tile.js';
import { TileCache } from '@/quadtree/cache.js';
import { transition } from '@/quadtree/lifecycle.js';
import { ingestReduction } from '@/quadtree/scheduler.js';
import { viewStateToCacheKey } from '@/interact/view_state.js';

interface InflightJob {
  tile:      TileID;
  key:       TileCacheKey;
  cancelled: boolean;
}

/**
 * Owns the set of in-flight tile jobs. Tracks by tile-key string so
 * duplicate dispatches collapse and cancellations are cheap.
 *
 * The ledger also owns the cache entry's early lifecycle: dispatch()
 * inserts (or transitions) the entry to 'computing' BEFORE the GPU job
 * starts. This matters twice over — planFrame skips 'computing' tiles
 * (no duplicate proposals), and ingestReduction drops results for tiles
 * with no cache entry, so without the early insert every completion
 * would land on the floor.
 */
export class JobLedger {
  private inflight = new Map<string, InflightJob>();
  private completed = 0;

  constructor(
    private dispatcher: GpuDispatcher,
    private cache:      TileCache,
    private opts: { maxInFlight: number;
                    ftleEnabled: boolean; ensembleEnabled: boolean },
  ) {}

  get inflightCount(): number { return this.inflight.size; }
  get completedCount(): number { return this.completed; }

  /**
   * Dispatch a tile if not already in flight or fully cached. Returns
   * true if a new dispatch was queued.
   */
  dispatch(tile: TileID, view: ViewState): boolean {
    const k = tileKey(tile);
    if (this.inflight.has(k)) return false;
    if (this.inflight.size >= this.opts.maxInFlight) return false;
    const key = viewStateToCacheKey(view);
    const cached = this.cache.get(tile, key);
    if (cached?.lifecycle === 'ready' || cached?.lifecycle === 'readyRefinable'
        || cached?.lifecycle === 'computing' || cached?.lifecycle === 'queued') {
      return false;
    }

    // Claim the cache entry before the GPU job starts (see class doc).
    if (cached) {
      transition(cached, 'queued');       // unseen → queued
      transition(cached, 'computing');
    } else {
      this.cache.put(tile, key, {
        id: tile, simBuffer: null, icBuffer: null,
        lifecycle: 'computing', computeCostMs: 0,
      });
    }

    const job: InflightJob = { tile, key, cancelled: false };
    this.inflight.set(k, job);
    this.dispatcher.dispatchTile(tile, view).then((reduction) => {
      this.inflight.delete(k);
      const entry = this.cache.get(tile, key);
      if (job.cancelled) {
        // Result discarded; release the entry for a later recompute.
        if (entry?.lifecycle === 'computing') transition(entry, 'unseen');
        return;
      }
      ingestReduction(this.cache, key, tile, reduction,
                      this.opts.ftleEnabled, this.opts.ensembleEnabled);
      this.completed++;
    }).catch((err: unknown) => {
      this.inflight.delete(k);
      const entry = this.cache.get(tile, key);
      if (entry?.lifecycle === 'computing') transition(entry, 'unseen');
      console.warn('GPU job failed', tile, err);
    });
    return true;
  }

  /**
   * Logically cancel in-flight jobs whose tiles are no longer wanted: a
   * job survives if its tile is one of the visible tiles OR a descendant
   * of one (split children land one level below the visible frontier).
   * The GPU work still runs; its reduction is dropped on completion.
   */
  cancelOffscreen(visible: readonly TileID[]): void {
    const visibleKeys = new Set(visible.map(tileKey));
    const losers: TileID[] = [];
    for (const [k, job] of this.inflight) {
      if (job.cancelled) continue;
      const wanted = visibleKeys.has(k)
        || visible.some((vt) => contains(vt, job.tile));
      if (!wanted) {
        job.cancelled = true;
        losers.push(job.tile);
      }
    }
    if (losers.length > 0) this.dispatcher.cancel(losers);
  }
}
