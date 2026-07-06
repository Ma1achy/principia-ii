import { registerChart } from './registry.js';
import { latentSliceChart } from './charts/latent_slice.js';
import { lzEChart }  from './charts/lz_e.js';
import { lzKChart }  from './charts/lz_k.js';
import { shapeSphereChart } from './charts/shape_sphere.js';
import { massSimplexChart }  from './charts/mass_simplex.js';
import { burrauEuclidChart } from './charts/burrau_euclid.js';

registerChart(latentSliceChart);
registerChart(lzEChart);
registerChart(lzKChart);
registerChart(shapeSphereChart);
registerChart(massSimplexChart);
registerChart(burrauEuclidChart);

export * from './types.js';
export * from './flags.js';
export * from './registry.js';
export * from './validation.js';
export * from './momentum_construction.js';
export * from './frozen_configuration.js';
export { makeMixedAxisChart } from './charts/mixed_axis.js';
export type { AxisSpec } from './charts/mixed_axis.js';
