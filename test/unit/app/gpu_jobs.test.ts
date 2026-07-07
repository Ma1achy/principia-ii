import { describe, it, expect } from 'vitest';
import { JobLedger } from '@/app/gpu_jobs.js';
import { TileCache } from '@/quadtree/cache.js';
import { defaultViewState, viewStateToCacheKey } from '@/interact/view_state.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

function makeStubDispatcher(): {
  d: GpuDispatcher;
  resolveOne: (r: TileReduction) => void;
  rejectOne: (e: Error) => void;
  cancelled: TileID[];
} {
  const queue: {
    resolve: (r: TileReduction) => void; reject: (e: Error) => void;
  }[] = [];
  const cancelled: TileID[] = [];
  const d: GpuDispatcher = {
    dispatchTile: () => new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
    }),
    cancel: (ids) => { cancelled.push(...ids); },
    render: () => {},
    inspect: () => Promise.resolve({} as InspectorResult),
  };
  return {
    d,
    resolveOne: (r) => queue.shift()!.resolve(r),
    rejectOne: (e) => queue.shift()!.reject(e),
    cancelled,
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('JobLedger', () => {
  it('respects maxInFlight', () => {
    const stub = makeStubDispatcher();
    const ledger = new JobLedger(stub.d, new TileCache(64),
      { maxInFlight: 2, ftleEnabled: false, ensembleEnabled: false });
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 1, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 1 }, defaultViewState())).toBe(false);
  });

  it('dedupes concurrent dispatches of the same tile', () => {
    const stub = makeStubDispatcher();
    const ledger = new JobLedger(stub.d, new TileCache(64),
      { maxInFlight: 4, ftleEnabled: false, ensembleEnabled: false });
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(true);
    expect(ledger.dispatch({ z: 1, tx: 0, ty: 0 }, defaultViewState())).toBe(false);
  });

  it('claims the cache entry at dispatch and ingests on completion', async () => {
    const stub = makeStubDispatcher();
    const cache = new TileCache(64);
    const ledger = new JobLedger(stub.d, cache,
      { maxInFlight: 4, ftleEnabled: false, ensembleEnabled: false });
    const view = defaultViewState();
    const id: TileID = { z: 1, tx: 0, ty: 0 };
    ledger.dispatch(id, view);
    expect(ledger.inflightCount).toBe(1);
    // The entry exists as 'computing' — this is what lets planFrame skip
    // it and lets ingestReduction find it.
    const key = viewStateToCacheKey(view);
    expect(cache.get(id, key)?.lifecycle).toBe('computing');

    stub.resolveOne(stubReduction(id));
    await flush();
    expect(ledger.inflightCount).toBe(0);
    expect(ledger.completedCount).toBe(1);
    const entry = cache.get(id, key)!;
    // Below the f32 floor and the view's maxDepth, ingest promotes the
    // tile to refinable (live depth refinement / DS.1 wiring).
    expect(entry.lifecycle).toBe('readyRefinable');
    expect(entry.reduction?.sample_count).toBe(256);
  });

  it('a failed job releases the entry for recompute', async () => {
    const stub = makeStubDispatcher();
    const cache = new TileCache(64);
    const ledger = new JobLedger(stub.d, cache,
      { maxInFlight: 4, ftleEnabled: false, ensembleEnabled: false });
    const view = defaultViewState();
    const id: TileID = { z: 1, tx: 0, ty: 0 };
    ledger.dispatch(id, view);
    stub.rejectOne(new Error('device hiccup'));
    await flush();
    expect(ledger.inflightCount).toBe(0);
    expect(cache.get(id, viewStateToCacheKey(view))?.lifecycle).toBe('unseen');
    // Re-dispatch is possible again.
    expect(ledger.dispatch(id, view)).toBe(true);
  });

  it('cancelOffscreen discards the result but keeps descendants of visible tiles', async () => {
    const stub = makeStubDispatcher();
    const cache = new TileCache(64);
    const ledger = new JobLedger(stub.d, cache,
      { maxInFlight: 4, ftleEnabled: false, ensembleEnabled: false });
    const view = defaultViewState();
    const key = viewStateToCacheKey(view);
    const offscreen: TileID = { z: 1, tx: 1, ty: 1 };
    const child: TileID = { z: 2, tx: 0, ty: 0 };   // child of visible 1/0/0
    ledger.dispatch(offscreen, view);
    ledger.dispatch(child, view);

    ledger.cancelOffscreen([{ z: 1, tx: 0, ty: 0 }]);
    expect(stub.cancelled).toEqual([offscreen]);

    // FIFO: offscreen resolves first — discarded; child second — ingested.
    stub.resolveOne(stubReduction(offscreen));
    stub.resolveOne(stubReduction(child));
    await flush();
    expect(cache.get(offscreen, key)?.lifecycle).toBe('unseen');
    expect(cache.get(child, key)?.lifecycle).toBe('readyRefinable');
    expect(ledger.completedCount).toBe(1);
  });
});
