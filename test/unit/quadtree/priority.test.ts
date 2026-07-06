import { describe, it, expect } from 'vitest';
import { computePriority, DEFAULT_PRIORITY_WEIGHTS } from '@/quadtree/priority.js';
import type { QuadtreeView, TileCacheKey } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

const key = {} as TileCacheKey;   // computePriority never reads the cache key
const view: QuadtreeView = {
  cacheKey: key, uvCentre: [0.5, 0.5], uvHalfWidth: [0.1, 0.1],
  zBase: 3, zMax: 12, width: 1024, height: 1024, tilePix: 256,
};

const reduction = (coherence: number): TileReduction => ({
  id: { z: 3, tx: 0, ty: 0 }, level: 3,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1, suspect_fraction: 0,
  suspect_lz_fraction: 0, energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0, word_agreement: 1,
  dominant_word_hash: 0, ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0, coherence_score: coherence,
  priority_score: 0, sample_count: 256, status_flags: 0,
});

describe('computePriority', () => {
  it('visibility dominates: an on-screen tile outranks an off-screen one', () => {
    // At zBase=3 the viewport [0.4,0.6]² covers tiles tx,ty ∈ {3,4}.
    const on  = computePriority({ z: 3, tx: 4, ty: 4 }, view, null);
    const off = computePriority({ z: 3, tx: 0, ty: 0 }, view, null);
    expect(on - off).toBeGreaterThan(DEFAULT_PRIORITY_WEIGHTS.wv - 2);
  });

  it('zoom-matched depth outranks a mismatched depth (same tile footprint)', () => {
    const matched    = computePriority({ z: 3, tx: 4, ty: 4 }, view, null);
    const mismatched = computePriority({ z: 6, tx: 32, ty: 32 }, view, null);
    expect(matched).toBeGreaterThan(mismatched);
  });

  it('unknown complexity (null reduction) sits between coherent and chaotic', () => {
    const id = { z: 3, tx: 4, ty: 4 };
    const coherent = computePriority(id, view, reduction(0));
    const unknown  = computePriority(id, view, null);
    const chaotic  = computePriority(id, view, reduction(10));
    expect(unknown).toBeGreaterThan(coherent);
    expect(chaotic).toBeGreaterThan(unknown);
  });

  it('focus: a tile at the viewport centre outranks a distant visible tile', () => {
    const wide: QuadtreeView = { ...view, uvHalfWidth: [0.5, 0.5], zBase: 3 };
    const centre = computePriority({ z: 3, tx: 4, ty: 4 }, wide, null);
    const corner = computePriority({ z: 3, tx: 0, ty: 0 }, wide, null);
    expect(centre).toBeGreaterThan(corner);
  });
});
