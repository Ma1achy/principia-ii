import type { Vec2, Vec3, Triple } from '@/math/types.js';
import { jacobiToParticlePositions } from '@/decode/jacobi_particle.js';

/**
 * Realise a frozen configuration (α, β) at the R̃ = 1 hyperspherical
 * gauge: ρ̃ = [cos α, 0], λ̃ = [sin α cos β, sin α sin β], unweighted by
 * √μ and reconstructed to particle positions in the COM frame.
 *
 * Shared by every chart that fixes geometry ((L_z, E)/(L_z, K), shape
 * sphere, mass simplex) — one copy, not three. Do NOT build this by
 * mutating `decodeConfigCanonical`'s output: its Vec2s are readonly.
 *
 * At this gauge the COM-frame moment of inertia is
 * I = Σ mᵢ|rᵢ|² = |ρ̃|² + |λ̃|² = 1, which the momentum construction
 * relies on.
 */
export function realiseFrozenConfig(
  alpha: number, beta: number, m: Vec3,
): Triple<Vec2> {
  const rhoT:    Vec2 = [Math.cos(alpha), 0];
  const lambdaT: Vec2 = [Math.sin(alpha) * Math.cos(beta),
                         Math.sin(alpha) * Math.sin(beta)];
  const muRho    = (m[0] * m[1]) / (m[0] + m[1]);
  const muLambda = m[2] * (m[0] + m[1]);
  const rho:    Vec2 = [rhoT[0] / Math.sqrt(muRho), rhoT[1] / Math.sqrt(muRho)];
  const lambda: Vec2 = [lambdaT[0] / Math.sqrt(muLambda),
                        lambdaT[1] / Math.sqrt(muLambda)];
  return jacobiToParticlePositions(rho, lambda, m);
}
