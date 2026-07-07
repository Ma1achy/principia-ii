import { describe, it, expect } from 'vitest';
import { JobLedger } from '@/app/gpu_jobs.js';
import { TileCache } from '@/quadtree/cache.js';
import { defaultViewState } from '@/interact/view_state.js';
import { AppErrorKind, type AppError } from '@/error/kinds.js';
import { classify, type ClassifyHints } from '@/error/boundary.js';
import { TILE_STATUS_FAIL } from '@/error/tile_status.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

/** Record every capture the ledger routes through the boundary. */
function makeSpyBoundary(): {
  capture: (err: unknown, hints?: ClassifyHints) => AppError;
  captured: { err: unknown; hints: ClassifyHints }[];
} {
  const captured: { err: unknown; hints: ClassifyHints }[] = [];
  return {
    captured,
    capture: (err, hints = {}) => { captured.push({ err, hints }); return classify(err, hints); },
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const TILE = { z: 1, tx: 0, ty: 0 };
const OPTS = { maxInFlight: 4, ftleEnabled: false, ensembleEnabled: false };

describe('JobLedger × ErrorBoundary (G11)', () => {
  it('a rejecting dispatch routes through capture with the tile key', async () => {
    const d: GpuDispatcher = {
      dispatchTile: async () => { throw new Error('device exploded'); },
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as InspectorResult),
    };
    const spy = makeSpyBoundary();
    const ledger = new JobLedger(d, new TileCache(16), OPTS, spy);
    expect(ledger.dispatch(TILE, defaultViewState())).toBe(true);
    await flush();
    expect(spy.captured).toHaveLength(1);
    expect(spy.captured[0]!.hints.tileKey).toBe('1/0/0');
    expect(spy.captured[0]!.err).toBeInstanceOf(Error);
    // ...and the failed tile is released for recompute (DG2.3 contract).
    expect(ledger.inflightCount).toBe(0);
  });

  it('a SUCCESSFUL dispatch carrying failure bits surfaces a TileFailure', async () => {
    const d: GpuDispatcher = {
      dispatchTile: async (tileId) => ({
        ...stubReduction(tileId),
        status_flags: TILE_STATUS_FAIL.SIM_FAILED,
      }),
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as InspectorResult),
    };
    const spy = makeSpyBoundary();
    const ledger = new JobLedger(d, new TileCache(16), OPTS, spy);
    ledger.dispatch(TILE, defaultViewState());
    await flush();
    expect(spy.captured).toHaveLength(1);
    const app = classify(spy.captured[0]!.err, spy.captured[0]!.hints);
    expect(app.kind).toBe(AppErrorKind.TileFailure);
    expect(ledger.completedCount).toBe(1);          // still a completion
  });

  it('clean completions capture nothing', async () => {
    const d: GpuDispatcher = {
      dispatchTile: async (tileId) => stubReduction(tileId),
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as InspectorResult),
    };
    const spy = makeSpyBoundary();
    const ledger = new JobLedger(d, new TileCache(16), OPTS, spy);
    ledger.dispatch(TILE, defaultViewState());
    await flush();
    expect(spy.captured).toHaveLength(0);
  });

  it('the 3-arg construction (no boundary) still works', async () => {
    const d: GpuDispatcher = {
      dispatchTile: async () => { throw new Error('boom'); },
      cancel: () => {}, render: () => {},
      inspect: async () => ({} as InspectorResult),
    };
    const ledger = new JobLedger(d, new TileCache(16), OPTS);
    expect(ledger.dispatch(TILE, defaultViewState())).toBe(true);
    await flush();                                   // must not throw/unhandled
    expect(ledger.inflightCount).toBe(0);
  });
});
