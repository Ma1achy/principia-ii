import { registerAcceptance } from './acceptance.js';
import { run } from '@/integrate/run.js';
import type { TrajState } from '@/math/types.js';

registerAcceptance(
  'A6', 'bounded-trajectory energy drift below threshold',
  () => {
    // Equal-mass binary with a distant near-massless third body — a
    // bounded configuration over the test horizon.
    const s0: TrajState = {
      m: [0.4999, 0.4999, 0.0002],
      r: [[0.5, 0], [-0.5, 0], [50, 0]],
      p: [[0, 0.4999 * 0.5], [0, -0.4999 * 0.5], [0, 0]],
      t: 0,
    };
    const result = run(s0, {
      integrator: 'yoshida4',
      dtMacro: 1e-3, THorizon: 50,
      rColl: 1e-4, REsc: 10, kEsc: 8,
      substep: { rSub: 0.05, gammaSub: 1.5, NMax: 64 },
    });
    const passed = result.diagnostics.energyDrift < 1e-4;
    return Promise.resolve({
      id: 'A6', name: 'bounded-trajectory energy drift below threshold',
      passed,
      details: `energyDrift = ${result.diagnostics.energyDrift.toExponential(3)}, terminal = ${result.terminal.kind}`,
    });
  },
);
