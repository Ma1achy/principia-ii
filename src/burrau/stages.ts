import type { Chart } from '@/chart_atlas/types.js';
import type { Vec3 } from '@/math/types.js';
import { burrauEuclidChart } from '@/chart_atlas/charts/burrau_euclid.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';
import { burrauTriangle } from './euclid.js';
import { makeAcuteAngleKChart } from './acute_angle.js';
import { makeBurrauMassChart }  from './mass_chart.js';
import { makeThetaKStrip, makeThetaDeltaMStrip } from './bifurcation.js';

/**
 * Frozen-configuration params for running the (L_z, E)/(L_z, K) charts
 * at a Burrau shape: the hyperspherical (α, β) of the ν-triangle plus
 * its natural masses. Wire the result into `ChartView.chartParams` (and
 * `view.m`). The lz decode realises the shape at the R̃ = 1 gauge, so
 * the triangle is rescaled — the SHAPE (α, β, side ratios) is what
 * carries over, exactly as the chart contract requires.
 */
export function burrauLzEParams(nu: number): {
  alpha: number; beta: number; m: Vec3;
} {
  const { r, m } = burrauTriangle(nu);
  const { rho, lambda } = particlePositionsToJacobi(r, m);
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rhoT    = Math.hypot(rho[0], rho[1]) * Math.sqrt(muRho);
  const lambdaT: [number, number] = [lambda[0] * Math.sqrt(muLambda),
                                     lambda[1] * Math.sqrt(muLambda)];
  const alpha = Math.atan2(Math.hypot(lambdaT[0], lambdaT[1]), rhoT);
  const beta  = Math.atan2(lambdaT[1], lambdaT[0]);
  return { alpha, beta, m };
}

/**
 * The Stage 1a → 4 escalation, materialised as concrete `Chart` objects
 * keyed by stage. The renderer / tile dispatcher reads these directly.
 */
export const burrauStages = {
  /** Stage 1a: discrete primitive triples at rest. Just a UI layer over
   *  the Euclid display chart with a small landmark list. */
  '1a': {
    chart: burrauEuclidChart,
    landmarks: ['(3,4,5)', '(5,12,13)', '(15,8,17)', '(7,24,25)'],
  },

  /** Stage 1b: continuous ν sweep. Same chart, no landmarks pinned. */
  '1b': { chart: burrauEuclidChart, landmarks: [] as string[] },

  /** Stage 2a: continuous masses at fixed ν (ν₀ = 1/2 → (3,4,5)). */
  '2a': makeBurrauMassChart(0.5),

  /** Stage 2b: (L_z, E) at fixed (3,4,5) shape & masses — the caller
   *  wires `burrauLzEParams(0.5)` into ChartView.chartParams / view.m. */
  '2b': lzEChart,

  /** Stage 3 (combined): mass × kinetic-energy strip. */
  '3': makeThetaDeltaMStrip({ mTarget: [1 / 3, 1 / 3, 1 / 3] }),

  /** Stage 4: full 8D — handled at the interaction layer via tilt
   *  sweeps. The probe lives in `hypothesis_probe.ts`. */
  '4_probe': null as Chart | null,

  /** Bonus: bifurcation strips. */
  thetaK:     makeThetaKStrip({ Kmax: 2, gammaK: 2 }),
  thetaDelta: makeThetaDeltaMStrip({ mTarget: [1 / 3, 1 / 3, 1 / 3] }),

  acuteK:     makeAcuteAngleKChart({ Kmax: 2, gammaK: 2 }),
};
