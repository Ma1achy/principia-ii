import { describe, it, expect } from 'vitest';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** Build a synthetic "uniform-basin" reduction: every sample escapes via
 *  the same body, no diffusion, no FTLE. */
function uniformBasinReduction(level: number): TileReduction {
  return {
    id: { z: level, tx: 0, ty: 0 }, level,
    mean_n_checkpoints: [],
    mean_arc_length_n: 0.5, mean_t_end: 12, mean_d_min: 0.3,
    mean_ftle: 0, mean_energy_drift: 1e-6, mean_diffusion: -1,
    spread_n: 0, spread_arc_length_n: 0.001, spread_t_end: 0.01,
    spread_d_min: 0.001, spread_ftle: 0, spread_energy_drift: 0,
    spread_diffusion: 0,
    outcome_impurity: 0, dominant_outcome: 2,
    suspect_fraction: 0, suspect_lz_fraction: 0,
    energy_drift_worst: 1e-6, lz_drift_worst: 1e-6,
    mean_word_length: 1, spread_word_length: 0,
    word_agreement: 1, dominant_word_hash: 0xabad1dea,
    ensemble_outcome_agreement: 1, ensemble_count: 0,
    mean_orbit_count: 0, retrograde_fraction: 0,
    coherence_score: 0, priority_score: 0,
    sample_count: 256, status_flags: 0,
  };
}

describe('basin stays coarse', () => {
  it('coherence remains below τ(ℓ) at every depth from 0 to 6', () => {
    for (let level = 0; level < 7; level++) {
      const r = uniformBasinReduction(level);
      const { sTile } = compositeCoherence(r,
                          { ftleEnabled: false, ensembleEnabled: false });
      r.coherence_score = sTile;
      const dec = decideSplit(r, {
        level, maxDepth: 12, visible: true,
        thresholds: DEFAULT_THRESHOLDS,
        ftleEnabled: false, ensembleEnabled: false,
      });
      expect(dec.action).toBe('keep');
      expect(sTile).toBeLessThan(0.05);
    }
  });
});
