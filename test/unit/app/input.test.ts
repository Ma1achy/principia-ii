import { describe, it, expect } from 'vitest';
import { Store } from '@/app/store.js';
import { InputHandlers } from '@/app/input.js';

describe('InputHandlers', () => {
  it('setSlider mutates only the targeted slot', () => {
    const s = new Store();
    new InputHandlers(s).setSlider(3, 0.7);
    expect(s.snapshot().z0[3]).toBe(0.7);
    expect(s.snapshot().z0[0]).toBe(0);
  });

  it('zoom adjusts mag by the log step', () => {
    const s = new Store();
    const before = s.snapshot().mag;
    new InputHandlers(s).zoom(1);     // halve the half-width
    expect(s.snapshot().mag).toBeCloseTo(before / 2, 12);
  });

  it('lock sets the locked flag and pins a physical IC', () => {
    const s = new Store();
    new InputHandlers(s).lock({ s: 0.5, t: 0.5 });
    expect(s.snapshot().locked).toBe(true);
    expect(s.snapshot().lockedPhysical).toBeDefined();
  });

  it('unlock clears the lock and the physical pin', () => {
    const s = new Store();
    const ih = new InputHandlers(s);
    ih.lock({ s: 0.5, t: 0.5 });
    ih.unlock();
    expect(s.snapshot().locked).toBe(false);
    expect(s.snapshot().lockedPhysical).toBeUndefined();
  });

  it('lookup writes back when ok and locks the result', () => {
    const s = new Store();
    const r = new InputHandlers(s).lookup({ kind: 'pythag', m: 2, n: 1 });
    expect(r.ok).toBe(true);
    expect(s.snapshot().locked).toBe(true);
  });

  it('even a near-collision lookup succeeds via clamping (decode totality)', () => {
    // The decode pipeline is total: αMin/qMax clamps keep every input
    // decodable, so with default knobs `lookup` cannot hit a terminal —
    // it surfaces the projection as a clamped-ok instead of rejecting.
    // (Chart-specific validators that CAN reject arrive with M10 charts.)
    const s = new Store();
    const r = new InputHandlers(s).lookup({
      kind: 'physical',
      m: [1 / 3, 1 / 3, 1 / 3],
      r: [[0, 0], [1e-6, 0], [10, 10]],
      p: [[0, 0], [0, 0], [0, 0]],
    });
    expect(r.ok).toBe(true);
    expect(s.snapshot().locked).toBe(true);
  });

  it('switchChart preserves a locked physical IC', () => {
    const s = new Store();
    const ih = new InputHandlers(s);
    ih.lock({ s: 0.5, t: 0.5 });
    const before = s.snapshot().lockedPhysical!;
    const r = ih.switchChart('lz_e');
    expect(r.ok).toBe(true);
    expect(s.snapshot().chartType).toBe('lz_e');
    const after = s.snapshot().lockedPhysical!;
    for (let i = 0; i < 3; i++) {
      expect(after.r[i]![0]).toBeCloseTo(before.r[i]![0], 4);
      expect(after.r[i]![1]).toBeCloseTo(before.r[i]![1], 4);
    }
  });
});
