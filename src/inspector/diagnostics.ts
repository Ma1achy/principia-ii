import type { TrajState } from '@/math/types.js';
import { totalEnergy, angularMomentum } from '@/integrate/forces.js';
import { shapeSphere, massWeightedJacobi } from '@/metrics/shape_sphere.js';
import { particlePositionsToJacobi } from '@/decode/jacobi_particle.js';

export function diagnosticsAt(s: TrajState): {
  E: number; Lz: number; n: { x: number; y: number; z: number };
} {
  const E  = totalEnergy(s.m, s.r, s.p);
  const Lz = angularMomentum(s.r, s.p);
  const { rho, lambda } = particlePositionsToJacobi(s.r, s.m);
  const { rhoT, lambdaT } = massWeightedJacobi(rho, lambda, s.m);
  const n = shapeSphere(rhoT, lambdaT);
  return { E, Lz, n: { x: n[0], y: n[1], z: n[2] } };
}
