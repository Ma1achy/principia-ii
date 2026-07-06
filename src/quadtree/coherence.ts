import type { TileReduction } from './reduction_types.js';

/**
 * Composite coherence weights from Appendix A of the spec.
 * Active terms are zero-weighted when their respective metric is disabled
 * (FTLE, ensemble) so the formula is one expression in all tiers.
 */
export const COHERENCE_WEIGHTS = {
  wn:    1.0,    // shape-trajectory spread (dominant)
  wL:    0.20,   // arc-length spread
  wt:    0.25,   // event-time spread
  wd:    0.15,   // d_min spread
  wf:    0.20,   // FTLE spread (Research only)
  wD:    0.25,   // diffusion spread
  wo:    0.35,   // outcome impurity
  wE:    0.30,   // suspect_fraction (numerical unreliability)
  wLz:   0.15,   // suspect_lz_fraction
  wens:  0.25,   // ensemble disagreement
} as const;

/**
 * S_tile = w_n S_n + ... + w_ens S_ens
 * C_tile = 1 / (1 + S_tile)
 *
 * Returns both. The caller may want either (S_tile is monotone for
 * thresholding, C_tile is bounded in [0,1] for blending).
 */
export function compositeCoherence(
  r: TileReduction,
  modes: { ftleEnabled: boolean; ensembleEnabled: boolean },
): { sTile: number; cTile: number } {
  const w = COHERENCE_WEIGHTS;
  const Sn   = r.spread_n;
  const SL   = r.spread_arc_length_n;
  const St   = r.spread_t_end;
  const Sd   = r.spread_d_min;
  const Sf   = modes.ftleEnabled     ? r.spread_ftle      : 0;
  const SD   = r.spread_diffusion >= 0 ? r.spread_diffusion : 0;
  const So   = r.outcome_impurity;
  const SE   = r.suspect_fraction;
  const SLz  = r.suspect_lz_fraction;
  const Sens = modes.ensembleEnabled
    ? Math.max(0, 1 - r.ensemble_outcome_agreement)
    : 0;

  const sTile = w.wn*Sn + w.wL*SL + w.wt*St + w.wd*Sd
              + w.wf*Sf + w.wD*SD + w.wo*So
              + w.wE*SE + w.wLz*SLz + w.wens*Sens;
  return { sTile, cTile: 1 / (1 + sTile) };
}
