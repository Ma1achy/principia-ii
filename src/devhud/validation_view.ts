import type { InspectorResult } from '@/inspector/types.js';

/** FTLE delta above which the inspector flags a GPU↔CPU disagreement (M9). */
export const FTLE_DELTA_THRESHOLD = 0.1;

export interface ValidationVM {
  available: boolean;            // false when the inspector ran without a GPU SimResult
  gpuOutcomeAgrees: boolean;
  gpuFtleDelta: number;
  gpuWordAgrees: boolean;
  /** True iff any of the three checks disagree (matches M9 inspectorToOverlay). */
  flagged: boolean;
  /** The inspector's own outcome, for the panel header. */
  outcome: InspectorResult['outcome'];
}

/**
 * Build the validation-panel view-model. When `result.validation` is
 * absent (inspector ran with no GPU SimResult to compare), returns
 * `available:false` and leaves the comparison fields neutral.
 */
export function validationVM(result: InspectorResult): ValidationVM {
  const v = result.validation;
  if (!v) {
    return {
      available: false,
      gpuOutcomeAgrees: true, gpuFtleDelta: 0, gpuWordAgrees: true,
      flagged: false, outcome: result.outcome,
    };
  }
  const flagged =
    !v.gpuOutcomeAgrees
    || Math.abs(v.gpuFtleDelta) > FTLE_DELTA_THRESHOLD
    || !v.gpuWordAgrees;
  return {
    available: true,
    gpuOutcomeAgrees: v.gpuOutcomeAgrees,
    gpuFtleDelta: v.gpuFtleDelta,
    gpuWordAgrees: v.gpuWordAgrees,
    flagged,
    outcome: result.outcome,
  };
}
