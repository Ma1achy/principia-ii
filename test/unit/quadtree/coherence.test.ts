import { describe, it, expect } from 'vitest';
import { compositeCoherence, COHERENCE_WEIGHTS } from '@/quadtree/coherence.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

const r0: TileReduction = {
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
};

describe('compositeCoherence', () => {
  it('is zero for a perfect tile', () => {
    const { sTile, cTile } = compositeCoherence(r0,
                              { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBe(0);
    expect(cTile).toBe(1);
  });

  it('respects shape-trajectory dominance', () => {
    const r = { ...r0, spread_n: 1, spread_t_end: 1 };
    const { sTile } = compositeCoherence(r,
                       { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBeCloseTo(COHERENCE_WEIGHTS.wn + COHERENCE_WEIGHTS.wt, 12);
  });

  it('zeroes ensemble term when ensembles are off', () => {
    const r = { ...r0, ensemble_outcome_agreement: 0 };
    const offS = compositeCoherence(r, { ftleEnabled: false, ensembleEnabled: false }).sTile;
    const onS  = compositeCoherence(r, { ftleEnabled: false, ensembleEnabled: true  }).sTile;
    expect(offS).toBe(0);
    expect(onS).toBeCloseTo(COHERENCE_WEIGHTS.wens, 12);
  });

  it('treats spread_diffusion = -1 (sentinel) as zero contribution', () => {
    const r = { ...r0, spread_diffusion: -1 };
    const { sTile } = compositeCoherence(r,
                       { ftleEnabled: false, ensembleEnabled: false });
    expect(sTile).toBe(0);
  });
});
