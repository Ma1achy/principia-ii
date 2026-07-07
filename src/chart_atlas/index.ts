import { registerChart } from './registry.js';
import { latentSliceChart } from './charts/latent_slice.js';
import { lzEChart }  from './charts/lz_e.js';
import { lzKChart }  from './charts/lz_k.js';
import { shapeSphereChart } from './charts/shape_sphere.js';
import { massSimplexChart }  from './charts/mass_simplex.js';
import { burrauEuclidChart } from './charts/burrau_euclid.js';
import { mixedAxisChart } from './charts/mixed_axis.js';
import { jacobiPositionChart, jacobiMomentumChart } from './charts/jacobi.js';

registerChart(latentSliceChart);
registerChart(lzEChart);
registerChart(lzKChart);
registerChart(shapeSphereChart);
registerChart(massSimplexChart);
registerChart(burrauEuclidChart);
registerChart(mixedAxisChart);
registerChart(jacobiPositionChart);
registerChart(jacobiMomentumChart);

export * from './types.js';
export * from './flags.js';
export * from './registry.js';
export * from './validation.js';
export * from './momentum_construction.js';
export * from './frozen_configuration.js';
export {
  makeMixedAxisChart, mixedAxisChart, axesOf, pairingError,
  AXIS_KINDS, DEFAULT_AXES,
} from './charts/mixed_axis.js';
export type { AxisSpec } from './charts/mixed_axis.js';
export { jacobiPositionChart, jacobiMomentumChart } from './charts/jacobi.js';
