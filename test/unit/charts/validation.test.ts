import { describe, it, expect } from 'vitest';
import { compatible } from '@/chart_atlas/validation.js';
import { lzEChart } from '@/chart_atlas/charts/lz_e.js';
import { latentSliceChart } from '@/chart_atlas/charts/latent_slice.js';

describe('chart compatibility', () => {
  it('refuses energy normalisation on an invariant chart', () => {
    const r = compatible(lzEChart, 0.5);
    expect(r.ok).toBe(false);
  });

  it('allows energy normalisation on the latent chart', () => {
    expect(compatible(latentSliceChart, 0.5).ok).toBe(true);
  });

  it('allows undefined target on any chart', () => {
    expect(compatible(lzEChart).ok).toBe(true);
  });
});
