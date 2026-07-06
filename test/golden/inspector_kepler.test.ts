import { describe, it, expect } from 'vitest';
import { runInspector } from '@/inspector/run.js';
import { RK45_DEFAULTS } from '@/inspector/types.js';

describe('Kepler energy conservation', () => {
  it('holds energy to 1e-12 over T = 1000 on a tight binary', () => {
    const m = [0.5, 0.5, 1e-12] as const;
    const v0 = Math.sqrt(0.25 / 1);
    const s0 = {
      r: [[0.5, 0], [-0.5, 0], [1e6, 0]] as const,
      p: [[0,  0.5*v0], [0, -0.5*v0], [0, 0]] as const,
      m, t: 0,
    };
    // RK45 is not symplectic: energy drifts secularly. On this smooth
    // orbit the step controller rides hMax the whole way, so the binding
    // knob is hMax, NOT the per-step tolerance (defaults land at ~7e-12
    // regardless of epsRel; hMax=2e-3 gets under 1e-12 — truncation-
    // dominated, empirically calibrated; see principia-inspector skill).
    const r = runInspector(s0 as any, {
      ...RK45_DEFAULTS, THorizon: 1000, fullTrace: false,
      epsRel: 1e-11, epsAbs: 1e-13, hMax: 2e-3,
    });
    expect(r.outcome).toBe('bounded');
    expect(r.deltaEMax).toBeLessThan(1e-12);
  }, 60_000);
});
