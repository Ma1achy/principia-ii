import { describe, it, expect } from 'vitest';
import { simUniformsLayout, simResultLayout, formatLayout } from '@/debug/struct_dump.js';
import { sizeOfSimResult } from '@/gpu/structs.js';

describe('simUniformsLayout', () => {
  const L = simUniformsLayout();
  it('totals 96 bytes and matches packSimUniforms offsets', () => {
    expect(L.totalSize).toBe(96);
    const off = Object.fromEntries(L.fields.map((f) => [f.name, f.offset]));
    expect(off['M_total']).toBe(12);
    expect(off['samples_per_axis']).toBe(72);
    expect(off['mu_max']).toBe(76);
    expect(off['q_max']).toBe(84);
  });
  it('every field fits inside the struct', () => {
    for (const f of L.fields) expect(f.offset + f.size).toBeLessThanOrEqual(96);
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
