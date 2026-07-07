import { describe, it, expect } from 'vitest';
import {
  planFrame, ingestReduction, REFINE_LEVELS_MAX,
} from '@/quadtree/scheduler.js';
import { TileCache } from '@/quadtree/cache.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';
import { reachedF32Floor } from '@/quadtree/pyramid.js';
import { tileKey } from '@/quadtree/tile.js';
import type { TileID, TileCacheKey, QuadtreeView } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import { defaultViewState, viewStateToCacheKey } from '@/interact/view_state.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

/**
 * DS.1 + live depth refinement: ingestReduction stamps the f32-floor bit
 * and promotes below-ceiling tiles to 'readyRefinable'; planFrame walks
 * refinement chains through ready children up to REFINE_LEVELS_MAX.
 */

const KEY: TileCacheKey = viewStateToCacheKey(defaultViewState());

const view = (over: Partial<QuadtreeView> = {}): QuadtreeView => ({
  cacheKey: KEY,
  uvCentre: [0.5, 0.5], uvHalfWidth: [0.5, 0.5],
  zBase: 0, zMax: 20,
  width: 800, height: 600, tilePix: 256,
  ...over,
});

const impure = (id: TileID): TileReduction =>
  ({ ...stubReduction(id), outcome_impurity: 0.5 });   // > tauImpurity 0.10

/** Put a tile in 'computing' (the ledger's claim) so ingest can land. */
function claim(cache: TileCache, id: TileID): void {
  cache.put(id, KEY, {
    id, simBuffer: null, icBuffer: null,
    lifecycle: 'computing', computeCostMs: 0,
  });
}

function ingest(
  cache: TileCache, id: TileID, r: TileReduction,
  refine?: { samplesPerAxis: number; maxDepth: number },
): void {
  claim(cache, id);
  ingestReduction(cache, KEY, id, r, false, false, refine);
}

describe('ingestReduction refinement wiring (DS.1)', () => {
  const root: TileID = { z: 0, tx: 0, ty: 0 };

  it('without RefineOpts keeps the M5 terminal state (plain ready)', () => {
    const cache = new TileCache(16);
    ingest(cache, root, stubReduction(root));
    expect(cache.get(root, KEY)?.lifecycle).toBe('ready');
  });

  it('promotes to readyRefinable below the floor and the depth ceiling', () => {
    const cache = new TileCache(16);
    ingest(cache, root, stubReduction(root), { samplesPerAxis: 16, maxDepth: 10 });
    expect(cache.get(root, KEY)?.lifecycle).toBe('readyRefinable');
  });

  it('stamps AT_F32_FLOOR at the floor depth and stays plain ready', () => {
    // For N=16 the floor is the first z where per-sample spacing < 1e-6.
    let floorZ = 0;
    while (!reachedF32Floor(floorZ, 16)) floorZ++;
    const deep: TileID = { z: floorZ, tx: 0, ty: 0 };
    const cache = new TileCache(16);
    const r = stubReduction(deep);
    ingest(cache, deep, r, { samplesPerAxis: 16, maxDepth: floorZ + 5 });
    expect(r.status_flags & TILE_STATUS.AT_F32_FLOOR).toBeTruthy();
    expect(cache.get(deep, KEY)?.lifecycle).toBe('ready');
    // One level up is not at the floor: no bit, refinable.
    const above: TileID = { z: floorZ - 1, tx: 0, ty: 0 };
    const r2 = stubReduction(above);
    ingest(cache, above, r2, { samplesPerAxis: 16, maxDepth: floorZ + 5 });
    expect(r2.status_flags & TILE_STATUS.AT_F32_FLOOR).toBeFalsy();
    expect(cache.get(above, KEY)?.lifecycle).toBe('readyRefinable');
  });

  it('stays plain ready at the maxDepth ceiling', () => {
    const t: TileID = { z: 3, tx: 0, ty: 0 };
    const cache = new TileCache(16);
    ingest(cache, t, stubReduction(t), { samplesPerAxis: 16, maxDepth: 3 });
    expect(cache.get(t, KEY)?.lifecycle).toBe('ready');
  });
});

describe('planFrame refinement chains', () => {
  const root: TileID = { z: 0, tx: 0, ty: 0 };
  const refine = { samplesPerAxis: 16, maxDepth: 10 };

  it('proposes the four children of an impure refinable visible tile', () => {
    const cache = new TileCache(64);
    ingest(cache, root, impure(root), refine);
    const jobs = planFrame(cache, view(), {
      frameBudget: 16, maxInFlight: 0, ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobs).toHaveLength(4);
    expect(jobs.every((j) => j.id.z === 1)).toBe(true);
    expect(jobs.every((j) => j.parent && tileKey(j.parent) === tileKey(root))).toBe(true);
  });

  it('a coherent refinable tile proposes nothing', () => {
    const cache = new TileCache(64);
    ingest(cache, root, stubReduction(root), refine);   // impurity 0, coherent
    const jobs = planFrame(cache, view(), {
      frameBudget: 16, maxInFlight: 0, ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobs).toHaveLength(0);
  });

  it('recurses through ready children to propose grandchildren', () => {
    const cache = new TileCache(64);
    ingest(cache, root, impure(root), refine);
    // Three children computed (impure, refinable); one still missing.
    const kids: TileID[] = [
      { z: 1, tx: 0, ty: 0 }, { z: 1, tx: 1, ty: 0 }, { z: 1, tx: 0, ty: 1 },
    ];
    for (const c of kids) ingest(cache, c, impure(c), refine);
    const jobs = planFrame(cache, view(), {
      frameBudget: 32, maxInFlight: 0, ftleEnabled: false, ensembleEnabled: false,
    });
    // 12 grandchildren (4 per computed child) + the 1 missing child.
    expect(jobs).toHaveLength(13);
    expect(jobs.filter((j) => j.id.z === 2)).toHaveLength(12);
    expect(jobs.filter((j) => j.id.z === 1)).toHaveLength(1);
  });

  it(`stops descending REFINE_LEVELS_MAX (${REFINE_LEVELS_MAX}) below the frontier`, () => {
    const cache = new TileCache(128);
    // A fully-computed impure chain root → child → grandchild.
    ingest(cache, root, impure(root), refine);
    const child: TileID = { z: 1, tx: 0, ty: 0 };
    ingest(cache, child, impure(child), refine);
    const grand: TileID = { z: 2, tx: 0, ty: 0 };
    ingest(cache, grand, impure(grand), refine);
    const jobs = planFrame(cache, view(), {
      frameBudget: 64, maxInFlight: 0, ftleEnabled: false, ensembleEnabled: false,
    });
    // The grandchild is refinable and impure, but it sits at the descent
    // cap — no great-grandchildren (z=3) may be proposed.
    expect(jobs.some((j) => j.id.z > REFINE_LEVELS_MAX)).toBe(false);
    expect(jobs.length).toBeGreaterThan(0);   // the other chains still fill in
  });

  it('respects the frame budget across refinement proposals', () => {
    const cache = new TileCache(64);
    ingest(cache, root, impure(root), refine);
    const jobs = planFrame(cache, view(), {
      frameBudget: 2, maxInFlight: 0, ftleEnabled: false, ensembleEnabled: false,
    });
    expect(jobs).toHaveLength(2);
  });
});
