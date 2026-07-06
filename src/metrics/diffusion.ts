/**
 * Windowed least-squares frequency fit. Given (t_k, θ̃_k) inside one
 * window, returns the slope ω of the best-fit line. The ≥3 samples gate
 * matches the corrected spec (older drafts said ≥4; M=8 default produces
 * 3 samples per full window).
 */
export function fitOmega(t: number[], thetaTilde: number[]): number | null {
  if (t.length < 3) return null;
  let tBar = 0, yBar = 0;
  for (let i = 0; i < t.length; i++) { tBar += t[i]!; yBar += thetaTilde[i]!; }
  tBar /= t.length; yBar /= t.length;
  let num = 0, den = 0;
  for (let i = 0; i < t.length; i++) {
    const dt = t[i]! - tBar;
    num += dt * (thetaTilde[i]! - yBar);
    den += dt * dt;
  }
  if (den === 0) return null;
  return num / den;
}

export interface DiffusionWindows {
  W1: [number, number];     // [T/4, T/2]
  W2: [number, number];     // [T/2, 3T/4]
}

export function defaultDiffusionWindows(T: number): DiffusionWindows {
  return { W1: [T / 4, T / 2], W2: [T / 2, 3 * T / 4] };
}

/**
 * Two-window diffusion. Returns the magnitude of the frequency change.
 * Sentinel `-1.0` for any window with too-few samples (spec contract:
 * never NaN under WGSL).
 */
export function diffusion(
  t: number[], thetaTilde: number[], T: number,
): { value: number; suspect: boolean } {
  const w = defaultDiffusionWindows(T);
  const inWin = (start: number, end: number): { ts: number[]; ys: number[] } => {
    const ts: number[] = [], ys: number[] = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i]! >= start && t[i]! <= end) {
        ts.push(t[i]!); ys.push(thetaTilde[i]!);
      }
    }
    return { ts, ys };
  };
  const a = inWin(w.W1[0], w.W1[1]);
  const b = inWin(w.W2[0], w.W2[1]);
  const w1 = fitOmega(a.ts, a.ys);
  const w2 = fitOmega(b.ts, b.ys);
  if (w1 === null || w2 === null) {
    return { value: -1, suspect: false };       // sentinel
  }
  const partial = b.ts.length < 4;              // partial window flag
  return { value: Math.abs(w2 - w1), suspect: partial };
}
