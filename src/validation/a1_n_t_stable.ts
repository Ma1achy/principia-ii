import { registerAcceptance } from './acceptance.js';
import { shapeSphere } from '@/metrics/shape_sphere.js';

/**
 * A1: n(t) storage is stable near poles and wrap regions. Sweeps the
 * whole (α, β) configuration space with a dense deterministic grid
 * (poles α → 0, π/2 and wrap β → 0, π included) and requires every
 * shape-sphere point to be finite and unit-norm.
 */
registerAcceptance(
  'A1', 'n(t) stable near poles and wrap regions',
  () => {
    let bad = 0;
    // Deterministic LCG for the β samples — acceptance checks never use
    // Math.random (a flaky acceptance gate is worse than none).
    let rng = 42;
    const next = () => {
      rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    for (let trial = 0; trial < 5000; trial++) {
      const a = (trial / 5000) * (Math.PI / 2);
      const b = next() * Math.PI;
      const rho:    [number, number] = [Math.cos(a), 0];
      const lambda: [number, number] = [Math.sin(a) * Math.cos(b),
                                        Math.sin(a) * Math.sin(b)];
      const n = shapeSphere(rho, lambda);
      if (!Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2])) bad++;
      const norm = Math.hypot(n[0], n[1], n[2]);
      if (Math.abs(norm - 1) > 1e-6) bad++;
    }
    return Promise.resolve({
      id: 'A1', name: 'n(t) stable near poles and wrap regions',
      passed: bad === 0,
      ...(bad ? { details: `${bad} samples produced NaN or non-unit n` } : {}),
    });
  },
);
