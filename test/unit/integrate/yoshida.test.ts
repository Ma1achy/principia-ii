import { describe, it, expect } from 'vitest';
import { yoshida4MacroStep, yoshida6MacroStep } from '@/integrate/yoshida.js';
import { kdkMacroStep } from '@/integrate/kdk.js';
import { totalEnergy } from '@/integrate/forces.js';

const sp = { rSub: 0.05, gammaSub: 1.5, NMax: 64 };

/**
 * A smooth, bounded binary (two 0.5 masses) with a distant near-massless third
 * body. It never approaches collision, so substepping stays at 1 and the
 * comparison isolates each integrator's secular energy error by order.
 *
 * NB: an equal-mass equilateral triangle released *from rest* is NOT usable
 * here — it is a homothetic triple-collision orbit (collapses to a point in
 * finite time), which makes every integrator diverge and defeats an order
 * comparison. Use a genuinely smooth orbit instead.
 */
const smoothBinary = () => ({
  m: [0.5, 0.5, 1e-12] as const,
  r: [[1, 0], [-1, 0], [50, 0]] as const,
  p: [[0, 0.3], [0, -0.3], [0, 0]] as const,
  t: 0,
});

describe('Yoshida 4 / 6', () => {
  it('Y4 has lower long-horizon energy drift than KDK', () => {
    const s0 = smoothBinary();
    const E0 = totalEnergy(s0.m, s0.r, s0.p);
    let kdk = s0 as any, y4 = s0 as any;
    const dt = 1e-2, T = 50;
    for (let t = 0; t < T; t += dt) {
      kdk = kdkMacroStep(kdk, dt, sp).state;
      y4  = yoshida4MacroStep(y4, dt, sp).state;
    }
    const driftKdk = Math.abs(totalEnergy(kdk.m, kdk.r, kdk.p) - E0);
    const driftY4  = Math.abs(totalEnergy(y4.m,  y4.r,  y4.p)  - E0);
    expect(driftY4).toBeLessThan(driftKdk);
  });

  it('Y6 has lower drift than Y4 at the same step size on smooth orbits', () => {
    const s0 = smoothBinary();
    const E0 = totalEnergy(s0.m, s0.r, s0.p);
    let y4 = s0 as any, y6 = s0 as any;
    const dt = 1e-2, T = 50;
    for (let t = 0; t < T; t += dt) {
      y4 = yoshida4MacroStep(y4, dt, sp).state;
      y6 = yoshida6MacroStep(y6, dt, sp).state;
    }
    const dy4 = Math.abs(totalEnergy(y4.m, y4.r, y4.p) - E0);
    const dy6 = Math.abs(totalEnergy(y6.m, y6.r, y6.p) - E0);
    expect(dy6).toBeLessThan(dy4);
  });
});
