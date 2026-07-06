import type { TileReduction } from './reduction_types.js';
import { TILE_STATUS } from './reduction_types.js';

export interface SplitThresholds {
  tauImpurity:        number;     // outcome impurity force-split
  tauSuspect:         number;     // suspect-sample force-split
  tau0:               number;     // base τ(ℓ)
  tauPerLevel:        number;     // slope
  ensembleAgreementMin: number;
}

export const DEFAULT_THRESHOLDS: SplitThresholds = {
  tauImpurity:        0.10,
  tauSuspect:         0.05,
  tau0:               0.20,
  tauPerLevel:        0.02,
  ensembleAgreementMin: 0.85,
};

export interface SplitDecision {
  action: 'split' | 'keep' | 'merge';
  reason: string;
}

/**
 * Decide whether to split, keep, or merge a tile. The order of the
 * checks matters: hard guards (depth, f32 floor, off-screen) override
 * everything; force-splits override coherence; coherence is the default.
 */
export function decideSplit(
  r: TileReduction,
  ctx: {
    level:        number;
    maxDepth:     number;
    visible:      boolean;
    thresholds:   SplitThresholds;
    ftleEnabled:  boolean;
    ensembleEnabled: boolean;
  },
): SplitDecision {
  // Hard guards.
  if (!ctx.visible)
    return { action: 'merge', reason: 'off_screen' };
  if (r.status_flags & TILE_STATUS.AT_F32_FLOOR)
    return { action: 'keep', reason: 'f32_floor' };
  if (ctx.level >= ctx.maxDepth)
    return { action: 'keep', reason: 'max_depth' };

  // Force splits.
  if (r.outcome_impurity > ctx.thresholds.tauImpurity)
    return { action: 'split', reason: 'outcome_impurity' };
  if (r.suspect_fraction > ctx.thresholds.tauSuspect)
    return { action: 'split', reason: 'suspect_fraction' };
  if (ctx.ensembleEnabled
      && r.ensemble_outcome_agreement < ctx.thresholds.ensembleAgreementMin)
    return { action: 'split', reason: 'ensemble_disagreement' };

  // Coherence-driven split.
  const tau = ctx.thresholds.tau0 + ctx.thresholds.tauPerLevel * ctx.level;
  if (r.coherence_score > tau)
    return { action: 'split', reason: 'coherence' };

  return { action: 'keep', reason: 'coherent' };
}
