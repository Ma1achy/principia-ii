import { describe, it, expect } from 'vitest';
import {
  packChartUniforms, unpackChartUniforms, CHART_UNIFORMS_DEFAULTS,
} from '@/gpu/chart_uniforms.js';
import { CHART_UNIFORMS_SIZE } from '@/gpu/layouts.js';

describe('ChartUniforms packing', () => {
  it('round-trips defaults', () => {
    const buf = packChartUniforms(CHART_UNIFORMS_DEFAULTS);
    const back = unpackChartUniforms(buf);
    expect(back.mu_max).toBe(CHART_UNIFORMS_DEFAULTS.mu_max);
    expect(back.alpha_min).toBeCloseTo(CHART_UNIFORMS_DEFAULTS.alpha_min, 7);
    expect(back.alpha_freeze).toBeCloseTo(Math.PI / 4, 6);
    expect(back.m_target[0]).toBeCloseTo(1 / 3, 6);
    expect(back.m_target[1]).toBeCloseTo(1 / 3, 6);
    expect(back.m_target[2]).toBeCloseTo(1 / 3, 6);
  });

  it('produces a 64-byte buffer (= CHART_UNIFORMS_SIZE, the G3 slot)', () => {
    expect(packChartUniforms(CHART_UNIFORMS_DEFAULTS).byteLength).toBe(64);
    expect(CHART_UNIFORMS_SIZE).toBe(64);
  });

  it('preserves field order across the f32 layout', () => {
    const c = { ...CHART_UNIFORMS_DEFAULTS,
                mu_max: 7.5, alpha_min: 0.123, q_max: 1.7 };
    const f = new Float32Array(packChartUniforms(c));
    expect(f[0]).toBeCloseTo(7.5, 6);
    expect(f[1]).toBeCloseTo(0.123, 6);
    expect(f[2]).toBeCloseTo(1.7, 6);
  });

  it('packs the target masses as three scalar lanes at f32[10..12]', () => {
    // A vec3<f32> in the WGSL struct would 16-align to offset 48 and read
    // the wrong lanes — the WGSL side uses three scalars for this reason.
    const f = new Float32Array(packChartUniforms(
      { ...CHART_UNIFORMS_DEFAULTS, m_target: [0.6, 0.3, 0.1] }));
    expect(f[10]).toBeCloseTo(0.6, 6);
    expect(f[11]).toBeCloseTo(0.3, 6);
    expect(f[12]).toBeCloseTo(0.1, 6);
    expect(f[13]).toBe(0);   // reserved tail stays zero
  });
});
