// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { shapePathToUv } from '@/ui/StreamlineOverlay.js';

const EPS = 0.05;

describe('shapePathToUv — S² path → shape-sphere chart UV', () => {
  it('equator points land at u=0.5 with v = φ/2π', () => {
    // n on the equator: θ=π/2. φ=0 → v=0; φ=π/2 → v=0.25.
    const uv = shapePathToUv([
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ], EPS);
    expect(uv[0]!.u).toBeCloseTo(0.5, 12);
    expect(uv[0]!.v).toBeCloseTo(0, 12);
    expect(uv[1]!.u).toBeCloseTo(0.5, 12);
    expect(uv[1]!.v).toBeCloseTo(0.25, 12);
  });

  it('does not fold across the equator — southern hemisphere maps to u > 0.5', () => {
    // θ = acos(−0.5) ≈ 1.047+... > π/2 → u > 0.5. Folding would snap the
    // path at the equator; the chart renders both hemispheres.
    const uv = shapePathToUv([{ x: Math.sqrt(0.75), y: 0, z: -0.5 }], EPS);
    expect(uv[0]!.u).toBeGreaterThan(0.5);
  });

  it('pole-buffer points return null (segment breaks, matching the chart domain)', () => {
    const uv = shapePathToUv([
      { x: 0, y: 0, z: 1 },        // north pole: θ=0 < ε
      { x: 1, y: 0, z: 0 },        // equator: fine
      { x: 0, y: 0, z: -1 },       // south pole: θ=π > π−ε
    ], EPS);
    expect(uv[0]).toBeNull();
    expect(uv[1]).not.toBeNull();
    expect(uv[2]).toBeNull();
  });

  it('negative φ wraps into [0,1)', () => {
    // n = (0,−1,0): φ = −π/2 → 3π/2 → v = 0.75.
    const uv = shapePathToUv([{ x: 0, y: -1, z: 0 }], EPS);
    expect(uv[0]!.v).toBeCloseTo(0.75, 12);
  });
});
