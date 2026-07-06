import { describe, it, expect } from 'vitest';
import {
  sigmoid, logit, artanh, clamp, clamp01, smoothstep, symlog, signDeadband,
} from '@/math/scalar.js';

describe('sigmoid / logit', () => {
  it('round-trips on a sweep of points away from saturation', () => {
    for (let s = 0.05; s < 1; s += 0.05) {
      const z = logit(s);
      expect(sigmoid(z)).toBeCloseTo(s, 12);
    }
  });

  it('is numerically stable for large negative z', () => {
    // σ(-1000) ≈ e^-1000 ≈ 5e-435 is below the smallest float64 subnormal, so
    // it correctly saturates to exactly 0 — the guarantee is finite, never NaN.
    expect(sigmoid(-1000)).toBeGreaterThanOrEqual(0);
    expect(sigmoid(-1000)).toBeLessThan(1e-100);
    expect(Number.isFinite(sigmoid(-1000))).toBe(true);
  });

  it('is numerically stable for large positive z', () => {
    expect(sigmoid(1000)).toBeCloseTo(1, 15);
    expect(Number.isFinite(sigmoid(1000))).toBe(true);
  });

  it('hits the half-point exactly at z = 0', () => {
    expect(sigmoid(0)).toBe(0.5);
  });
});

describe('artanh', () => {
  it('round-trips with tanh', () => {
    for (const x of [-0.9, -0.3, 0, 0.3, 0.9]) {
      expect(Math.tanh(artanh(x))).toBeCloseTo(x, 12);
    }
  });
});

describe('clamp / clamp01', () => {
  it('passes values inside the range unchanged', () => {
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp01(0.7)).toBe(0.7);
  });
  it('snaps to bounds outside', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp01(-1e-10)).toBe(0);
    expect(clamp01(1 + 1e-10)).toBe(1);
  });
});

describe('smoothstep', () => {
  it('matches WGSL plateau behaviour outside [edge0, edge1]', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
  it('hits 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
  it('has (near-)zero derivative at the endpoints', () => {
    // s'(t) = 6t(1-t) is exactly 0 at both endpoints. A forward difference over
    // a step `eps` estimates s'(0) + (eps/2)·s''(0) = O(eps) ≈ 3·eps, so the
    // slope is O(eps), not machine-zero — and vanishingly small next to the
    // interior slope s'(0.5) = 1.5.
    const eps = 1e-6;
    const dLow  = (smoothstep(0, 1, eps) - smoothstep(0, 1, 0))     / eps;
    const dHigh = (smoothstep(0, 1, 1)   - smoothstep(0, 1, 1-eps)) / eps;
    expect(dLow).toBeLessThan(1e-4);
    expect(dHigh).toBeLessThan(1e-4);
  });
});

describe('symlog', () => {
  it('is linear inside ±ε', () => {
    expect(symlog(1e-4, 1e-3)).toBeCloseTo(0.1, 12);
    expect(symlog(-5e-4, 1e-3)).toBeCloseTo(-0.5, 12);
  });
  it('is monotonic across the boundary', () => {
    const eps = 1e-3;
    const a = symlog(eps,        eps);
    const b = symlog(eps + 1e-9, eps);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('signDeadband', () => {
  it('returns 0 inside the band', () => {
    expect(signDeadband(0,    1e-12)).toBe(0);
    expect(signDeadband(1e-13, 1e-12)).toBe(0);
  });
  it('returns the sign outside', () => {
    expect(signDeadband(-1,    1e-12)).toBe(-1);
    expect(signDeadband(2e-12, 1e-12)).toBe(1);
  });
});
