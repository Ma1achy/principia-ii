import { registerAcceptance } from './acceptance.js';
import { compositeCoherence } from '@/quadtree/coherence.js';
import { decideSplit, DEFAULT_THRESHOLDS } from '@/quadtree/split.js';
import type { TileReduction } from '@/quadtree/reduction_types.js';

/**
 * A2: a tile whose reduction says "coherent" stays coherent one level
 * deeper. Built on M5's REAL coherence/split logic (not a stub): a
 * uniform-basin reduction keeps at level ℓ, and — because a uniform
 * field's children share its statistics and τ(ℓ) loosens with depth —
 * all four synthetic children keep at ℓ+1. A contrast case (impure
 * boundary tile) must still split, proving the thresholds are live.
 */
function uniformReduction(level: number): TileReduction {
  const ck = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 1, w: 0 }));
  return {
    id: { z: level, tx: 0, ty: 0 }, level,
    mean_n_checkpoints: ck,
    mean_arc_length_n: 1.2, mean_t_end: 80, mean_d_min: 0.4,
    mean_ftle: 0.01, mean_energy_drift: 1e-9, mean_diffusion: 0.05,
    spread_n: 0, spread_arc_length_n: 0, spread_t_end: 0, spread_d_min: 0,
    spread_ftle: 0, spread_energy_drift: 0, spread_diffusion: 0,
    outcome_impurity: 0, dominant_outcome: 1,
    suspect_fraction: 0, suspect_lz_fraction: 0,
    energy_drift_worst: 1e-9, lz_drift_worst: 1e-12,
    mean_word_length: 4, spread_word_length: 0, word_agreement: 1,
    dominant_word_hash: 7,
    ensemble_outcome_agreement: 1, ensemble_count: 0,
    mean_orbit_count: 2, retrograde_fraction: 0,
    coherence_score: 0,     // S_tile of a zero-spread field
    priority_score: 0, sample_count: 1024, status_flags: 0,
  };
}

registerAcceptance(
  'A2', 'coherent tile stays coherent one level deeper',
  () => {
    const ctx = (level: number) => ({
      level, maxDepth: 20, visible: true,
      thresholds: DEFAULT_THRESHOLDS,
      ftleEnabled: true, ensembleEnabled: false,
    });

    const parent = uniformReduction(3);
    const { sTile, cTile } = compositeCoherence(parent,
      { ftleEnabled: true, ensembleEnabled: false });
    const parentKeeps = decideSplit(parent, ctx(3)).action === 'keep';

    let childrenKeep = true;
    for (let q = 0; q < 4; q++) {
      const child = uniformReduction(4);
      if (decideSplit(child, ctx(4)).action !== 'keep') childrenKeep = false;
    }

    // Contrast: an impure boundary tile must still split at the same
    // level — otherwise the thresholds are vacuous, not "passing".
    const boundary = { ...uniformReduction(3), outcome_impurity: 0.5 };
    const boundarySplits = decideSplit(boundary, ctx(3)).action === 'split';

    const passed = sTile === 0 && cTile === 1
                 && parentKeeps && childrenKeep && boundarySplits;
    return Promise.resolve({
      id: 'A2', name: 'coherent tile stays coherent one level deeper',
      passed,
      ...(passed ? {} : {
        details: `sTile=${sTile} keep=${parentKeeps} children=${childrenKeep} boundarySplits=${boundarySplits}`,
      }),
    });
  },
);
