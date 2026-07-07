import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packSimUniforms, INTEGRATOR_INDEX, type SimUniforms } from '@/gpu/structs.js';

const wgsl = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../../../src/gpu/shaders/${name}`, import.meta.url)), 'utf8');

const BASE: SimUniforms = {
  G: 1, dt_macro: 1e-3, N_max: 64, r_sub: 0.05, gamma_sub: 1.5,
  T_horizon: 80, r_coll: 1e-4, R_esc: 10, k_esc: 8,
  eps_E: 1e-6, eps_L: 1e-6, r_close: 0.01,
  quality_tier: 1, checkpoint_count: 8, samples_per_axis: 16, integrator: 0,
};

describe('GPU integrator selection (three-place rule)', () => {
  it('integrator packs into lane u32[15] (bytes 60..63)', () => {
    const buf = packSimUniforms({ ...BASE, integrator: INTEGRATOR_INDEX.yoshida6 });
    expect(buf.byteLength).toBe(64);
    expect(new Uint32Array(buf)[15]).toBe(2);
  });

  it('INTEGRATOR_INDEX mirrors the WGSL INTEG_* constants', () => {
    const src = wgsl('integrate.wgsl');
    const c = (name: string): number =>
      Number(new RegExp(`const INTEG_${name}: u32\\s*=\\s*(\\d+)u`).exec(src)![1]);
    expect(c('KDK')).toBe(INTEGRATOR_INDEX.kdk);
    expect(c('YOSHIDA4')).toBe(INTEGRATOR_INDEX.yoshida4);
    expect(c('YOSHIDA6')).toBe(INTEGRATOR_INDEX.yoshida6);
    expect(c('RK4')).toBe(INTEGRATOR_INDEX.rk4);
  });

  it('WGSL Yoshida coefficients equal the CPU reference (yoshida.ts)', () => {
    const src = wgsl('integrate.wgsl');
    const c = (name: string): number =>
      Number(new RegExp(`const ${name}: f32\\s*=\\s*(-?[0-9.]+)`).exec(src)![1]);
    // CPU reference values (src/integrate/yoshida.ts).
    const W4_1 = 1 / (2 - Math.cbrt(2));
    expect(c('Y4_W1')).toBeCloseTo(W4_1, 15);
    expect(c('Y4_W2')).toBeCloseTo(-Math.cbrt(2) / (2 - Math.cbrt(2)), 15);
    expect(c('Y6_W1')).toBeCloseTo(0.7845136104775573, 15);
    expect(c('Y6_W2')).toBeCloseTo(0.23557321335935813, 15);
    expect(c('Y6_W3')).toBeCloseTo(-1.177679984178871, 15);
    expect(c('Y6_W4')).toBeCloseTo(1.3151863206839112, 15);
    // Consistency: Y6 weights must sum to 1 (7-stage palindrome).
    const sum = c('Y6_W1') * 2 + c('Y6_W2') * 2 + c('Y6_W3') * 2 + c('Y6_W4');
    expect(sum).toBeCloseTo(1, 12);
    // Y4: 2*w1 + w2 = 1.
    expect(c('Y4_W1') * 2 + c('Y4_W2')).toBeCloseTo(1, 12);
  });

  it('every WGSL SimUniforms declaration carries the integrator lane', () => {
    // The struct is repeated per entry module and must stay byte-identical.
    for (const f of ['simulate.wgsl', 'render_graph.wgsl', 'render_layer0.wgsl', 'reduce.wgsl']) {
      const m = /struct SimUniforms \{[\s\S]*?\};/.exec(wgsl(f));
      expect(m, `${f}: SimUniforms not found`).not.toBeNull();
      expect(m![0]).toContain('integrator');
    }
  });
});
