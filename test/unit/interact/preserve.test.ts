import { describe, it, expect } from 'vitest';
import { lockAffine } from '@/interact/lock.js';
import { defaultViewState } from '@/interact/view_state.js';
import { preserveLockAcrossChart } from '@/interact/preserve.js';

describe('preserveLockAcrossChart', () => {
  it('passes through chart change for an unlocked view', () => {
    const v = defaultViewState();
    const r = preserveLockAcrossChart(v, 'lz_e');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.view.chartType).toBe('lz_e');
      expect(r.view.locked).toBe(false);
    }
  });

  it('preserves a locked physical IC', () => {
    const v0 = lockAffine(defaultViewState(), { s: 0.6, t: 0.4 });
    const r = preserveLockAcrossChart(v0, 'shape_sphere');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const before = v0.lockedPhysical!;
      const after  = r.view.lockedPhysical!;
      for (let i = 0; i < 3; i++) {
        expect(after.r[i]![0]).toBeCloseTo(before.r[i]![0], 4);
        expect(after.r[i]![1]).toBeCloseTo(before.r[i]![1], 4);
      }
    }
  });
});
