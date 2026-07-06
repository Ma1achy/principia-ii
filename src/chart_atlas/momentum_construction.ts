import type { Vec2, Vec3, Triple } from '@/math/types.js';
import { J } from '@/math/vec.js';

/**
 * Deterministic momentum construction at fixed (L_z, K*). Used by the
 * (L_z, E) and (L_z, K) charts (they share it: with the configuration
 * frozen, E = U(r) + K*, so the E-axis is the K-axis shifted by U).
 *
 *   (i)   rigid part: ω = L_z / I,  v^L_i = ω · J(r_i), carrying exactly
 *         K_min = L_z² / (2 I);
 *   (ii)  seed field w: subtract COM drift, subtract the L_z component
 *         (β = L(w)/I, w := w − β·J(r)), normalise in the mass-weighted
 *         norm Σ mᵢ|wᵢ|² = 1;
 *   (iii) mix v_i = v^L_i + a·w_i with a = √(2(K* − K_min)). Because the
 *         L_z projection makes Σ mᵢ v^L_i · wᵢ = ω·L(w) = 0, the mix hits
 *         K* and L_z exactly — no iteration.
 *
 * Gauge: canonical COM frame at R̃ = 1 ⇒ I = Σ mᵢ|rᵢ|² = 1; callers pass
 * I explicitly so the invariant is visible at the call site.
 *
 * Returns particle VELOCITIES (caller multiplies by mᵢ for momenta).
 * ADR-0007 mapping: 'infeasible' → INFEASIBLE_ENERGY (15),
 * 'seeds_exhausted' → MOMENTUM_SEEDS_EXHAUSTED (16).
 */
export type MomentumConstruction =
  | { kind: 'ok'; v: Triple<Vec2>; usedSeed: number }
  | { kind: 'infeasible' }
  | { kind: 'seeds_exhausted' };

export function constructMomentaForLzK(
  m: Vec3, r: Triple<Vec2>, Lz: number, KTarget: number, I = 1,
): MomentumConstruction {
  const omega = Lz / I;
  const Kmin = Lz * Lz / (2 * I);

  if (KTarget < Kmin - 1e-15) return { kind: 'infeasible' };

  const vL: Triple<Vec2> = [
    [omega * -r[0][1], omega * r[0][0]],
    [omega * -r[1][1], omega * r[1][0]],
    [omega * -r[2][1], omega * r[2][0]],
  ];

  // Seed families, tried in order until one survives the projection.
  // NOTE: the all-body rotational field [J(r_0), J(r_1), J(r_2)] is the
  // pure-rotation direction — the L_z projection annihilates it to zero
  // every time, so only PARTIAL rotational seeds appear here.
  const seedFamilies: Triple<Vec2>[] = [
    [r[0], r[1], r[2]],                 // radial (ρ̃/λ̃ directions)
    [[0, 0], [0, 0], r[2]],             // outer-body radial
    [J(r[0]), J(r[1]), [0, 0]],         // partial rotation (inner pair)
    [[0, 0], [0, 0], J(r[2])],          // partial rotation (outer body)
  ];
  for (let s = 0; s < seedFamilies.length; s++) {
    const w = projectAndNormalise(seedFamilies[s]!, m, r, I);
    if (w) {
      // K* can sit within fp noise below K_min — clamp before the sqrt.
      const a = Math.sqrt(Math.max(0, 2 * (KTarget - Kmin)));
      return {
        kind: 'ok',
        usedSeed: s,
        v: [
          [vL[0][0] + a * w[0][0], vL[0][1] + a * w[0][1]],
          [vL[1][0] + a * w[1][0], vL[1][1] + a * w[1][1]],
          [vL[2][0] + a * w[2][0], vL[2][1] + a * w[2][1]],
        ],
      };
    }
  }
  return { kind: 'seeds_exhausted' };
}

function projectAndNormalise(
  seed: Triple<Vec2>, m: Vec3, r: Triple<Vec2>, I: number,
  epsW = 1e-10,
): Triple<Vec2> | null {
  // Remove COM drift.
  const M = m[0] + m[1] + m[2];
  const cx = (m[0] * seed[0][0] + m[1] * seed[1][0] + m[2] * seed[2][0]) / M;
  const cy = (m[0] * seed[0][1] + m[1] * seed[1][1] + m[2] * seed[2][1]) / M;
  let w: Triple<Vec2> = [
    [seed[0][0] - cx, seed[0][1] - cy],
    [seed[1][0] - cx, seed[1][1] - cy],
    [seed[2][0] - cx, seed[2][1] - cy],
  ];
  // Remove the L_z component: β = L(w) / I, w := w − β·J(r), where
  // L(w) = Σ mᵢ (rᵢ × wᵢ)_z.
  const Lw = m[0] * (r[0][0] * w[0][1] - r[0][1] * w[0][0])
           + m[1] * (r[1][0] * w[1][1] - r[1][1] * w[1][0])
           + m[2] * (r[2][0] * w[2][1] - r[2][1] * w[2][0]);
  const beta = Lw / I;
  w = [
    [w[0][0] + beta * r[0][1], w[0][1] - beta * r[0][0]],
    [w[1][0] + beta * r[1][1], w[1][1] - beta * r[1][0]],
    [w[2][0] + beta * r[2][1], w[2][1] - beta * r[2][0]],
  ];
  // Mass-weighted norm; reject degenerate (collinear / zero) seeds.
  const mwn2 = m[0] * (w[0][0] ** 2 + w[0][1] ** 2)
             + m[1] * (w[1][0] ** 2 + w[1][1] ** 2)
             + m[2] * (w[2][0] ** 2 + w[2][1] ** 2);
  if (mwn2 < epsW * epsW) return null;
  const inv = 1 / Math.sqrt(mwn2);
  return [
    [w[0][0] * inv, w[0][1] * inv],
    [w[1][0] * inv, w[1][1] * inv],
    [w[2][0] * inv, w[2][1] * inv],
  ];
}
