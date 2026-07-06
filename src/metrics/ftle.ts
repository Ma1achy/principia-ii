/**
 * Benettin-style FTLE estimator. Caller supplies the integrator and the
 * separation/renormalisation primitives so this is integrator-agnostic.
 *
 * The mass-weighted phase-space norm is the spec's default choice
 * (§4.3.3): δ² = Σ m_i |Δr_i|² + α Σ (1/m_i) |Δp_i|².
 */
export interface FtleHandles {
  step:       () => void;        // advance both base and shadow by one macro step
  separation: () => number;      // current ||Δ|| in the chosen norm
  renormalise: () => void;       // shadow ← base + (shadow - base) * δ_0 / δ
}

export function benettinFTLE(
  h: FtleHandles, T: number, dtMacro: number, mRenorm: number, delta0: number,
): { lambda: number; renorms: number; valid: boolean } {
  let S = 0;
  let renorms = 0;
  let dt = 0;

  while (dt < T) {
    for (let s = 0; s < mRenorm; s++) {
      h.step();
      dt += dtMacro;
      if (dt >= T) break;
    }
    const dj = h.separation();
    if (!Number.isFinite(dj) || dj === 0) {
      return { lambda: 0, renorms, valid: false };
    }
    S += Math.log(dj / delta0);
    h.renormalise();
    renorms++;
  }

  return { lambda: S / Math.max(dt, 1e-12), renorms, valid: renorms > 0 };
}

/** Mass-weighted phase-space norm. */
export function massWeightedNorm(
  m: readonly [number, number, number],
  dr: readonly [readonly [number,number], readonly [number,number], readonly [number,number]],
  dp: readonly [readonly [number,number], readonly [number,number], readonly [number,number]],
  alpha = 1,
): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const drx = dr[i]![0], dry = dr[i]![1];
    const dpx = dp[i]![0], dpy = dp[i]![1];
    s += m[i]! * (drx*drx + dry*dry);
    s += alpha * (dpx*dpx + dpy*dpy) / m[i]!;
  }
  return Math.sqrt(s);
}
