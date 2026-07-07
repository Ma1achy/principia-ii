import type { TileID } from '@/quadtree/types.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/** A perfectly-coherent synthetic reduction: every scalar lane present
 *  (the TileReduction type derives its field names from
 *  TILE_REDUCTION_FIELDS, so a missing lane is a type error). */
export function stubReduction(id: TileID): TileReduction {
  return {
    id, level: id.z,
    mean_n_checkpoints: [],
    mean_arc_length_n: 0, mean_t_end: 0, mean_d_min: 0, mean_ftle: 0,
    mean_energy_drift: 0, mean_diffusion: -1,
    spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
    spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
    outcome_impurity: 0, dominant_outcome: 1,
    suspect_fraction: 0, suspect_lz_fraction: 0,
    energy_drift_worst: 0, lz_drift_worst: 0,
    mean_word_length: 0, spread_word_length: 0,
    word_agreement: 1, dominant_word_hash: 0,
    ensemble_outcome_agreement: 1, ensemble_count: 0,
    mean_orbit_count: 0, retrograde_fraction: 0,
    coherence_score: 0, priority_score: 0,
    sample_count: 256, status_flags: 0,
  };
}
