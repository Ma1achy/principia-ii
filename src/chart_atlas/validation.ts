import type { Chart, ChartView, ValidationResult } from './types.js';

/**
 * Pre-dispatch validation: catch user-entered ICs that fall outside the
 * chart's feasibility region before they reach the GPU.
 */
export function validateBeforeDispatch(
  chart: Chart, uv: [number, number], view: ChartView,
): ValidationResult {
  return chart.validate(uv, view);
}

/**
 * Compatibility assertion: refuse to combine a
 * `forbids_energy_normalisation` chart with a non-zero energy
 * normalisation override. Spec §1.6.6.
 */
export function compatible(
  chart: Chart, energyNormalisationTarget?: number,
): { ok: boolean; reason?: string } {
  if (chart.flags.forbids_energy_normalisation && energyNormalisationTarget !== undefined) {
    return { ok: false,
             reason: `chart ${chart.id} forbids energy normalisation` };
  }
  return { ok: true };
}
