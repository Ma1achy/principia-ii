import { describe, it, expect, vi } from 'vitest';
import { Store } from '@/app/store.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('Store', () => {
  it('starts at the initial view', () => {
    const v = defaultViewState();
    expect(new Store(v).snapshot()).toBe(v);
  });

  it('subscribers fire once on subscribe and on every setView', () => {
    const s = new Store();
    const cb = vi.fn();
    s.subscribe(cb);
    expect(cb).toHaveBeenCalledTimes(1);     // initial fire
    s.setView({ ...s.snapshot(), zoom: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops further notifications', () => {
    const s = new Store();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    off();
    s.setView({ ...s.snapshot(), zoom: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('update applies a functional patch', () => {
    const s = new Store();
    s.update((v) => ({ ...v, zoom: 7 }));
    expect(s.snapshot().zoom).toBe(7);
  });
});
