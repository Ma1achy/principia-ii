import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';

const r0 = (): TileReduction => ({
  id: { z: 0, tx: 0, ty: 0 }, level: 0,
  mean_n_checkpoints: [],
  mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
  mean_energy_drift: 0, mean_diffusion: -1,
  spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
  spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
  outcome_impurity: 0, dominant_outcome: 1, suspect_fraction: 0,
  suspect_lz_fraction: 0, energy_drift_worst: 0, lz_drift_worst: 0,
  mean_word_length: 0, spread_word_length: 0, word_agreement: 1,
  dominant_word_hash: 0, ensemble_outcome_agreement: 1, ensemble_count: 0,
  mean_orbit_count: 0, retrograde_fraction: 0, coherence_score: 0,
  priority_score: 0, sample_count: 256, status_flags: 0,
});

const ctx0 = { level: 2, maxDepth: 8, visible: true,
               thresholds: DEFAULT_THRESHOLDS,
               ftleEnabled: false, ensembleEnabled: false };

describe('decideSplit', () => {
  it('keeps a coherent tile', () => {
    expect(decideSplit(r0(), ctx0).action).toBe('keep');
  });

  it('force-splits on outcome impurity', () => {
    const r = { ...r0(), outcome_impurity: 0.2 };
    expect(decideSplit(r, ctx0).reason).toBe('outcome_impurity');
  });

  it('force-splits on suspect fraction', () => {
    const r = { ...r0(), suspect_fraction: 0.1 };
    expect(decideSplit(r, ctx0).reason).toBe('suspect_fraction');
  });

  it('splits on coherence above τ(ℓ)', () => {
    const r = { ...r0(), coherence_score: 0.5 };
    expect(decideSplit(r, ctx0).reason).toBe('coherence');
  });

  it('keeps when AT_F32_FLOOR even with high impurity', () => {
    const r = { ...r0(), outcome_impurity: 0.9,
                status_flags: TILE_STATUS.AT_F32_FLOOR };
    expect(decideSplit(r, ctx0).action).toBe('keep');
  });

  it('keeps when at max depth', () => {
    const r = { ...r0(), coherence_score: 5 };
    expect(decideSplit(r, { ...ctx0, level: 8 }).action).toBe('keep');
  });

  it('reports merge for off-screen tiles', () => {
    expect(decideSplit(r0(), { ...ctx0, visible: false }).action).toBe('merge');
  });
});
