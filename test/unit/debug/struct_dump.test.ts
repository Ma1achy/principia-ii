import { describe, it, expect } from 'vitest';
import {
  simUniformsLayout, chartUniformsLayout, simResultLayout, formatLayout,
} from '@/debug/struct_dump.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

describe('simUniformsLayout', () => {
  const L = simUniformsLayout();
  it('totals 64 bytes and matches packSimUniforms offsets (G4 slim layout)', () => {
    expect(L.totalSize).toBe(64);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['G']).toBe(0);
    expect(off['N_max']).toBe(8);
    expect(off['k_esc']).toBe(32);
    expect(off['samples_per_axis']).toBe(56);
  });
  it('every field fits inside the struct', () => {
    for (const f of L.fields) expect(f.offset + f.size).toBeLessThanOrEqual(64);
  });
});

describe('chartUniformsLayout (G4)', () => {
  const L = chartUniformsLayout();
  it('totals 64 bytes; m*_target are scalars at 40/44/48, NOT a 16-aligned vec3', () => {
    expect(L.totalSize).toBe(64);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['mu_max']).toBe(0);
    expect(off['nu_burrau']).toBe(36);
    expect(off['m1_target']).toBe(40);
    expect(off['m2_target']).toBe(44);
    expect(off['m3_target']).toBe(48);
  });
  it('matches packChartUniforms lane-for-lane', async () => {
    const { packChartUniforms, CHART_UNIFORMS_DEFAULTS } =
      await import('@/gpu/chart_uniforms.js');
    const f = new Float32Array(packChartUniforms(
      { ...CHART_UNIFORMS_DEFAULTS, nu_burrau: 0.75, m_target: [0.5, 0.3, 0.2] }));
    expect(f[9]).toBeCloseTo(0.75, 6);
    expect(f[10]).toBeCloseTo(0.5, 6);
    expect(f[11]).toBeCloseTo(0.3, 6);
    expect(f[12]).toBeCloseTo(0.2, 6);
  });
});

describe('simResultLayout', () => {
  it('M=8 totals 208 bytes; descriptor at offset 188', () => {
    const L = simResultLayout(8);
    expect(L.totalSize).toBe(sizeOfSimResult(8));
    expect(L.totalSize).toBe(208);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['free_group_word']).toBe(128);
    expect(off['arc_length_n']).toBe(144);
    expect(off['sample_descriptor']).toBe(188);
    expect(off['trajectory_stats']).toBe(192);
  });
  it('formatLayout produces a non-empty table header', () => {
    expect(formatLayout(simResultLayout(8))).toContain('SimResult(M=8)');
  });
});
