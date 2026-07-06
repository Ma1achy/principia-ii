import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** A boundary tile: high outcome impurity, large checkpoint spread. */
function boundaryReduction(level: number): TileReduction {
  return {
    id: { z: level, tx: 0, ty: 0 }, level,
    mean_n_checkpoints: [],
    mean_arc_length_n: 4, mean_t_end: 50, mean_d_min: 0.05,
    mean_ftle: 0, mean_energy_drift: 5e-5, mean_diffusion: 0.4,
    spread_n: 1.5, spread_arc_length_n: 1.2, spread_t_end: 2,
    spread_d_min: 0.05, spread_ftle: 0, spread_energy_drift: 1e-5,
    spread_diffusion: 0.6,
    outcome_impurity: 0.4, dominant_outcome: 2,
    suspect_fraction: 0.02, suspect_lz_fraction: 0.01,
    energy_drift_worst: 1e-4, lz_drift_worst: 5e-5,
    mean_word_length: 6, spread_word_length: 4,
    word_agreement: 0.4, dominant_word_hash: 0,
    ensemble_outcome_agreement: 0.6, ensemble_count: 0,
    mean_orbit_count: 1, retrograde_fraction: 0.3,
    coherence_score: 0, priority_score: 0,
    sample_count: 256, status_flags: 0,
  };
}

describe('boundary tiles refine to MAX_DEPTH', () => {
  it('every level < MAX_DEPTH triggers split', () => {
    const MAX = 12;
    for (let level = 0; level < MAX; level++) {
      const r = boundaryReduction(level);
      const { sTile } = compositeCoherence(r,
                          { ftleEnabled: false, ensembleEnabled: false });
      r.coherence_score = sTile;
      const dec = decideSplit(r, {
        level, maxDepth: MAX, visible: true,
        thresholds: DEFAULT_THRESHOLDS,
        ftleEnabled: false, ensembleEnabled: false,
      });
      expect(dec.action).toBe('split');
    }
    // At MAX_DEPTH the guard kicks in and we stop.
    const r = boundaryReduction(MAX);
    const { sTile } = compositeCoherence(r,
                        { ftleEnabled: false, ensembleEnabled: false });
    r.coherence_score = sTile;
    expect(decideSplit(r, {
      level: MAX, maxDepth: MAX, visible: true,
      thresholds: DEFAULT_THRESHOLDS,
      ftleEnabled: false, ensembleEnabled: false,
    }).action).toBe('keep');
  });
});
